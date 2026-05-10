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
//      "translating" rows to RTDB, and on completion run the gpt-4.1-mini
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

const OPENAI_REALTIME_URL = process.env.OPENAI_REALTIME_URL || "wss://api.openai.com/v1/realtime"
// The actual upgrade is the STT side (gpt-realtime-whisper). Translation
// stays on the model that was working in production. Both are env-overridable
// for instant rollback or experimentation.
const STT_MODEL = process.env.OPENAI_STT_MODEL || "gpt-realtime-whisper"
const TRANSLATION_MODEL = process.env.OPENAI_REASONING_MODEL || process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini"
const PARTIAL_DB_INTERVAL_MS = Number(process.env.REALTIME_PARTIAL_DB_INTERVAL_MS || 120)
const VAD_THRESHOLD = Number(process.env.REALTIME_VAD_THRESHOLD || 0.5)
const VAD_PREFIX_PADDING_MS = Number(process.env.REALTIME_VAD_PREFIX_PADDING_MS || 500)
const VAD_SILENCE_DURATION_MS = Number(process.env.REALTIME_VAD_SILENCE_DURATION_MS || 700)
const CONTEXT_SEGMENT_LIMIT = 5
const TRANSLATION_BUFFER_MIN_CHARS = Number(process.env.REALTIME_TRANSLATION_MIN_CHARS || 45)
const TRANSLATION_BUFFER_TIMEOUT_MS = Number(process.env.REALTIME_TRANSLATION_TIMEOUT_MS || 1800)
const TRANSLATION_BUFFER_SENTENCE_END = (process.env.REALTIME_TRANSLATION_SENTENCE_END || "true") === "true"

const DEFAULT_STT_PROMPTS: Record<string, string> = {
    ko: process.env.DEFAULT_STT_PROMPT_KO || "",
    en: process.env.DEFAULT_STT_PROMPT_EN || "",
    ja: process.env.DEFAULT_STT_PROMPT_JA || "",
    zh: process.env.DEFAULT_STT_PROMPT_ZH || "",
}

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

interface TranslationBufferEntry {
    segmentId: string
    transcript: string
}

