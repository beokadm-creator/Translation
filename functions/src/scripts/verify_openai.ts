import * as dotenv from 'dotenv';
import OpenAI from "openai";

dotenv.config(); // Load .env file

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function verifyKey() {
    try {
        console.log("🔑 Verifying OpenAI API Key...");
        // Try a simple request
        const completion = await openai.chat.completions.create({
            messages: [{ role: "user", content: "Say 'Hello' if you can hear me." }],
            model: "gpt-3.5-turbo", // Use a cheap/standard model for verification
        });
        
        console.log("✅ API Key Verification Successful!");
        console.log("Response:", completion.choices[0].message.content);
        
        // Also list available models to see if we have access to whisper-1
        // const models = await openai.models.list();
        // const hasWhisper = models.data.some(m => m.id === 'whisper-1');
        // console.log("Whisper-1 Model Available:", hasWhisper ? "YES" : "NO");

    } catch (error: any) {
        console.error("❌ API Key Verification Failed:", error.message);
        if (error.code === 'invalid_api_key') {
             console.error("The provided API key is invalid.");
        }
    }
}

verifyKey();
