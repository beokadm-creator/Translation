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
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
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
