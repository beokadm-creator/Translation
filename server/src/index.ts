// Realtime relay server.
//
// Bridges browser admin clients (Socket.IO) to OpenAI's Realtime API
// (gpt-realtime-whisper for streaming STT + gpt-4.1-mini for refinement and
// translation). Long-lived WebSockets aren't a great fit for Firebase Cloud
// Functions, so this service is intended to run on Cloud Run (production) or
// `npm run dev` locally. Authentication piggybacks on Firebase Auth: each
// client must present a valid ID token in the Socket.IO handshake.

import "dotenv/config"
import { createServer } from "node:http"
import express from "express"
import cors from "cors"
import { Server as SocketIOServer } from "socket.io"
import { applicationDefault, initializeApp } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"

import { RealtimeRelaySession } from "./realtime.js"
import type { PersonaConfig } from "./translate.js"

try {
    initializeApp({
        credential: applicationDefault(),
        databaseURL: process.env.FIREBASE_DATABASE_URL,
    })
} catch {
    // already initialized (dev hot-reload)
}

const PORT = Number(process.env.PORT || 3000)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

const app = express()
app.use(cors({ origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : "*" }))

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        sttModel: process.env.OPENAI_STT_MODEL || "gpt-realtime-whisper",
        translationModel: process.env.OPENAI_REASONING_MODEL || process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini",
    })
})

const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
    cors: { origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : "*" },
    // PCM16 frames at 24kHz produce ~48KB/sec — well below default limits, but
    // we set the buffer high enough to absorb 250ms bursts comfortably.
    maxHttpBufferSize: 2 * 1024 * 1024,
})

interface RelayInitPayload {
    projectId: string
    activeSessionId: string
    sourceLang: "ko" | "en" | "ja" | "zh"
    sessionContext: string
    customKeywords: string
    targetLanguages: string[]
    persona: PersonaConfig | null
    sourceLabel: string
}

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token as string | undefined
        if (!token) return next(new Error("missing_token"))
        const decoded = await getAuth().verifyIdToken(token)
        socket.data.uid = decoded.uid
        next()
    } catch (err) {
        next(err instanceof Error ? err : new Error("auth_failed"))
    }
})

io.on("connection", (socket) => {
    let session: RealtimeRelaySession | null = null
    // eslint-disable-next-line no-console
    console.log(`[relay] client connected ${socket.id}`)

    socket.on("init", async (payload: RelayInitPayload, ack?: (response: unknown) => void) => {
        try {
            if (!payload?.projectId || !/^[a-zA-Z0-9_-]+$/.test(payload.projectId)) {
                throw new Error("invalid_projectId")
            }
            const apiKey = process.env.OPENAI_API_KEY
            if (!apiKey) throw new Error("OPENAI_API_KEY not configured")

            session = new RealtimeRelaySession(socket, payload, apiKey)
            await session.start()
            // eslint-disable-next-line no-console
            console.log(`[relay] init ok project=${payload.projectId} session=${payload.activeSessionId || "none"}`)
            ack?.({ ok: true })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            // eslint-disable-next-line no-console
            console.error(`[relay] init failed: ${message}`)
            ack?.({ ok: false, error: message })
            socket.emit("relay:error", { message })
        }
    })

    socket.on("disconnect", () => {
        // eslint-disable-next-line no-console
        console.log(`[relay] client disconnected ${socket.id}`)
        session?.close()
        session = null
    })
})

httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
        `[relay] Listening on :${PORT} — STT=${process.env.OPENAI_STT_MODEL || "gpt-realtime-whisper"}, Translation=${process.env.OPENAI_REASONING_MODEL || process.env.OPENAI_TRANSLATION_MODEL || "gpt-4.1-mini"}`,
    )
})
