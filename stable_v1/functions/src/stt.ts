import * as functions from "firebase-functions/v1"
import * as admin from "firebase-admin"
import OpenAI from "openai"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { Readable } from "stream"
import * as fs from "fs"

let _openai: OpenAI | null = null
let _genai: GoogleGenerativeAI | null = null

const getOpenAI = (): OpenAI => {
  if (!_openai) {
    const envKey = process.env.OPENAI_API_KEY || ""
    let cfgKey = ""
    try {
      cfgKey = (functions.config()?.openai?.key as string) || ""
    } catch {}
    const apiKey = envKey || cfgKey
    if (!apiKey) throw new Error("OPENAI_API_KEY missing")
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

const getGenAI = (): GoogleGenerativeAI => {
  if (!_genai) {
    const envKey = process.env.GEMINI_API_KEY || ""
    let cfgKey = ""
    try {
      cfgKey = (functions.config()?.gemini?.key as string) || ""
    } catch {}
    const apiKey = envKey || cfgKey
    if (!apiKey) throw new Error("GEMINI_API_KEY missing")
    _genai = new GoogleGenerativeAI(apiKey)
  }
  return _genai
}

const DENTAL_PROMPT = "임플란트, 상악동 거상술, 사이너스, Sinus Graft, 픽스처, Fixture, 어버트먼트, Abutment, 크라운, 브릿지, 파절, 치주염, 골이식"

const sanitize = (s: string): string => {
  let t = (s || "");
  t = t.replace(/소음이나\s*인사말은\s*무시하고\s*실제\s*강연\s*내용만\s*출력하세요\.?/gi, "");
  t = t.replace(/프롬프트에\s*적힌\s*단어를\s*반복하지\s*마세요\.?/gi, "");
  t = t.replace(/\bundefined\b/gi, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

export const processAudio = functions
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    const versionTag = "v1.1.0_dental"
    res.set("Access-Control-Allow-Origin", "*")
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
    if (req.method === "OPTIONS") {
      res.status(204).send("")
      return
    }
    try {
      if (!admin.apps.length) throw new Error("Admin not initialized")
      const auth = (req.headers.authorization || "").toString()
      if (!auth.startsWith("Bearer ")) {
        res.status(401).json({ success: false, error: "Unauthorized", version: versionTag })
        return
      }
      await admin.auth().verifyIdToken(auth.split("Bearer ")[1])
      const projectId = (req.query.projectId || "").toString()
      const mode = (req.query.mode || "").toString()
      const sourceLabel = (req.query.sourceLabel || "").toString()
      if (!projectId) {
        res.status(400).json({ success: false, error: "Missing projectId", version: versionTag })
        return
      }
      let buf: Buffer | null = null
      const raw = (req as any).rawBody as Buffer | undefined
      if (raw && Buffer.isBuffer(raw)) buf = raw
      else if (Buffer.isBuffer(req.body)) buf = req.body as Buffer
      else if (typeof req.body === "string") buf = Buffer.from(req.body, "binary")
      if (!buf || buf.length === 0) {
        res.status(400).json({ success: false, error: "Empty audio", version: versionTag })
        return
      }
      await admin.database().ref(`sessions/${projectId}/status`).update({ lastActive: Date.now() }).catch(() => {})
      const tmpPath = `/tmp/audio.webm`
      try {
        fs.writeFileSync(tmpPath, buf)
        const bucket = admin.storage().bucket()
        const dest = `diagnostics/audio_${Date.now()}.webm`
        await bucket.upload(tmpPath, { destination: dest, contentType: "audio/webm" })
        try {
          const [signed] = await bucket.file(dest).getSignedUrl({ action: "read", expires: Date.now() + 15 * 60 * 1000 })
          ;(req as any)._uploadedUrl = signed
        } catch {}
      } catch {}
      let openai: OpenAI
      try {
        openai = getOpenAI()
      } catch (cfgErr: any) {
        await admin.database().ref(`sessions/${projectId}/status/services/openai`).set({ state: "error", message: cfgErr?.message || "OPENAI_API_KEY missing", ts: Date.now() }).catch(() => {})
        res.status(500).json({ success: false, error: cfgErr?.message || "OPENAI_API_KEY missing", version: versionTag })
        return
      }
      if (mode === "test") {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const timestamp = Date.now()
        const text = "Internal Connection"
        await admin.database().ref(`sessions/${projectId}/stream/${id}/original`).set({ id, text, lang: "original", timestamp, isFinal: true, sourceLabel })
        res.status(200).json({ success: true, id, text, timestamp, metrics: { whisperMs: 0, geminiMs: 0 }, version: versionTag })
        return
      }
      const tOpenaiStart = Date.now()
      let tOpenaiEnd = tOpenaiStart
      if (buf.length < 2000) {
        res.status(200).json({ success: false, error: "TooSmallChunk", audioBytes: buf.length, version: versionTag })
        return
      }
      let stt: any
      try {
        const audioStream = Readable.from(buf)
        ;(audioStream as any).path = "audio.webm"
        stt = await openai.audio.transcriptions.create({ file: audioStream as any, model: "whisper-1", language: "ko", prompt: DENTAL_PROMPT, temperature: 0 })
        tOpenaiEnd = Date.now()
        await admin.database().ref(`sessions/${projectId}/status/services/openai`).set({ state: "ok", ts: Date.now() }).catch(() => {})
      } catch (err1: any) {
        try {
          const audioStream2 = Readable.from(buf)
          ;(audioStream2 as any).path = "audio.mp4"
          stt = await openai.audio.transcriptions.create({ file: audioStream2 as any, model: "whisper-1", language: "ko", prompt: DENTAL_PROMPT, temperature: 0 })
          tOpenaiEnd = Date.now()
          await admin.database().ref(`sessions/${projectId}/status/services/openai`).set({ state: "ok", ts: Date.now(), note: "mp4-fallback" }).catch(() => {})
        } catch (err2: any) {
          // Graceful: mark invalid chunk and continue
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          await admin.database().ref(`sessions/${projectId}/errors/${id}`).set({ type: "WhisperInvalidFormat", bytes: buf.length, ts: Date.now() }).catch(() => {})
          await admin.database().ref(`sessions/${projectId}/status/services/openai`).set({ state: "error", message: "WhisperInvalidFormat", ts: Date.now() }).catch(() => {})
          res.status(200).json({ success: false, error: "WhisperInvalidFormat", audioBytes: buf.length, version: versionTag })
          return
        }
      }
      const rawText = sanitize((stt?.text || "").trim())
      try {
        const stateSnap = await admin.database().ref(`sessions/${projectId}/state`).get()
        const last = stateSnap.exists() ? (stateSnap.val() || {}) : {}
        const lastText = (last.lastText || "").toString()
        const lastTs = Number(last.lastTimestamp || 0)
        const isDup = rawText && rawText === lastText && (Date.now() - lastTs) < 30000
        if (isDup) {
          const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          const timestamp = Date.now()
          res.status(200).json({ success: true, id, text: "", stage: "original", timestamp, audioBytes: buf.length, info: "DuplicateSuppressed", fileUrl: (req as any)._uploadedUrl || null, metrics: { whisperMs: tOpenaiEnd - tOpenaiStart, geminiMs: 0 }, version: versionTag })
          return
        }
      } catch {}
      if (!rawText) {
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const timestamp = Date.now()
        res.status(200).json({ success: true, id, text: "", stage: "original", timestamp, audioBytes: buf.length, info: "Empty", fileUrl: (req as any)._uploadedUrl || null, metrics: { whisperMs: tOpenaiEnd - tOpenaiStart, geminiMs: 0 }, version: versionTag })
        return
      }
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const timestamp = Date.now()
      await admin.database().ref(`sessions/${projectId}/stream/${id}/original`).set({ id, text: rawText, lang: "original", timestamp, isFinal: true, sourceLabel })
      await admin.database().ref(`sessions/${projectId}/state`).update({ lastText: rawText, lastTimestamp: timestamp }).catch(() => {})
      res.status(200).json({ success: true, id, text: rawText, stage: "original", timestamp, audioBytes: buf.length, fileUrl: (req as any)._uploadedUrl || null, metrics: { whisperMs: tOpenaiEnd - tOpenaiStart, geminiMs: 0 }, version: versionTag })
      let genai: GoogleGenerativeAI
      try {
        genai = getGenAI()
      } catch (cfgErr: any) {
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ refinedError: cfgErr?.message || "GEMINI_API_KEY missing" }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/gemini`).set({ state: "error", message: cfgErr?.message || "GEMINI_API_KEY missing", ts: Date.now() }).catch(() => {})
        return
      }
      const systemInstruction = "너는 STT 오역을 교정하는 치과 전문 편집자다. 출력은 간결하고 정확한 본문만 제공하라."
      const hintWords = ["상악동", "골이식", "어버트먼트", "픽스처", "임플란트"]
      const tokens = rawText.split(/\s+/).filter(Boolean)
      const uniqCount = new Set(tokens).size
      const repetitionRatio = tokens.length ? 1 - (uniqCount / tokens.length) : 1
      const hintCount = hintWords.reduce((acc, w) => acc + ((rawText.match(new RegExp(w, "g")) || []).length), 0)
      const hintRatio = tokens.length ? (hintCount / tokens.length) : 1
      const hallucination = hintRatio >= 0.8 || repetitionRatio >= 0.6
      let refined = rawText
      let tGeminiStart = Date.now()
      if (hallucination) {
        refined = ""
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ refinedError: "hallucination_filtered" }).catch(() => {})
      } else {
        const primaryModel = getGenAI().getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction })
        tGeminiStart = Date.now()
        try {
          const result = await primaryModel.generateContent(`원문: ${rawText}\n출력: 교정된 문장만 출력`)
          refined = sanitize((await result.response).text().trim() || rawText)
        } catch {
          try {
            const fallbackModel = getGenAI().getGenerativeModel({ model: "gemini-1.0-pro", systemInstruction })
            const fb = await fallbackModel.generateContent(`원문: ${rawText}\n출력: 교정된 문장만 출력`)
            refined = sanitize((await fb.response).text().trim() || rawText)
          } catch (fbErr: any) {
            await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ refinedError: fbErr?.message || "Gemini failed" }).catch(() => {})
            refined = rawText
          }
        }
        const tGeminiEnd = Date.now()
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ geminiMs: tGeminiEnd - tGeminiStart }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/gemini`).set({ state: "ok", ts: Date.now() }).catch(() => {})
      }
      await admin.database().ref(`sessions/${projectId}/stream/${id}/refined`).set({ id, text: refined, lang: "refined", timestamp: Date.now(), isFinal: true }).catch(() => {})

      // Translation step
      try {
        // Prefer Google Translate if available
        let en = "", ja = ""
        try {
          const gProject = (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "").toString()
          const gtAny: any = (() => { try { return require("@google-cloud/translate"); } catch { return null } })()
          if (gtAny && gProject) {
            const { TranslationServiceClient } = gtAny.v3 || gtAny
            const client = new TranslationServiceClient()
            const loc = "global"
            const parent = `projects/${gProject}/locations/${loc}`
            const text = refined || rawText
            const [enResp] = await client.translateText({ parent, contents: [text], mimeType: "text/plain", sourceLanguageCode: "ko", targetLanguageCode: "en" })
            const [jaResp] = await client.translateText({ parent, contents: [text], mimeType: "text/plain", sourceLanguageCode: "ko", targetLanguageCode: "ja" })
            en = (enResp?.translations?.[0]?.translatedText || "").toString()
            ja = (jaResp?.translations?.[0]?.translatedText || "").toString()
          }
        } catch {}
        if (!en && !ja) {
          const translateModel = getGenAI().getGenerativeModel({ model: "gemini-1.5-flash-latest", systemInstruction: "너는 전문 치과 강의 자막을 영어와 일본어로 간결하게 번역하는 번역가다. JSON으로만 출력하라." })
          const tPrompt = `입력: ${refined || rawText}\n요구 형식: {"en":"...","ja":"..."}`
          const tRes = await translateModel.generateContent(tPrompt)
          const tText = (await tRes.response).text().trim()
          try {
            const parsed = JSON.parse(tText)
            en = (parsed.en || "").toString()
            ja = (parsed.ja || "").toString()
          } catch {
            en = tText
          }
        }
        const tStart = Date.now()
        const tEnd = Date.now()
        const tObj: any = { en, ja, timestamp: Date.now(), isFinal: true }
        await admin.database().ref(`sessions/${projectId}/stream/${id}/translated`).set(tObj).catch(() => {})
        // For overlay compatibility: also expose language keys at top-level
        if (en) await admin.database().ref(`sessions/${projectId}/stream/${id}/en`).set({ id, text: en, lang: "en", timestamp: Date.now(), isFinal: true }).catch(() => {})
        if (ja) await admin.database().ref(`sessions/${projectId}/stream/${id}/ja`).set({ id, text: ja, lang: "ja", timestamp: Date.now(), isFinal: true }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ translateMs: tEnd - tStart }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/translation`).set({ state: "ok", ts: Date.now() }).catch(() => {})
      } catch (tErr: any) {
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ translatedError: tErr?.message || "Translate failed" }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/translation`).set({ state: "error", message: tErr?.message || "Translate failed", ts: Date.now() }).catch(() => {})
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Internal Error", version: versionTag })
    }
  })
