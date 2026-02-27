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
const fs = __importStar(require("fs"));
const dotenv = __importStar(require("dotenv"));
const openai_1 = __importDefault(require("openai"));
// Load environment variables from .env file
dotenv.config();
// usage: npx ts-node src/scripts/test_whisper.ts <path-to-audio-file>
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
async function testWhisper(filePath) {
    if (!OPENAI_API_KEY) {
        console.error("❌ Error: OPENAI_API_KEY is not set in .env or environment.");
        process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
        console.error(`❌ Error: File not found at ${filePath}`);
        process.exit(1);
    }
    console.log(`🎧 Testing Whisper API with file: ${filePath}`);
    const openai = new openai_1.default({ apiKey: OPENAI_API_KEY });
    try {
        const start = Date.now();
        console.log("Sending request to OpenAI Whisper API...");
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-1",
        });
        const duration = Date.now() - start;
        console.log("\n✅ Whisper API Result:");
        console.log("---------------------------------------------------");
        console.log(transcription.text);
        console.log("---------------------------------------------------");
        console.log(`⏱️ Latency: ${duration}ms`);
    }
    catch (error) {
        console.error("❌ Whisper API Failed:", error);
    }
}
// Check for args
const args = process.argv.slice(2);
if (args.length > 0) {
    testWhisper(args[0]);
}
else {
    console.log("Usage: npx ts-node src/scripts/test_whisper.ts <path-to-audio-file>");
    console.log("Please provide a sample audio file (mp3/wav) to test.");
}
