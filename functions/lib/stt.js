"use strict";
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
exports.triggerRemaster = exports.remasterSession = exports.onRefineRequest = exports.processAudio = void 0;
// Version: v7.9 (Language Locking)
const functions = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const openai_1 = __importDefault(require("openai"));
const stream_1 = require("stream");
let _openai = null;
const getGeminiKeys = () => {
    var _a, _b;
    const keys = [];
    const primaryKey = process.env.GEMINI_API_KEY || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.gemini) === null || _b === void 0 ? void 0 : _b.key) || "";
    if (primaryKey)
        keys.push(primaryKey);
    keys.push("AIzaSyAYO3OAfzPxa1kZGyPGOoJIbiRewaumVI8"); // Fallback key supplied by user
    if (keys.length === 0)
        functions.logger.warn("GEMINI_API_KEY is not set.");
    return keys;
};
const GEMINI_FLASH_URL = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`;
const GEMINI_PRO_URL = (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${key}`;
const getDynamicPrompt = (sourceLang, sessionContext, previousContext) => {
    const base = `
Role: Live Captioner for Medical Conference
Rule 1: Always output valid JSON.
Rule 2: Refine the input text to be grammatically correct and professional.
Rule 3: Infer medical terms from phonetic errors (e.g. "Gamgon" -> "Recommendation").

[FRAGMENT HANDLING]
- Even if the input is a single word or a fragment (e.g., "Criteria, Prevention,"), YOU MUST TRANSLATE IT.
- Do not skip short segments.
- If the input Korean seems like a typo (e.g., "불유부" -> sounds like "분류"), fix the Korean mentally and translate the intended meaning (e.g., "Classification").

[STRICT LANGUAGE RULES]
- Source Language: ${sourceLang}
`;
    let instructions = "";
    if (sourceLang === 'ko') {
        instructions = `
- "refined": Refine the input in Korean.
- "en": Translate to English. DO NOT include Korean characters in this field.
- "ja": Translate to Japanese.
`;
    }
    else if (sourceLang === 'en') {
        instructions = `
- "refined": Refine the input in English.
- "en": Same as "refined".
- "ja": Translate to Japanese.
`;
    }
    else if (sourceLang === 'ja') {
        instructions = `
- "refined": Refine the input in Japanese.
- "en": Translate to English.
- "ja": Same as "refined".
`;
    }
    else if (sourceLang === 'zh') {
        instructions = `
- "refined": Refine the input in Chinese.
- "en": Translate to English.
- "ja": Translate to Japanese.
`;
    }
    else {
        instructions = `
- "refined": Refine the input.
- "en": Translate to English.
- "ja": Translate to Japanese.
`;
    }
    return `${base}${instructions}
Output JSON Format: {"isMedicalContext": true|false, "refined": "...", "en": "...", "ja": "..."}

[CONTEXT CONTINUITY - CRITICAL]
- The PREVIOUS CONTEXT below is what was just said before this fragment. Your output MUST flow naturally from it.
- If the INPUT seems like a continuation or fragment of the previous context, connect them seamlessly.
- Example: If previous context ends with "25번 임플란트" and input is "주변에 염증이", the refined result should naturally continue the thought, NOT start a new sentence.
- Remove unnecessary line breaks. Output as a single continuous phrase or sentence.
- Do NOT repeat words that already appear in the PREVIOUS CONTEXT.

${sessionContext ? `[SESSION INFO]\n${sessionContext}` : ""}
${previousContext ? `[PREVIOUS CONTEXT - continue naturally from this]\n${previousContext}` : ""}
[INPUT TO REFINE]: `;
};
const callGeminiREST = async (text, previousContext, sessionContext, sourceLang) => {
    var _a, _b, _c;
    const prompt = getDynamicPrompt(sourceLang, sessionContext, previousContext);
    const payload = { contents: [{ parts: [{ text: `${prompt}"${text}"` }] }], generationConfig: { responseMimeType: "application/json" } };
    const apiKeys = getGeminiKeys();
    let data = null;
    let lastStatus = 500;
    for (const apiKey of apiKeys) {
        let res = await fetch(GEMINI_FLASH_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (res.ok) {
            data = await res.json();
            break;
        }
        const errText = await res.text();
        functions.logger.warn("Gemini REST Flash error", { status: res.status, body: errText });
        lastStatus = res.status;
        if (res.status === 429)
            continue; // Rate limit hit, try next key
        res = await fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (res.ok) {
            data = await res.json();
            break;
        }
        lastStatus = res.status;
        if (res.status === 429)
            continue; // Try next key
    }
    if (!data) {
        throw new Error(`Gemini REST Error: ${lastStatus}`);
    }
    const outText = ((_c = (_b = (_a = (((data || {}).candidates || [])[0] || {}).content) === null || _a === void 0 ? void 0 : _a.parts) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.text) || "";
    if (!outText)
        return { refined: "" };
    try {
        const cleanText = outText.replace(/```json\s*|```/g, "").trim();
        const obj = JSON.parse(cleanText);
        return { isMedicalContext: !!obj.isMedicalContext, refined: sanitize(obj.refined), en: sanitize(obj.en), ja: sanitize(obj.ja) };
    }
    catch {
        return { refined: sanitize(outText) };
    }
};
const getOpenAI = () => {
    var _a, _b;
    if (!_openai) {
        const envKey = process.env.OPENAI_API_KEY || "";
        const apiKey = envKey || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.openai) === null || _b === void 0 ? void 0 : _b.key) || "";
        if (!apiKey)
            throw new Error("OPENAI_API_KEY missing");
        _openai = new openai_1.default({ apiKey });
    }
    return _openai;
};
const DENTAL_PROMPT = "치과, 임플란트, 보철, 수술, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, Implant, Surgery, Bone Graft, Fixture, Abutment, Crown";
const sanitize = (s) => {
    let t = (s || "").toString();
    t = t.replace(/[`]{3,}/g, "").replace(/[`]/g, "");
    t = t.replace(/\bundefined\b/gi, "");
    return t.trim();
};
const HALLUCINATION_BLACKLIST = ['자막제작', '자막 제작', 'Subtitles by', 'MBC 뉴스', 'Copyright', 'http', '.co.kr'];
const isLoopPattern = (text) => {
    if (HALLUCINATION_BLACKLIST.some(b => text.includes(b)))
        return true;
    if (/(.+)\1{2,}/.test(text))
        return true;
    if (/(.*,){4,}/.test(text))
        return true;
    if (/^(Implant, Surgery|임플란트, 보철)/i.test(text))
        return true;
    return false;
};
// 1. HTTP Trigger: Receive Audio -> STT (Language Locked) -> Save Raw
exports.processAudio = functions
    .runWith({ timeoutSeconds: 60, memory: "512MB" })
    .https.onRequest(async (req, res) => {
    var _a, _b;
    const versionTag = "v7.9_lang_lock";
    // CORS Handling
    const origin = req.headers.origin;
    const allowedOrigin = process.env.ALLOWED_ORIGIN || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.app) === null || _b === void 0 ? void 0 : _b.allowed_origin) || "*";
    if (allowedOrigin === "*" || allowedOrigin === origin) {
        res.set("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : origin);
    }
    else if (origin && (origin.endsWith(".web.app") || origin.endsWith(".firebaseapp.com") || origin.includes("localhost"))) {
        res.set("Access-Control-Allow-Origin", origin);
    }
    else {
        res.set("Access-Control-Allow-Origin", allowedOrigin);
    }
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
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
        // Get Source Language
        let sourceLang = 'ko';
        let activeSessionId = null;
        try {
            const activeSnap = await admin.database().ref(`projects/${projectId}/activeSessionId`).get();
            activeSessionId = activeSnap.val();
            if (activeSessionId) {
                const sessionSnap = await admin.database().ref(`projects/${projectId}/sessions/${activeSessionId}`).get();
                if (sessionSnap.exists()) {
                    sourceLang = sessionSnap.val().sourceLanguage || 'ko';
                }
            }
        }
        catch { // Intentionally empty
        }
        await admin.database().ref(`projects/${projectId}/status`).update({ lastActive: Date.now() }).catch(() => { });
        let openai;
        try {
            openai = getOpenAI();
        }
        catch {
            res.status(500).json({ success: false });
            return;
        }
        if (buf.length < 2000) {
            res.status(200).json({ success: false, error: "TooSmall" });
            return;
        }
        let stt;
        try {
            const audioStream = stream_1.Readable.from(buf);
            audioStream.path = "audio.webm"; // 원본 포맷인 webm으로 원복
            stt = await openai.audio.transcriptions.create({
                file: audioStream,
                model: "whisper-1",
                language: sourceLang,
                prompt: DENTAL_PROMPT,
                temperature: 0
            });
            functions.logger.info("Whisper Raw Result:", { text: stt === null || stt === void 0 ? void 0 : stt.text });
            await admin.database().ref(`projects/${projectId}/status/services/openai`).set({ state: "ok", ts: Date.now() }).catch(() => { });
        }
        catch (error) {
            functions.logger.error("Whisper API Error:", error.message);
            res.status(200).json({ success: false, error: "WhisperFailed", details: error.message });
            return;
        }
        const rawResponseText = (stt === null || stt === void 0 ? void 0 : stt.text) || "";
        let rawText = sanitize(rawResponseText.trim());
        if (rawText.length < 2) {
            functions.logger.info("Whisper result too short or empty, dropping", { raw: rawResponseText });
            rawText = "";
        }
        if (isLoopPattern(rawText)) {
            res.status(200).json({ success: true, info: "LoopDropped" });
            return;
        }
        if (!rawText) {
            res.status(200).json({ success: true, info: "Empty" });
            return;
        }
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = Date.now();
        // Sequence Logic
        const seqRef = admin.database().ref(`projects/${projectId}/lastSequence`);
        const seqResult = await seqRef.transaction((current) => {
            return (current || 0) + 1;
        });
        const seq = seqResult.snapshot.val();
        await admin.database().ref(`projects/${projectId}/stream/${id}`).set({
            original: rawText,
            status: "raw",
            timestamp,
            sourceLabel,
            sessionId: activeSessionId,
            seq
        });
        await admin.database().ref(`projects/${projectId}/state`).update({ lastText: rawText, lastId: id }).catch(() => { });
        res.status(200).json({ success: true, id, text: rawText, stage: "original", timestamp, version: versionTag });
    }
    catch (e) {
        void e;
        res.status(500).json({ success: false, error: "Internal Error" });
    }
});
// 2. DB Trigger: Refine Text (Concurrency Safe & Dynamic Language)
exports.onRefineRequest = functions
    .runWith({ timeoutSeconds: 60, memory: "512MB" })
    .database.ref("projects/{projectId}/stream/{dataId}")
    .onCreate(async (snapshot, context) => {
    const { projectId, dataId } = context.params;
    const val = snapshot.val();
    if (!val || val.status !== 'raw')
        return;
    const rawText = val.original;
    const projectRef = admin.database().ref(`projects/${projectId}`);
    let bufferText = "";
    let bufferIds = [];
    let lastGeminiTime = 0;
    let sessionContext = "";
    let sourceLang = "ko";
    let chunkSettings = { minLength: 80, timeoutMs: 5000, sentenceEnd: true }; // Default (optimized for context coherence)
    let activeSessionId = null;
    try {
        const [stateSnap, activeSnap, settingsSnap] = await Promise.all([
            projectRef.child('state').get(),
            projectRef.child('activeSessionId').get(),
            projectRef.child('settings/chunk').get()
        ]);
        if (stateSnap.exists()) {
            const st = stateSnap.val();
            bufferText = (st.bufferText || "").toString();
            bufferIds = (st.bufferIds || []);
            lastGeminiTime = Number(st.lastGeminiTime || 0);
        }
        if (settingsSnap.exists()) {
            chunkSettings = { ...chunkSettings, ...settingsSnap.val() };
        }
        if (activeSnap.exists()) {
            activeSessionId = activeSnap.val();
            const sessionSnap = await projectRef.child(`sessions/${activeSessionId}`).get();
            if (sessionSnap.exists()) {
                const s = sessionSnap.val();
                sessionContext = `Speaker: ${s.speaker}, Topic: ${s.topic}, Abstract: ${s.abstract}, Keywords: ${s.keywords}`;
                sourceLang = s.sourceLanguage || "ko";
            }
        }
    }
    catch { // Intentionally empty
    }
    bufferText = bufferText ? bufferText + " " + rawText : rawText;
    bufferIds.push(dataId);
    const now = Date.now();
    const timeDiff = now - lastGeminiTime;
    const isSentenceEnd = chunkSettings.sentenceEnd && /[.!?]$/.test(rawText.trim());
    const isLongEnough = bufferText.length >= chunkSettings.minLength;
    const isTimeOut = timeDiff > chunkSettings.timeoutMs;
    const shouldFlush = isSentenceEnd || isLongEnough || isTimeOut;
    if (!shouldFlush) {
        await projectRef.child('state').update({ bufferText, bufferIds });
        return;
    }
    functions.logger.info("Flushing Buffer", { projectId, lang: sourceLang, textLen: bufferText.length });
    let previousContext = "";
    try {
        const snap = await projectRef.child('state/lastRefinedList').get();
        const list = snap.exists() ? snap.val() : [];
        // Build context from last 3 refined outputs
        previousContext = list.slice(-3).join(' / ');
    }
    catch { // Intentionally empty
        void 0;
    }
    let refined = bufferText;
    let firstEn = "";
    let firstJa = "";
    const tGeminiStart = Date.now();
    try {
        const out = await callGeminiREST(bufferText, previousContext, sessionContext, sourceLang);
        refined = sanitize(out.refined || bufferText);
        firstEn = (out.en || "").toString();
        firstJa = (out.ja || "").toString();
    }
    catch (_err) {
        // CRITICAL: 제미나이 실패 시 원인을 무조건 기록해야 함 (Silent Failure 방지)
        functions.logger.error("Gemini Refine Error [FATAL]:", {
            message: _err.message,
            stack: _err.stack,
            bufferTextLen: bufferText.length
        });
        // 실패 시 원본을 내보내되, 에러 상황임을 마킹할 수도 있음
        refined = bufferText;
    }
    const updates = {};
    const targetId = bufferIds[0];
    const idsToDelete = bufferIds.slice(1);
    updates[`projects/${projectId}/stream/${targetId}/refined`] = refined;
    updates[`projects/${projectId}/stream/${targetId}/en`] = firstEn;
    updates[`projects/${projectId}/stream/${targetId}/ja`] = firstJa;
    updates[`projects/${projectId}/stream/${targetId}/status`] = "final";
    updates[`projects/${projectId}/stream/${targetId}/geminiMs`] = Date.now() - tGeminiStart;
    updates[`projects/${projectId}/stream/${targetId}/mergedIds`] = idsToDelete;
    for (const pid of idsToDelete) {
        updates[`projects/${projectId}/stream/${pid}/status`] = "merged";
        updates[`projects/${projectId}/stream/${pid}/refined`] = "";
    }
    updates[`projects/${projectId}/state/bufferText`] = "";
    updates[`projects/${projectId}/state/bufferIds`] = [];
    updates[`projects/${projectId}/state/lastGeminiTime`] = Date.now();
    updates[`projects/${projectId}/state/lastRefined`] = refined; // Keep for backward compat
    // Update rolling context list (keep last 5):
    try {
        const listSnap = await projectRef.child('state/lastRefinedList').get();
        const existingList = listSnap.exists() ? listSnap.val() : [];
        const newList = [...existingList, refined].slice(-5);
        updates[`projects/${projectId}/state/lastRefinedList`] = newList;
    }
    catch { // Intentionally empty
        void 0;
    }
    await admin.database().ref().update(updates);
});
// 3. Scheduled Batch: Live Remastering (Every 2 minutes)
exports.remasterSession = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .pubsub.schedule("every 2 minutes").onRun(async (_context) => {
    void _context;
    await runRemasterLogic();
});
// Manual Trigger for Remastering
exports.triggerRemaster = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    try {
        const projectId = (req.query.projectId || "").toString();
        let count = 0;
        if (!projectId) {
            // If no project ID, run for all (batch mode) or error? 
            // Let's run the batch logic for simplicity
            count = await runRemasterLogic() || 0;
        }
        else {
            // Run for specific project logic (simplified version of batch logic)
            count = await runRemasterLogic(projectId) || 0;
        }
        res.json({ success: true, count });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Unknown error' });
    }
});
const runRemasterLogic = async (targetProjectId) => {
    const now = Date.now();
    // Target: Recent 10 minutes (State-based Sweeping)
    // Avoid very recent 30s
    // START_OFFSET removed: unused
    // END_OFFSET removed: unused
    // 1. Get projects
    let projectsSnap;
    if (targetProjectId) {
        projectsSnap = await admin.database().ref(`projects/${targetProjectId}`).get();
    }
    else {
        projectsSnap = await admin.database().ref('projects').get();
    }
    if (!projectsSnap.exists())
        return;
    const promises = [];
    const processProject = (pSnap, pid) => {
        const pVal = pSnap.val();
        const activeId = pVal.activeSessionId;
        if (!activeId)
            return;
        // Determine Time Window
        // Force Remaster: Always look back 60 minutes, ignoring lastRemasteredAt
        // This ensures we always re-evaluate the recent context
        const ONE_HOUR = 3600 * 1000;
        const startTime = now - ONE_HOUR;
        const endTime = now - 1000; // Up to 1 second ago
        promises.push((async () => {
            var _a, _b, _c, _d;
            // 2. Fetch data within time window
            const streamRef = admin.database().ref(`projects/${pid}/stream`);
            const q = streamRef.orderByChild('timestamp').startAt(startTime).endAt(endTime);
            const streamSnap = await q.get();
            if (!streamSnap.exists())
                return 0;
            const items = [];
            const streamVal = streamSnap.val() || {};
            const entries = Object.entries(streamVal);
            for (const [key, val] of entries) {
                const v = val;
                if (v && v.sessionId === activeId && v.status === 'final') {
                    items.push({ id: key, timestamp: v.timestamp, refined: v.refined, original: v.original, sessionId: v.sessionId });
                }
            }
            if (items.length === 0)
                return 0; // Nothing to update (Sweeping complete)
            // Sort by timestamp
            const allItems = items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            if (allItems.length < 3)
                return 0;
            // 3. Prepare Prompt
            const sessionInfo = ((_a = pVal.sessions) === null || _a === void 0 ? void 0 : _a[activeId]) || {};
            const contextText = `Speaker: ${sessionInfo.speaker}, Topic: ${sessionInfo.topic}, Abstract: ${sessionInfo.abstract}`;
            const sourceLang = sessionInfo.sourceLanguage || 'ko';
            // Determine targets:
            // We want to fix broken sentences.
            // We pass ALL items to Gemini, but mark them as "isTarget: true" if they are recent (last 10 mins) OR haven't been remastered.
            // Actually, for "Force Remaster", let's just ask Gemini to review the whole block and fix any broken flows.
            const inputList = allItems.map(i => ({
                id: i.id,
                text: i.refined || i.original,
                // isTarget: !i.isRemastered // OLD LOGIC
                isTarget: true // FORCE LOGIC: Check everything in the window
            }));
            const prompt = `
[TASK: REMASTER TRANSCRIPT]
- Analyze the conversation list (JSON).
- Focus on items where "isTarget": true.
- Use context from other items to fix terminology and flow.
- Output the updated list for TARGET items only.

[REMASTERING RULES]
1. Input Source Language: ${sourceLang}
2. Target Languages: en, ja

[OUTPUT FIELDS]
- "id": The ID of the item being updated (The main sentence).
- "refined": MUST BE in ${sourceLang}. Fix typos and grammar only. DO NOT TRANSLATE.
- "translations": Object containing keys for each target language.
- "mergedIds": Array of IDs that were merged/absorbed into this sentence. (These will be DELETED from the screen).

[RULE]
- If you combine multiple fragments into one complete sentence, use the ID of the FIRST fragment as the main "id", and list all other absorbed IDs in "mergedIds".

[EXAMPLE]
Input: 
Item 1 (ID: A): "1, 2, 3"
Item 2 (ID: B): "Hello"
Item 3 (ID: C): "World"
(Source: en)

Output:
[
  {
    "id": "B",
    "refined": "Hello World.",
    "translations": { "ko": "안녕 세상아." },
    "mergedIds": ["A", "C"] 
  }
]

[NOISE CLEANUP]
- Remove non-lecture speech like microphone testing ("1, 2, 3, 4", "Ah, ah").
- Fix obvious typos ("띵 진료" -> "루틴 진료" or "핵심 진료" based on context).
- If a sentence is broken, merge it with the next one to make a complete paragraph.
- If the Korean sentence lacks a subject (e.g., "권고합니다"), add a proper subject like "We recommend" or "It is recommended" based on context.
- Ensure the final English output forms complete, professional sentences suitable for a medical lecture.

[Session Abstract]
${contextText}

[INPUT JSON]
${JSON.stringify(inputList)}
`;
            // 4. Call Gemini Pro
            try {
                const apiKeys = getGeminiKeys();
                const payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
                let data = null;
                for (const apiKey of apiKeys) {
                    const res = await fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                    if (res.ok) {
                        data = await res.json();
                        break;
                    }
                    if (res.status === 429)
                        continue; // Try next key
                }
                if (!data)
                    return 0;
                const outText = ((_d = (_c = (_b = (((data || {}).candidates || [])[0] || {}).content) === null || _b === void 0 ? void 0 : _b.parts) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.text) || "";
                if (!outText)
                    return 0;
                const cleanText = outText.replace(/```json\s*|```/g, "").trim();
                const refinedList = JSON.parse(cleanText);
                if (!Array.isArray(refinedList))
                    return 0;
                // 5. Update DB
                const updates = {};
                for (const item of refinedList) {
                    if (!item || !item.id)
                        continue;
                    const originalItem = items.find(i => i.id === item.id);
                    if (originalItem && item.refined) {
                        // Safety Guard: Check if source language is preserved
                        if (sourceLang === 'ko' && !/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(item.refined)) {
                            functions.logger.warn(`Safety Guard: Dropped English update for Korean field`, item);
                            continue; // Skip this update
                        }
                        updates[`projects/${pid}/stream/${item.id}/refined`] = sanitize(item.refined);
                        if (item.translations) {
                            if (item.translations.en)
                                updates[`projects/${pid}/stream/${item.id}/en`] = sanitize(item.translations.en);
                            if (item.translations.ja)
                                updates[`projects/${pid}/stream/${item.id}/ja`] = sanitize(item.translations.ja);
                        }
                        updates[`projects/${pid}/stream/${item.id}/isRemastered`] = true;
                        // Handle Merged IDs (Delete them)
                        if (item.mergedIds && Array.isArray(item.mergedIds)) {
                            item.mergedIds.forEach((mid) => {
                                if (mid !== item.id) { // Prevent self-deletion
                                    updates[`projects/${pid}/stream/${mid}`] = null; // Delete from DB
                                }
                            });
                        }
                    }
                }
                // Update lastRemasteredAt to the max timestamp of fetched items
                let maxTimestamp = 0;
                if (items.length > 0) {
                    maxTimestamp = Math.max(...items.map(i => i.timestamp || 0));
                }
                if (maxTimestamp > 0) {
                    updates[`projects/${pid}/settings/lastRemasteredAt`] = maxTimestamp;
                }
                if (Object.keys(updates).length > 0) {
                    await admin.database().ref().update(updates);
                    functions.logger.info(`Remastered ${Object.keys(updates).length} items for ${pid}`);
                    return Object.keys(updates).length; // Return count
                }
                // Even if no updates, update pointer
                if (maxTimestamp > 0) {
                    await admin.database().ref(`projects/${pid}/settings/lastRemasteredAt`).set(maxTimestamp);
                }
                return 0;
            }
            catch (e) {
                functions.logger.error("Remaster Inner Error", e);
                throw new Error(`Inner Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
            }
        })());
    };
    if (targetProjectId) {
        processProject(projectsSnap, targetProjectId);
    }
    else {
        projectsSnap.forEach((pSnap) => { processProject(pSnap, pSnap.key); });
    }
    const results = await Promise.all(promises);
    const totalCount = results.reduce((a, b) => (a || 0) + (b || 0), 0);
    return totalCount;
};
