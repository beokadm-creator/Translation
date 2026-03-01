import express from 'express'
import multer from 'multer'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import path from 'path'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const router = express.Router()

// Configure multer for file upload
const upload = multer({
  dest: path.join(__dirname, '../../tmp/audio'),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// Initialize clients lazily when needed
let openai: OpenAI | null = null
let genAI: GoogleGenerativeAI | null = null

function getOpenAIClient() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set')
    openai = new OpenAI({ apiKey })
  }
  return openai
}

function getGeminiClient() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set')
    genAI = new GoogleGenerativeAI(apiKey)
  }
  return genAI
}

// Dental terminology correction prompt
const DENTAL_CORRECTION_PROMPT = "치과 전문 학술 강연입니다. 임플란트, 상악동 거상술, 사이너스, Sinus Graft, 픽스처, 어버트먼트, 크라운, 브릿지, 파절, 치주염 등 의학 전문 용어를 한글과 영어로 정확히 인식하세요."

// Ensure temp directory exists
async function ensureTempDir() {
  const tempDir = path.join(__dirname, '../../tmp/audio')
  try {
    await fs.access(tempDir)
  } catch {
    await fs.mkdir(tempDir, { recursive: true })
  }
}

// POST /api/audio/upload
router.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    await ensureTempDir()

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file provided' })
    }



    const audioFile = req.file

    // Read the uploaded file
    const audioBuffer = await fs.readFile(audioFile.path)
    const webmPath = path.join(__dirname, '../../tmp/audio', `audio.webm`)
    await fs.writeFile(webmPath, audioBuffer)

    // Step 1: Whisper STT with Korean language
    const openaiClient = getOpenAIClient()
    const transcription = await openaiClient.audio.transcriptions.create({
      file: createReadStream(webmPath),
      model: 'whisper-1',
      language: 'ko',
      prompt: DENTAL_CORRECTION_PROMPT,
      response_format: 'text',
      temperature: 0
    })

    const transcript = transcription as string

    // Step 2: Gemini correction for dental terminology
    let corrected = ''
    try {
      const geminiClient = getGeminiClient()
      const model = geminiClient.getGenerativeModel({ model: 'gemini-pro' })
      const result = await model.generateContent([
        DENTAL_CORRECTION_PROMPT,
        transcript
      ])
      const response = await result.response
      corrected = response.text()
    } catch (geminiError) {
      console.error('Gemini correction failed:', geminiError)
      // Fallback: use original transcript if Gemini fails
      corrected = transcript
    }

    // Clean up temp files
    try {
      await fs.unlink(audioFile.path)
      await fs.unlink(webmPath)
    } catch (cleanupError) {
      console.error('Failed to cleanup temp files:', cleanupError)
    }

    res.json({
      success: true,
      transcript,
      corrected,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Audio upload error:', error)
    // Clean up temp file on error
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path)
      } catch (cleanupError) {
        console.error('Failed to cleanup temp file on error:', cleanupError)
      }
    }
    res.status(500).json({ success: false, error: 'Failed to process audio file' })
  }
})

export default router
