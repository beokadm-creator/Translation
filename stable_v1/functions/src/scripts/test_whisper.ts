import * as fs from 'fs';
import * as dotenv from 'dotenv';
import OpenAI from "openai";

// Load environment variables from .env file
dotenv.config();

// usage: npx ts-node src/scripts/test_whisper.ts <path-to-audio-file>

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

async function testWhisper(filePath: string) {
    if (!OPENAI_API_KEY) {
        console.error("❌ Error: OPENAI_API_KEY is not set in .env or environment.");
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`❌ Error: File not found at ${filePath}`);
        process.exit(1);
    }

    console.log(`🎧 Testing Whisper API with file: ${filePath}`);
    
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    
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

    } catch (error) {
        console.error("❌ Whisper API Failed:", error);
    }
}

// Check for args
const args = process.argv.slice(2);
if (args.length > 0) {
    testWhisper(args[0]);
} else {
    console.log("Usage: npx ts-node src/scripts/test_whisper.ts <path-to-audio-file>");
    console.log("Please provide a sample audio file (mp3/wav) to test.");
}
