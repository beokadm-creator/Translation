"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var dotenv = require("dotenv");
var path = require("path");
// Load .env from functions root
var envPath = path.resolve(__dirname, '../../.env');
console.log("Loading .env from: ".concat(envPath));
var result = dotenv.config({ path: envPath });
if (result.error) {
    console.error("Error loading .env file:", result.error);
}
console.log("---------------------------------------------------");
console.log("             API KEY DIAGNOSIS (DRY RUN)           ");
console.log("---------------------------------------------------");
var openaiKey = process.env.OPENAI_API_KEY;
var geminiKey = process.env.GEMINI_API_KEY;
console.log("[OPENAI_API_KEY] Status: ".concat(openaiKey ? "PRESENT" : "MISSING"));
if (openaiKey) {
    console.log("[OPENAI_API_KEY] Value: ".concat(openaiKey.substring(0, 8), "...").concat(openaiKey.substring(openaiKey.length - 4)));
}
console.log("[GEMINI_API_KEY] Status: ".concat(geminiKey ? "PRESENT" : "MISSING"));
if (geminiKey) {
    console.log("[GEMINI_API_KEY] Value: ".concat(geminiKey.substring(0, 8), "...").concat(geminiKey.substring(geminiKey.length - 4)));
}
else {
    console.error("CRITICAL: GEMINI_API_KEY is missing! AI Refinement will fail.");
}
console.log("---------------------------------------------------");
if (openaiKey && geminiKey) {
    console.log("SUCCESS: Both keys are present. 'Collision' is unlikely unless code uses wrong var.");
}
else {
    console.log("FAILURE: One or more keys are missing.");
}
