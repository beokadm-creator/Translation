import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from functions root
const envPath = path.resolve(__dirname, '../../.env');
console.log(`Loading .env from: ${envPath}`);
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.error("Error loading .env file:", result.error);
}

console.log("---------------------------------------------------");
console.log("             API KEY DIAGNOSIS (DRY RUN)           ");
console.log("---------------------------------------------------");

const openaiKey = process.env.OPENAI_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

console.log(`[OPENAI_API_KEY] Status: ${openaiKey ? "PRESENT" : "MISSING"}`);
if (openaiKey) {
    console.log(`[OPENAI_API_KEY] Value: ${openaiKey.substring(0, 8)}...${openaiKey.substring(openaiKey.length - 4)}`);
}

console.log(`[GEMINI_API_KEY] Status: ${geminiKey ? "PRESENT" : "MISSING"}`);
if (geminiKey) {
    console.log(`[GEMINI_API_KEY] Value: ${geminiKey.substring(0, 8)}...${geminiKey.substring(geminiKey.length - 4)}`);
} else {
    console.error("CRITICAL: GEMINI_API_KEY is missing! AI Refinement will fail.");
}

console.log("---------------------------------------------------");

if (openaiKey && geminiKey) {
    console.log("SUCCESS: Both keys are present. 'Collision' is unlikely unless code uses wrong var.");
} else {
    console.log("FAILURE: One or more keys are missing.");
}
