/**
 * Audio Processing Route
 * Pipeline: GPT(Whisper) STT → Gemini(전문용어 교정) → Gemini(다국어 번역)
 * Version: v2.0 (Full Pipeline)
 */

import express from 'express'
import multer from 'multer'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

// Configure multer for file upload
const upload = multer({
  dest: path.join(__dirname, '../../tmp/audio'),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// Initialize clients lazily
let openai: OpenAI | null = null

function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
    openai = new OpenAI({ apiKey })
  }
  return openai
}

function getGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY || ''
  if (!key) throw new Error('GEMINI_API_KEY environment variable is not set')
  return key
}

const GEMINI_FLASH_URL = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`

const GEMINI_PRO_URL = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${key}`

// Dental terminology hint for Whisper
const DENTAL_STT_PROMPT =
  '치과 전문 학술 강연. 임플란트, 상악동 거상술, Sinus Graft, 픽스처, 어버트먼트, 크라운, 브릿지, 파절, 치주염, GBR, BMP, PRP, 골이식, Osstem, 스트라우만, 노벨.'

// Hallucination blacklist
const HALLUCINATION_BLACKLIST = ['자막제작', '자막 제작', 'Subtitles by', 'MBC 뉴스', '시청해 주셔서 감사합니다']
const isGarbage = (text: string): boolean => {
  if (!text) return false

  // Only drop if the ENTIRE chunk is exactly a hallucination, not just containing it
  const trimmed = text.trim()
  if (HALLUCINATION_BLACKLIST.some((b) => trimmed === b)) return true

  // Add regex for quick drops of short common YT/speech hallucination phrases
  const filterGarbage = /(치과 학술대회|Transcribe exactly|발화 내용만 정확히|구독|좋아요|알림.*설정|Please subscribe|Thank you for|Thanks for watching|시청.*감사)/i
  if (filterGarbage.test(trimmed) && trimmed.length < 60) return true

  // Drop obvious repetition loops: e.g., "Hello Hello Hello Hello"
  if (/(.+)\1{3,}/.test(text) && text.length > 50) return true

  return false
}