function defaultBasePrompt(lang: string): string {
    return DEFAULT_STT_PROMPTS[lang] || ""
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

function buildSttPrompt(lang: string, persona: PersonaConfig | null, customKeywords: string): string {
    const parts = [pickBasePrompt(lang, persona)]
    if (persona?.enabled && persona.medicalTerms) parts.push(persona.medicalTerms)
    if (customKeywords) parts.push(customKeywords)
    return parts.filter(Boolean).join(", ")
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
    private pendingInitialWrite: Promise<void> | null = null
    private pendingPartialText = ""
    private partialFlushTimer: NodeJS.Timeout | null = null
    private lastPartialWriteAt = 0
    private translationBuffer: TranslationBufferEntry[] = []
    private translationBufferStartedAt = 0
    private translationFlushTimer: NodeJS.Timeout | null = null
    private translationFlushPromise: Promise<void> = Promise.resolve()
    private previousRefinedList: string[] = []
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
        await this.loadPreviousContext()

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
        const prompt = buildSttPrompt(
            this.init.sourceLang,
            this.init.persona,
            this.init.customKeywords,
        )

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
                    threshold: VAD_THRESHOLD,
                    prefix_padding_ms: VAD_PREFIX_PADDING_MS,
                    silence_duration_ms: VAD_SILENCE_DURATION_MS,
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
            this.enqueueTranslationFlush()
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

        // First delta of a new segment — allocate a stable id immediately.
        // Do not await Firebase here; that would put the Realtime delta stream
        // behind an RTDB round trip and make the UI feel less instant.
        if (!this.currentSegmentId) {
            this.currentSegmentId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            this.currentPartial = ""
            this.pendingInitialWrite = null
        }

        this.currentPartial += delta
        const segmentId = this.currentSegmentId
        this.clientSocket.emit("relay:partial", {
            id: segmentId,
            text: this.currentPartial,
        })

        // Live-update RTDB with the running partial so the audience overlay can
        // type it in. Throttle DB writes; the admin socket already receives
        // every delta instantly.
        this.queuePartialUpdate(segmentId, this.currentPartial)
    }

    private async onCompleted(event: OpenAIRealtimeEvent): Promise<void> {
        const transcript = sanitize(((event.transcript as string) || this.currentPartial).trim())
        const segmentId = this.currentSegmentId
        const promptText = [
            buildSttPrompt(this.init.sourceLang, this.init.persona, this.init.customKeywords),
        ].join(", ")

        // Reset so the next delta starts a fresh segment.
        this.currentSegmentId = null
        this.currentPartial = ""
        await this.flushPartialUpdate(segmentId)
        this.pendingInitialWrite = null

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

        this.queueTranslation(segmentId, transcript)
    }

    private queueTranslation(segmentId: string, transcript: string): void {
        if (this.translationBuffer.length === 0) {
            this.translationBufferStartedAt = Date.now()
        }

        this.translationBuffer.push({ segmentId, transcript })
        const bufferText = this.translationBuffer.map((entry) => entry.transcript).join(" ")
        const elapsed = Date.now() - this.translationBufferStartedAt
        const shouldFlush =
            bufferText.length >= TRANSLATION_BUFFER_MIN_CHARS ||
            elapsed >= TRANSLATION_BUFFER_TIMEOUT_MS ||
            (TRANSLATION_BUFFER_SENTENCE_END && /[.!?。！？]$/.test(bufferText.trim()))

        if (shouldFlush) {
            this.enqueueTranslationFlush()
            return
        }

        if (!this.translationFlushTimer) {
            this.translationFlushTimer = setTimeout(() => {
                this.translationFlushTimer = null
                this.enqueueTranslationFlush()
            }, TRANSLATION_BUFFER_TIMEOUT_MS - elapsed)
        }
    }

    private enqueueTranslationFlush(): void {
        this.translationFlushPromise = this.translationFlushPromise
            .catch(() => {})
            .then(() => this.flushTranslationBuffer())
            .catch((err) => {
                this.emitClientError(
                    `translation_flush_error:${err instanceof Error ? err.message : String(err)}`,
                )
            })
    }

    private async flushTranslationBuffer(): Promise<void> {
        if (this.translationFlushTimer) {
            clearTimeout(this.translationFlushTimer)
            this.translationFlushTimer = null
        }

        const entries = this.translationBuffer
        this.translationBuffer = []
        this.translationBufferStartedAt = 0
        if (entries.length === 0) return

        const target = entries[0]
        const mergedIds = entries.slice(1).map((entry) => entry.segmentId)
        const flushText = sanitize(entries.map((entry) => entry.transcript).join(" ").trim())
        if (!flushText) return

        let result: TranslateResult | null = null
        try {
            result = await this.translator.translate({
                rawText: flushText,
                sourceLang: this.init.sourceLang,
                sessionContext: this.init.sessionContext,
                previousRefined: this.previousRefinedList.join("\n"),
                targetLanguages: this.init.targetLanguages,
                persona: this.init.persona,
            })
        } catch (err) {
            this.emitClientError(
                `translate_error:${err instanceof Error ? err.message : String(err)}`,
            )
        }

        if (!result) {
            await this.writeFallbackFinal(target.segmentId, flushText, mergedIds)
            this.previousRefinedList = [...this.previousRefinedList, flushText].slice(-CONTEXT_SEGMENT_LIMIT)
            this.clientSocket.emit("relay:final", { id: target.segmentId, text: flushText, fallback: true })
            return
        }

        await this.writeFinal(target.segmentId, flushText, result, mergedIds)
        this.previousRefinedList = [...this.previousRefinedList, result.refined].slice(-CONTEXT_SEGMENT_LIMIT)
        this.clientSocket.emit("relay:final", {
            id: target.segmentId,
            text: result.refined,
            isMedical: result.isMedical,
        })
    }

    private async loadPreviousContext(): Promise<void> {
        try {
            const snap = await admin
                .database()
                .ref(`projects/${this.init.projectId}/state/lastRefinedList`)
                .get()
            const value = snap.val()
            if (Array.isArray(value)) {
                this.previousRefinedList = value
                    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
                    .slice(-CONTEXT_SEGMENT_LIMIT)
            }
        } catch {
            this.previousRefinedList = []
        }
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

    private async writeInitial(segmentId: string, partial: string): Promise<void> {
        const projectRef = admin.database().ref(`projects/${this.init.projectId}`)
        const seqResult = await projectRef
            .child("lastSequence")
            .transaction((cur: number | null) => (cur || 0) + 1)
        const seq = seqResult.snapshot.val()

        await projectRef.child(`stream/${segmentId}`).set({
            original: partial,
            refined: partial,
            status: "translating",
            timestamp: Date.now(),
            sourceLabel: this.init.sourceLabel,
            sessionId: this.init.activeSessionId,
            seq,
            version: "v13_realtime",
        })
    }

    private queuePartialUpdate(segmentId: string, partial: string): void {
        this.pendingPartialText = partial

        if (!this.pendingInitialWrite) {
            this.pendingInitialWrite = this.writeInitial(segmentId, partial).catch((err) => {
                this.emitClientError(
                    `partial_write_error:${err instanceof Error ? err.message : String(err)}`,
                )
            })
            this.lastPartialWriteAt = Date.now()
            return
        }

        const elapsed = Date.now() - this.lastPartialWriteAt
        if (elapsed >= PARTIAL_DB_INTERVAL_MS) {
            void this.flushPartialUpdate(segmentId).catch((err) => {
                this.emitClientError(
                    `partial_write_error:${err instanceof Error ? err.message : String(err)}`,
                )
            })
            return
        }

        if (!this.partialFlushTimer) {
            this.partialFlushTimer = setTimeout(() => {
                this.partialFlushTimer = null
                void this.flushPartialUpdate(segmentId).catch((err) => {
                    this.emitClientError(
                        `partial_write_error:${err instanceof Error ? err.message : String(err)}`,
                    )
                })
            }, PARTIAL_DB_INTERVAL_MS - elapsed)
        }
    }

    private async flushPartialUpdate(segmentId: string | null): Promise<void> {
        if (!segmentId || !this.pendingPartialText) return
        const partial = this.pendingPartialText
        this.lastPartialWriteAt = Date.now()
        if (this.partialFlushTimer) {
            clearTimeout(this.partialFlushTimer)
            this.partialFlushTimer = null
        }

        await this.pendingInitialWrite
        await this.partialUpdate(segmentId, partial)
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

    private async writeFallbackFinal(
        segmentId: string,
        raw: string,
        mergedIds: string[] = [],
    ): Promise<void> {
        const updates: Record<string, unknown> = {}
        const base = `projects/${this.init.projectId}/stream/${segmentId}`
        updates[`${base}/original`] = raw
        updates[`${base}/refined`] = raw
        updates[`${base}/status`] = "final"
        if (mergedIds.length > 0) updates[`${base}/mergedIds`] = mergedIds
        for (const lang of this.init.targetLanguages) {
            updates[`${base}/${lang}`] = raw
        }
        for (const id of mergedIds) {
            updates[`projects/${this.init.projectId}/stream/${id}/status`] = "merged"
        }
        await admin.database().ref().update(updates)
    }

    private async writeFinal(
        segmentId: string,
        raw: string,
        result: TranslateResult,
        mergedIds: string[] = [],
    ): Promise<void> {
        const updates: Record<string, unknown> = {}
        const base = `projects/${this.init.projectId}/stream/${segmentId}`
        updates[`${base}/original`] = raw
        updates[`${base}/refined`] = result.refined
        updates[`${base}/isMedical`] = result.isMedical
        updates[`${base}/status`] = "final"
        if (mergedIds.length > 0) updates[`${base}/mergedIds`] = mergedIds
        for (const lang of this.init.targetLanguages) {
            updates[`${base}/${lang}`] = result.translations[lang] ?? ""
        }
        for (const id of mergedIds) {
            updates[`projects/${this.init.projectId}/stream/${id}/status`] = "merged"
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
        if (this.partialFlushTimer) {
            clearTimeout(this.partialFlushTimer)
            this.partialFlushTimer = null
        }
        if (this.translationFlushTimer) {
            clearTimeout(this.translationFlushTimer)
            this.translationFlushTimer = null
        }
        this.openaiSocket = null
    }
}
