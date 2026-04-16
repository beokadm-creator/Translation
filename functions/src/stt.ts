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

    // 1. 프롬프트 전체가 텍스트에 통째로 포함된 경우 (가장 흔한 케이스)
    if (normalizedText.includes(normalizedPrompt) && normalizedPrompt.length >= 10) return true
    if (normalizedPrompt.includes(normalizedText) && normalizedText.length >= 40) return true

    // 2. 키워드가 문장 사이에 연속으로 박혀있는 경우 감지
    // "임플란트, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, 보철" 등
    const promptItems = promptText
        .split(',')
        .map(item => normalizeLoose(item))
        .filter(item => item.length >= 2) // 짧은 단어도 포함하도록 조건 완화

    if (promptItems.length < 3) return false

    // 텍스트 내에 존재하는 프롬프트 아이템 개수 세기
    const matchedItems = promptItems.filter(item => normalizedText.includes(item))
    
    // 키워드가 3개 이상 들어있으면서, 그 키워드들이 쉼표나 띄어쓰기로만 단순 나열된 패턴이 보이면 환각으로 간주
    // "단어1, 단어2, 단어3" 형태의 패턴이 텍스트에 존재하는지 검사
    const commaCount = (text.match(/,/g) || []).length
    if (matchedItems.length >= 3 && commaCount >= 2) return true
    
    // 추가: 쉼표가 없더라도 프롬프트 단어가 3개 이상 들어가고 문장 길이가 짧으면 환각으로 간주
    if (matchedItems.length >= 3 && text.length < 50) return true

    return false
}

const isGarbage = (text: string, _originalText?: string, promptText?: string): boolean => {
    if (!text) return false

    if (hasRepetitionLoop(text)) return true
    if (isPromptLeakage(text, promptText)) return true

    // 전체가 괄호/대괄호 소리 표기인 경우 (Whisper 무음 환각)
    if (/^\s*[\(\[][^\)\]]{1,40}[\)\]]\s*[\.!]?\s*$/.test(text.trim())) return true

    // 침묵 시 흔히 나오는 짧은 환각어 필터 (짧은 문구에서만 발동, 긴 정상 발화는 보존)
    // 주의: '좋아요' / '구독' 단독 사용 금지 - 정상 발화("좋아요, 다음으로...") 삭제됨
    const filterGarbage = /(치과 학술대회|Transcribe exactly|발화 내용만 정확히|구독과 좋아요|알림.*설정|Please subscribe|Thank you for|Thanks for watching|시청.*감사|^감사합니다\.?$|영상편집|자막 제공|광고를 포함|알 수 없는 소리|subtitles by|subtitle by|자막.*제작|번역.*제공|MBC 뉴스|SBS 뉴스|KBS 뉴스|임플란트.*상악동.*골이식|상악동.*골이식.*픽스처|픽스처.*어버트먼트|충분한.*수직|충분한.*수직이)/i
    if (filterGarbage.test(text.trim()) && text.length < 150) return true

    // 성음만으로 된 건 버림
    const alphanumeric = text.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '')
    if (alphanumeric.length < 2) return true

    return false
}

interface STTResult {
    text: string;
    ms: number;
    provider: string;
}

interface STTProvider {
    name: string;
    transcribe(audioStream: Readable, sourceLang: string, prompt: string): Promise<STTResult>;
}

class OpenAISTTProvider implements STTProvider {
    name = "openai";
    async transcribe(audioStream: Readable, sourceLang: string, prompt: string): Promise<STTResult> {
        const tStart = Date.now();
        const stt = await getOpenAI().audio.transcriptions.create({
            file: audioStream as any, model: "gpt-4o-transcribe", language: sourceLang,
            prompt: prompt, temperature: 0,
        });
        return { text: (stt?.text || "").trim(), ms: Date.now() - tStart, provider: this.name };
    }
}

class DeepgramSTTProvider implements STTProvider {
    name = "deepgram";
    async transcribe(_audioStream: Readable, _sourceLang: string, _prompt: string): Promise<STTResult> {
        throw new Error("Deepgram not implemented yet");
    }
}

