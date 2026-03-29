// Version: v12.3 (Stable - OpenAI Only)
// STT:         gpt-4o-transcribe  (language + domain keyword prompt)
// Translation: gpt-4o-mini        (JSON strict, temperature 0)
// KEY FLOW:
// 1. Every speech segment is written to DB IMMEDIATELY as 'translating'.
// 2. Audience sees the raw text in ~1-2 seconds.
// 3. Translation waits for minLength chars OR timeout before flushing buffer.
// 4. When buffer flushes, first segment gets translation, others are marked 'merged' (hidden).
// 5. Result: Ultra-fast visual feedback + High-quality contextual translation.

import * as functions from "firebase-functions/v1"
import * as admin from "firebase-admin"
import OpenAI from "openai"
import type { Request } from "express"
import { Readable } from "stream"

let _openai: OpenAI | null = null

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

const normalizeLoose = (text: string): string =>
    (text || "")
        .toLowerCase()
        .replace(/[()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

const isPromptLeakage = (text: string, promptText?: string): boolean => {
    if (!text || !promptText) return false

    const normalizedText = normalizeLoose(text)
    const normalizedPrompt = normalizeLoose(promptText)

    if (!normalizedText || !normalizedPrompt) return false

    if (normalizedPrompt.includes(normalizedText) && normalizedText.length >= 40) return true
    if (normalizedText.includes(normalizedPrompt) && normalizedPrompt.length >= 40) return true

    const promptItems = promptText
        .split(',')
        .map(item => normalizeLoose(item))
        .filter(item => item.length >= 6)

    if (promptItems.length < 4) return false

    const matchedItems = new Set(
        promptItems.filter(item => normalizedText.includes(item))
    )

    const commaCount = (text.match(/,/g) || []).length

    return matchedItems.size >= 4 && commaCount >= 3
}

const isGarbage = (text: string, _originalText?: string, promptText?: string): boolean => {
    if (!text) return false

    if (hasRepetitionLoop(text)) return true
    if (isPromptLeakage(text, promptText)) return true

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

const translateWithOpenAI = async (
    rawText: string,
    sourceLang: string,
    previousContext: string,
    sessionContext: string
) : Promise<{ refined: string; ko: string; en: string; isMedical: boolean } | null> => {
    try {
        const openai = getOpenAI()
        const contextLine = sanitize(sessionContext).slice(0, 180)
        const previousLine = sanitize(previousContext.split(' / ').slice(-1)[0] || '').slice(0, 80)
        const prompt = [
            `source_lang=${sourceLang}`,
            `input=${rawText}`,
            contextLine ? `session_context=${contextLine}` : "",
            previousLine ? `previous_refined=${previousLine}` : "",
            'Return strict JSON: {"refined":"","ko":"","en":"","isMedical":true}.',
            'Rules: (1) Output ONLY what is in "input" — never add, expand, or infer content from session_context. (2) Correct only obvious STT errors (e.g. wrong homophone). (3) Do not output topic, speaker name, affiliation, or keywords as standalone content. (4) Never leave ko or en empty; translate fragments as fragments. (5) Keep all clinical terminology literal.',
            'If source_lang=ko, refined and ko must stay Korean and en must be English. If source_lang=en, refined and en must stay English and ko must be Korean.',
            'Example output for source_lang=ko and input="임플란트 픽스처를 식립했습니다.": {"refined":"임플란트 픽스처를 식립했습니다.","ko":"임플란트 픽스처를 식립했습니다.","en":"The implant fixture was placed.","isMedical":true}'
        ].filter(Boolean).join('\n')

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            max_tokens: 200,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: "You refine live medical speech-to-text output and produce Korean and English translations in strict JSON."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        })

        const content = completion.choices[0]?.message?.content || ""
        if (!content) return null

        const data = JSON.parse(content) as Record<string, unknown>
        if (!validateTranslation(data, ['ko', 'en'])) return null

        return buildTranslationResult(data, sourceLang, rawText)
    } catch (e: any) {
        functions.logger.warn("[Translate][OpenAI] Failed", {
            err: String(e).slice(0, 180)
        })
        return null
    }
}

const translateWithFallback = async (
    rawText: string,
    sourceLang: string,
    previousContext: string,
    sessionContext: string
): Promise<{ refined: string; ko: string; en: string; isMedical: boolean }> => {
    const tStart = Date.now()
    const result = await translateWithOpenAI(rawText, sourceLang, previousContext, sessionContext)

    if (result) {
        functions.logger.info("[Translate][OpenAI] OK", {
            ms: Date.now() - tStart,
            srcLen: rawText.length
        })
        return result
    }

    functions.logger.error("[Translate][OpenAI] Failed, raw text fallback", { input: rawText.slice(0, 50) })
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
        const versionTag = "v12.3_openai_only"

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
            let minLength = 35
            let timeoutMs = 4500
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
                        // Whisper prompt: 연자명·소속·주제·키워드·초록(60자) 포함 → 고유명사·도메인 용어 오인식 방지
                        const speakerTerms = [s.speaker, s.affiliation, s.topic].filter(Boolean).join(', ')
                        const abstractSnippet = s.abstract ? s.abstract.slice(0, 60) : ''
                        customKeywords = [s.keywords, speakerTerms, abstractSnippet].filter(Boolean).join(', ')
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
                    if (sett.minLength !== undefined) minLength = Math.max(10, Number(sett.minLength))
                    if (sett.timeoutMs !== undefined) timeoutMs = Math.max(1000, Number(sett.timeoutMs))
                    if (sett.sentenceEnd !== undefined) sentenceEnd = Boolean(sett.sentenceEnd)
                }
                if (stateSnap.exists()) {
                    const st = stateSnap.val()
                    const list: string[] = Array.isArray(st.lastRefinedList) ? st.lastRefinedList : []
                    previousContext = list.slice(-2).join(' / ')
                }
            } catch { /* 무시 */ }

            // ── STEP 1: OpenAI STT ────────────────────────────────────────────
            let openai = getOpenAI()
            const audioStream = Readable.from(buf) as Readable & { path: string }
            audioStream.path = "audio.webm"

            const tWhisper = Date.now()
            const basePrompt = sourceLang === 'ko' ? DENTAL_PROMPT_KO : DENTAL_PROMPT_EN;
            const whisperPrompt = customKeywords ? `${basePrompt}, ${customKeywords}` : basePrompt;

            const stt = await openai.audio.transcriptions.create({
                file: audioStream, model: "gpt-4o-transcribe", language: sourceLang,
                prompt: whisperPrompt, temperature: 0,
            })
            const whisperMs = Date.now() - tWhisper
            functions.logger.info("[Whisper]", { ms: whisperMs })

            // HealthDashboard WHISPER 상태 표시용 타임스탬프 기록 (비차단)
            projectRef.child('status/services/openai').update({ ts: Date.now() }).catch(() => {})

            const sttText = (stt?.text || "").trim()
            const rawText = sanitize(sttText)

            if (rawText.length < 2 || isGarbage(rawText, sttText, whisperPrompt)) {
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
                const lastFlushTime = currentBufferIds.length === 0
                    ? Date.now()
                    : Number(st.lastFlushTime || st.lastGeminiTime || Date.now())

                const newBufferText = currentBufferText ? currentBufferText + ' ' + rawText : rawText
                const newBufferIds = [...currentBufferIds, id]

                const timeDiff = Date.now() - lastFlushTime
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
                    return { bufferText: '', bufferIds: [], lastFlushTime: Date.now(), lastRefinedList: (st.lastRefinedList as string[]) || [] }
                } else {
                    // BUFFERING: 현재 세그먼트 추가
                    return { ...st, bufferText: newBufferText, bufferIds: newBufferIds, lastFlushTime: lastFlushTime }
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
                    // 번역 실패 시 버퍼된 모든 세그먼트를 "final"로 복구
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

// ── Legacy Triggers (Disabled) ───────────────────────────────────────────────
export const onRefineRequest = functions.database.ref("projects/{projectId}/stream/{dataId}").onCreate(() => null)

// ── Remaster (미구현 stub - 비활성화) ────────────────────────────────────────
// remasterSession pubsub은 구현체가 없으므로 비용/로그 낭비를 막기 위해 비활성화.
// 추후 실제 리마스터 로직 구현 시 아래 주석을 해제할 것.
// export const remasterSession = functions.pubsub.schedule("every 2 minutes").onRun(() => runRemasterLogic())

// ── 진단 툴 ─────────────────────────────────────────────────────────────────
export const verifyPipeline = functions.https.onRequest(async (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*")
    const result = await translateWithFallback("임플란트 픽스처를 식립했습니다.", "ko", "", "Live Medical Lecture")
    res.json({ success: true, version: "v12.3_openai_only", stt: "gpt-4o-transcribe", translation: "gpt-4o-mini", result })
})
