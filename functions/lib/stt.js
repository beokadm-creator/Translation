"use strict";
// Version: v12.3 (Stable - OpenAI Only)
// STT:         gpt-4o-transcribe  (language + domain keyword prompt)
// Translation: gpt-4o-mini        (JSON strict, temperature 0)
// KEY FLOW:
// 1. Every speech segment is written to DB IMMEDIATELY as 'translating'.
// 2. Audience sees the raw text in ~1-2 seconds.
// 3. Translation waits for minLength chars OR timeout before flushing buffer.
// 4. When buffer flushes, first segment gets translation, others are marked 'merged' (hidden).
// 5. Result: Ultra-fast visual feedback + High-quality contextual translation.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processAudio = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const openai_1 = __importDefault(require("openai"));
const stream_1 = require("stream");
let _openai = null;
// ── Hallucination 필터 ────────────────────────────────────────────────────────
// 정적 URL 도메인만 핀포인트로 필터 (전체 문장 삭제 방지)
const URL_FILTER_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:sites\.google\.com|cst\.eu\.com|Amara\.org|amara\.org|youtube\.com|youtu\.be)\S*/gi;
// 메타 언어 단어만 핀포인트로 필터 (일본어/중국어 환각 포함)
const META_FILTER_REGEX = /(?:Thank you for watching\.?|Thanks for watching\.?|Thank you\.?|시청해 주셔서 감사합니다\.?|시청해주셔서 감사합니다\.?|ご視聴ありがとうございました\.?|ご視聴いただきありがとうございました\.?|チャンネル登録お願いします\.?|字幕提供|サブタイトル|MBC 뉴스|SBS 뉴스|KBS 뉴스|YTN 뉴스|JTBC 뉴스|연합뉴스|新しい話者、所属、新しいトピック|新しい話題|유료광고|유료 광고|paid advertisement|disclaimer|면책 조항|면책조항|영상편집 및 자막|자막 제공 및 광고|광고를 포함하고|알 수 없는 소리|\[Music\]|\(Music\)|\[music\]|\(music\)|\[Applause\]|\(Applause\)|\[applause\]|\(applause\)|\[Laughter\]|\(Laughter\)|\[laughter\]|\(laughter\)|\(박수\)|\[박수\]|\(웃음\)|\[웃음\]|\(환호\)|\[환호\]|\(음악\)|\[음악\]|\(노래\)|\[노래\]|\(소음\)|\[소음\]|\(침묵\)|\[침묵\]|\(무음\)|\[무음\])/gi;
const sanitize = (s) => {
    let t = (s || "").toString();
    t = t.replace(/[`]{3,}/g, "").replace(/[`]/g, "");
    t = t.replace(/\bundefined\b/gi, "");
    t = t.replace(URL_FILTER_REGEX, ' ');
    t = t.replace(META_FILTER_REGEX, ' ');
    return t.replace(/\s+/g, ' ').trim();
};
// 반복 루프 체크
const hasRepetitionLoop = (text) => {
    // 다국어 지원: 한중일 띄어쓰기 없는 문장도 글자 단위로 분리하여 검사 (영어/한국어는 단어 단위)
    // CJK 문자는 각각 한 글자씩 분리하고, 알파벳/숫자는 단어 단위로 분리
    const tokens = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu) || [];
    const words = tokens.slice(0, 40);
    if (words.length < 8)
        return false;
    // 서로 다른 토큰이 6개 이하이고 전체 길이가 80자(알파벳) 또는 20자(CJK) 이상이면 반복으로 판단
    const unique = new Set(words.map(w => w.toLowerCase()));
    return unique.size <= 6 && (text.length > 80 || (text.length > 20 && tokens.length === text.replace(/\s/g, '').length));
};
const normalizeLoose = (text) => (text || "")
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const isPromptLeakage = (text, promptText) => {
    if (!text || !promptText)
        return false;
    const normalizedText = normalizeLoose(text);
    const normalizedPrompt = normalizeLoose(promptText);
    if (!normalizedText || !normalizedPrompt)
        return false;
    // 1. 프롬프트 전체가 텍스트에 통째로 포함된 경우 (가장 흔한 케이스)
    if (normalizedText.includes(normalizedPrompt) && normalizedPrompt.length >= 10)
        return true;
    if (normalizedPrompt.includes(normalizedText) && normalizedText.length >= 40)
        return true;
    // 2. 키워드가 문장 사이에 연속으로 박혀있는 경우 감지
    // "임플란트, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, 보철" 등
    const promptItems = promptText
        .split(',')
        .map(item => normalizeLoose(item))
        .filter(item => item.length >= 2); // 짧은 단어도 포함하도록 조건 완화
    if (promptItems.length < 3)
        return false;
    // 텍스트 내에 존재하는 프롬프트 아이템 개수 세기
    const matchedItems = promptItems.filter(item => normalizedText.includes(item));
    // 키워드가 3개 이상 들어있으면서, 그 키워드들이 쉼표나 띄어쓰기로만 단순 나열된 패턴이 보이면 환각으로 간주
    // "단어1, 단어2, 단어3" 형태의 패턴이 텍스트에 존재하는지 검사
    const commaCount = (text.match(/,/g) || []).length;
    if (matchedItems.length >= 3 && commaCount >= 2)
        return true;
    // 추가: 쉼표가 없더라도 프롬프트 단어가 3개 이상 들어가고 문장 길이가 짧으면 환각으로 간주
    if (matchedItems.length >= 3 && text.length < 50)
        return true;
    return false;
};
const isGarbage = (text, _originalText, promptText) => {
    if (!text)
        return false;
    if (hasRepetitionLoop(text))
        return true;
    if (isPromptLeakage(text, promptText))
        return true;
    // 전체가 괄호/대괄호 소리 표기인 경우 (Whisper 무음 환각)
    if (/^\s*[\(\[][^\)\]]{1,40}[\)\]]\s*[\.!]?\s*$/.test(text.trim()))
        return true;
    // 침묵 시 흔히 나오는 짧은 환각어 필터 (짧은 문구에서만 발동, 긴 정상 발화는 보존)
    // 주의: '좋아요' / '구독' 단독 사용 금지 - 정상 발화("좋아요, 다음으로...") 삭제됨
    const filterGarbage = /(치과 학술대회|Transcribe exactly|발화 내용만 정확히|구독과 좋아요|알림.*설정|Please subscribe|Thank you for|Thanks for watching|시청.*감사|^감사합니다\.?$|영상편집|자막 제공|광고를 포함|알 수 없는 소리|subtitles by|subtitle by|자막.*제작|번역.*제공|MBC 뉴스|SBS 뉴스|KBS 뉴스|임플란트.*상악동.*골이식|상악동.*골이식.*픽스처|픽스처.*어버트먼트|충분한.*수직|충분한.*수직이|ご視聴|チャンネル登録|新しい話者、所属、新しいトピック|新しい話題|字幕提供)/i;
    if (filterGarbage.test(text.trim()) && text.length < 150)
        return true;
    // 성음만으로 된 건 버림 (다국어 지원: 한글, 영문, 숫자 외에 한자, 히라가나, 가타카나 등 모든 문자 허용)
    const alphanumeric = text.replace(/[^\p{L}\p{N}]/gu, '');
    if (alphanumeric.length < 2)
        return true;
    // 언어 불일치 환각 감지 (예: 소스 언어는 한국어인데 일본어 히라가나/가타카나가 지나치게 많이 나오는 경우 등)
    // 그러나 일본어 뉴스 앵커 음성처럼 완전히 다른 내용의 환각이 나올 수 있음.
    // 긴 무음 구간에서 흔히 발생하는 일본어 뉴스 환각 패턴 처리
    if (text.includes("新しい話者") || text.includes("新しいトピック") || text.includes("新しい話題"))
        return true;
    return false;
};
class OpenAISTTProvider {
    constructor() {
        this.name = "openai";
    }
    async transcribe(audioStream, sourceLang, prompt) {
        const tStart = Date.now();
        const file = Object.assign(audioStream, { path: "audio.webm" });
        const stt = await getOpenAI().audio.transcriptions.create({
            file: file, model: "gpt-4o-transcribe", language: sourceLang,
            prompt: prompt, temperature: 0,
        });
        return { text: (stt?.text || "").trim(), ms: Date.now() - tStart, provider: this.name };
    }
}
class DeepgramSTTProvider {
    constructor() {
        this.name = "deepgram";
    }
    async transcribe(_audioStream, _sourceLang, _prompt) {
        throw new Error("Deepgram not implemented yet");
    }
}
class STTFactory {
    static async executeWithFallback(audioBuffer, sourceLang, prompt, primaryEngineName = 'openai', fallbackEngineName = 'deepgram') {
        const getProvider = (name) => {
            if (name === 'deepgram')
                return new DeepgramSTTProvider();
            return new OpenAISTTProvider();
        };
        const primary = getProvider(primaryEngineName);
        const fallback = getProvider(fallbackEngineName);
        try {
            const stream = stream_1.Readable.from(audioBuffer);
            stream.path = "audio.webm";
            return await primary.transcribe(stream, sourceLang, prompt);
        }
        catch (e) {
            const errorStr = e instanceof Error ? e.message : String(e);
            functions.logger.error("[STT] Primary engine failed, attempting fallback", { error: errorStr });
            try {
                const streamFallback = stream_1.Readable.from(audioBuffer);
                streamFallback.path = "audio.webm";
                return await fallback.transcribe(streamFallback, sourceLang, prompt);
            }
            catch (fallbackError) {
                const fallbackErrorStr = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                functions.logger.error("[STT] Fallback engine also failed", { error: fallbackErrorStr });
                throw fallbackError;
            }
        }
    }
}
// ── 번역 파이프라인 ───────────────────────────────────────────────────────────
// 번역 결과 유효성 검사 (필수 target 필드가 모두 채워졌는지 확인)
const validateTranslation = (data, targets, sourceLang) => {
    if (!data) {
        functions.logger.warn("[Validate] data is null or undefined");
        return false;
    }
    if (targets.length === 0) {
        functions.logger.warn("[Validate] targets array is empty");
        return false;
    }
    for (const t of targets) {
        // 소스 언어와 타겟 언어가 동일한 경우, OpenAI가 빈 문자열을 반환할 수 있으므로 검증에서 예외 처리
        if (t === sourceLang)
            continue;
        const val = data[t];
        if (!val || String(val).trim().length === 0) {
            functions.logger.warn(`[Validate] target field '${t}' is empty or missing`, { data });
            return false;
        }
    }
    return true;
};
const buildTranslationResult = (data, sourceLang, rawText, targetLanguages) => {
    const refined = sanitize(data.refined || rawText);
    const result = { refined, isMedical: false, provider: '', ms: 0 };
    for (const lang of targetLanguages) {
        if (lang === sourceLang) {
            result[lang] = refined;
        }
        else if (data[lang]) {
            result[lang] = sanitize(data[lang]);
        }
        else {
            result[lang] = ''; // 실패 시 빈 문자열
        }
    }
    result.isMedical = data.isMedical ?? false;
    return result;
};
class OpenAITranslationProvider {
    constructor() {
        this.name = "openai";
    }
    async translate(rawText, sourceLang, previousContext, sessionContext, targetLanguages, persona) {
        const tStart = Date.now();
        const openai = getOpenAI();
        const contextLine = sanitize(sessionContext).slice(0, 180);
        const previousLine = sanitize(previousContext.split(' / ').slice(-1)[0] || '').slice(0, 80);
        const langFields = targetLanguages.map(l => `"${l}": ""`).join(', ');
        // Persona 
        let personaPrompt = "";
        if (persona && persona.enabled) {
            const lines = [];
            if (persona.customInstructions)
                lines.push(`Instructions: ${persona.customInstructions}`);
            if (persona.medicalTerms)
                lines.push(`Medical Dictionary: ${persona.medicalTerms}`);
            if (lines.length > 0) {
                personaPrompt = "\n[Persona Context]\n" + lines.join('\n');
            }
        }
        const prompt = [
            `source_lang=${sourceLang}`,
            `input=${rawText}`,
            contextLine ? `session_context=${contextLine}` : "",
            previousLine ? `previous_refined=${previousLine}` : "",
            personaPrompt,
            `Return strict JSON: {"refined":"","isMedical":true, ${langFields}}.`,
            'Rules: (1) Output ONLY what is in "input" — never add, expand, or infer content from session_context or previous_refined. (2) Correct only obvious STT errors (e.g. wrong homophone). (3) Do not output topic, speaker name, affiliation, or keywords as standalone content. (4) Never leave any target language field empty; translate fragments as fragments. (5) Keep all clinical terminology literal. (6) DO NOT generate conversational filler, meta-text, or hallucinations. (7) If input is just a meta-tag hallucination like "新しい話者、所属、新しいトピック" or "新しい話題", return empty strings.',
            `If source_lang matches a target language, the text for that language must remain in the source language.`
        ].filter(Boolean).join('\n');
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            max_tokens: 1000,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: "You refine live medical speech-to-text output and produce translations in strict JSON. Do not hallucinate or create fake text."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });
        const content = completion.choices[0]?.message?.content || "";
        if (!content)
            return null;
        let data;
        try {
            data = JSON.parse(content);
        }
        catch (e) {
            functions.logger.error("[Translate] JSON.parse error", { content: content.slice(0, 100), err: String(e) });
            return null;
        }
        if (!validateTranslation(data, targetLanguages, sourceLang))
            return null;
        const result = buildTranslationResult(data, sourceLang, rawText, targetLanguages);
        return { ...result, provider: this.name, ms: Date.now() - tStart };
    }
}
class ClaudeTranslationProvider {
    constructor() {
        this.name = "claude";
    }
    async translate(_rawText, _sourceLang, _previousContext, _sessionContext, _targetLanguages, _persona) {
        throw new Error("Claude not implemented yet");
    }
}
class TranslationFactory {
    static async executeWithFallback(rawText, sourceLang, previousContext, sessionContext, targetLanguages, persona, primaryEngineName = 'openai', fallbackEngineName = 'claude') {
        const getProvider = (name) => {
            // [F-HIGH-05 Fix] Claude가 미구현 상태이므로, Claude가 선택된 경우에도 강제로 OpenAI를 반환하여 안전하게 동작하도록 조치합니다.
            // 향후 Claude 구현 시 이 분기 처리를 복구하면 됩니다.
            if (name === 'claude') {
                functions.logger.warn("[Translate] Claude is not implemented yet, falling back to OpenAI automatically");
                return new OpenAITranslationProvider();
            }
            return new OpenAITranslationProvider();
        };
        const primary = getProvider(primaryEngineName);
        const fallback = getProvider(fallbackEngineName);
        try {
            const result = await primary.translate(rawText, sourceLang, previousContext, sessionContext, targetLanguages, persona);
            if (result) {
                functions.logger.info(`[Translate][${result.provider}] OK`, { ms: result.ms, srcLen: rawText.length });
                return result;
            }
        }
        catch (e) {
            const errorStr = e instanceof Error ? e.message : String(e);
            functions.logger.warn(`[Translate][${primary.name}] Failed, attempting fallback`, { err: errorStr.slice(0, 180) });
            try {
                const fbResult = await fallback.translate(rawText, sourceLang, previousContext, sessionContext, targetLanguages, persona);
                if (fbResult) {
                    functions.logger.info(`[Translate][${fbResult.provider}] OK (Fallback)`, { ms: fbResult.ms, srcLen: rawText.length });
                    return fbResult;
                }
            }
            catch (fallbackErr) {
                const fallbackErrStr = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
                functions.logger.warn(`[Translate][${fallback.name}] Fallback failed`, { err: fallbackErrStr.slice(0, 180) });
            }
        }
        functions.logger.error("[Translate] All engines failed, raw text fallback", { input: rawText.slice(0, 50) });
        const safeRaw = sanitize(rawText);
        const fallbackResult = { refined: safeRaw, isMedical: false, provider: "fallback", ms: 0 };
        for (const lang of targetLanguages) {
            fallbackResult[lang] = safeRaw;
        }
        return fallbackResult;
    }
}
// 메모리 캐시 (key: projectId, value: { data: PersonaConfig, expiresAt: number })
const personaCache = new Map();
const loadPersona = async (projectId) => {
    if (!projectId)
        return null;
    const now = Date.now();
    // 정리(eviction) 로직: 만료된 항목 삭제
    if (personaCache.size > 100) {
        for (const [key, value] of personaCache.entries()) {
            if (value.expiresAt <= now) {
                personaCache.delete(key);
            }
        }
        // 여전히 크면 무작위(첫번째) 삭제
        if (personaCache.size > 100) {
            const firstKey = personaCache.keys().next().value;
            if (firstKey)
                personaCache.delete(firstKey);
        }
    }
    const cached = personaCache.get(projectId);
    if (cached && cached.expiresAt > now) {
        return cached.data;
    }
    try {
        const snap = await admin.database().ref(`projects/${projectId}/settings/persona`).get();
        if (snap.exists()) {
            const data = snap.val();
            // 5분(300000ms) 캐싱
            personaCache.set(projectId, { data, expiresAt: now + 300000 });
            return data;
        }
    }
    catch (err) {
        functions.logger.warn(`Failed to load persona for ${projectId}`, { err: String(err) });
    }
    return null;
};
// ── OpenAI 클라이언트 ─────────────────────────────────────────────────────────
const getOpenAI = () => {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY || functions.config()?.openai?.key || "";
        if (!apiKey)
            throw new Error("OPENAI_API_KEY missing");
        _openai = new openai_1.default({ apiKey });
    }
    return _openai;
};
const DENTAL_PROMPT_KO = "임플란트, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, 보철";
const DENTAL_PROMPT_EN = "Implant, Sinus, Bone Graft, Fixture, Abutment, Crown";
// ─────────────────────────────────────────────────────────────────────────────
// 1. HTTP Trigger: Immediate Display + Progressive Buffering
// ─────────────────────────────────────────────────────────────────────────────
exports.processAudio = functions
    .runWith({ timeoutSeconds: 120, memory: "1GB" })
    .https.onRequest(async (req, res) => {
    const versionTag = "v12.3_openai_only";
    // CORS
    const origin = req.headers.origin;
    const allowedOrigins = (process.env.ALLOWED_ORIGIN || functions.config()?.app?.allowed_origin || "*").split(',').map(s => s.trim());
    if (allowedOrigins.includes("*")) {
        res.set("Access-Control-Allow-Origin", "*");
    }
    else if (origin && allowedOrigins.includes(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
    }
    else {
        res.set("Access-Control-Allow-Origin", allowedOrigins[0] || "*");
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Active-Session-Id, X-Custom-Keywords, X-Session-Context, X-Chunk-Min-Length, X-Chunk-Timeout-Ms, X-Chunk-Sentence-End, X-STT-Primary, X-STT-Fallback, X-Trans-Primary, X-Trans-Fallback, X-Force-Flush, X-Target-Languages");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    const tTotal = Date.now();
    try {
        if (!admin.apps.length)
            throw new Error("Admin not initialized");
        const auth = (req.headers.authorization || "").toString();
        if (!auth.startsWith("Bearer ")) {
            res.status(401).json({ success: false });
            return;
        }
        const token = auth.split("Bearer ")[1];
        try {
            await admin.auth().verifyIdToken(token);
        }
        catch (error) {
            res.status(401).json({ success: false, error: "Invalid token" });
            return;
        }
        const projectId = (req.query.projectId || "").toString();
        if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
            res.status(400).json({ success: false, error: "Invalid projectId" });
            return;
        }
        const sourceLabel = (req.query.sourceLabel || "").toString();
        const queryLang = (req.query.sourceLang || "").toString();
        let buf = null;
        const raw = req.rawBody;
        if (raw && Buffer.isBuffer(raw))
            buf = raw;
        else if (Buffer.isBuffer(req.body))
            buf = req.body;
        else if (typeof req.body === "string")
            buf = Buffer.from(req.body, "binary");
        if (!buf || buf.length === 0) {
            res.status(400).json({ success: false });
            return;
        }
        if (buf.length < 2000) {
            res.status(200).json({ success: false, error: "TooSmall" });
            return;
        }
        if (!projectId) {
            res.status(400).json({ success: false });
            return;
        }
        const projectRef = admin.database().ref(`projects/${projectId}`);
        const sourceLang = queryLang || 'ko';
        // 3. 클라이언트 헤더에서 메타데이터 추출 (2단계 최적화: DB Read 제거)
        const activeSessionId = (req.headers['x-active-session-id'] || "").toString();
        const customKeywords = decodeURIComponent((req.headers['x-custom-keywords'] || "").toString());
        const sessionContext = decodeURIComponent((req.headers['x-session-context'] || "").toString());
        const targetLanguagesStr = (req.headers['x-target-languages'] || "ko,en,ja,zh").toString();
        const targetLanguages = targetLanguagesStr.split(',').map(l => l.trim()).filter(Boolean);
        const minLength = Number(req.headers['x-chunk-min-length'] || 35);
        const timeoutMs = Number(req.headers['x-chunk-timeout-ms'] || 5000);
        const sentenceEnd = (req.headers['x-chunk-sentence-end'] || "true") === "true";
        const primarySTT = (req.headers['x-stt-primary'] || "openai").toString();
        const fallbackSTT = (req.headers['x-stt-fallback'] || "deepgram").toString();
        const primaryTrans = (req.headers['x-trans-primary'] || "openai").toString();
        const fallbackTrans = (req.headers['x-trans-fallback'] || "claude").toString();
        const persona = await loadPersona(projectId);
        // ── STEP 1: AI STT ────────────────────────────────────────────
        let basePrompt = "";
        // Persona 기본 프롬프트가 있으면 우선 적용
        if (persona && persona.enabled) {
            if (sourceLang === 'ko' && persona.basePromptKo)
                basePrompt = persona.basePromptKo;
            if (sourceLang === 'en' && persona.basePromptEn)
                basePrompt = persona.basePromptEn;
            if (sourceLang === 'ja' && persona.basePromptJa)
                basePrompt = persona.basePromptJa;
            if (sourceLang === 'zh' && persona.basePromptZh)
                basePrompt = persona.basePromptZh;
        }
        const whisperPrompt = [basePrompt, customKeywords].filter(Boolean).join(', ');
        const sttResult = await STTFactory.executeWithFallback(buf, sourceLang, whisperPrompt, primarySTT, fallbackSTT);
        functions.logger.info(`[STT][${sttResult.provider}]`, { ms: sttResult.ms });
        // HealthDashboard WHISPER 상태 표시용 타임스탬프 기록 (비차단)
        projectRef.child(`status/services/${sttResult.provider}`).update({ ts: Date.now() }).catch(() => { });
        const sttText = sttResult.text;
        const rawText = sanitize(sttText);
        if (rawText.length < 2 || isGarbage(rawText, sttText, whisperPrompt)) {
            res.status(200).json({ success: true, info: "EmptyOrGarbage", text: rawText });
            return;
        }
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = Date.now();
        const seqResult = await projectRef.child('lastSequence').transaction((cur) => (cur || 0) + 1);
        const seq = seqResult.snapshot.val();
        // ── STEP 1.5: 세션 전환 검증 (CRITICAL 방어) ─────────────────
        // STT 처리(수 초 소요) 중에 관리자가 세션을 전환(아카이브)했다면, 
        // 현재 데이터가 이전 세션의 고아(Orphan) 데이터로 남거나 새 세션에 섞이는 것을 방지
        const forceFlush = (req.headers['x-force-flush'] || "false") === "true";
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
        });
        // 응답 즉시 전송 (로그에서 undefined 안 나오게 text 포함)
        res.status(200).json({ success: true, id, text: rawText, stage: "translating" });
        // ── STEP 3: 버퍼링 및 번역 (RTDB Transaction - Race condition 완전 제거) ──
        // transaction()은 read→modify→write를 서버 레벨에서 원자적으로 처리.
        // 동시 요청이 있으면 RTDB가 자동으로 재시도하여 데이터 유실 없음.
        let flushData = null;
        await projectRef.child('state').transaction((currentState) => {
            // 트랜잭션 재시도(Retry) 시 이전 시도의 flushData를 반드시 초기화하여 덮어쓰기 방지
            flushData = null;
            const st = (currentState || {});
            const lastSourceLang = (st.sourceLang || '').toString();
            const langChanged = !!lastSourceLang && lastSourceLang !== sourceLang;
            const currentBufferText = langChanged ? '' : (st.bufferText || '').toString();
            const currentBufferIds = langChanged ? [] : (Array.isArray(st.bufferIds) ? st.bufferIds : []);
            // 버퍼가 비어있으면 지금부터 타이머 시작
            const lastFlushTime = currentBufferIds.length === 0
                ? Date.now()
                : Number(st.lastFlushTime || Date.now());
            // ── 2단계 최적화: previousContext 지연 읽기 (Lazy Read) ──
            // 버퍼 상태에서 lastRefinedList를 추출하여 flushData에 함께 넘김
            let previousContext = "";
            const list = langChanged ? [] : (Array.isArray(st.lastRefinedList) ? st.lastRefinedList : []);
            previousContext = list.slice(-2).join(' / ');
            const newBufferText = currentBufferText ? currentBufferText + ' ' + rawText : rawText;
            const newBufferIds = [...currentBufferIds, id];
            const timeDiff = Date.now() - lastFlushTime;
            const isSentenceEnd = sentenceEnd && /[.!?]$/.test(newBufferText.trim());
            const isLongEnough = newBufferText.length >= minLength;
            const isTimeOut = timeDiff >= timeoutMs;
            // X-Force-Flush가 있으면 언어가 바뀌기 직전의 마지막 청크이므로 무조건 flush
            if (isSentenceEnd || isLongEnough || isTimeOut || forceFlush) {
                // FLUSH: 상태 초기화 + 플러시 데이터 캡처
                flushData = {
                    targetId: newBufferIds[0],
                    idsToDelete: newBufferIds.slice(1),
                    bufferText: newBufferText,
                    previousContext: previousContext
                };
                return {
                    bufferText: '',
                    bufferIds: [],
                    lastFlushTime: Date.now(),
                    lastRefinedList: langChanged ? [] : (st.lastRefinedList || []),
                    sourceLang
                };
            }
            else {
                // BUFFERING: 현재 세그먼트 추가
                return {
                    ...st,
                    bufferText: newBufferText,
                    bufferIds: newBufferIds,
                    lastFlushTime: lastFlushTime,
                    ...(langChanged ? { lastRefinedList: [] } : {}),
                    sourceLang
                };
            }
        });
        if (flushData) {
            const { targetId, idsToDelete, bufferText: flushText, previousContext } = flushData;
            // ── CRITICAL 2 방어: 타겟 세그먼트가 아카이브/삭제되었는지 검증 ──
            const targetSnap = await projectRef.child(`stream/${targetId}`).get();
            if (!targetSnap.exists()) {
                functions.logger.warn(`[Translation] Target segment ${targetId} was removed (likely archived). Dropping translation result.`);
                return;
            }
            try {
                const translationResult = await TranslationFactory.executeWithFallback(flushText, sourceLang, previousContext, sessionContext, targetLanguages, persona, primaryTrans, fallbackTrans);
                const updates = {};
                const base = `projects/${projectId}/stream/${targetId}`;
                updates[`${base}/refined`] = translationResult.refined;
                updates[`${base}/isMedical`] = translationResult.isMedical;
                updates[`${base}/status`] = "final";
                for (const lang of targetLanguages) {
                    updates[`${base}/${lang}`] = translationResult[lang];
                }
                if (idsToDelete.length > 0) {
                    updates[`${base}/mergedIds`] = idsToDelete;
                }
                for (const pid of idsToDelete) {
                    updates[`projects/${projectId}/stream/${pid}/status`] = "merged";
                }
                // ── 3단계 디테일 튜닝: 문맥(lastRefinedList) 업데이트 시 Race Condition 방지를 위한 개별 트랜잭션 처리 ──
                // 기존의 updates 객체 할당(updates[`.../lastRefinedList`] = ...) 방식은 
                // 병렬 번역 시 서로 덮어쓰는 문제가 있으므로, 별도의 트랜잭션으로 안전하게 꼬리물기 저장합니다.
                await projectRef.child('state/lastRefinedList').transaction((currentList) => {
                    const list = Array.isArray(currentList) ? currentList : [];
                    return [...list, translationResult.refined].slice(-5);
                });
                // 나머지 일반 상태값들은 기존처럼 일괄 업데이트 (Multi-path)
                await admin.database().ref().update(updates);
            }
            catch (e) {
                const errorStr = e instanceof Error ? e.message : String(e);
                // ── 3단계 디테일 튜닝: 번역 실패 및 에러 복구 시 확실한 로깅 및 무한 로딩 방지 ──
                functions.logger.error("[processAudio] Translation or update failed", { error: errorStr });
                const errorFixes = {};
                const safeRaw = sanitize(flushText);
                errorFixes[`projects/${projectId}/stream/${targetId}/refined`] = safeRaw;
                errorFixes[`projects/${projectId}/stream/${targetId}/status`] = "final";
                for (const lang of targetLanguages) {
                    errorFixes[`projects/${projectId}/stream/${targetId}/${lang}`] = safeRaw;
                }
                for (const pid of idsToDelete) {
                    errorFixes[`projects/${projectId}/stream/${pid}/status`] = "final";
                }
                // 복구 업데이트 자체도 실패할 수 있으므로 catch를 달아 Cloud Function 크래시를 방지
                await admin.database().ref().update(errorFixes).catch((err) => {
                    const fallbackErrStr = err instanceof Error ? err.message : String(err);
                    functions.logger.error("[processAudio] Fallback DB update failed", { error: fallbackErrStr });
                });
            }
        }
        // flushData가 null이면 버퍼링 중 → transaction이 이미 상태 저장 완료
    }
    catch (e) {
        const errorStr = e instanceof Error ? e.message : String(e);
        try {
            res.status(500).json({ success: false, error: errorStr });
        }
        catch { }
    }
});
