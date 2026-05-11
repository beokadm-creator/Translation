// useRealtimeRelay
//
// Opens a Socket.IO connection to the relay server, streams PCM16 24kHz frames
// from an AudioWorklet, and exposes partial/final transcript callbacks. The
// hook does NOT touch the legacy chunked HTTP path — AdminDashboard decides
// which one to use via a feature flag, so we can roll back instantly.

import { useCallback, useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { auth } from "../firebase"
// Vite resolves this to a fingerprinted URL in production and to the dev
// server URL in development — both load successfully in audioWorklet.addModule.
import pcm16WorkletUrl from "../worklets/pcm16-processor.js?url"

export interface RelayInit {
    projectId: string
    activeSessionId: string
    sourceLang: "ko" | "en" | "ja" | "zh"
    sessionContext: string
    customKeywords: string
    targetLanguages: string[]
    persona: PersonaConfigInput | null
    sourceLabel: string
}

export interface PersonaConfigInput {
    enabled: boolean
    basePromptKo?: string
    basePromptEn?: string
    basePromptJa?: string
    basePromptZh?: string
    customInstructions?: string
    medicalTerms?: string
}

export type RelayStatus = "idle" | "connecting" | "ready" | "streaming" | "error" | "closed"

interface UseRealtimeRelayOptions {
    relayUrl: string
    onPartial?: (segmentId: string, text: string) => void
    onFinal?: (segmentId: string, text: string, fallback?: boolean) => void
    onError?: (message: string) => void
}

interface UseRealtimeRelayApi {
    status: RelayStatus
    connect: (init: RelayInit) => Promise<void>
    sendPcmFrame: (pcm: ArrayBuffer) => void
    forceFlush: () => void
    disconnect: () => void
}

const TARGET_SAMPLE_RATE = 24000

export function useRealtimeRelay(options: UseRealtimeRelayOptions): UseRealtimeRelayApi {
    const socketRef = useRef<Socket | null>(null)
    const [status, setStatus] = useState<RelayStatus>("idle")
    const optionsRef = useRef(options)

    // Keep latest callbacks/url visible to async socket handlers without
    // re-subscribing them. Updating refs in an effect (not during render)
    // satisfies the react-hooks/refs rule.
    useEffect(() => {
        optionsRef.current = options
    }, [options])

    useEffect(() => {
        return () => {
            socketRef.current?.disconnect()
            socketRef.current = null
        }
    }, [])

    const connect = useCallback(async (init: RelayInit) => {
        setStatus("connecting")
        console.log("[Relay] connect() called, url=", optionsRef.current.relayUrl)
        const token = await auth.currentUser?.getIdToken()
        if (!token) {
            console.error("[Relay] no auth token")
            setStatus("error")
            optionsRef.current.onError?.("not_authenticated")
            return
        }

        return new Promise<void>((resolve, reject) => {
            const socket = io(optionsRef.current.relayUrl, {
                transports: ["websocket"],
                auth: { token },
                reconnection: false,
            })
            socketRef.current = socket

            socket.on("connect", () => {
                console.log("[Relay] socket connected, sending init")
                socket.emit(
                    "init",
                    init,
                    (response: { ok: boolean; error?: string }) => {
                        if (response?.ok) {
                            console.log("[Relay] init ok")
                            setStatus("ready")
                            resolve()
                        } else {
                            console.error("[Relay] init failed:", response?.error)
                            setStatus("error")
                            optionsRef.current.onError?.(response?.error || "init_failed")
                            reject(new Error(response?.error || "init_failed"))
                        }
                    },
                )
            })

            socket.on("connect_error", (err) => {
                console.error("[Relay] connect_error:", err.message)
                setStatus("error")
                optionsRef.current.onError?.(`connect_error: ${err.message}`)
                reject(err)
            })

            socket.on("relay:partial", (msg: { id: string; text: string }) => {
                setStatus("streaming")
                optionsRef.current.onPartial?.(msg.id, msg.text)
            })

            socket.on("relay:final", (msg: { id: string; text: string; fallback?: boolean }) => {
                optionsRef.current.onFinal?.(msg.id, msg.text, msg.fallback)
            })

            socket.on("relay:error", (msg: { message: string }) => {
                console.error("[Relay] relay:error:", msg.message)
                optionsRef.current.onError?.(msg.message)
            })

            socket.on("disconnect", () => {
                setStatus("closed")
            })
        })
    }, [])

    const sendPcmFrame = useCallback((pcm: ArrayBuffer) => {
        const socket = socketRef.current
        if (!socket || !socket.connected) return
        const base64 = arrayBufferToBase64(pcm)
        socket.emit("audio", { audio: base64 })
    }, [])

    const forceFlush = useCallback(() => {
        socketRef.current?.emit("force_flush")
    }, [])

    const disconnect = useCallback(() => {
        socketRef.current?.disconnect()
        socketRef.current = null
        setStatus("closed")
    }, [])

    return { status, connect, sendPcmFrame, forceFlush, disconnect }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize)
        binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    return btoa(binary)
}

/**
 * Build a 24kHz AudioContext for the PCM16 worklet. Browsers will resample the
 * mic stream automatically when the context's sample rate differs from the
 * device. Caller is responsible for closing the context when done.
 */
export async function createPcm16Pipeline(
    stream: MediaStream,
): Promise<{
    audioContext: AudioContext
    workletNode: AudioWorkletNode
    sampleRate: number
}> {
    const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) throw new Error("AudioContext not supported")

    const audioContext = new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE })
    await audioContext.audioWorklet.addModule(pcm16WorkletUrl)
    const source = audioContext.createMediaStreamSource(stream)
    const workletNode = new AudioWorkletNode(audioContext, "pcm16-processor")
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0
    source.connect(workletNode)
    workletNode.connect(silentGain)
    silentGain.connect(audioContext.destination)
    if (audioContext.state === "suspended") await audioContext.resume()
    return { audioContext, workletNode, sampleRate: audioContext.sampleRate }
}
