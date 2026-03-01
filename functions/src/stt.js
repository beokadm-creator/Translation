"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerRemaster = exports.remasterSession = exports.onRefineRequest = exports.processAudio = void 0;
// Version: v7.9 (Language Locking)
var functions = require("firebase-functions/v1");
var admin = require("firebase-admin");
var openai_1 = require("openai");
var stream_1 = require("stream");
var _openai = null;
var getGeminiKey = function () {
    var _a, _b;
    var key = process.env.GEMINI_API_KEY || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.gemini) === null || _b === void 0 ? void 0 : _b.key) || "";
    if (!key)
        functions.logger.warn("GEMINI_API_KEY is not set.");
    return key;
};
var GEMINI_FLASH_URL = function (key) { return "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=".concat(key); };
var GEMINI_PRO_URL = function (key) { return "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=".concat(key); };
var getDynamicPrompt = function (sourceLang, sessionContext, previousContext) {
    var base = "\nRole: Live Captioner for Medical Conference\nRule 1: Always output valid JSON.\nRule 2: Refine the input text to be grammatically correct and professional.\nRule 3: Infer medical terms from phonetic errors (e.g. \"Gamgon\" -> \"Recommendation\").\n\n[FRAGMENT HANDLING]\n- Even if the input is a single word or a fragment (e.g., \"Criteria, Prevention,\"), YOU MUST TRANSLATE IT.\n- Do not skip short segments.\n- If the input Korean seems like a typo (e.g., \"\uBD88\uC720\uBD80\" -> sounds like \"\uBD84\uB958\"), fix the Korean mentally and translate the intended meaning (e.g., \"Classification\").\n\n[STRICT LANGUAGE RULES]\n- Source Language: ".concat(sourceLang, "\n");
    var instructions = "";
    if (sourceLang === 'ko') {
        instructions = "\n- \"refined\": Refine the input in Korean.\n- \"en\": Translate to English. DO NOT include Korean characters in this field.\n- \"ja\": Translate to Japanese.\n";
    }
    else if (sourceLang === 'en') {
        instructions = "\n- \"refined\": Refine the input in English.\n- \"en\": Same as \"refined\".\n- \"ja\": Translate to Japanese.\n";
    }
    else if (sourceLang === 'ja') {
        instructions = "\n- \"refined\": Refine the input in Japanese.\n- \"en\": Translate to English.\n- \"ja\": Same as \"refined\".\n";
    }
    else if (sourceLang === 'zh') {
        instructions = "\n- \"refined\": Refine the input in Chinese.\n- \"en\": Translate to English.\n- \"ja\": Translate to Japanese.\n";
    }
    else {
        instructions = "\n- \"refined\": Refine the input.\n- \"en\": Translate to English.\n- \"ja\": Translate to Japanese.\n";
    }
    return "".concat(base).concat(instructions, "\nOutput JSON Format: {\"isMedicalContext\": true|false, \"refined\": \"...\", \"en\": \"...\", \"ja\": \"...\"}\n\n").concat(sessionContext ? "SESSION INFO: ".concat(sessionContext) : "", "\n").concat(previousContext ? "PREVIOUS CONTEXT: ".concat(previousContext) : "", "\nINPUT: ");
};
var callGeminiREST = function (text, previousContext, sessionContext, sourceLang) { return __awaiter(void 0, void 0, void 0, function () {
    var prompt, payload, apiKey, res, errText, data, outText, cleanText, obj;
    var _a, _b, _c;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                prompt = getDynamicPrompt(sourceLang, sessionContext, previousContext);
                payload = { contents: [{ parts: [{ text: "".concat(prompt, "\"").concat(text, "\"") }] }], generationConfig: { responseMimeType: "application/json" } };
                apiKey = getGeminiKey();
                return [4 /*yield*/, fetch(GEMINI_FLASH_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })];
            case 1:
                res = _d.sent();
                if (!!res.ok) return [3 /*break*/, 4];
                return [4 /*yield*/, res.text()];
            case 2:
                errText = _d.sent();
                functions.logger.error("Gemini REST error", { status: res.status, body: errText });
                return [4 /*yield*/, fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })];
            case 3:
                res = _d.sent();
                if (!res.ok) {
                    throw new Error("Gemini REST Error: ".concat(res.status));
                }
                _d.label = 4;
            case 4: return [4 /*yield*/, res.json()];
            case 5:
                data = _d.sent();
                outText = ((_c = (_b = (_a = (((data || {}).candidates || [])[0] || {}).content) === null || _a === void 0 ? void 0 : _a.parts) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.text) || "";
                if (!outText)
                    return [2 /*return*/, { refined: "" }];
                try {
                    cleanText = outText.replace(/```json\s*|```/g, "").trim();
                    obj = JSON.parse(cleanText);
                    return [2 /*return*/, { isMedicalContext: !!obj.isMedicalContext, refined: sanitize(obj.refined), en: sanitize(obj.en), ja: sanitize(obj.ja) }];
                }
                catch (_f) {
                    return [2 /*return*/, { refined: sanitize(outText) }];
                }
                return [2 /*return*/];
        }
    });
}); };
var getOpenAI = function () {
    var _a, _b;
    if (!_openai) {
        var envKey = process.env.OPENAI_API_KEY || "";
        var apiKey = envKey || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.openai) === null || _b === void 0 ? void 0 : _b.key) || "";
        if (!apiKey)
            throw new Error("OPENAI_API_KEY missing");
        _openai = new openai_1.default({ apiKey: apiKey });
    }
    return _openai;
};
// TTS Helper
var generateTTS = function (text, lang, projectId, sessionId, seq) { return __awaiter(void 0, void 0, void 0, function () {
    var apiKey, voiceName, languageCode, url, payload, res, data, bucketName, bucket, filePath, file, e_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
                if (!apiKey)
                    return [2 /*return*/, null];
                // Filter out very short text or garbage
                if (!text || text.length < 2)
                    return [2 /*return*/, null];
                voiceName = lang === 'ko' ? 'ko-KR-Neural2-C' : 'en-US-Neural2-J';
                languageCode = lang === 'ko' ? 'ko-KR' : 'en-US';
                url = "https://texttospeech.googleapis.com/v1/text:synthesize?key=".concat(apiKey);
                payload = {
                    input: { text: text },
                    voice: { languageCode: languageCode, name: voiceName },
                    audioConfig: { audioEncoding: 'MP3' }
                };
                _a.label = 1;
            case 1:
                _a.trys.push([1, 6, , 7]);
                return [4 /*yield*/, fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })];
            case 2:
                res = _a.sent();
                return [4 /*yield*/, res.json()];
            case 3:
                data = _a.sent();
                if (!data.audioContent) {
                    functions.logger.error("TTS Failed", data);
                    return [2 /*return*/, null];
                }
                bucketName = "translation-comm.firebasestorage.app";
                bucket = admin.storage().bucket(bucketName);
                filePath = "audios/".concat(projectId, "/").concat(sessionId, "/").concat(seq, ".mp3");
                file = bucket.file(filePath);
                return [4 /*yield*/, file.save(Buffer.from(data.audioContent, 'base64'), {
                        metadata: { contentType: 'audio/mpeg' }
                    })];
            case 4:
                _a.sent();
                return [4 /*yield*/, file.makePublic()];
            case 5:
                _a.sent();
                return [2 /*return*/, "https://storage.googleapis.com/".concat(bucketName, "/").concat(filePath)];
            case 6:
                e_1 = _a.sent();
                functions.logger.error("TTS Error", e_1);
                return [2 /*return*/, null];
            case 7: return [2 /*return*/];
        }
    });
}); };
var DENTAL_PROMPT = "치과, 임플란트, 보철, 수술, 상악동, 골이식, 픽스처, 어버트먼트, 크라운, Implant, Surgery, Bone Graft, Fixture, Abutment, Crown";
var sanitize = function (s) {
    var t = (s || "").toString();
    t = t.replace(/[`]{3,}/g, "").replace(/[`]/g, "");
    t = t.replace(/\bundefined\b/gi, "");
    return t.trim();
};
var HALLUCINATION_BLACKLIST = ['자막제작', '자막 제작', 'Subtitles by', 'MBC 뉴스', 'Copyright', 'http', '.co.kr'];
var isLoopPattern = function (text) {
    if (HALLUCINATION_BLACKLIST.some(function (b) { return text.includes(b); }))
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
    .https.onRequest(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var versionTag, auth, projectId, sourceLabel, buf, raw, sourceLang, activeSessionId, activeSnap, sessionSnap, _a, openai, stt, audioStream, _b, rawText, id, timestamp, seqRef, seqResult, seq, e_2;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                versionTag = "v7.9_lang_lock";
                res.set("Access-Control-Allow-Origin", "*");
                res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
                res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
                if (req.method === "OPTIONS") {
                    res.status(204).send("");
                    return [2 /*return*/];
                }
                _c.label = 1;
            case 1:
                _c.trys.push([1, 17, , 18]);
                if (!admin.apps.length)
                    throw new Error("Admin not initialized");
                auth = (req.headers.authorization || "").toString();
                if (!auth.startsWith("Bearer ")) {
                    res.status(401).json({ success: false });
                    return [2 /*return*/];
                }
                projectId = (req.query.projectId || "").toString();
                sourceLabel = (req.query.sourceLabel || "").toString();
                if (!projectId) {
                    res.status(400).json({ success: false });
                    return [2 /*return*/];
                }
                buf = null;
                raw = req.rawBody;
                if (raw && Buffer.isBuffer(raw))
                    buf = raw;
                else if (Buffer.isBuffer(req.body))
                    buf = req.body;
                else if (typeof req.body === "string")
                    buf = Buffer.from(req.body, "binary");
                if (!buf || buf.length === 0) {
                    res.status(400).json({ success: false });
                    return [2 /*return*/];
                }
                sourceLang = 'ko';
                activeSessionId = null;
                _c.label = 2;
            case 2:
                _c.trys.push([2, 6, , 7]);
                return [4 /*yield*/, admin.database().ref("projects/".concat(projectId, "/activeSessionId")).get()];
            case 3:
                activeSnap = _c.sent();
                activeSessionId = activeSnap.val();
                if (!activeSessionId) return [3 /*break*/, 5];
                return [4 /*yield*/, admin.database().ref("projects/".concat(projectId, "/sessions/").concat(activeSessionId)).get()];
            case 4:
                sessionSnap = _c.sent();
                if (sessionSnap.exists()) {
                    sourceLang = sessionSnap.val().sourceLanguage || 'ko';
                }
                _c.label = 5;
            case 5: return [3 /*break*/, 7];
            case 6:
                _a = _c.sent();
                return [3 /*break*/, 7];
            case 7: return [4 /*yield*/, admin.database().ref("projects/".concat(projectId, "/status")).update({ lastActive: Date.now() }).catch(function () { })];
            case 8:
                _c.sent();
                openai = void 0;
                try {
                    openai = getOpenAI();
                }
                catch (_d) {
                    res.status(500).json({ success: false });
                    return [2 /*return*/];
                }
                if (buf.length < 2000) {
                    res.status(200).json({ success: false, error: "TooSmall" });
                    return [2 /*return*/];
                }
                stt = void 0;
                _c.label = 9;
            case 9:
                _c.trys.push([9, 12, , 13]);
                audioStream = stream_1.Readable.from(buf);
                audioStream.path = "audio.webm";
                return [4 /*yield*/, openai.audio.transcriptions.create({
                        file: audioStream,
                        model: "whisper-1",
                        language: sourceLang, // LOCKED!
                        prompt: DENTAL_PROMPT,
                        temperature: 0
                    })];
            case 10:
                stt = _c.sent();
                return [4 /*yield*/, admin.database().ref("projects/".concat(projectId, "/status/services/openai")).set({ state: "ok", ts: Date.now() }).catch(function () { })];
            case 11:
                _c.sent();
                return [3 /*break*/, 13];
            case 12:
                _b = _c.sent();
                // Retry with mp4 ext if needed, but let's keep it simple for now
                res.status(200).json({ success: false, error: "WhisperFailed" });
                return [2 /*return*/];
            case 13:
                rawText = sanitize(((stt === null || stt === void 0 ? void 0 : stt.text) || "").trim());
                if (rawText.length < 2)
                    rawText = "";
                if (isLoopPattern(rawText)) {
                    res.status(200).json({ success: true, info: "LoopDropped" });
                    return [2 /*return*/];
                }
                if (!rawText) {
                    res.status(200).json({ success: true, info: "Empty" });
                    return [2 /*return*/];
                }
                id = "".concat(Date.now(), "_").concat(Math.random().toString(36).slice(2, 8));
                timestamp = Date.now();
                seqRef = admin.database().ref("projects/".concat(projectId, "/lastSequence"));
                return [4 /*yield*/, seqRef.transaction(function (current) {
                        return (current || 0) + 1;
                    })];
            case 14:
                seqResult = _c.sent();
                seq = seqResult.snapshot.val();
                return [4 /*yield*/, admin.database().ref("projects/".concat(projectId, "/stream/").concat(id)).set({
                        original: rawText,
                        status: "raw",
                        timestamp: timestamp,
                        sourceLabel: sourceLabel,
                        sessionId: activeSessionId,
                        seq: seq
                    })];
            case 15:
                _c.sent();
                return [4 /*yield*/, admin.database().ref("projects/".concat(projectId, "/state")).update({ lastText: rawText, lastId: id }).catch(function () { })];
            case 16:
                _c.sent();
                res.status(200).json({ success: true, id: id, text: rawText, stage: "original", timestamp: timestamp, version: versionTag });
                return [3 /*break*/, 18];
            case 17:
                e_2 = _c.sent();
                void e_2;
                res.status(500).json({ success: false, error: "Internal Error" });
                return [3 /*break*/, 18];
            case 18: return [2 /*return*/];
        }
    });
}); });
// 2. DB Trigger: Refine Text (Concurrency Safe & Dynamic Language)
exports.onRefineRequest = functions
    .runWith({ timeoutSeconds: 60, memory: "512MB" })
    .database.ref("projects/{projectId}/stream/{dataId}")
    .onCreate(function (snapshot, context) { return __awaiter(void 0, void 0, void 0, function () {
    var _a, projectId, dataId, val, rawText, projectRef, bufferText, bufferIds, lastGeminiTime, sessionContext, sourceLang, chunkSettings, activeSessionId, _b, stateSnap, activeSnap, settingsSnap, st, sessionSnap, s, _c, now, timeDiff, isSentenceEnd, isLongEnough, isTimeOut, shouldFlush, previousContext, snap, _d, refined, firstEn, firstJa, tGeminiStart, out, _err_1, updates, targetId, idsToDelete, targetSnap, tVal, tSeq, tSessionId, audioUrl, _e_1, _i, idsToDelete_1, pid;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                _a = context.params, projectId = _a.projectId, dataId = _a.dataId;
                val = snapshot.val();
                if (!val || val.status !== 'raw')
                    return [2 /*return*/];
                rawText = val.original;
                projectRef = admin.database().ref("projects/".concat(projectId));
                bufferText = "";
                bufferIds = [];
                lastGeminiTime = 0;
                sessionContext = "";
                sourceLang = "ko";
                chunkSettings = { minLength: 50, timeoutMs: 6000, sentenceEnd: true };
                activeSessionId = null;
                _f.label = 1;
            case 1:
                _f.trys.push([1, 5, , 6]);
                return [4 /*yield*/, Promise.all([
                        projectRef.child('state').get(),
                        projectRef.child('activeSessionId').get(),
                        projectRef.child('settings/chunk').get()
                    ])];
            case 2:
                _b = _f.sent(), stateSnap = _b[0], activeSnap = _b[1], settingsSnap = _b[2];
                if (stateSnap.exists()) {
                    st = stateSnap.val();
                    bufferText = (st.bufferText || "").toString();
                    bufferIds = (st.bufferIds || []);
                    lastGeminiTime = Number(st.lastGeminiTime || 0);
                }
                if (settingsSnap.exists()) {
                    chunkSettings = __assign(__assign({}, chunkSettings), settingsSnap.val());
                }
                if (!activeSnap.exists()) return [3 /*break*/, 4];
                activeSessionId = activeSnap.val();
                return [4 /*yield*/, projectRef.child("sessions/".concat(activeSessionId)).get()];
            case 3:
                sessionSnap = _f.sent();
                if (sessionSnap.exists()) {
                    s = sessionSnap.val();
                    sessionContext = "Speaker: ".concat(s.speaker, ", Topic: ").concat(s.topic, ", Abstract: ").concat(s.abstract, ", Keywords: ").concat(s.keywords);
                    sourceLang = s.sourceLanguage || "ko";
                }
                _f.label = 4;
            case 4: return [3 /*break*/, 6];
            case 5:
                _c = _f.sent();
                return [3 /*break*/, 6];
            case 6:
                bufferText = bufferText ? bufferText + " " + rawText : rawText;
                bufferIds.push(dataId);
                now = Date.now();
                timeDiff = now - lastGeminiTime;
                isSentenceEnd = chunkSettings.sentenceEnd && /[.!?]$/.test(rawText.trim());
                isLongEnough = bufferText.length >= chunkSettings.minLength;
                isTimeOut = timeDiff > chunkSettings.timeoutMs;
                shouldFlush = isSentenceEnd || isLongEnough || isTimeOut;
                if (!!shouldFlush) return [3 /*break*/, 8];
                return [4 /*yield*/, projectRef.child('state').update({ bufferText: bufferText, bufferIds: bufferIds })];
            case 7:
                _f.sent();
                return [2 /*return*/];
            case 8:
                functions.logger.info("Flushing Buffer", { projectId: projectId, lang: sourceLang, textLen: bufferText.length });
                previousContext = "";
                _f.label = 9;
            case 9:
                _f.trys.push([9, 11, , 12]);
                return [4 /*yield*/, projectRef.child('state/lastRefined').get()];
            case 10:
                snap = _f.sent();
                previousContext = (snap.val() || "").toString();
                return [3 /*break*/, 12];
            case 11:
                _d = _f.sent();
                void 0;
                return [3 /*break*/, 12];
            case 12:
                refined = bufferText;
                firstEn = "";
                firstJa = "";
                tGeminiStart = Date.now();
                _f.label = 13;
            case 13:
                _f.trys.push([13, 15, , 16]);
                return [4 /*yield*/, callGeminiREST(bufferText, previousContext, sessionContext, sourceLang)];
            case 14:
                out = _f.sent();
                refined = sanitize(out.refined || bufferText);
                firstEn = (out.en || "").toString();
                firstJa = (out.ja || "").toString();
                return [3 /*break*/, 16];
            case 15:
                _err_1 = _f.sent();
                void _err_1;
                refined = bufferText;
                return [3 /*break*/, 16];
            case 16:
                updates = {};
                targetId = bufferIds[0];
                idsToDelete = bufferIds.slice(1);
                updates["projects/".concat(projectId, "/stream/").concat(targetId, "/refined")] = refined;
                updates["projects/".concat(projectId, "/stream/").concat(targetId, "/en")] = firstEn;
                updates["projects/".concat(projectId, "/stream/").concat(targetId, "/ja")] = firstJa;
                updates["projects/".concat(projectId, "/stream/").concat(targetId, "/status")] = "final";
                updates["projects/".concat(projectId, "/stream/").concat(targetId, "/geminiMs")] = Date.now() - tGeminiStart;
                updates["projects/".concat(projectId, "/stream/").concat(targetId, "/mergedIds")] = idsToDelete;
                _f.label = 17;
            case 17:
                _f.trys.push([17, 21, , 22]);
                return [4 /*yield*/, admin.database().ref("projects/".concat(projectId, "/stream/").concat(targetId)).get()];
            case 18:
                targetSnap = _f.sent();
                if (!targetSnap.exists()) return [3 /*break*/, 20];
                tVal = targetSnap.val();
                tSeq = tVal.seq;
                tSessionId = tVal.sessionId || activeSessionId;
                if (!(tSeq && tSessionId)) return [3 /*break*/, 20];
                return [4 /*yield*/, generateTTS(refined, sourceLang, projectId, tSessionId, tSeq)];
            case 19:
                audioUrl = _f.sent();
                if (audioUrl) {
                    updates["projects/".concat(projectId, "/stream/").concat(targetId, "/audioUrl")] = audioUrl;
                }
                _f.label = 20;
            case 20: return [3 /*break*/, 22];
            case 21:
                _e_1 = _f.sent();
                functions.logger.error("TTS Gen Error (Refine)", _e_1 instanceof Error ? _e_1.message : 'Unknown error');
                return [3 /*break*/, 22];
            case 22:
                for (_i = 0, idsToDelete_1 = idsToDelete; _i < idsToDelete_1.length; _i++) {
                    pid = idsToDelete_1[_i];
                    updates["projects/".concat(projectId, "/stream/").concat(pid, "/status")] = "merged";
                    updates["projects/".concat(projectId, "/stream/").concat(pid, "/refined")] = "";
                }
                updates["projects/".concat(projectId, "/state/bufferText")] = "";
                updates["projects/".concat(projectId, "/state/bufferIds")] = [];
                updates["projects/".concat(projectId, "/state/lastGeminiTime")] = Date.now();
                updates["projects/".concat(projectId, "/state/lastRefined")] = refined;
                return [4 /*yield*/, admin.database().ref().update(updates)];
            case 23:
                _f.sent();
                return [2 /*return*/];
        }
    });
}); });
// 3. Scheduled Batch: Live Remastering (Every 2 minutes)
exports.remasterSession = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .pubsub.schedule("every 2 minutes").onRun(function (_context) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                void _context;
                return [4 /*yield*/, runRemasterLogic()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
// Manual Trigger for Remastering
exports.triggerRemaster = functions
    .runWith({ timeoutSeconds: 300, memory: "1GB" })
    .https.onRequest(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var projectId, count, e_3;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                res.set("Access-Control-Allow-Origin", "*");
                if (req.method === "OPTIONS") {
                    res.status(204).send("");
                    return [2 /*return*/];
                }
                _a.label = 1;
            case 1:
                _a.trys.push([1, 6, , 7]);
                projectId = (req.query.projectId || "").toString();
                count = 0;
                if (!!projectId) return [3 /*break*/, 3];
                return [4 /*yield*/, runRemasterLogic()];
            case 2:
                // If no project ID, run for all (batch mode) or error? 
                // Let's run the batch logic for simplicity
                count = (_a.sent()) || 0;
                return [3 /*break*/, 5];
            case 3: return [4 /*yield*/, runRemasterLogic(projectId)];
            case 4:
                // Run for specific project logic (simplified version of batch logic)
                count = (_a.sent()) || 0;
                _a.label = 5;
            case 5:
                res.json({ success: true, count: count });
                return [3 /*break*/, 7];
            case 6:
                e_3 = _a.sent();
                res.status(500).json({ success: false, error: e_3 instanceof Error ? e_3.message : 'Unknown error' });
                return [3 /*break*/, 7];
            case 7: return [2 /*return*/];
        }
    });
}); });
var runRemasterLogic = function (targetProjectId) { return __awaiter(void 0, void 0, void 0, function () {
    var now, projectsSnap, promises, processProject, results, totalCount;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                now = Date.now();
                if (!targetProjectId) return [3 /*break*/, 2];
                return [4 /*yield*/, admin.database().ref("projects/".concat(targetProjectId)).get()];
            case 1:
                projectsSnap = _a.sent();
                return [3 /*break*/, 4];
            case 2: return [4 /*yield*/, admin.database().ref('projects').get()];
            case 3:
                projectsSnap = _a.sent();
                _a.label = 4;
            case 4:
                if (!projectsSnap.exists())
                    return [2 /*return*/];
                promises = [];
                processProject = function (pSnap, pid) {
                    var pVal = pSnap.val();
                    var activeId = pVal.activeSessionId;
                    if (!activeId)
                        return;
                    // Determine Time Window
                    // Force Remaster: Always look back 60 minutes, ignoring lastRemasteredAt
                    // This ensures we always re-evaluate the recent context
                    var ONE_HOUR = 3600 * 1000;
                    var startTime = now - ONE_HOUR;
                    var endTime = now - 1000; // Up to 1 second ago
                    promises.push((function () { return __awaiter(void 0, void 0, void 0, function () {
                        var streamRef, q, streamSnap, items, streamVal, entries, _i, entries_1, _a, key, val, v, allItems, sessionInfo, contextText, sourceLang, inputList, prompt, apiKey, payload, res, data, outText, cleanText, refinedList, updates_1, _loop_1, _b, refinedList_1, item, maxTimestamp, e_4;
                        var _c, _d, _f, _g;
                        return __generator(this, function (_h) {
                            switch (_h.label) {
                                case 0:
                                    streamRef = admin.database().ref("projects/".concat(pid, "/stream"));
                                    q = streamRef.orderByChild('timestamp').startAt(startTime).endAt(endTime);
                                    return [4 /*yield*/, q.get()];
                                case 1:
                                    streamSnap = _h.sent();
                                    if (!streamSnap.exists())
                                        return [2 /*return*/, 0];
                                    items = [];
                                    streamVal = streamSnap.val() || {};
                                    entries = Object.entries(streamVal);
                                    for (_i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
                                        _a = entries_1[_i], key = _a[0], val = _a[1];
                                        v = val;
                                        if (v && v.sessionId === activeId && v.status === 'final') {
                                            items.push({ id: key, timestamp: v.timestamp, refined: v.refined, original: v.original, sessionId: v.sessionId });
                                        }
                                    }
                                    if (items.length === 0)
                                        return [2 /*return*/, 0]; // Nothing to update (Sweeping complete)
                                    allItems = items.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
                                    if (allItems.length < 3)
                                        return [2 /*return*/, 0];
                                    sessionInfo = ((_c = pVal.sessions) === null || _c === void 0 ? void 0 : _c[activeId]) || {};
                                    contextText = "Speaker: ".concat(sessionInfo.speaker, ", Topic: ").concat(sessionInfo.topic, ", Abstract: ").concat(sessionInfo.abstract);
                                    sourceLang = sessionInfo.sourceLanguage || 'ko';
                                    inputList = allItems.map(function (i) { return ({
                                        id: i.id,
                                        text: i.refined || i.original,
                                        // isTarget: !i.isRemastered // OLD LOGIC
                                        isTarget: true // FORCE LOGIC: Check everything in the window
                                    }); });
                                    prompt = "\n[TASK: REMASTER TRANSCRIPT]\n- Analyze the conversation list (JSON).\n- Focus on items where \"isTarget\": true.\n- Use context from other items to fix terminology and flow.\n- Output the updated list for TARGET items only.\n\n[REMASTERING RULES]\n1. Input Source Language: ".concat(sourceLang, "\n2. Target Languages: en, ja\n\n[OUTPUT FIELDS]\n- \"id\": The ID of the item being updated (The main sentence).\n- \"refined\": MUST BE in ").concat(sourceLang, ". Fix typos and grammar only. DO NOT TRANSLATE.\n- \"translations\": Object containing keys for each target language.\n- \"mergedIds\": Array of IDs that were merged/absorbed into this sentence. (These will be DELETED from the screen).\n\n[RULE]\n- If you combine multiple fragments into one complete sentence, use the ID of the FIRST fragment as the main \"id\", and list all other absorbed IDs in \"mergedIds\".\n\n[EXAMPLE]\nInput: \nItem 1 (ID: A): \"1, 2, 3\"\nItem 2 (ID: B): \"Hello\"\nItem 3 (ID: C): \"World\"\n(Source: en)\n\nOutput:\n[\n  {\n    \"id\": \"B\",\n    \"refined\": \"Hello World.\",\n    \"translations\": { \"ko\": \"\uC548\uB155 \uC138\uC0C1\uC544.\" },\n    \"mergedIds\": [\"A\", \"C\"] \n  }\n]\n\n[NOISE CLEANUP]\n- Remove non-lecture speech like microphone testing (\"1, 2, 3, 4\", \"Ah, ah\").\n- Fix obvious typos (\"\uB775 \uC9C4\uB8CC\" -> \"\uB8E8\uD2F4 \uC9C4\uB8CC\" or \"\uD575\uC2EC \uC9C4\uB8CC\" based on context).\n- If a sentence is broken, merge it with the next one to make a complete paragraph.\n- If the Korean sentence lacks a subject (e.g., \"\uAD8C\uACE0\uD569\uB2C8\uB2E4\"), add a proper subject like \"We recommend\" or \"It is recommended\" based on context.\n- Ensure the final English output forms complete, professional sentences suitable for a medical lecture.\n\n[Session Abstract]\n").concat(contextText, "\n\n[INPUT JSON]\n").concat(JSON.stringify(inputList), "\n");
                                    _h.label = 2;
                                case 2:
                                    _h.trys.push([2, 13, , 14]);
                                    apiKey = getGeminiKey();
                                    payload = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } };
                                    return [4 /*yield*/, fetch(GEMINI_PRO_URL(apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })];
                                case 3:
                                    res = _h.sent();
                                    if (!res.ok)
                                        return [2 /*return*/, 0];
                                    return [4 /*yield*/, res.json()];
                                case 4:
                                    data = _h.sent();
                                    outText = ((_g = (_f = (_d = (((data || {}).candidates || [])[0] || {}).content) === null || _d === void 0 ? void 0 : _d.parts) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.text) || "";
                                    if (!outText)
                                        return [2 /*return*/, 0];
                                    cleanText = outText.replace(/```json\s*|```/g, "").trim();
                                    refinedList = JSON.parse(cleanText);
                                    if (!Array.isArray(refinedList))
                                        return [2 /*return*/, 0];
                                    updates_1 = {};
                                    _loop_1 = function (item) {
                                        var originalItem, rSessionId, audioUrl, _e_2;
                                        return __generator(this, function (_j) {
                                            switch (_j.label) {
                                                case 0:
                                                    if (!item || !item.id)
                                                        return [2 /*return*/, "continue"];
                                                    originalItem = items.find(function (i) { return i.id === item.id; });
                                                    if (!(originalItem && item.refined)) return [3 /*break*/, 4];
                                                    // Safety Guard: Check if source language is preserved
                                                    if (sourceLang === 'ko' && !/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(item.refined)) {
                                                        functions.logger.warn("Safety Guard: Dropped English update for Korean field", item);
                                                        return [2 /*return*/, "continue"];
                                                    }
                                                    updates_1["projects/".concat(pid, "/stream/").concat(item.id, "/refined")] = sanitize(item.refined);
                                                    if (item.translations) {
                                                        if (item.translations.en)
                                                            updates_1["projects/".concat(pid, "/stream/").concat(item.id, "/en")] = sanitize(item.translations.en);
                                                        if (item.translations.ja)
                                                            updates_1["projects/".concat(pid, "/stream/").concat(item.id, "/ja")] = sanitize(item.translations.ja);
                                                    }
                                                    updates_1["projects/".concat(pid, "/stream/").concat(item.id, "/isRemastered")] = true;
                                                    // Handle Merged IDs (Delete them)
                                                    if (item.mergedIds && Array.isArray(item.mergedIds)) {
                                                        item.mergedIds.forEach(function (mid) {
                                                            if (mid !== item.id) { // Prevent self-deletion
                                                                updates_1["projects/".concat(pid, "/stream/").concat(mid)] = null; // Delete from DB
                                                            }
                                                        });
                                                    }
                                                    rSessionId = originalItem.sessionId;
                                                    if (!rSessionId) return [3 /*break*/, 4];
                                                    _j.label = 1;
                                                case 1:
                                                    _j.trys.push([1, 3, , 4]);
                                                    return [4 /*yield*/, generateTTS(sanitize(item.refined), sourceLang, pid, rSessionId, 0)];
                                                case 2:
                                                    audioUrl = _j.sent();
                                                    if (audioUrl) {
                                                        updates_1["projects/".concat(pid, "/stream/").concat(item.id, "/audioUrl")] = audioUrl;
                                                    }
                                                    return [3 /*break*/, 4];
                                                case 3:
                                                    _e_2 = _j.sent();
                                                    void _e_2;
                                                    return [3 /*break*/, 4];
                                                case 4: return [2 /*return*/];
                                            }
                                        });
                                    };
                                    _b = 0, refinedList_1 = refinedList;
                                    _h.label = 5;
                                case 5:
                                    if (!(_b < refinedList_1.length)) return [3 /*break*/, 8];
                                    item = refinedList_1[_b];
                                    return [5 /*yield**/, _loop_1(item)];
                                case 6:
                                    _h.sent();
                                    _h.label = 7;
                                case 7:
                                    _b++;
                                    return [3 /*break*/, 5];
                                case 8:
                                    maxTimestamp = 0;
                                    if (items.length > 0) {
                                        maxTimestamp = Math.max.apply(Math, items.map(function (i) { return i.timestamp || 0; }));
                                    }
                                    if (maxTimestamp > 0) {
                                        updates_1["projects/".concat(pid, "/settings/lastRemasteredAt")] = maxTimestamp;
                                    }
                                    if (!(Object.keys(updates_1).length > 0)) return [3 /*break*/, 10];
                                    return [4 /*yield*/, admin.database().ref().update(updates_1)];
                                case 9:
                                    _h.sent();
                                    functions.logger.info("Remastered ".concat(Object.keys(updates_1).length, " items for ").concat(pid));
                                    return [2 /*return*/, Object.keys(updates_1).length]; // Return count
                                case 10:
                                    if (!(maxTimestamp > 0)) return [3 /*break*/, 12];
                                    return [4 /*yield*/, admin.database().ref("projects/".concat(pid, "/settings/lastRemasteredAt")).set(maxTimestamp)];
                                case 11:
                                    _h.sent();
                                    _h.label = 12;
                                case 12: return [2 /*return*/, 0];
                                case 13:
                                    e_4 = _h.sent();
                                    functions.logger.error("Remaster Inner Error", e_4);
                                    throw new Error("Inner Error: ".concat(e_4 instanceof Error ? e_4.message : 'Unknown error'));
                                case 14: return [2 /*return*/];
                            }
                        });
                    }); })());
                };
                if (targetProjectId) {
                    processProject(projectsSnap, targetProjectId);
                }
                else {
                    projectsSnap.forEach(function (pSnap) { processProject(pSnap, pSnap.key); });
                }
                return [4 /*yield*/, Promise.all(promises)];
            case 5:
                results = _a.sent();
                totalCount = results.reduce(function (a, b) { return (a || 0) + (b || 0); }, 0);
                return [2 /*return*/, totalCount];
        }
    });
}); };
