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
exports.synthesizeSpeech = void 0;
const functions = __importStar(require("firebase-functions/v1"));
const openai_1 = __importDefault(require("openai"));
let _openai = null;
const getOpenAI = () => {
    if (!_openai) {
        const apiKey = process.env.OPENAI_API_KEY || functions.config()?.openai?.key || "";
        if (!apiKey)
            throw new Error("OPENAI_API_KEY missing");
        _openai = new openai_1.default({ apiKey });
    }
    return _openai;
};
// ─────────────────────────────────────────────────────────────────────────────
// synthesizeSpeech — OpenAI tts-1 → MP3 오디오 스트림 반환
// 인증 불필요 (번역 결과를 읽어주는 공개 기능)
// ─────────────────────────────────────────────────────────────────────────────
exports.synthesizeSpeech = functions
    .runWith({ timeoutSeconds: 30, memory: "256MB" })
    .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-Target-Languages");
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    try {
        const text = (req.query.text || "").toString().slice(0, 1000).trim();
        const lang = (req.query.lang || "ko").toString();
        const speedParam = parseFloat((req.query.speed || "1.0").toString());
        const speed = Math.min(2.0, Math.max(0.25, isNaN(speedParam) ? 1.0 : speedParam));
        if (!text) {
            res.status(400).json({ error: "text required" });
            return;
        }
        // 음성 선택: 클라이언트에서 voice 파라미터 전달 가능 (nova/shimmer/onyx/echo/alloy/fable)
        const voiceParam = (req.query.voice || "").toString();
        const defaultVoice = lang === "ko" ? "nova" : "alloy";
        const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
        const voice = VALID_VOICES.includes(voiceParam) ? voiceParam : defaultVoice;
        const openai = getOpenAI();
        const response = await openai.audio.speech.create({
            model: "tts-1",
            voice,
            input: text,
            response_format: "mp3",
            speed,
        });
        const buffer = Buffer.from(await response.arrayBuffer());
        // 동일 텍스트 반복 요청 최소화를 위해 5분 캐시
        res.set("Content-Type", "audio/mpeg");
        res.set("Cache-Control", "public, max-age=300");
        res.send(buffer);
        functions.logger.info("[TTS] OK", {
            lang,
            chars: text.length,
            speed,
            voice,
        });
    }
    catch (e) {
        functions.logger.error("[TTS] Error", { err: String(e).slice(0, 200) });
        res.status(500).json({ error: "TTS failed" });
    }
});
