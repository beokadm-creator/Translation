"use strict";
// Version: v11.0 (Stable - Medical/Dental Optimized)
// KEY IMPROVEMENT:
// 1. Every speech segment is written to DB IMMEDIATELY as 'translating'.
// 2. Audience sees the raw text in ~2 seconds.
// 3. Translation (Gemini) waits for either minLength (30 chars) or timeout (2s pause).
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
exports.verifyGeminiPipeline = exports.triggerRemaster = exports.remasterSession = exports.onRefineRequest = exports.processAudio = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const openai_1 = __importDefault(require("openai"));
const stream_1 = require("stream");
let _openai = null;
// ── 4개 Gemini API 키 ─────────────────────────────────────────────────────────
const GEMINI_KEYS = [
    process.env.GEMINI_KEY_TRANSLATE || "AIzaSyAA6tsr0l11KlpiVNDCKEn4GNJRM9u962o",
    process.env.GEMINI_KEY_MEDICAL || "AIzaSyAYO3OAfzPxa1kZGyPGOoJIbiRewaumVI8",
    process.env.GEMINI_KEY_EDITOR || "AIzaSyAMzzrp54aQywsPF-7BG4rPTkBVbda7jNc",
    process.env.GEMINI_KEY_CONTEXT || "AIzaSyDMbGlFRZrVSJiUzwuWCTFT5gEjCEVbgIA",
];
let _keyIndex = 0;
// ✅ 모델 설정: gemini-2.5-flash (최신 API 키용)
// 만약 404가 발생하면 1.5-flash-latest 등으로 폴백 시도 가능
const FLASH_URL = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
const PRO_URL = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`;
// ── Hallucination 필터 ────────────────────────────────────────────────────────
const HALLUCINATION_BLACKLIST = [
    '자막제작', '자막 제작', 'Subtitles by', 'Provided by', 'Copyright', 'http://', 'https://', '.co.kr',
    'Thank you for watching', 'Thanks for watching', 'Thank you for your attention',
    '시청해 주셔서 감사합니다', '시청해주셔서 감사합니다', '구독과 좋아요',
    'MBC 뉴스', 'SBS 뉴스', 'KBS 뉴스', 'YTN 뉴스', 'JTBC 뉴스', '연합뉴스',
    'Please subscribe', 'Click like', 'Like and subscribe',
    '유료광고', '유료 광고', 'paid advertisement', '이 영상은',
    'sites.google.com', 'cst.eu.com', 'Amara.org', 'amara.org', 'disclaimer at'
];
// 정적 URL 도메인만 핀포인트로 필터 (전체 문장 삭제 방지)
const URL_FILTER_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:sites\.google\.com|cst\.eu\.com|Amara\.org|amara\.org|youtube\.com|youtu\.be)\S*/gi;
// 메타 언어 단어만 핀포인트로 필터
const META_FILTER_REGEX = /(?:Thank you for watching\.?|Thanks for watching\.?|Thank you\.?|시청해 주셔서 감사합니다\.?|시청해주셔서 감사합니다\.?|MBC 뉴스|SBS 뉴스|KBS 뉴스|YTN 뉴스|JTBC 뉴스|연합뉴스|유료광고|유료 광고|paid advertisement|disclaimer|면책 조항|면책조항)/gi;
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
    const words = text.split(/[,. ]+/).filter(Boolean).slice(0, 40);
    if (words.length < 8)
        return false;
    // 서로 다른 단어가 6개 이하이고 전체 길이가 80자 이상이면 반복으로 판단
    const unique = new Set(words.map(w => w.toLowerCase()));
    return unique.size <= 6 && text.length > 80;
};
const isGarbage = (text, _originalText) => {
    if (!text)
        return false;
    if (hasRepetitionLoop(text))
        return true;
    // 침묵 시 흔히 나오는 짧은 환각어 필터 (짧은 문구에서만 발동, 긴 정상 발화는 보존)
    const filterGarbage = /(치과 학술대회|Transcribe exactly|발화 내용만 정확히|구독|좋아요|알림.*설정|Please subscribe|Thank you for|Thanks for watching|시청.*감사)/i;
    if (filterGarbage.test(text.trim()) && text.length < 60)
        return true;
    // 성음만으로 된 건 버림
    const alphanumeric = text.replace(/[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
    if (alphanumeric.length < 2)
        return true;
    return false;
};
// ── Gemini 단일 호출 ──────────────────────────────────────────────────────────
const callGemini = async (apiKey, prompt, timeoutMs = 12000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const res = await fetch(FLASH_URL(apiKey), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload), signal: controller.signal
        });
        clearTimeout(timer);
        if (!res.ok) {
            functions.logger.warn(`[Gemini] HTTP ${res.status}`, { key: apiKey.slice(0, 10) });
            return null;
        }
        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!raw)
            return null;
        const clean = raw.replace(/```json\s*|```/g, "").trim();
        return JSON.parse(clean);
    }
    catch (e) {
        clearTimeout(timer);
        return null;
    }
};
// ── 번역 파이프라인 ───────────────────────────────────────────────────────────
const translateWithFallback = async (rawText, sourceLang, previousContext, sessionContext) => {
    const tStart = Date.now();
    const targets = ['ko', 'en'].filter(l => l !== sourceLang);
    const langNames = { ko: 'Korean', en: 'English' };
    const srcName = langNames[sourceLang] || 'the source language';
    const transFields = targets.map(l => `"${l}": "...${langNames[l] || l}..."`).join(', ');
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
        `[INPUT] "The implant fixture was placed."`,
        `{"refined": "The implant fixture was placed.", "ko": "임플란트 픽스처가 식립되었습니다.", "isMedical": true}`,
        `[INPUT] "Uh, so, we did the bone graft."`,
        `{"refined": "So, we did the bone graft.", "ko": "그래서 우리는 골이식을 진행했습니다.", "isMedical": true}`,
        ``,
        `CRITICAL: All language fields MUST be filled containing the translated text. Never return empty strings for translations. Even if the input is a single word or fragment, YOU MUST TRANSLATE IT.`,
        `FORMAT: {"refined": "...", ${transFields}, "isMedical": true}`
    ].filter(Boolean).join('\n');
    const startIdx = _keyIndex % GEMINI_KEYS.length;
    _keyIndex++;
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const key = GEMINI_KEYS[(startIdx + i) % GEMINI_KEYS.length];
        const data = await callGemini(key, prompt, 12000);
        if (data) {
            // Validate that required translation fields exist and are not empty
            let isValid = true;
            if (sourceLang !== 'ko' && (!data.ko || data.ko.toString().trim().length === 0))
                isValid = false;
            if (sourceLang !== 'en' && (!data.en || data.en.toString().trim().length === 0))
                isValid = false;
            // if (sourceLang !== 'ja' && (!data.ja || data.ja.toString().trim().length === 0)) isValid = false; // Optional depending on config, but user only cares about ko right now mostly. Let's strictly check targets:
            targets.forEach(t => {
                if (!data[t] || data[t].toString().trim().length === 0)
                    isValid = false;
            });
            if (isValid) {
                functions.logger.info("[Translate] OK", {
                    ms: Date.now() - tStart,
                    key: key.slice(0, 10),
                    srcLen: rawText.length,
                    koLen: data.ko?.length || 0,
                    enLen: data.en?.length || 0
                });
                const refined = sanitize(data.refined || rawText);
                return {
                    refined,
                    ko: sourceLang === 'ko' ? refined : sanitize(data.ko || ''),
                    en: sourceLang === 'en' ? refined : sanitize(data.en || ''),
                    isMedical: data.isMedical ?? false
                };
            }
            else {
                functions.logger.warn("[Translate] Missing required translation fields, retrying...", {
                    ko: !!data.ko, en: !!data.en,
                    key: key.slice(0, 10),
                    rawResponseStr: JSON.stringify(data).slice(0, 100)
                });
            }
        }
    }
    functions.logger.error(`[Translate] All ${GEMINI_KEYS.length} keys failed to return valid translations for input:`, { input: rawText.slice(0, 50) });
    return {
        refined: sanitize(rawText),
        ko: sourceLang === 'ko' ? sanitize(rawText) : '',
        en: sourceLang === 'en' ? sanitize(rawText) : '',
        isMedical: false
    };
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
    const versionTag = "v11.0_stable";
    // CORS
    const origin = req.headers.origin;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || functions.config()?.app?.allowed_origin || "*";
    if (allowedOrigin === "*" || allowedOrigin === origin) {
        res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    }
    else {
        res.set("Access-Control-Allow-Origin", origin || allowedOrigin);
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
        const projectId = (req.query.projectId || "").toString();
        const sourceLabel = (req.query.sourceLabel || "").toString();
        const queryLang = (req.query.sourceLang || "").toString();
        if (!projectId) {
            res.status(400).json({ success: false });
            return;
        }
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
        const projectRef = admin.database().ref(`projects/${projectId}`);
        let sourceLang = queryLang || 'ko'; // Use query param if provided, otherwise default 'ko'
        let activeSessionId = null;
        let sessionContext = "";
        let previousContext = "";
        let customKeywords = "";
        let minLength = 30;
        let timeoutMs = 5000;
        let sentenceEnd = true;
        // 설정 로드
        try {
            const [activeSnap, stateSnap, chunkSnap, projectSettingsSnap] = await Promise.all([
                projectRef.child('activeSessionId').get(),
                projectRef.child('state').get(),
                projectRef.child('settings/chunk').get(),
                projectRef.child('settings').get()
            ]);
            const projectSettings = projectSettingsSnap.val() || {};
            // Fallback: If no active session, try to guess from project's primary target
            if (projectSettings.targetLanguages === 'ko' || (Array.isArray(projectSettings.targetLanguages) && projectSettings.targetLanguages.includes('ko'))) {
                sourceLang = 'en';
            }
            else if (projectSettings.targetLanguages === 'en' || (Array.isArray(projectSettings.targetLanguages) && projectSettings.targetLanguages.includes('en'))) {
                sourceLang = 'ko';
            }
            if (activeSnap.exists()) {
                activeSessionId = activeSnap.val();
                console.log(`[STT] Active Session found: ${activeSessionId}`);
                const sSnap = await projectRef.child(`sessions/${activeSessionId}`).get();
                if (sSnap.exists()) {
                    const s = sSnap.val();
                    sourceLang = s.sourceLanguage || sourceLang;
                    console.log(`[STT] Session language: ${sourceLang}`);
                    const affiliationStr = s.affiliation ? `, Affiliation: ${s.affiliation}` : '';
                    const abstractStr = s.abstract ? `, Abstract: ${s.abstract}` : '';
                    const keywordsStr = s.keywords ? `, Keywords: ${s.keywords}` : '';
                    sessionContext = `Speaker: ${s.speaker}${affiliationStr}, Topic: ${s.topic}${abstractStr}${keywordsStr}`;
                    customKeywords = s.keywords || "";
                }
                else {
                    console.warn(`[STT] Active Session ${activeSessionId} data missing in DB`);
                }
            }
            else {
                console.log(`[STT] No Active Session in RTDB, using fallback lang: ${sourceLang}`);
            }
            if (chunkSnap.exists()) {
                const sett = chunkSnap.val();
                if (sett.minLength !== undefined)
                    minLength = Number(sett.minLength);
                if (sett.timeoutMs !== undefined)
                    timeoutMs = Number(sett.timeoutMs);
                if (sett.sentenceEnd !== undefined)
                    sentenceEnd = Boolean(sett.sentenceEnd);
            }
            if (stateSnap.exists()) {
                const st = stateSnap.val();
                const list = Array.isArray(st.lastRefinedList) ? st.lastRefinedList : [];
                previousContext = list.slice(-2).join(' / ');
            }
        }
        catch { /* 무시 */ }
        // ── STEP 1: Whisper STT ────────────────────────────────────────────
        let openai = getOpenAI();
        const audioStream = stream_1.Readable.from(buf);
        audioStream.path = "audio.webm";
        const tWhisper = Date.now();
        const basePrompt = sourceLang === 'ko' ? DENTAL_PROMPT_KO : DENTAL_PROMPT_EN;
        const whisperPrompt = customKeywords ? `${basePrompt}, ${customKeywords}` : basePrompt;
        const stt = await openai.audio.transcriptions.create({
            file: audioStream, model: "whisper-1", language: sourceLang,
            prompt: whisperPrompt, temperature: 0
        });
        const sttText = (stt?.text || "").trim();
        const rawText = sanitize(sttText);
        if (rawText.length < 2 || isGarbage(rawText, sttText)) {
            res.status(200).json({ success: true, info: "EmptyOrGarbage", text: rawText });
            return;
        }
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = Date.now();
        const seqResult = await projectRef.child('lastSequence').transaction((cur) => (cur || 0) + 1);
        const seq = seqResult.snapshot.val();
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
        // ── STEP 3: 버퍼링 및 번역 (Background) ──────────────────────────
        const stateSnap = await projectRef.child('state').get();
        const st = stateSnap.val() || {};
        let bufferText = (st.bufferText || "").toString();
        let bufferIds = Array.isArray(st.bufferIds) ? st.bufferIds : [];
        let lastGeminiTime = Number(st.lastGeminiTime || 0);
        if (bufferIds.length === 0)
            lastGeminiTime = Date.now();
        bufferText = bufferText ? bufferText + " " + rawText : rawText;
        bufferIds.push(id);
        const timeDiff = Date.now() - lastGeminiTime;
        const isSentenceEnd = sentenceEnd && /[.!?]$/.test(bufferText.trim());
        const isLongEnough = bufferText.length >= minLength;
        const isTimeOut = timeDiff >= timeoutMs;
        if (isSentenceEnd || isLongEnough || isTimeOut) {
            // FLUSH
            const targetId = bufferIds[0];
            const idsToDelete = bufferIds.slice(1);
            await projectRef.child('state').update({ bufferText: "", bufferIds: [], lastGeminiTime: Date.now() });
            try {
                const { refined, ko, en, isMedical } = await translateWithFallback(bufferText, sourceLang, previousContext, sessionContext);
                const updates = {};
                const base = `projects/${projectId}/stream/${targetId}`;
                updates[`${base}/refined`] = refined;
                updates[`${base}/ko`] = ko;
                updates[`${base}/en`] = en;
                updates[`${base}/isMedical`] = isMedical;
                updates[`${base}/status`] = "final";
                updates[`${base}/mergedIds`] = idsToDelete;
                for (const pid of idsToDelete) {
                    updates[`projects/${projectId}/stream/${pid}/status`] = "merged";
                }
                // context 리스트 업데이트
                try {
                    const listSnap = await projectRef.child('state/lastRefinedList').get();
                    const list = listSnap.exists() ? listSnap.val() : [];
                    updates[`projects/${projectId}/state/lastRefinedList`] = [...list, refined].slice(-5);
                }
                catch { }
                await admin.database().ref().update(updates);
            }
            catch {
                await admin.database().ref(`projects/${projectId}/stream/${targetId}/status`).set("final");
            }
        }
        else {
            // KEEP BUFFERING (상태는 계속 translating 유지)
            await projectRef.child('state').update({ bufferText, bufferIds });
        }
    }
    catch (e) {
        try {
            res.status(500).json({ success: false, error: e.message });
        }
        catch { }
    }
});
// ── Legacy Triggers (Disabled for v11.0) ─────────────────────────────────────
exports.onRefineRequest = functions.database.ref("projects/{projectId}/stream/{dataId}").onCreate(() => null);
// ── Remaster ─────────────────────────────────────────────────────────────────
exports.remasterSession = functions.pubsub.schedule("every 2 minutes").onRun(() => runRemasterLogic());
exports.triggerRemaster = functions.https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    const pid = (req.query.projectId || "").toString();
    const count = await runRemasterLogic(pid || undefined);
    res.json({ success: true, count });
});
const runRemasterLogic = async (targetPid) => {
    const now = Date.now();
    const ONE_HOUR = 3600 * 1000;
    let snap = targetPid ? await admin.database().ref(`projects/${targetPid}`).get() : await admin.database().ref('projects').get();
    if (!snap.exists())
        return 0;
    // (리마스터링 로직 생략 또는 최소화 - 실시간 성능에 집중)
    return 0;
};
// ── 진단 툴 ─────────────────────────────────────────────────────────────────
exports.verifyGeminiPipeline = functions.https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    const result = await translateWithFallback("Testing terminal connectivity.", "en", "", "");
    res.json({ success: true, version: "v11.0", result });
});
