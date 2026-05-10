// Per-connection bridge between a browser admin client (Socket.IO) and the
// OpenAI Realtime API (raw WebSocket).
//
// Lifecycle:
//   1. Admin client opens a Socket.IO connection with init metadata
//      (projectId, activeSessionId, sourceLang, sessionContext, persona, etc.)
//   2. RealtimeRelaySession opens a transcription session to OpenAI using
//      gpt-realtime-whisper, configured with the dental-medical prompt.
//   3. Browser streams PCM16 24kHz mono frames via 'audio' events; we forward
//      each frame as input_audio_buffer.append to OpenAI.
//   4. OpenAI emits conversation.item.input_audio_transcription.delta and
//      .completed events. We surface deltas to the client immediately, persist
//      "translating" rows to RTDB, and on completion run the gpt-realtime-2
//      Translator to produce refined + ko/en/ja JSON.
//   5. Final segment is written back to RTDB; audience views update via the
//      existing onValue subscription (no client changes there).

import WebSocket from "ws"
import * as admin from "firebase-admin"
import OpenAI from "openai"
import type { Socket } from "socket.io"

import { isGarbage, sanitize } from "./filters.js"
import { loadPersona, mergePersona } from "./persona.js"
import { Translator, type PersonaConfig, type TranslateResult } from "./translate.js"

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime"
// The actual upgrade is the STT side (gpt-realtime-whisper). Translation
// stays on the model that was working in production. Both are env-overridable
// for instant rollback or experimentation.
const STT_MODEL = process.env.OPENAI_STT_MODEL || "gpt-realtime-whisper"
const TRANSLATION_MODEL = process.env.OPENAI_REASONING_MODEL || "gpt-4o-mini"

const DENTAL_PROMPT_KO = "임플란트, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, 보철"
const DENTAL_PROMPT_EN = "Implant, Sinus, Bone Graft, Fixture, Abutment, Crown"

interface RelayInit {
    projectId: string
    activeSessionId: string
    sourceLang: "ko" | "en" | "ja" | "zh"
    sessionContext: string
    customKeywords: string
    targetLanguages: string[]
    persona: PersonaConfig | null
    sourceLabel: string
}

interface OpenAIRealtimeEvent {
    type: string
    [key: string]: unknown
}

function defaultBasePrompt(lang: string): string {
    if (lang === "en") return DENTAL_PROMPT_EN
    return DENTAL_PROMPT_KO
}

function pickBasePrompt(lang: string, persona: PersonaConfig | null): string {
    if (persona && persona.enabled) {
        if (lang === "ko" && persona.basePromptKo) return persona.basePromptKo
        if (lang === "en" && persona.basePromptEn) return persona.basePromptEn
        if (lang === "ja" && persona.basePromptJa) return persona.basePromptJa
        if (lang === "zh" && persona.basePromptZh) return persona.basePromptZh
    }
    return defaultBasePrompt(lang)
}

export class RealtimeRelaySession {
    private clientSocket: Socket
    private openaiSocket: WebSocket | null = null
    private openai: OpenAI
    private translator: Translator
    private init: RelayInit
    private apiKey: string
    private currentSegmentId: string | null = null
    private currentPartial = ""
    private previousRefined = ""
    private closed = false

    constructor(socket: Socket, init: RelayInit, apiKey: string) {
        this.clientSocket = socket
        this.init = init
        this.apiKey = apiKey
        this.openai = new OpenAI({ apiKey })
        this.translator = new Translator(this.openai, TRANSLATION_MODEL)
    }

    async start(): Promise<void> {
        // Defense in depth: even if the client init omits persona or sends a
        // stale snapshot, we always re-read the canonical config from RTDB
        // and merge with the client-provided override. Per-session persona
        // (e.g. "Opening Ceremony") wins over project default — see
        // persona.ts loadPersona for the resolution order.
        //
        // `forceFresh: true` bypasses the 5-min cache because an admin may
        // have just edited the persona seconds before clicking START
        // BROADCAST — we always want the newest config on session start.
        const serverPersona = await loadPersona(
            this.init.projectId,
            this.init.activeSessionId,
            true,
        )
        this.init.persona = mergePersona(serverPersona, this.init.persona)

        await this.connectUpstream()
        this.wireClientEvents()
    }

