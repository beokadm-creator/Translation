"use strict";
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
var express_1 = require("express");
var multer_1 = require("multer");
var promises_1 = require("fs/promises");
var fs_1 = require("fs");
var path_1 = require("path");
var openai_1 = require("openai");
var generative_ai_1 = require("@google/generative-ai");
var url_1 = require("url");
var __filename = (0, url_1.fileURLToPath)(import.meta.url);
var __dirname = path_1.default.dirname(__filename);
var router = express_1.default.Router();
// Configure multer for file upload
var upload = (0, multer_1.default)({
    dest: path_1.default.join(__dirname, '../../tmp/audio'),
    limits: { fileSize: 10 * 1024 * 1024 },
});
// Initialize clients lazily when needed
var openai = null;
var genAI = null;
function getOpenAIClient() {
    if (!openai) {
        var apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey)
            throw new Error('OPENAI_API_KEY environment variable is not set');
        openai = new openai_1.default({ apiKey: apiKey });
    }
    return openai;
}
function getGeminiClient() {
    if (!genAI) {
        var apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            throw new Error('GEMINI_API_KEY environment variable is not set');
        genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    }
    return genAI;
}
// Dental terminology correction prompt
var DENTAL_CORRECTION_PROMPT = "치과 전문 학술 강연입니다. 임플란트, 상악동 거상술, 사이너스, Sinus Graft, 픽스처, 어버트먼트, 크라운, 브릿지, 파절, 치주염 등 의학 전문 용어를 한글과 영어로 정확히 인식하세요.";
// Ensure temp directory exists
function ensureTempDir() {
    return __awaiter(this, void 0, void 0, function () {
        var tempDir, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    tempDir = path_1.default.join(__dirname, '../../tmp/audio');
                    _b.label = 1;
                case 1:
                    _b.trys.push([1, 3, , 5]);
                    return [4 /*yield*/, promises_1.default.access(tempDir)];
                case 2:
                    _b.sent();
                    return [3 /*break*/, 5];
                case 3:
                    _a = _b.sent();
                    return [4 /*yield*/, promises_1.default.mkdir(tempDir, { recursive: true })];
                case 4:
                    _b.sent();
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
// POST /api/audio/upload
router.post('/upload', upload.single('audio'), function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var audioFile, audioBuffer, webmPath, openaiClient, transcription, transcript, corrected, geminiClient, model, result, response, geminiError_1, cleanupError_1, error_1, cleanupError_2;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                _b.trys.push([0, 14, , 19]);
                return [4 /*yield*/, ensureTempDir()];
            case 1:
                _b.sent();
                if (!req.file) {
                    return [2 /*return*/, res.status(400).json({ success: false, error: 'No audio file provided' })];
                }
                audioFile = req.file;
                return [4 /*yield*/, promises_1.default.readFile(audioFile.path)];
            case 2:
                audioBuffer = _b.sent();
                webmPath = path_1.default.join(__dirname, '../../tmp/audio', "audio.webm");
                return [4 /*yield*/, promises_1.default.writeFile(webmPath, audioBuffer)
                    // Step 1: Whisper STT with Korean language
                ];
            case 3:
                _b.sent();
                openaiClient = getOpenAIClient();
                return [4 /*yield*/, openaiClient.audio.transcriptions.create({
                        file: (0, fs_1.createReadStream)(webmPath),
                        model: 'whisper-1',
                        language: 'ko',
                        prompt: DENTAL_CORRECTION_PROMPT,
                        response_format: 'text',
                        temperature: 0
                    })];
            case 4:
                transcription = _b.sent();
                transcript = transcription;
                corrected = '';
                _b.label = 5;
            case 5:
                _b.trys.push([5, 8, , 9]);
                geminiClient = getGeminiClient();
                model = geminiClient.getGenerativeModel({ model: 'gemini-pro' });
                return [4 /*yield*/, model.generateContent([
                        DENTAL_CORRECTION_PROMPT,
                        transcript
                    ])];
            case 6:
                result = _b.sent();
                return [4 /*yield*/, result.response];
            case 7:
                response = _b.sent();
                corrected = response.text();
                return [3 /*break*/, 9];
            case 8:
                geminiError_1 = _b.sent();
                console.error('Gemini correction failed:', geminiError_1);
                // Fallback: use original transcript if Gemini fails
                corrected = transcript;
                return [3 /*break*/, 9];
            case 9:
                _b.trys.push([9, 12, , 13]);
                return [4 /*yield*/, promises_1.default.unlink(audioFile.path)];
            case 10:
                _b.sent();
                return [4 /*yield*/, promises_1.default.unlink(webmPath)];
            case 11:
                _b.sent();
                return [3 /*break*/, 13];
            case 12:
                cleanupError_1 = _b.sent();
                console.error('Failed to cleanup temp files:', cleanupError_1);
                return [3 /*break*/, 13];
            case 13:
                res.json({
                    success: true,
                    transcript: transcript,
                    corrected: corrected,
                    timestamp: new Date().toISOString()
                });
                return [3 /*break*/, 19];
            case 14:
                error_1 = _b.sent();
                console.error('Audio upload error:', error_1);
                if (!((_a = req.file) === null || _a === void 0 ? void 0 : _a.path)) return [3 /*break*/, 18];
                _b.label = 15;
            case 15:
                _b.trys.push([15, 17, , 18]);
                return [4 /*yield*/, promises_1.default.unlink(req.file.path)];
            case 16:
                _b.sent();
                return [3 /*break*/, 18];
            case 17:
                cleanupError_2 = _b.sent();
                console.error('Failed to cleanup temp file on error:', cleanupError_2);
                return [3 /*break*/, 18];
            case 18:
                res.status(500).json({ success: false, error: 'Failed to process audio file' });
                return [3 /*break*/, 19];
            case 19: return [2 /*return*/];
        }
    });
}); });
exports.default = router;
