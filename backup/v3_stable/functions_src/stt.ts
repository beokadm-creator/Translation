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
Role: Lecture Subtitle Editor
Task:
1. Edit and refine the input as natural Korean lecture subtitles.
2. Preserve lecturer speech: connecting words, explanations, and light jokes; do NOT drop valid flow.
3. Delete only obvious hallucinations (e.g., MBC 뉴스, 날씨, 김성현, 방송 마감 멘트, 구독/좋아요 등).
4. Dentistry/medical terms are not required; if it sounds like part of the lecture, set isMedicalContext=true.
5. Provide English and Japanese translations when possible.
6. Keep the input sentence length and breathing; do not summarize or merge segments. Maintain pacing.

Output JSON Format:
{"isMedicalContext": true|false, "refined": "", "en": "", "ja": ""}
`;
const callGeminiREST = async (text: string, previousContext: string = ""): Promise<{ isMedicalContext?: boolean, refined?: string, en?: string, ja?: string }> => {
  const contextPrompt = previousContext ? `\nPREVIOUS CONTEXT (The sentence right before this one): "${previousContext}"` : "";
  const payload: any = { contents: [{ parts: [{ text: `${GEMINI_SYSTEM_PROMPT}${contextPrompt}\nINPUT (Current Audio Chunk): "${text}"\nINSTRUCTION: Connect naturally with previous context if needed. If INPUT is a duplicate of context, output empty string. Output only the NEW content.` }]}], generationConfig: { responseMimeType: "application/json" } }
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
  const outText = (((data || {}).candidates || [])[0] || {}).content?.parts?.[0]?.text || ""
  try {
    const cleanText = outText.replace(/```json\s*|```/g, "").trim()
    const obj = JSON.parse(cleanText)
    // Ensure refined is simple text, not JSON string
    let r = (obj.refined || "").toString()
    try {
      const inner = JSON.parse(r)
      if (inner && inner.refined) r = inner.refined
    } catch {}
    return { isMedicalContext: !!obj.isMedicalContext, refined: sanitize(r), en: (obj.en || "").toString(), ja: (obj.ja || "").toString() }
  } catch {
    return { refined: sanitize(outText || "") }
  }
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
  t = t.replace(/이명노/gi, "");
  t = t.replace(/날씨였습니다/gi, "");
  t = t.replace(/고맙습니다/gi, "");
  t = t.replace(/수고하셨습니다/gi, "");
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

const BANNED_WORDS = ["이덕영", "MBC", "MBC 뉴스", "시청해", "구독", "좋아요", "감사합니다", "수고하셨습니다", "뉴스입니다", "김성현", "재택 플러스", "뉴스", "기자", "체결합니다", "입니다.", "날씨"]
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
const isRepetitiveHallucination = (s: string): boolean => {
  const t = (s || "").trim();
  if (t.length < 2) return false;
  // Check for repeated single characters (e.g. "오오오오", "......")
  if (/(.)\1{4,}/.test(t)) return true;
  // Check for repeated short phrases (e.g. "음음음", "네네네")
  if (/(..)\1{3,}/.test(t)) return true;
  return false;
}

const isHallucination = (s: string): boolean => {
  const t = (s || "").trim()
  if (!t) return false
  if (isRepetitiveHallucination(t)) return true;
  const short = t.length <= 5
  const hasBanned = BANNED_WORDS.some(b => t.toLowerCase().includes(b.toLowerCase()))
  return hasBanned && short
}

const isPromptEcho = (s: string): boolean => {
  const tokens = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length) return false;
  const matchCount = tokens.filter(tok => PROMPT_WORDS.includes(tok)).length;
  const repetitionRatio = 1 - (new Set(tokens).size / tokens.length);
  return (matchCount / tokens.length) > 0.6 || repetitionRatio > 0.6;
}

const analyzeRelationship = (lastText: string, newText: string): { type: 'new' | 'update' | 'append', cleanedText: string } => {
    const a = lastText.trim();
    const b = newText.trim();
    if (!a || !b) return { type: 'new', cleanedText: b };

    // Normalize for comparison
    const normA = a.replace(/\s/g, "");
    const normB = b.replace(/\s/g, "");

    // 1. UPDATE: New text contains Old text (Correction/Expansion)
    if (normB.includes(normA)) {
        // Example: "방법을" -> "방법을 썼습니다"
        // Return full new text to REPLACE old text
        return { type: 'update', cleanedText: b };
    }
    
    // 2. UPDATE: Old text contains New text (Shrink? Rare, maybe correction)
    // If similarity is high (>80%), assume it's a correction
    if (normA.includes(normB) && normB.length > normA.length * 0.8) {
        return { type: 'update', cleanedText: b };
    }

    // 3. APPEND with Overlap Trimming
    // Check if Head of New overlaps with Tail of Old
    // We check from 5 chars up to min(a.len, b.len)
    const minOverlap = 5;
    const maxOverlap = Math.min(a.length, b.length);
    
    // Check for overlap starting from largest possible
    for (let len = maxOverlap; len >= minOverlap; len--) {
        const tailA = a.slice(-len);
        if (b.startsWith(tailA)) {
            // Found overlap!
            // Cleaned text is b without the overlapping part
            const clean = b.slice(len).trim();
            if (!clean) {
                // Fully overlapped? Then it's actually an UPDATE case that we missed, or duplicate.
                // If fully overlapped, it means b is a substring of a's tail.
                // e.g. A="...hello world", B="hello world"
                // This should be ignored or update?
                // If we treat as update, we might lose context of A.
                // Better to treat as Duplicate (Ignore).
                // But let's return 'update' with original A to be safe? 
                // Or just 'append' with empty?
                return { type: 'update', cleanedText: a }; // Keep old text
            }
            return { type: 'append', cleanedText: clean };
        }
    }
    
    // No overlap found
    return { type: 'new', cleanedText: b };
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
      let hall = false
      if (rawText && isPromptEcho(rawText)) {
        rawText = "";
      }
      if (rawText && isBannedDominant(rawText)) {
        rawText = "";
      }
      if (rawText && isHallucination(rawText)) {
        hall = true
        rawText = ""
      }

      // Rollback: No complex relationship analysis
      // Just basic duplicate check for exact matches within 30s
      let id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      let isUpdate = false

      try {
        const stateSnap = await admin.database().ref(`sessions/${projectId}/state`).get()
        const last = stateSnap.exists() ? (stateSnap.val() || {}) : {}
        const lastText = (last.lastText || "").toString()
        const lastTs = Number(last.lastTimestamp || 0)
        
        // Simple Duplicate Check
        if (lastText === rawText && (Date.now() - lastTs) < 30000) {
             res.status(200).json({ success: true, id, text: "", stage: "original", timestamp: Date.now(), audioBytes: buf.length, info: "DuplicateSuppressed", fileUrl: (req as any)._uploadedUrl || null, metrics: { whisperMs: tOpenaiEnd - tOpenaiStart, geminiMs: 0 }, version: versionTag })
             return;
        }
      } catch {}

      if (!rawText) {
        const timestamp = Date.now()
        const info = hall ? "HallucinationSuppressed" : "Empty"
        res.status(200).json({ success: true, id, text: "", stage: "original", timestamp, audioBytes: buf.length, info, fileUrl: (req as any)._uploadedUrl || null, metrics: { whisperMs: tOpenaiEnd - tOpenaiStart, geminiMs: 0 }, version: versionTag })
        return
      }

      const timestamp = Date.now()
      functions.logger.info(isUpdate ? "Original segment UPDATING" : "Original segment CREATING", { id, projectId, len: rawText.length })
      
      await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ status: "raw" }).catch(() => {})
      await admin.database().ref(`sessions/${projectId}/stream/${id}/original`).set(rawText)
      
      await admin.database().ref(`sessions/${projectId}/state`).update({ lastText: rawText, lastId: id, lastTimestamp: timestamp }).catch(() => {})
      
      // IMMEDIATE RESPONSE
      res.status(200).json({ success: true, id, text: rawText, stage: "original", timestamp, audioBytes: buf.length, fileUrl: (req as any)._uploadedUrl || null, metrics: { whisperMs: tOpenaiEnd - tOpenaiStart, geminiMs: 0 }, version: versionTag })

      // Async Processing (Using the same 'id')
      const runAsyncWork = async () => {
          let refined = rawText
          let firstEn = ""
          let firstJa = ""
          let contextOk = true
          const tGeminiStart = Date.now()
          functions.logger.info("Gemini REST call start", { id, projectId, len: rawText.length })
          
          // Get Previous Context for Injection
          let previousContext = "";
          try {
             const stateSnap = await admin.database().ref(`sessions/${projectId}/state`).get();
             if (stateSnap.exists()) {
                 const st = stateSnap.val();
                 previousContext = (st.lastRefined || st.lastText || "").toString();
             }
          } catch {}
          
          try {
            const out = await callGeminiREST(rawText, previousContext)
            if (out && out.isMedicalContext === false) {
              functions.logger.info("Filtered out non-medical context", { id, projectId })
              return
            }
            contextOk = true
            refined = sanitize(((out.refined || "").trim()) || rawText)
            firstEn = (out.en || "").toString()
            firstJa = (out.ja || "").toString()
            const tGeminiEnd = Date.now()
            await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ geminiMs: tGeminiEnd - tGeminiStart }).catch(() => {})
            await admin.database().ref(`sessions/${projectId}/status/services/gemini`).set({ state: "ok", ts: Date.now() }).catch(() => {})
            functions.logger.info("Gemini REST call success", { id, projectId, refinedLen: refined.length })
          } catch (err: any) {
            await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ refinedError: err?.message || "Gemini REST failed" }).catch(() => {})
            await admin.database().ref(`sessions/${projectId}/status/services/gemini`).set({ state: "error", message: err?.message || "Gemini REST failed", ts: Date.now() }).catch(() => {})
            functions.logger.error("Gemini REST call error", { id, projectId, message: err?.message || "unknown" })
            refined = rawText
          }
          if (!contextOk || !refined) {
            await admin.database().ref(`sessions/${projectId}/stream/${id}`).set(null).catch(() => {})
            functions.logger.info("Segment discarded by context filter", { id })
            return
          }
            await admin.database().ref(`sessions/${projectId}/stream/${id}/context`).set({ isMedicalContext: true, ts: Date.now() }).catch(() => {})
          
        // Regex-based JSON extraction (Hardened)
        // Find all JSON objects in the string
        const jsonRegex = /\{[\s\S]*?\}/g;
        const matches = refined.match(jsonRegex);
        let cleanRefined = refined;

        if (matches && matches.length > 0) {
            try {
                // Try to parse each match and see if it has 'refined' key
                for (const match of matches) {
                    try {
                        const parsed = JSON.parse(match);
                        if (parsed && parsed.refined) {
                            cleanRefined = parsed.refined;
                            break; // Use the first valid one
                        }
                    } catch {}
                }
            } catch {}
        }

        // Final Sanitize & Fallback
        // If cleanRefined still looks like JSON or contains brackets, force use rawText
        if (cleanRefined.trim().startsWith('{') || cleanRefined.includes('{"refined"')) {
             functions.logger.warn("JSON parsing failed fully, falling back to rawText", { id, cleanRefined });
             cleanRefined = rawText; // Better to show original than code
        }
        
        // Explicitly cast to string to be safe and sanitize again just in case
        cleanRefined = sanitize(String(cleanRefined || ""));

        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ refined: cleanRefined, en: firstEn, ja: firstJa, status: "final" }).catch(() => {})
        // Update State with Refined Text for next context
        await admin.database().ref(`sessions/${projectId}/state`).update({ lastRefined: cleanRefined, lastTimestamp: Date.now() }).catch(() => {})
        
        functions.logger.info("Refined segment saved", { id, projectId, refinedLen: cleanRefined.length })
        await admin.database().ref(`sessions/${projectId}/stream/${id}`).update({ status: "final" }).catch(() => {})

          // Translation step
          try {
            // Prefer Google Translate if available
            let en = firstEn, ja = firstJa
            if (!en && !ja) {
              try {
                const joint = await callGeminiREST(refined || rawText) // Context removed for speed
                en = (joint.en || "").toString()
                ja = (joint.ja || "").toString()
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
      };

      // Execute async work (without await, so function returns immediately)
      // Using Promise.resolve().then() to detach from main loop slightly
      Promise.resolve().then(runAsyncWork).catch(err => functions.logger.error("Async work failed", err));
    } catch (e: any) {
      res.status(500).json({ success: false, error: e?.message || "Internal Error", version: versionTag })
    }
  })