class STTFactory {
    static async executeWithFallback(
        audioBuffer: Buffer, 
        sourceLang: string, 
        prompt: string,
        primaryEngineName: string = 'openai',
        fallbackEngineName: string = 'deepgram'
    ): Promise<STTResult> {
        
        const getProvider = (name: string): STTProvider => {
            if (name === 'deepgram') return new DeepgramSTTProvider();
            return new OpenAISTTProvider();
        };

        const primary = getProvider(primaryEngineName);
        const fallback = getProvider(fallbackEngineName);

        try {
            const stream = Readable.from(audioBuffer) as Readable & { path: string };
            stream.path = "audio.webm";
            return await primary.transcribe(stream, sourceLang, prompt);
        } catch (e: any) {
            functions.logger.error("[STT] Primary engine failed, attempting fallback", { error: e.message });
            try {
                const streamFallback = Readable.from(audioBuffer) as Readable & { path: string };
                streamFallback.path = "audio.webm";
                return await fallback.transcribe(streamFallback, sourceLang, prompt);
            } catch (fallbackError: any) {
                functions.logger.error("[STT] Fallback engine also failed", { error: fallbackError.message });
                throw fallbackError;
            }
        }
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

interface TranslationResult {
    refined: string;
    ko: string;
    en: string;
    isMedical: boolean;
    provider: string;
    ms: number;
}

interface TranslationProvider {
    name: string;
    translate(rawText: string, sourceLang: string, previousContext: string, sessionContext: string): Promise<TranslationResult | null>;
}

class OpenAITranslationProvider implements TranslationProvider {
    name = "openai";
    async translate(rawText: string, sourceLang: string, previousContext: string, sessionContext: string): Promise<TranslationResult | null> {
        const tStart = Date.now();
        const openai = getOpenAI()
        const contextLine = sanitize(sessionContext).slice(0, 180)
        const previousLine = sanitize(previousContext.split(' / ').slice(-1)[0] || '').slice(0, 80)
        const prompt = [
            `source_lang=${sourceLang}`,
            `input=${rawText}`,
            contextLine ? `session_context=${contextLine}` : "",
            previousLine ? `previous_refined=${previousLine}` : "",
            'Return strict JSON: {"refined":"","ko":"","en":"","isMedical":true}.',
            'Rules: (1) Output ONLY what is in "input" — never add, expand, or infer content from session_context or previous_refined. (2) Correct only obvious STT errors (e.g. wrong homophone). (3) Do not output topic, speaker name, affiliation, or keywords as standalone content. (4) Never leave ko or en empty; translate fragments as fragments. (5) Keep all clinical terminology literal. (6) DO NOT generate conversational filler, meta-text, or hallucinations.',
            'If source_lang=ko, refined and ko must stay Korean and en must be English. If source_lang=en, refined and en must stay English and ko must be Korean.',
            'Example output for source_lang=ko and input="임플란트 픽스처를 식립했습니다.": {"refined":"임플란트 픽스처를 식립했습니다.","ko":"임플란트 픽스처를 식립했습니다.","en":"The implant fixture was placed.","isMedical":true}'
        ].filter(Boolean).join('\n')

        const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
                {
                    role: "system",
                    content: "You refine live medical speech-to-text output and produce Korean and English translations in strict JSON. Do not hallucinate or create fake text."
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

        const result = buildTranslationResult(data, sourceLang, rawText);
        return { ...result, provider: this.name, ms: Date.now() - tStart };
    }
}

class ClaudeTranslationProvider implements TranslationProvider {
    name = "claude";
    async translate(_rawText: string, _sourceLang: string, _previousContext: string, _sessionContext: string): Promise<TranslationResult | null> {
        throw new Error("Claude not implemented yet");
    }
}

class TranslationFactory {
    static async executeWithFallback(
        rawText: string,
        sourceLang: string,
        previousContext: string,
        sessionContext: string,
        primaryEngineName: string = 'openai',
        fallbackEngineName: string = 'claude'
    ): Promise<{ refined: string; ko: string; en: string; isMedical: boolean }> {
        
        const getProvider = (name: string): TranslationProvider => {
            if (name === 'claude') return new ClaudeTranslationProvider();
            return new OpenAITranslationProvider();
        };

        const primary = getProvider(primaryEngineName);
        const fallback = getProvider(fallbackEngineName);

        try {
            const result = await primary.translate(rawText, sourceLang, previousContext, sessionContext);
            if (result) {
                functions.logger.info(`[Translate][${result.provider}] OK`, { ms: result.ms, srcLen: rawText.length });
                return result;
            }
        } catch (e: any) {
            functions.logger.warn(`[Translate][${primary.name}] Failed, attempting fallback`, { err: String(e).slice(0, 180) });
            try {
                const fbResult = await fallback.translate(rawText, sourceLang, previousContext, sessionContext);
                if (fbResult) {
                    functions.logger.info(`[Translate][${fbResult.provider}] OK (Fallback)`, { ms: fbResult.ms, srcLen: rawText.length });
                    return fbResult;
                }
            } catch (fallbackErr: any) {
                functions.logger.warn(`[Translate][${fallback.name}] Fallback failed`, { err: String(fallbackErr).slice(0, 180) });
            }
        }

        functions.logger.error("[Translate] All engines failed, raw text fallback", { input: rawText.slice(0, 50) });
        const safeRaw = sanitize(rawText);
        return { refined: safeRaw, ko: safeRaw, en: safeRaw, isMedical: false };
    }
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
        res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Active-Session-Id, X-Custom-Keywords, X-Session-Context, X-Chunk-Min-Length, X-Chunk-Timeout-Ms, X-Chunk-Sentence-End, X-STT-Primary, X-STT-Fallback, X-Trans-Primary, X-Trans-Fallback")
        if (req.method === "OPTIONS") { res.status(204).send(""); return }

        const tTotal = Date.now()

        try {
            if (!admin.apps.length) throw new Error("Admin not initialized")
            const auth = (req.headers.authorization || "").toString()
            if (!auth.startsWith("Bearer ")) { res.status(401).json({ success: false }); return }

            const projectId = (req.query.projectId || "").toString();
        const sourceLabel = (req.query.sourceLabel || "").toString();
        const queryLang = (req.query.sourceLang || "").toString();

        let buf: Buffer | null = null;
        const raw = (req as Request & { rawBody?: Buffer }).rawBody as Buffer | undefined;
        if (raw && Buffer.isBuffer(raw)) buf = raw;
        else if (Buffer.isBuffer(req.body)) buf = req.body as Buffer;
        else if (typeof req.body === "string") buf = Buffer.from(req.body, "binary");

        if (!buf || buf.length === 0) { res.status(400).json({ success: false }); return; }
        if (buf.length < 2000) { res.status(200).json({ success: false, error: "TooSmall" }); return; }

        if (!projectId) { res.status(400).json({ success: false }); return; }

        const projectRef = admin.database().ref(`projects/${projectId}`);
        const sourceLang = queryLang || 'ko';

        // 3. 클라이언트 헤더에서 메타데이터 추출 (2단계 최적화: DB Read 제거)
        const activeSessionId = (req.headers['x-active-session-id'] || "").toString();
        const customKeywords = decodeURIComponent((req.headers['x-custom-keywords'] || "").toString());
        const sessionContext = decodeURIComponent((req.headers['x-session-context'] || "").toString());
        const minLength = Number(req.headers['x-chunk-min-length'] || 35);
        const timeoutMs = Number(req.headers['x-chunk-timeout-ms'] || 5000);
        const sentenceEnd = (req.headers['x-chunk-sentence-end'] || "true") === "true";
        const primarySTT = (req.headers['x-stt-primary'] || "openai").toString();
        const fallbackSTT = (req.headers['x-stt-fallback'] || "deepgram").toString();
        const primaryTrans = (req.headers['x-trans-primary'] || "openai").toString();
        const fallbackTrans = (req.headers['x-trans-fallback'] || "claude").toString();

        // ── STEP 1: AI STT ────────────────────────────────────────────
            const basePrompt = sourceLang === 'ko' ? DENTAL_PROMPT_KO : DENTAL_PROMPT_EN;
            const whisperPrompt = customKeywords ? `${basePrompt}, ${customKeywords}` : basePrompt;

            const sttResult = await STTFactory.executeWithFallback(buf, sourceLang, whisperPrompt, primarySTT, fallbackSTT);
            functions.logger.info(`[STT][${sttResult.provider}]`, { ms: sttResult.ms });

            // HealthDashboard WHISPER 상태 표시용 타임스탬프 기록 (비차단)
            projectRef.child(`status/services/${sttResult.provider}`).update({ ts: Date.now() }).catch(() => {})

            const sttText = sttResult.text;
            const rawText = sanitize(sttText)

            if (rawText.length < 2 || isGarbage(rawText, sttText, whisperPrompt)) {
                res.status(200).json({ success: true, info: "EmptyOrGarbage", text: rawText }); return
            }

            const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            const timestamp = Date.now()
            const seqResult = await projectRef.child('lastSequence').transaction((cur) => (cur || 0) + 1)
            const seq = seqResult.snapshot.val()

            // ── STEP 1.5: 세션 전환 검증 (CRITICAL 방어) ─────────────────
            // STT 처리(수 초 소요) 중에 관리자가 세션을 전환(아카이브)했다면, 
            // 현재 데이터가 이전 세션의 고아(Orphan) 데이터로 남거나 새 세션에 섞이는 것을 방지
            if (activeSessionId) {
                const currentActiveSnap = await projectRef.child('activeSessionId').get();
                const currentActiveId = currentActiveSnap.val();
                if (currentActiveId !== activeSessionId) {
                    functions.logger.warn(`[STT] Session changed during processing: ${activeSessionId} -> ${currentActiveId}. Dropping chunk.`);
                    res.status(200).json({ success: true, info: "SessionChanged", text: rawText });
                    return;
                }
            }

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
            let flushData: { targetId: string; idsToDelete: string[]; bufferText: string; previousContext: string } | null = null

            await projectRef.child('state').transaction((currentState: Record<string, unknown> | null) => {
                // 트랜잭션 재시도(Retry) 시 이전 시도의 flushData를 반드시 초기화하여 덮어쓰기 방지
                flushData = null;
                const st = (currentState || {}) as Record<string, unknown>
                const lastSourceLang = ((st.sourceLang as string) || '').toString()
                const langChanged = !!lastSourceLang && lastSourceLang !== sourceLang

                const currentBufferText = langChanged ? '' : ((st.bufferText as string) || '').toString()
                const currentBufferIds: string[] = langChanged ? [] : (Array.isArray(st.bufferIds) ? (st.bufferIds as string[]) : [])

                // 버퍼가 비어있으면 지금부터 타이머 시작
                const lastFlushTime = currentBufferIds.length === 0
                    ? Date.now()
                    : Number(st.lastFlushTime || Date.now());

                // ── 2단계 최적화: previousContext 지연 읽기 (Lazy Read) ──
                // 버퍼 상태에서 lastRefinedList를 추출하여 flushData에 함께 넘김
                let previousContext = "";
                const list: string[] = langChanged ? [] : (Array.isArray(st.lastRefinedList) ? st.lastRefinedList : []);
                previousContext = list.slice(-2).join(' / ');

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
                        bufferText: newBufferText,
                        previousContext: previousContext
                    } as any
                    return {
                        bufferText: '',
                        bufferIds: [],
                        lastFlushTime: Date.now(),
                        lastRefinedList: langChanged ? [] : ((st.lastRefinedList as string[]) || []),
                        sourceLang
                    }
                } else {
                    // BUFFERING: 현재 세그먼트 추가
                    return {
                        ...st,
                        bufferText: newBufferText,
                        bufferIds: newBufferIds,
                        lastFlushTime: lastFlushTime,
                        ...(langChanged ? { lastRefinedList: [] } : {}),
                        sourceLang
                    }
                }
            })

            if (flushData) {
                const { targetId, idsToDelete, bufferText: flushText, previousContext } = flushData as { targetId: string; idsToDelete: string[]; bufferText: string; previousContext: string }

                // ── CRITICAL 2 방어: 타겟 세그먼트가 아카이브/삭제되었는지 검증 ──
                const targetSnap = await projectRef.child(`stream/${targetId}`).get();
                if (!targetSnap.exists()) {
                    functions.logger.warn(`[Translation] Target segment ${targetId} was removed (likely archived). Dropping translation result.`);
                    return;
                }

                try {
                    const { refined, ko, en, isMedical } = await TranslationFactory.executeWithFallback(
                        flushText, sourceLang, previousContext, sessionContext, primaryTrans, fallbackTrans
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

                    // ── 3단계 디테일 튜닝: 문맥(lastRefinedList) 업데이트 시 Race Condition 방지를 위한 개별 트랜잭션 처리 ──
                    // 기존의 updates 객체 할당(updates[`.../lastRefinedList`] = ...) 방식은 
                    // 병렬 번역 시 서로 덮어쓰는 문제가 있으므로, 별도의 트랜잭션으로 안전하게 꼬리물기 저장합니다.
                    await projectRef.child('state/lastRefinedList').transaction((currentList: any) => {
                        const list: string[] = Array.isArray(currentList) ? currentList : [];
                        return [...list, refined].slice(-5);
                    });

                    // 나머지 일반 상태값들은 기존처럼 일괄 업데이트 (Multi-path)
                    await admin.database().ref().update(updates)
                } catch (e: any) {
                    // ── 3단계 디테일 튜닝: 번역 실패 및 에러 복구 시 확실한 로깅 및 무한 로딩 방지 ──
                    functions.logger.error("[processAudio] Translation or update failed", { error: e.message || e })
                    
                    const errorFixes: Record<string, unknown> = {}
                    const safeRaw = sanitize(flushText);
                    errorFixes[`projects/${projectId}/stream/${targetId}/refined`] = safeRaw
                    errorFixes[`projects/${projectId}/stream/${targetId}/ko`] = safeRaw
                    errorFixes[`projects/${projectId}/stream/${targetId}/en`] = safeRaw
                    errorFixes[`projects/${projectId}/stream/${targetId}/status`] = "final"
                    for (const pid of idsToDelete) {
                        errorFixes[`projects/${projectId}/stream/${pid}/status`] = "final"
                    }
                    
                    // 복구 업데이트 자체도 실패할 수 있으므로 catch를 달아 Cloud Function 크래시를 방지
                    await admin.database().ref().update(errorFixes).catch(err => {
                        functions.logger.error("[processAudio] Fallback DB update failed", { error: err.message || err })
                    })
                }
            }
            // flushData가 null이면 버퍼링 중 → transaction이 이미 상태 저장 완료

        } catch (e: any) {
            try { res.status(500).json({ success: false, error: e.message }) } catch { }
        }
    })