// ─── Step 2+3: Gemini - Terminology + Translation ────────────────────────────
const callGeminiFullPipeline = async (
  rawText: string,
  sourceLang: string,
  sessionContext: string
): Promise<{ refined: string; en: string; ja: string; isMedicalContext: boolean }> => {
  const apiKey = getGeminiKey()

  // Build field-level instructions based on source language
  let fieldInstructions = ''
  if (sourceLang === 'ko') {
    fieldInstructions = `
- "refined": 한국어로 교정. 전문용어를 올바르게 수정. 번역하지 마세요.
- "en": 영어로 번역. 한국어 문자를 포함하지 마세요.
- "ja": 일본어로 번역.`
  } else if (sourceLang === 'en') {
    fieldInstructions = `
- "refined": 영어로 교정. 번역하지 마세요.
- "en": refined와 동일.
- "ja": 일본어로 번역.`
  } else if (sourceLang === 'ja') {
    fieldInstructions = `
- "refined": 일본어로 교정. 번역하지 마세요.
- "en": 영어로 번역.
- "ja": refined와 동일.`
  } else if (sourceLang === 'zh') {
    fieldInstructions = `
- "refined": 중국어로 교정. 번역하지 마세요.
- "en": 영어로 번역.
- "ja": 일본어로 번역.`
  } else {
    fieldInstructions = `
- "refined": 원문 언어로 교정.
- "en": 영어로 번역.
- "ja": 일본어로 번역.`
  }

  const prompt = `당신은 치과 의학 학술대회 전문 라이브 캡셔너입니다.

[규칙]
1. 항상 유효한 JSON만 출력하세요.
2. 음성인식 오류를 문맥으로 교정하세요 (예: "감곤" → "권고안", "싸이너스" → "Sinus").
3. 의료 전문용어를 올바르게 표기하세요.
4. 짧은 단편도 반드시 번역하세요. 절대 건너뛰지 마세요.
5. "isMedicalContext": 치과/의료 내용이면 true, 일반 대화면 false.

[출력 언어 지침]
${fieldInstructions}

[출력 형식]
{"isMedicalContext": true|false, "refined": "...", "en": "...", "ja": "..."}

${sessionContext ? `[세션 정보]\n${sessionContext}\n` : ''}
[입력 텍스트]
"${rawText}"`

  type GeminiPayload = {
    contents: { parts: { text: string }[] }[]
    generationConfig: { responseMimeType: string }
  }

  const payload: GeminiPayload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' },
  }

  // Try Flash first, fallback to Pro
  let res = await fetch(GEMINI_FLASH_URL(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    console.warn(`[Gemini Flash] Error ${res.status}, falling back to Pro`)
    res = await fetch(GEMINI_PRO_URL(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new Error(`Gemini API Error: ${res.status}`)
    }
  }

  const data = await res.json()
  const outText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''

  if (!outText) return { refined: rawText, en: '', ja: '', isMedicalContext: false }

  try {
    const cleanText = outText.replace(/```json\s*|```/g, '').trim()
    const obj = JSON.parse(cleanText)
    return {
      isMedicalContext: !!obj.isMedicalContext,
      refined: sanitize(obj.refined || rawText),
      en: sanitize(obj.en || ''),
      ja: sanitize(obj.ja || ''),
    }
  } catch {
    return { refined: sanitize(outText), en: '', ja: '', isMedicalContext: false }
  }
}

const sanitize = (s: string): string => {
  let t = (s || '').toString()
  t = t.replace(/[`]{3,}/g, '').replace(/[`]/g, '')
  t = t.replace(/\bundefined\b/gi, '')
  return t.trim()
}

// Ensure temp directory exists
async function ensureTempDir() {
  const tempDir = path.join(__dirname, '../../tmp/audio')
  try {
    await fs.access(tempDir)
  } catch {
    await fs.mkdir(tempDir, { recursive: true })
  }
}

// ─── POST /api/audio/upload ───────────────────────────────────────────────────
router.post('/upload', upload.single('audio'), async (req, res) => {
  const tStart = Date.now()
  try {
    await ensureTempDir()

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file provided' })
    }

    const audioFile = req.file

    // Read the uploaded file and write as .webm
    const audioBuffer = await fs.readFile(audioFile.path)

    // Safety: reject files that are too small (silence / noise)
    if (audioBuffer.length < 2000) {
      await fs.unlink(audioFile.path).catch(() => { })
      return res.status(200).json({ success: false, error: 'TooSmall' })
    }

    const webmPath = path.join(__dirname, '../../tmp/audio', `${Date.now()}_audio.webm`)
    await fs.writeFile(webmPath, audioBuffer)

    // ── Step 1: GPT Whisper STT ──────────────────────────────────────────────
    // Get source language from request body (client can send it, defaults to 'ko')
    const sourceLang = (req.body?.sourceLang as string) || 'ko'
    const sessionContext = (req.body?.sessionContext as string) || ''

    let rawText = ''
    const tWhisperStart = Date.now()
    try {
      const openaiClient = getOpenAIClient()
      const transcription = await openaiClient.audio.transcriptions.create({
        file: createReadStream(webmPath),
        model: 'whisper-1',
        language: sourceLang, // Language-locked for accuracy
        prompt: DENTAL_STT_PROMPT,
        response_format: 'text',
        temperature: 0,
      })
      rawText = sanitize((transcription as string).trim())
      console.log(`[Whisper] ${Date.now() - tWhisperStart}ms | lang=${sourceLang} | "${rawText.slice(0, 60)}..."`)
    } catch (whisperError) {
      console.error('[Whisper] STT failed:', whisperError)
      await cleanup(audioFile.path, webmPath)
      return res.status(200).json({ success: false, error: 'WhisperFailed' })
    }

    // Cleanup temp files ASAP
    await cleanup(audioFile.path, webmPath)

    // Validate transcript
    if (!rawText || rawText.length < 2) {
      return res.status(200).json({ success: true, info: 'Empty' })
    }
    if (isGarbage(rawText)) {
      console.log('[Filter] Garbage dropped:', rawText)
      return res.status(200).json({ success: true, info: 'GarbageDropped' })
    }

    // ── Step 2+3: Gemini 전문용어 교정 + 다국어 번역 ─────────────────────────
    let refined = rawText
    let en = ''
    let ja = ''
    let isMedicalContext = false
    const tGeminiStart = Date.now()

    try {
      const result = await callGeminiFullPipeline(rawText, sourceLang, sessionContext)
      refined = result.refined || rawText
      en = result.en
      ja = result.ja
      isMedicalContext = result.isMedicalContext
      console.log(`[Gemini] ${Date.now() - tGeminiStart}ms | medical=${isMedicalContext} | en="${en.slice(0, 40)}..."`)
    } catch (geminiError) {
      console.error('[Gemini] Pipeline failed, using raw text:', geminiError)
      refined = rawText
    }

    const totalMs = Date.now() - tStart
    console.log(`[Pipeline] Total: ${totalMs}ms`)

    return res.json({
      success: true,
      original: rawText,
      refined,
      en,
      ja,
      isMedicalContext,
      sourceLang,
      processingMs: {
        whisper: Date.now() - tWhisperStart,
        gemini: Date.now() - tGeminiStart,
        total: totalMs,
      },
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[Audio Upload] Unexpected error:', error)
    if (req.file?.path) {
      await fs.unlink(req.file.path).catch(() => { })
    }
    return res.status(500).json({ success: false, error: 'Failed to process audio file' })
  }
})

async function cleanup(...paths: string[]) {
  for (const p of paths) {
    try {
      await fs.unlink(p)
    } catch {
      // ignore
    }
  }
}

export default router
