// Version: Quality Stable v1
import * as functions from "firebase-functions/v1"
import * as admin from "firebase-admin"
import OpenAI from "openai"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { Readable } from "stream"
import * as fs from "fs"

let _openai: OpenAI | null = null
const DIRECT_GEMINI_KEY = "AIzaSyDNqx0ScloGAYK74hddqiaNf188T8uZnnw"
const GEMINI_FLASH_URL = (key: string) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`
const GEMINI_PRO_URL = (key: string) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${key}`
const GEMINI_SYSTEM_PROMPT = `
역할: 당신은 실시간 치과 학술 세미나의 "무음 자막 편집기"입니다.
목표: 입력된 텍스트를 치과 전문 용어를 사용한 매끄러운 문장으로 다듬어 "결과 텍스트만" 출력하십시오.

[절대 금지 사항 - 어기면 시스템 오류 발생]
1. 설명, 주석, 마크다운(##, **), "교정 결과:", "Input/Output" 등의 메타 텍스트를 절대 포함하지 마십시오.
2. "이덕영입니다", "감사합니다", "뉴스입니다" 등의 반복되는 환각 멘트가 문맥과 맞지 않으면 과감히 삭제하십시오.
3. 문장을 분석하거나 이유를 말하지 마십시오.

[수행 지침]
1. 입력: "임플란트 넥파절이 와서 리페어 했어요"
2. 출력: "임플란트 넥 파절(Implant Neck Fracture)로 인한 보철 수리(Repair) 증례입니다."
3. 오직 다듬어진 "한 문장(또는 문단)"만 출력하십시오.
- 입력된 텍스트가 "이덕영입니다", "뉴스입니다" 처럼 강연 내용과 무관한 자기소개나 방송 멘트라면, 번역이나 교정을 하지 말고 아예 결과에서 제외(삭제)하십시오.
`;
const callGeminiREST = async (text: string): Promise<string> => {
  const payload: any = { contents: [{ parts: [{ text: `${GEMINI_SYSTEM_PROMPT}\nINPUT: ${text}` }]}] }
  let res = await fetch(GEMINI_FLASH_URL(DIRECT_GEMINI_KEY), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
  if (!res.ok) {
    const errText = await res.text()
    functions.logger.error("Gemini REST error", { status: res.status, body: errText })
    res = await fetch(GEMINI_PRO_URL(DIRECT_GEMINI_KEY), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    if (!res.ok) {
      const errText2 = await res.text()
      functions.logger.error("Gemini REST fallback error", { status: res.status, body: errText2 })
      throw new Error(`Gemini REST Error: ${res.status} - ${errText2}`)
    }
  }
  const data = await res.json()
  const out = (((data || {}).candidates || [])[0] || {}).content?.parts?.[0]?.text || ""
  return out
}

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

const getGenAI = (): GoogleGenerativeAI => new GoogleGenerativeAI(DIRECT_GEMINI_KEY)

const DENTAL_PROMPT = ""
const PROMPT_WORDS = [
  "수술","사이너스","Sinus","Sinus Graft","픽스처","Fixture","어버트먼트","Abutment","임플란트","크라운","브릿지","파절","치주염","골이식"
]

const sanitize = (s: string): string => {
  let t = (s || "");
  t = t.replace(/소음이나\s*인사말은\s*무시하고\s*실제\s*강연\s*내용만\s*출력하세요\.?/gi, "");
  t = t.replace(/프롬프트에\s*적힌\s*단어를\s*반복하지\s*마세요\.?/gi, "");
  t = t.replace(/MBC\s*뉴스/gi, "");
  t = t.replace(/시청해주셔서\s*감사합니다/gi, "");
  t = t.replace(/구독과\s*좋아요/gi, "");
  t = t.replace(/안녕하세요/gi, "");
  t = t.replace(/이덕영입니다/gi, "");
  t = t.replace(/뉴스입니다/gi, "");
  t = t.replace(/(?:^|\s)(?:Input|Output|교정\s*결과)\s*:?/gi, "");
  t = t.replace(/[`]{3,}/g, "");
  t = t.replace(/[`]/g, "");
  t = t.replace(/#{1,}/g, "");
  t = t.replace(/\*{2,}/g, "");
  t = t.replace(/_{2,}/g, "");
  t = t.replace(/^>+/gm, "");
  t = t.replace(/\bundefined\b/gi, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}

const BANNED_WORDS = ["이덕영", "MBC", "MBC 뉴스", "시청해", "구독", "좋아요", "감사합니다", "수고하셨습니다", "뉴스입니다"]
const isBannedDominant = (s: string): boolean => {
  const tokens = s.split(/[\s]+/).filter(Boolean)
  if (!tokens.length) return false
  const lower = tokens.map(w => w.toLowerCase())
  const bannedCount = lower.filter(w => BANNED_WORDS.some(b => w.includes(b.toLowerCase()))).length
  const ratio = bannedCount / tokens.length
  if (ratio >= 0.5) return true
  if (tokens.length <= 6 && bannedCount >= 1) return true
  return false
}

const isPromptEcho = (s: string): boolean => {
  const tokens = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length) return false;
  const matchCount = tokens.filter(tok => PROMPT_WORDS.includes(tok)).length;
  const repetitionRatio = 1 - (new Set(tokens).size / tokens.length);
  return (matchCount / tokens.length) > 0.6 || repetitionRatio > 0.6;
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
      let rawText = sanitize((stt?.text || "").trim())
      if (rawText && isPromptEcho(rawText)) {
        rawText = "";
      }
      if (rawText && isBannedDominant(rawText)) {
        rawText = "";
      }
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
      await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ status: "raw" }).catch(() => {})
      await admin.database().ref(`sessions/${projectId}/stream/${id}/original`).set({ id, text: rawText, lang: "original", timestamp, isFinal: true, sourceLabel })
      await admin.database().ref(`sessions/${projectId}/state`).update({ lastText: rawText, lastTimestamp: timestamp }).catch(() => {})
      res.status(200).json({ success: true, id, text: rawText, stage: "original", timestamp, audioBytes: buf.length, fileUrl: (req as any)._uploadedUrl || null, metrics: { whisperMs: tOpenaiEnd - tOpenaiStart, geminiMs: 0 }, version: versionTag })
      let refined = rawText
      const tGeminiStart = Date.now()
      functions.logger.info("Gemini REST call start", { id, projectId, len: rawText.length })
      try {
        const out = await callGeminiREST(rawText)
        refined = sanitize((out || "").trim() || rawText)
        const tGeminiEnd = Date.now()
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ geminiMs: tGeminiEnd - tGeminiStart }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/gemini`).set({ state: "ok", ts: Date.now() }).catch(() => {})
        functions.logger.info("Gemini REST call success", { id })
      } catch (err: any) {
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ refinedError: err?.message || "Gemini REST failed" }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/gemini`).set({ state: "error", message: err?.message || "Gemini REST failed", ts: Date.now() }).catch(() => {})
        functions.logger.error("Gemini REST call error", { id, projectId, message: err?.message || "unknown" })
        refined = rawText
      }
      await admin.database().ref(`sessions/${projectId}/stream/${id}/refined`).set({ id, text: refined, lang: "refined", timestamp: Date.now(), isFinal: true }).catch(() => {})
      await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ status: "final" }).catch(() => {})

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
          try {
            const prompt = `SYSTEM: 너는 전문 치과 강의 자막을 영어와 일본어로 간결하게 번역하는 번역가다. JSON으로만 출력하라.\nINPUT: ${refined || rawText}\nFORMAT: {"en":"...","ja":"..."}`
            const txt = await callGeminiREST(prompt)
            try {
              const parsed = JSON.parse(txt)
              en = (parsed.en || "").toString()
              ja = (parsed.ja || "").toString()
            } catch {
              en = txt
            }
          } catch {}
        }
        const tStart = Date.now()
        const tEnd = Date.now()
        const tObj: any = { en, ja, timestamp: Date.now(), isFinal: true }
        await admin.database().ref(`sessions/${projectId}/stream/${id}/translated`).set(tObj).catch(() => {})
        // For overlay compatibility: also expose language keys at top-level
        if (en) await admin.database().ref(`sessions/${projectId}/stream/${id}/en`).set({ id, text: en, lang: "en", timestamp: Date.now(), isFinal: true }).catch(() => {})
        if (ja) await admin.database().ref(`sessions/${projectId}/stream/${id}/ja`).set({ id, text: ja, lang: "ja", timestamp: Date.now(), isFinal: true }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ translateMs: tEnd - tStart, status: "final" }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/translation`).set({ state: "ok", ts: Date.now() }).catch(() => {})
      } catch (tErr: any) {
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ translatedError: tErr?.message || "Translate failed" }).catch(() => {})
        await admin.database().ref(`sessions/${projectId}/status/services/translation`).set({ state: "error", message: tErr?.message || "Translate failed", ts: Date.now() }).catch(() => {})
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Internal Error", version: versionTag })
    }
  })
