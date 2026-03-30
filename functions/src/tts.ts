import * as functions from "firebase-functions/v1"
import OpenAI from "openai"

let _openai: OpenAI | null = null
const getOpenAI = (): OpenAI => {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY || (functions.config()?.openai?.key as string) || ""
        if (!apiKey) throw new Error("OPENAI_API_KEY missing")
        _openai = new OpenAI({ apiKey })
    }
    return _openai
}

// ─────────────────────────────────────────────────────────────────────────────
// synthesizeSpeech — OpenAI tts-1 → MP3 오디오 스트림 반환
// 인증 불필요 (번역 결과를 읽어주는 공개 기능)
// ─────────────────────────────────────────────────────────────────────────────
export const synthesizeSpeech = functions
    .runWith({ timeoutSeconds: 30, memory: "256MB" })
    .https.onRequest(async (req, res) => {
        res.set("Access-Control-Allow-Origin", "*")
        res.set("Access-Control-Allow-Methods", "GET, OPTIONS")
        res.set("Access-Control-Allow-Headers", "Content-Type")
        if (req.method === "OPTIONS") { res.status(204).send(""); return }

        try {
            const text = (req.query.text || "").toString().slice(0, 1000).trim()
            const lang = (req.query.lang || "ko").toString()
            const speedParam = parseFloat((req.query.speed || "1.0").toString())
            const speed = Math.min(2.0, Math.max(0.25, isNaN(speedParam) ? 1.0 : speedParam))

            if (!text) { res.status(400).json({ error: "text required" }); return }

            // 음성 선택: 클라이언트에서 voice 파라미터 전달 가능 (nova/shimmer/onyx/echo/alloy/fable)
            const voiceParam = (req.query.voice || "").toString()
            const defaultVoice = lang === "ko" ? "nova" : "alloy"
            const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
            const voice = VALID_VOICES.includes(voiceParam) ? voiceParam : defaultVoice

            const openai = getOpenAI()
            const response = await openai.audio.speech.create({
                model: "tts-1",
                voice,
                input: text,
                response_format: "mp3",
                speed,
            })

            const buffer = Buffer.from(await response.arrayBuffer())

            // 동일 텍스트 반복 요청 최소화를 위해 5분 캐시
            res.set("Content-Type", "audio/mpeg")
            res.set("Cache-Control", "public, max-age=300")
            res.send(buffer)

            functions.logger.info("[TTS] OK", {
                lang,
                chars: text.length,
                speed,
                voice,
            })
        } catch (e: any) {
            functions.logger.error("[TTS] Error", { err: String(e).slice(0, 200) })
            res.status(500).json({ error: "TTS failed" })
        }
    })
