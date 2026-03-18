// Version: v11.0 (Stable - Medical/Dental Optimized)
// KEY IMPROVEMENT:
// 1. Every speech segment is written to DB IMMEDIATELY as 'translating'.
// 2. Audience sees the raw text in ~2 seconds.
// 3. Translation (Gemini) waits for either minLength (30 chars) or timeout (2s pause).
// 4. When buffer flushes, first segment gets translation, others are marked 'merged' (hidden).
// 5. Result: Ultra-fast visual feedback + High-quality contextual translation.

import * as functions from "firebase-functions/v1"
import * as admin from "firebase-admin"
import OpenAI from "openai"
import type { Request } from "express"
import { Readable } from "stream"

let _openai: OpenAI | null = null

// ── 4개 Gemini API 키 ─────────────────────────────────────────────────────────
const GEMINI_KEYS = [
    process.env.GEMINI_KEY_TRANSLATE || "",
    process.env.GEMINI_KEY_MEDICAL   || "",
    process.env.GEMINI_KEY_EDITOR    || "",
    process.env.GEMINI_KEY_CONTEXT   || "",
].filter(Boolean) // 빈 키 제거 (환경변수 미설정 방어)

let _keyIndex = 0

// ✅ 모델 설정: gemini-2.5-flash (이 API 키에서 사용 가능한 유일한 모델)
const FLASH_URL = (key: string) =>
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`

// ── Hallucination 필터 ────────────────────────────────────────────────────────
// 정적 URL 도메인만 핀포인트로 필터 (전체 문장 삭제 방지)
const URL_FILTER_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:sites\.google\.com|cst\.eu\.com|Amara\.org|amara\.org|youtube\.com|youtu\.be)\S*/gi
// 메타 언어 단어만 핀포인트로 필터
const META_FILTER_REGEX = /(?:Thank you for watching\.?|Thanks for watching\.?|Thank you\.?|시청해 주셔서 감사합니다\.?|시청해주셔서 감사합니다\.?|MBC 뉴스|SBS 뉴스|KBS 뉴스|YTN 뉴스|JTBC 뉴스|연합뉴스|유료광고|유료 광고|paid advertisement|disclaimer|면책 조항|면책조항|영상편집 및 자막|자막 제공 및 광고|광고를 포함하고|알 수 없는 소리|\[Music\]|\(Music\)|\[music\]|\(music\)|\[Applause\]|\(Applause\)|\[applause\]|\(applause\)|\[Laughter\]|\(Laughter\)|\[laughter\]|\(laughter\)|\(박수\)|\[박수\]|\(웃음\)|\[웃음\]|\(환호\)|\[환호\]|\(음악\)|\[음악\]|\(노래\)|\[노래\]|\(소음\)|\[소음\]|\(침묵\)|\[침묵\]|\(무음\)|\[무음\])/gi

const sanitize = (s: string): string => {
    let t = (s || "").toString()
    t = t.replace(/[`]{3,}/g, "").replace(/[`]/g, "")
    t = t.replace(/\bundefined\b/gi, "")

    t = t.replace(URL_FILTER_REGEX, ' ')
    t = t.replace(META_FILTER_REGEX, ' ')

    return t.replace(/\s+/g, ' ').trim()
}

// 반복 루프 체크
const hasRepetitionLoop = (text: string): boolean => {
    const words = text.split(/[,. ]+/).filter(Boolean).slice(0, 40)
    if (words.length < 8) return false
    // 서로 다른 단어가 6개 이하이고 전체 길이가 80자 이상이면 반복으로 판단
    const unique = new Set(words.map(w => w.toLowerCase()))
    return unique.size <= 6 && text.length > 80
}

const isGarbage = (text: string, _originalText?: string): boolean => {
    if (!text) return false

    if (hasRepetitionLoop(text)) return true

    // 전체가 괄호/대괄호 소리 표기인 경우 (Whisper 무음 환각)
    if (/^\s*[\(\[][^\)\]]{1,40}[\)\]]\s*[\.!]?\s*$/.test(text.trim())) return true

    // 침묵 시 흔히 나오는 짧은 환각어 필터 (짧은 문구에서만 발동, 긴 정상 발화는 보존)
    // 주의: '좋아요' / '구독' 단독 사용 금지 - 정상 발화("좋아요, 다음으로...") 삭제됨
    const filterGarbage = /(치과 학술대회|Transcribe exactly|발화 내용만 정확히|구독과 좋아요|알림.*설정|Please subscribe|Thank you for|Thanks for watching|시청.*감사|^감사합니다\.?$|영상편집|자막 제공|광고를 포함|알 수 없는 소리|subtitles by|subtitle by|자막.*제작|번역.*제공|MBC 뉴스|SBS 뉴스|KBS 뉴스)/i
    if (filterGarbage.test(text.trim()) && text.length < 80) return true

    // 성음만으로 된 건 버림
    const alphanumeric = text.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '')
    if (alphanumeric.length < 2) return true

    return false
}

// ── Gemini 단일 호출 ──────────────────────────────────────────────────────────
const callGemini = async (apiKey: string, prompt: string, timeoutMs = 12000): Promise<any | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 0 }
            }
        }
        const res = await fetch(FLASH_URL(apiKey), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload), signal: controller.signal
        })
        clearTimeout(timer)
        if (!res.ok) {
            functions.logger.warn(`[Gemini] HTTP ${res.status}`, { key: apiKey.slice(0, 10) })
            return null
        }
        const data = await res.json()
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
        if (!raw) return null
        const clean = raw.replace(/```json\s*|```/g, "").trim()
        return JSON.parse(clean)
    } catch (e: any) {
        clearTimeout(timer)
        return null
    }
}

// ── 번역 파이프라인 ───────────────────────────────────────────────────────────

// 번역 결과 유효성 검사 (필수 target 필드가 모두 채워졌는지 확인)
const validateTranslation = (data: Record<string, unknown>, targets: readonly string[]): boolean => {
    if (!data) return false
    for (const t of targets) {
        const val = data[t]
        if (!val || String(val).trim().length === 0) return false
    }
    return true
}

const buildTranslationResult = (
    data: Record<string, unknown>,
    sourceLang: string,
    rawText: string
): { refined: string; ko: string; en: string; isMedical: boolean } => {
    const refined = sanitize((data.refined as string) || rawText)
    return {
        refined,
        ko: sourceLang === 'ko' ? refined : sanitize((data.ko as string) || ''),
        en: sourceLang === 'en' ? refined : sanitize((data.en as string) || ''),
        isMedical: (data.isMedical as boolean) ?? false
    }
}

const translateWithFallback = async (
    rawText: string,
    sourceLang: string,
    previousContext: string,
    sessionContext: string
): Promise<{ refined: string; ko: string; en: string; isMedical: boolean }> => {
    const tStart = Date.now()
    const targets = (['ko', 'en'] as const).filter(l => l !== sourceLang)
    const langNames: Record<string, string> = { ko: 'Korean', en: 'English' }
    const srcName = langNames[sourceLang] || 'the source language'
    const transFields = targets.map(l => `"${l}": "...${langNames[l] || l}..."`).join(', ')

    const prompt = [
        `You are a professional medical/dental translation AI.`,
        `SESSION CONTEXT (CRITICAL): ${sessionContext || 'Live Medical/Dental Lecture'}`,
        `SOURCE: ${sourceLang} (${srcName})`,
        `INPUT: "${rawText}"`,
        previousContext ? `PREVIOUS: "${previousContext.split(' / ').slice(-1)[0]}"` : '',
        `TASK: Refine/Fix the input in ${srcName} (especially technical terminology like Implant, Sinus, Bone Graft, etc.) and translate it accurately.`,
        ``,
        `TASKS:`,
        `1. REFINE: Fix errors in ${srcName}. Correct dental terms. Keep ${srcName} only.`,
        `2. TRANSLATE to: ${targets.map(l => langNames[l] || l).join(' AND ')}`,
        `3. OUTPUT JSON ONLY.`,
        ``,
        `EXAMPLES:`,
        `[INPUT KO] "임플란트 픽스처를 식립했습니다."`,
        `{"refined": "임플란트 픽스처를 식립했습니다.", "en": "The implant fixture was placed.", "isMedical": true}`,
        `[INPUT EN] "Uh, so, we did the bone graft."`,
        `{"refined": "So, we did the bone graft.", "ko": "그래서 우리는 골이식을 진행했습니다.", "isMedical": true}`,
        ``,
        `CRITICAL: All language fields MUST be filled. Never return empty strings. Even for fragments, YOU MUST TRANSLATE.`,
        `FORMAT: {"refined": "...", ${transFields}, "isMedical": true}`
    ].filter(Boolean).join('\n')

    if (GEMINI_KEYS.length === 0) {
        functions.logger.error("[Translate] No Gemini keys available")
        const fallback = sanitize(rawText)
        return { refined: fallback, ko: fallback, en: fallback, isMedical: false }
    }

    // ── 4개 키 동시 병렬 호출 → 가장 빠른 유효 응답 사용 ──────────────────
    // gemini-2.5-flash는 thinking으로 10-20초 소요. 순차 시도 시 timeout 초과 반복.
    // Promise.any()로 4개를 동시에 쏘면 가장 빠른 키가 응답하는 즉시 사용.
    try {
        const data = await Promise.any(
            GEMINI_KEYS.map(key =>
                callGemini(key, prompt, 22000).then(d => {
                    if (!d || !validateTranslation(d, targets)) throw new Error('invalid')
                    return d as Record<string, unknown>
                })
            )
        )
        functions.logger.info("[Translate] OK", {
            ms: Date.now() - tStart, srcLen: rawText.length
        })
        return buildTranslationResult(data, sourceLang, rawText)
    } catch {
        // AggregateError: 모든 키 실패
    }

    functions.logger.error(`[Translate] All ${GEMINI_KEYS.length} keys failed → raw text fallback`, { input: rawText.slice(0, 50) })
    const fallback = sanitize(rawText)
    return { refined: fallback, ko: fallback, en: fallback, isMedical: false }
}

// ── OpenAI 클라이언트 ─────────────────────────────────────────────────────────
const getOpenAI = (): OpenAI => {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY || (functions.config()?.openai?.key as string) || ""
        if (!apiKey) throw new Error("OPENAI_API_KEY missing")
        _openai = new OpenAI({ apiKey })
    }
    return _openai
}

const DENTAL_PROMPT_KO = "임플란트, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, 보철"
const DENTAL_PROMPT_EN = "Implant, Sinus, Bone Graft, Fixture, Abutment, Crown"

// ─────────────────────────────────────────────────────────────────────────────
// 1. HTTP Trigger: Immediate Display + Progressive Buffering
// ─────────────────────────────────────────────────────────────────────────────
export const processAudio = functions
    .runWith({ timeoutSeconds: 120, memory: "1GB" })
    .https.onRequest(async (req, res) => {
        const versionTag = "v11.0_stable"

        // CORS
        const origin = req.headers.origin as string
        const allowedOrigin = process.env.ALLOWED_ORIGIN || (functions.config()?.app?.allowed_origin as string) || "*"
        if (allowedOrigin === "*" || allowedOrigin === origin) {
            res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin)
        } else {
            res.set("Access-Control-Allow-Origin", origin || allowedOrigin)
        }
        res.set("Access-Control-Allow-Methods", "POST, OPTIONS")
        res.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
        if (req.method === "OPTIONS") { res.status(204).send(""); return }

        const tTotal = Date.now()

        try {
            if (!admin.apps.length) throw new Error("Admin not initialized")
            const auth = (req.headers.authorization || "").toString()
            if (!auth.startsWith("Bearer ")) { res.status(401).json({ success: false }); return }

            const projectId = (req.query.projectId || "").toString()
            const sourceLabel = (req.query.sourceLabel || "").toString()
            const queryLang = (req.query.sourceLang || "").toString()
            if (!projectId) { res.status(400).json({ success: false }); return }

            let buf: Buffer | null = null
            const raw = (req as Request & { rawBody?: Buffer }).rawBody as Buffer | undefined
            if (raw && Buffer.isBuffer(raw)) buf = raw
            else if (Buffer.isBuffer(req.body)) buf = req.body as Buffer
            else if (typeof req.body === "string") buf = Buffer.from(req.body, "binary")

            if (!buf || buf.length === 0) { res.status(400).json({ success: false }); return }
            if (buf.length < 2000) { res.status(200).json({ success: false, error: "TooSmall" }); return }

            const projectRef = admin.database().ref(`projects/${projectId}`)
            let sourceLang = queryLang || 'ko' // Use query param if provided, otherwise default 'ko'
            let activeSessionId: string | null = null
            let sessionContext = ""
            let previousContext = ""
            let customKeywords = ""
            let minLength = 20
            let timeoutMs = 3000
            let sentenceEnd = true

            // 설정 로드
            try {
                const [activeSnap, stateSnap, chunkSnap, projectSettingsSnap] = await Promise.all([
                    projectRef.child('activeSessionId').get(),
                    projectRef.child('state').get(),
                    projectRef.child('settings/chunk').get(),
                    projectRef.child('settings').get()
                ])

                if (activeSnap.exists()) {
                    // ── 우선순위 1: 활성 세션의 sourceLanguage ─────────────────────
                    activeSessionId = activeSnap.val()
                    functions.logger.info(`[STT] Active Session: ${activeSessionId}`)
                    const sSnap = await projectRef.child(`sessions/${activeSessionId}`).get()
                    if (sSnap.exists()) {
                        const s = sSnap.val()
                        sourceLang = s.sourceLanguage || sourceLang
                        functions.logger.info(`[STT] Session language: ${sourceLang}`)
                        const affiliationStr = s.affiliation ? `, Affiliation: ${s.affiliation}` : ''
                        const abstractStr = s.abstract ? `, Abstract: ${s.abstract}` : ''
                        const keywordsStr = s.keywords ? `, Keywords: ${s.keywords}` : ''
                        sessionContext = `Speaker: ${s.speaker}${affiliationStr}, Topic: ${s.topic}${abstractStr}${keywordsStr}`
                        // Whisper prompt에 연자명·소속·키워드 모두 포함 → 고유명사 오인식 방지
                        const speakerTerms = [s.speaker, s.affiliation, s.topic].filter(Boolean).join(', ')
                        customKeywords = [s.keywords, speakerTerms].filter(Boolean).join(', ')
                    } else {
                        functions.logger.warn(`[STT] Active Session ${activeSessionId} data missing in DB`)
                    }
                } else {
                    // ── 우선순위 2: 세션 없을 때 projectSettings targetLanguages 역추론 ──
                    // queryLang(클라이언트 전달값)이 이미 초기값이므로 여기서만 보정
                    const projectSettings = projectSettingsSnap.val() || {}
                    const tgt = projectSettings.targetLanguages
                    const tgtArr: string[] = Array.isArray(tgt) ? tgt : (tgt ? [tgt] : [])
                    if (tgtArr.includes('ko') && !tgtArr.includes('en')) {
                        sourceLang = 'en' // 타겟이 한국어면 소스는 영어
                    } else if (tgtArr.includes('en') && !tgtArr.includes('ko')) {
                        sourceLang = 'ko' // 타겟이 영어면 소스는 한국어
                    }
                    // 그 외(양방향이거나 타겟 미설정): queryLang || 'ko' 유지
                    functions.logger.info(`[STT] No active session. Using lang: ${sourceLang}`)
                }
                if (chunkSnap.exists()) {
                    const sett = chunkSnap.val()
                    if (sett.minLength !== undefined) minLength = Number(sett.minLength)
                    if (sett.timeoutMs !== undefined) timeoutMs = Number(sett.timeoutMs)
                    if (sett.sentenceEnd !== undefined) sentenceEnd = Boolean(sett.sentenceEnd)
                }
                if (stateSnap.exists()) {
                    const st = stateSnap.val()
                    const list: string[] = Array.isArray(st.lastRefinedList) ? st.lastRefinedList : []
                    previousContext = list.slice(-2).join(' / ')
                }
            } catch { /* 무시 */ }

            // ── STEP 1: Whisper STT ────────────────────────────────────────────
            let openai = getOpenAI()
            const audioStream = Readable.from(buf) as Readable & { path: string }
            audioStream.path = "audio.webm"

            const tWhisper = Date.now()
            const basePrompt = sourceLang === 'ko' ? DENTAL_PROMPT_KO : DENTAL_PROMPT_EN;
            const whisperPrompt = customKeywords ? `${basePrompt}, ${customKeywords}` : basePrompt;

            const stt = await openai.audio.transcriptions.create({
                file: audioStream, model: "whisper-1", language: sourceLang,
                prompt: whisperPrompt, temperature: 0,
            })
            const whisperMs = Date.now() - tWhisper
            functions.logger.info("[Whisper]", { ms: whisperMs })

            // HealthDashboard WHISPER 상태 표시용 타임스탬프 기록 (비차단)
            projectRef.child('status/services/openai').update({ ts: Date.now() }).catch(() => {})

            const sttText = (stt?.text || "").trim()
            const rawText = sanitize(sttText)

            if (rawText.length < 2 || isGarbage(rawText, sttText)) {
                res.status(200).json({ success: true, info: "EmptyOrGarbage", text: rawText }); return
            }

            const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            const timestamp = Date.now()
            const seqResult = await projectRef.child('lastSequence').transaction((cur) => (cur || 0) + 1)
            const seq = seqResult.snapshot.val()

            // ── STEP 2: DB에 즉시 기록 (status: translating) ─────────────────
            // 이렇게 해야 유저 설정(hideRaw)과 상관없이 '번역 중'으로 원문이 즉시 보임
            await projectRef.child(`stream/${id}`).set({
                original: rawText,
                refined: rawText,
                status: "translating",
                timestamp, sourceLabel, sessionId: activeSessionId, seq, version: versionTag
            })

            // 응답 즉시 전송 (로그에서 undefined 안 나오게 text 포함)
            res.status(200).json({ success: true, id, text: rawText, stage: "translating" })

            // ── STEP 3: 버퍼링 및 번역 (RTDB Transaction - Race condition 완전 제거) ──
            // transaction()은 read→modify→write를 서버 레벨에서 원자적으로 처리.
            // 동시 요청이 있으면 RTDB가 자동으로 재시도하여 데이터 유실 없음.
            let flushData: { targetId: string; idsToDelete: string[]; bufferText: string } | null = null

            await projectRef.child('state').transaction((currentState: Record<string, unknown> | null) => {
                const st = (currentState || {}) as Record<string, unknown>
                const currentBufferText = ((st.bufferText as string) || '').toString()
                const currentBufferIds: string[] = Array.isArray(st.bufferIds) ? (st.bufferIds as string[]) : []

                // 버퍼가 비어있으면 지금부터 타이머 시작
                const lastGeminiTime = currentBufferIds.length === 0
                    ? Date.now()
                    : Number(st.lastGeminiTime || Date.now())

                const newBufferText = currentBufferText ? currentBufferText + ' ' + rawText : rawText
                const newBufferIds = [...currentBufferIds, id]

                const timeDiff = Date.now() - lastGeminiTime
                const isSentenceEnd = sentenceEnd && /[.!?]$/.test(newBufferText.trim())
                const isLongEnough = newBufferText.length >= minLength
                const isTimeOut = timeDiff >= timeoutMs

                if (isSentenceEnd || isLongEnough || isTimeOut) {
                    // FLUSH: 상태 초기화 + 플러시 데이터 캡처
                    flushData = {
                        targetId: newBufferIds[0],
                        idsToDelete: newBufferIds.slice(1),
                        bufferText: newBufferText
                    }
                    return { bufferText: '', bufferIds: [], lastGeminiTime: Date.now(), lastRefinedList: (st.lastRefinedList as string[]) || [] }
                } else {
                    // BUFFERING: 현재 세그먼트 추가
                    return { ...st, bufferText: newBufferText, bufferIds: newBufferIds, lastGeminiTime }
                }
            })

            if (flushData) {
                const { targetId, idsToDelete, bufferText: flushText } = flushData as { targetId: string; idsToDelete: string[]; bufferText: string }
                try {
                    const { refined, ko, en, isMedical } = await translateWithFallback(
                        flushText, sourceLang, previousContext, sessionContext
                    )
                    const updates: Record<string, unknown> = {}
                    const base = `projects/${projectId}/stream/${targetId}`
                    updates[`${base}/refined`] = refined
                    updates[`${base}/ko`] = ko
                    updates[`${base}/en`] = en
                    updates[`${base}/isMedical`] = isMedical
                    updates[`${base}/status`] = "final"
                    updates[`${base}/mergedIds`] = idsToDelete

                    for (const pid of idsToDelete) {
                        updates[`projects/${projectId}/stream/${pid}/status`] = "merged"
                    }

                    // context 리스트 업데이트
                    try {
                        const listSnap = await projectRef.child('state/lastRefinedList').get()
                        const list: string[] = listSnap.exists() ? listSnap.val() : []
                        updates[`projects/${projectId}/state/lastRefinedList`] = [...list, refined].slice(-5)
                    } catch { }

                    await admin.database().ref().update(updates)
                } catch {
                    // Gemini 실패 시 버퍼된 모든 세그먼트를 "final"로 복구
                    const errorFixes: Record<string, unknown> = {}
                    errorFixes[`projects/${projectId}/stream/${targetId}/status`] = "final"
                    for (const pid of idsToDelete) {
                        errorFixes[`projects/${projectId}/stream/${pid}/status`] = "final"
                    }
                    await admin.database().ref().update(errorFixes)
                }
            }
            // flushData가 null이면 버퍼링 중 → transaction이 이미 상태 저장 완료

        } catch (e: any) {
            try { res.status(500).json({ success: false, error: e.message }) } catch { }
        }
    })

// ── Legacy Triggers (Disabled for v11.0) ─────────────────────────────────────
export const onRefineRequest = functions.database.ref("projects/{projectId}/stream/{dataId}").onCreate(() => null)

// ── Remaster (미구현 stub - 비활성화) ────────────────────────────────────────
// remasterSession pubsub은 구현체가 없으므로 비용/로그 낭비를 막기 위해 비활성화.
// 추후 실제 리마스터 로직 구현 시 아래 주석을 해제할 것.
// export const remasterSession = functions.pubsub.schedule("every 2 minutes").onRun(() => runRemasterLogic())

// ── 진단 툴 ─────────────────────────────────────────────────────────────────
export const verifyGeminiPipeline = functions.https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*")
    const result = await translateWithFallback("Testing terminal connectivity.", "en", "", "")
    res.json({ success: true, version: "v11.0", result })
})