    private connectUpstream(): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = `${OPENAI_REALTIME_URL}?intent=transcription&model=${encodeURIComponent(STT_MODEL)}`
            const ws = new WebSocket(url, {
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    "OpenAI-Beta": "realtime=v1",
                },
            })

            ws.on("open", () => {
                this.openaiSocket = ws
                this.sendSessionConfig()
                resolve()
            })

            ws.on("message", (data) => {
                this.handleUpstreamMessage(data.toString())
            })

            ws.on("error", (err) => {
                this.emitClientError(`upstream_error:${err.message}`)
                if (!this.openaiSocket) reject(err)
            })

            ws.on("close", () => {
                this.openaiSocket = null
                if (!this.closed) {
                    this.clientSocket.emit("relay:upstream_closed")
                }
            })
        })
    }

    private sendSessionConfig(): void {
        const basePrompt = pickBasePrompt(this.init.sourceLang, this.init.persona)
        const prompt = [basePrompt, this.init.customKeywords].filter(Boolean).join(", ")

        const config: OpenAIRealtimeEvent = {
            type: "transcription_session.update",
            session: {
                input_audio_format: "pcm16",
                input_audio_transcription: {
                    model: STT_MODEL,
                    language: this.init.sourceLang,
                    prompt,
                },
                // Server-side VAD trims long silence and segments utterances —
                // mirroring the client-side VAD we used in the chunked HTTP path.
                turn_detection: {
                    type: "server_vad",
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 500,
                },
            },
        }
        this.sendUpstream(config)
    }

    private sendUpstream(event: OpenAIRealtimeEvent): void {
        if (!this.openaiSocket || this.openaiSocket.readyState !== WebSocket.OPEN) return
        this.openaiSocket.send(JSON.stringify(event))
    }

    private wireClientEvents(): void {
        // Audio frames from the browser AudioWorklet — base64 PCM16 24kHz mono.
        this.clientSocket.on("audio", (payload: { audio: string }) => {
            if (!payload?.audio) return
            this.sendUpstream({
                type: "input_audio_buffer.append",
                audio: payload.audio,
            })
        })

        this.clientSocket.on("force_flush", () => {
            this.sendUpstream({ type: "input_audio_buffer.commit" })
        })

        this.clientSocket.on("disconnect", () => {
            this.close()
        })
    }

    private async handleUpstreamMessage(raw: string): Promise<void> {
        let event: OpenAIRealtimeEvent
        try {
            event = JSON.parse(raw) as OpenAIRealtimeEvent
        } catch {
            return
        }

        switch (event.type) {
            case "conversation.item.input_audio_transcription.delta":
                await this.onPartial(event)
                break
            case "conversation.item.input_audio_transcription.completed":
                await this.onCompleted(event)
                break
            case "error":
                this.emitClientError(`openai_error:${(event as { error?: { message?: string } }).error?.message ?? "unknown"}`)
                break
            default:
                // Ignore housekeeping events.
                break
        }
    }

    private async onPartial(event: OpenAIRealtimeEvent): Promise<void> {
        const delta = (event.delta as string) || ""
        if (!delta) return

        // First delta of a new segment — allocate a stable id and an immediate
        // RTDB row so the audience sees raw text in ~200ms instead of waiting
        // for the final transcript.
        if (!this.currentSegmentId) {
            this.currentSegmentId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            this.currentPartial = ""

            const sessionStillActive = await this.guardSessionActive()
            if (!sessionStillActive) {
                this.currentSegmentId = null
                return
            }

            await this.writeInitial(this.currentSegmentId)
        }

        this.currentPartial += delta
        this.clientSocket.emit("relay:partial", {
            id: this.currentSegmentId,
            text: this.currentPartial,
        })

        // Live-update RTDB with the running partial so the audience overlay can
        // type it in. We intentionally keep status:"translating" until completion.
        await this.partialUpdate(this.currentSegmentId, this.currentPartial)
    }

    private async onCompleted(event: OpenAIRealtimeEvent): Promise<void> {
        const transcript = sanitize(((event.transcript as string) || this.currentPartial).trim())
        const segmentId = this.currentSegmentId
        const promptText = [
            pickBasePrompt(this.init.sourceLang, this.init.persona),
            this.init.customKeywords,
        ]
            .filter(Boolean)
            .join(", ")

        // Reset so the next delta starts a fresh segment.
        this.currentSegmentId = null
        this.currentPartial = ""

        if (!segmentId) return

        if (transcript.length < 2 || isGarbage(transcript, transcript, promptText)) {
            await this.dropSegment(segmentId)
            this.clientSocket.emit("relay:dropped", { id: segmentId, reason: "filtered" })
            return
        }

        const stillActive = await this.guardSessionActive()
        if (!stillActive) {
            await this.dropSegment(segmentId)
            return
        }

        let result: TranslateResult | null = null
        try {
            result = await this.translator.translate({
                rawText: transcript,
                sourceLang: this.init.sourceLang,
                sessionContext: this.init.sessionContext,
                previousRefined: this.previousRefined,
                targetLanguages: this.init.targetLanguages,
                persona: this.init.persona,
            })
        } catch (err) {
            this.emitClientError(
                `translate_error:${err instanceof Error ? err.message : String(err)}`,
            )
        }

        if (!result) {
            await this.writeFallbackFinal(segmentId, transcript)
            this.clientSocket.emit("relay:final", { id: segmentId, text: transcript, fallback: true })
            return
        }

        await this.writeFinal(segmentId, transcript, result)
        this.previousRefined = result.refined
        this.clientSocket.emit("relay:final", {
            id: segmentId,
            text: result.refined,
            isMedical: result.isMedical,
        })
    }

    private async guardSessionActive(): Promise<boolean> {
        if (!this.init.activeSessionId) return true
        try {
            const snap = await admin
                .database()
                .ref(`projects/${this.init.projectId}/activeSessionId`)
                .get()
            const current = snap.val()
            return !current || current === this.init.activeSessionId
        } catch {
            return true
        }
    }

    private async writeInitial(segmentId: string): Promise<void> {
        const projectRef = admin.database().ref(`projects/${this.init.projectId}`)
        const seqResult = await projectRef
            .child("lastSequence")
            .transaction((cur: number | null) => (cur || 0) + 1)
        const seq = seqResult.snapshot.val()

        await projectRef.child(`stream/${segmentId}`).set({
            original: "",
            refined: "",
            status: "translating",
            timestamp: Date.now(),
            sourceLabel: this.init.sourceLabel,
            sessionId: this.init.activeSessionId,
            seq,
            version: "v13_realtime",
        })
    }

    private async partialUpdate(segmentId: string, partial: string): Promise<void> {
        await admin
            .database()
            .ref(`projects/${this.init.projectId}/stream/${segmentId}`)
            .update({ original: partial, refined: partial })
    }

    private async dropSegment(segmentId: string): Promise<void> {
        await admin
            .database()
            .ref(`projects/${this.init.projectId}/stream/${segmentId}`)
            .remove()
            .catch(() => {})
    }

    private async writeFallbackFinal(segmentId: string, raw: string): Promise<void> {
        const updates: Record<string, unknown> = {}
        const base = `projects/${this.init.projectId}/stream/${segmentId}`
        updates[`${base}/original`] = raw
        updates[`${base}/refined`] = raw
        updates[`${base}/status`] = "final"
        for (const lang of this.init.targetLanguages) {
            updates[`${base}/${lang}`] = raw
        }
        await admin.database().ref().update(updates)
    }

    private async writeFinal(
        segmentId: string,
        raw: string,
        result: TranslateResult,
    ): Promise<void> {
        const updates: Record<string, unknown> = {}
        const base = `projects/${this.init.projectId}/stream/${segmentId}`
        updates[`${base}/original`] = raw
        updates[`${base}/refined`] = result.refined
        updates[`${base}/isMedical`] = result.isMedical
        updates[`${base}/status`] = "final"
        for (const lang of this.init.targetLanguages) {
            updates[`${base}/${lang}`] = result.translations[lang] ?? ""
        }
        await admin.database().ref().update(updates)

        // Maintain a rolling 5-segment context tail for the next translate call.
        await admin
            .database()
            .ref(`projects/${this.init.projectId}/state/lastRefinedList`)
            .transaction((current: unknown) => {
                const list: string[] = Array.isArray(current) ? (current as string[]) : []
                return [...list, result.refined].slice(-5)
            })
    }

    private emitClientError(message: string): void {
        this.clientSocket.emit("relay:error", { message })
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        try {
            this.openaiSocket?.close()
        } catch {
            // ignore
        }
        this.openaiSocket = null
    }
}
