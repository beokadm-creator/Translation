/**
 * 영어 → 한국어 번역 테스트
 * 실행: node test-translate.mjs
 */

const GEMINI_KEYS = [
    "AIzaSyAA6tsr0l11KlpiVNDCKEn4GNJRM9u962o",
    "AIzaSyAYO3OAfzPxa1kZGyPGOoJIbiRewaumVI8",
    "AIzaSyAMzzrp54aQywsPF-7BG4rPTkBVbda7jNc",
    "AIzaSyDMbGlFRZrVSJiUzwuWCTFT5gEjCEVbgIA",
];

const MODELS = {
    flash: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    pro: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`,
    flash15: (key) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
};

const TEST_INPUTS = [
    "Hello.",
    "Good morning everyone.",
    "The patient is doing well after the surgery.",
    "We will discuss implant placement today.",
    "The CBCT scan shows severe bone resorption around the implant fixture.",
];

const PROMPTS = {
    A: {
        name: "현재-영어프롬프트",
        build: (input) => `You are an expert live captioning AI for medical/dental conferences.
SOURCE: en (English)
INPUT: "${input}"
SESSION: Medical/Dental conference

TASKS:
1. REFINE: Fix errors in English. Correct dental terms. Keep English only.
2. TRANSLATE to: Korean
3. OUTPUT JSON ONLY.

CRITICAL: All language fields MUST be filled containing the translated text. Never return empty strings for translations.
FORMAT: {"refined": "...", "ko": "...Korean...", "isMedical": true}`,
    },
    B: {
        name: "다국어지시어",
        build: (input) => `You are a professional translator for medical conferences.
Source: English | Target: Korean
Input: "${input}"

Instructions:
1. First, refine the English text (fix errors, correct medical terms)
2. Then translate the refined text to Korean

한국어 번역 규칙 (Korean Translation Rules):
- 반드시 자연스러운 한국어로 번역하세요
- 의료/치과 용어는 정확한 한국어 전문 용어를 사용하세요
- 이 필드는 절대 비워두지 마세요
- 한 단어라도 반드시 번역하세요

Output JSON format only:
{"refined": "<English text>", "ko": "<Korean translation>", "isMedical": true/false}`,
    },
    C: {
        name: "FewShot예시",
        build: (input) => `You are a medical conference translator. Translate English to Korean.

Example 1:
Input: "The implant was placed successfully."
Output: {"refined": "The implant was placed successfully.", "ko": "임플란트가 성공적으로 식립되었습니다.", "isMedical": true}

Example 2:
Input: "Hello everyone."
Output: {"refined": "Hello everyone.", "ko": "여러분 안녕하세요.", "isMedical": false}

Now translate this:
Input: "${input}"
Output:`,
    },
    D: {
        name: "간결형",
        build: (input) => `Translate the following English text to Korean. Medical/dental context.

English: "${input}"

Respond with JSON only: {"refined": "<English>", "ko": "<Korean>", "isMedical": boolean}
The "ko" field must contain the Korean translation. Never leave it empty.`,
    },
    E: {
        name: "CoT단계별",
        build: (input) => `You are a medical translator. Think step by step.

Input: "${input}"

Step 1: Identify the main content and any medical terms.
Step 2: Refine the English text if needed.
Step 3: Translate to natural Korean using appropriate medical terminology.
Step 4: Verify the Korean translation is complete and accurate.

Output JSON: {"refined": "...", "ko": "...", "isMedical": true/false}`,
    },
};

async function callGemini(modelKey, prompt) {
    const key = GEMINI_KEYS[0];
    const url = MODELS[modelKey](key);
    
    const startTime = Date.now();
    
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" },
            }),
        });
        
        const duration = Date.now() - startTime;
        
        if (!res.ok) {
            return { success: false, duration, error: `HTTP ${res.status}` };
        }
        
        const json = await res.json();
        const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        
        if (!raw) {
            return { success: false, duration, error: "Empty response" };
        }
        
        const clean = raw.replace(/```json\s*|```/g, "").trim();
        const data = JSON.parse(clean);
        
        const hasKorean = data.ko && /[가-힣]/.test(data.ko) && data.ko.length > 0;
        
        return {
            success: hasKorean,
            duration,
            ko: data.ko || "",
            refined: data.refined || "",
            isMedical: data.isMedical,
        };
    } catch (e) {
        return { success: false, duration: Date.now() - startTime, error: e.message };
    }
}

async function main() {
    console.log("========================================");
    console.log("영어 → 한국어 번역 테스트");
    console.log("========================================\n");
    
    const results = [];
    
    // 테스트 구성
    const modelsToTest = ["flash", "pro"];
    const promptsToTest = ["A", "B", "C", "D", "E"];
    const inputsToTest = [0, 2, 3]; // Hello, 일반문장, 의료용어
    
    const total = modelsToTest.length * promptsToTest.length * inputsToTest.length;
    let current = 0;
    
    for (const modelKey of modelsToTest) {
        for (const promptKey of promptsToTest) {
            for (const inputIndex of inputsToTest) {
                current++;
                const input = TEST_INPUTS[inputIndex];
                const prompt = PROMPTS[promptKey].build(input);
                
                console.log(`[${current}/${total}] ${modelKey} + ${PROMPTS[promptKey].name}`);
                console.log(`   Input: "${input.slice(0, 40)}..."`);
                
                const result = await callGemini(modelKey, prompt);
                
                results.push({
                    model: modelKey,
                    prompt: promptKey,
                    inputIndex,
                    ...result,
                });
                
                if (result.success) {
                    console.log(`   ✅ SUCCESS (${result.duration}ms)`);
                    console.log(`   Korean: "${result.ko.slice(0, 60)}..."`);
                } else {
                    console.log(`   ❌ FAILED (${result.duration}ms)`);
                    if (result.error) console.log(`   Error: ${result.error}`);
                    else if (result.ko) console.log(`   Korean: "${result.ko.slice(0, 60)}..." (no Hangul)`);
                    else console.log(`   Korean: (empty)`);
                }
                console.log();
                
                await new Promise((r) => setTimeout(r, 300));
            }
        }
    }
    
    // 요약
    console.log("\n========================================");
    console.log("테스트 결과 요약");
    console.log("========================================\n");
    
    // 모델별
    console.log("📊 모델별 성공률:");
    for (const modelKey of modelsToTest) {
        const modelResults = results.filter((r) => r.model === modelKey);
        const successCount = modelResults.filter((r) => r.success).length;
        const rate = ((successCount / modelResults.length) * 100).toFixed(1);
        const color = rate >= 80 ? "✅" : rate >= 50 ? "⚠️" : "❌";
        console.log(`   ${color} ${modelKey}: ${successCount}/${modelResults.length} (${rate}%)`);
    }
    console.log();
    
    // 프롬프트별
    console.log("📝 프롬프트별 성공률:");
    for (const promptKey of promptsToTest) {
        const promptResults = results.filter((r) => r.prompt === promptKey);
        const successCount = promptResults.filter((r) => r.success).length;
        const rate = ((successCount / promptResults.length) * 100).toFixed(1);
        const color = rate >= 80 ? "✅" : rate >= 50 ? "⚠️" : "❌";
        console.log(`   ${color} ${PROMPTS[promptKey].name}: ${successCount}/${promptResults.length} (${rate}%)`);
    }
    console.log();
    
    // 평균 시간
    console.log("⏱️ 평균 응답 시간:");
    for (const modelKey of modelsToTest) {
        const modelResults = results.filter((r) => r.model === modelKey && r.duration > 0);
        const avg = modelResults.length > 0
            ? Math.round(modelResults.reduce((a, b) => a + b.duration, 0) / modelResults.length)
            : 0;
        console.log(`   ${modelKey}: ${avg}ms`);
    }
    console.log();
    
    // 최적 조합
    console.log("🏆 최적 조합:");
    const successful = results.filter((r) => r.success);
    if (successful.length > 0) {
        const comboMap = new Map();
        for (const r of successful) {
            const key = `${r.model}+${PROMPTS[r.prompt].name}`;
            if (!comboMap.has(key)) comboMap.set(key, { count: 0, totalTime: 0 });
            comboMap.get(key).count++;
            comboMap.get(key).totalTime += r.duration;
        }
        
        const sorted = Array.from(comboMap.entries()).sort((a, b) => b[1].count - a[1].count);
        for (const [key, val] of sorted.slice(0, 3)) {
            const avgTime = Math.round(val.totalTime / val.count);
            console.log(`   ✅ ${key}: ${val.count}회 성공, 평균 ${avgTime}ms`);
        }
    } else {
        console.log("   ❌ 모든 테스트 실패");
    }
    console.log();
    
    // 추천
    console.log("========================================");
    console.log("📌 추천 설정");
    console.log("========================================\n");
    
    const flashSuccess = results.filter((r) => r.model === "flash" && r.success).length;
    const proSuccess = results.filter((r) => r.model === "pro" && r.success).length;
    
    if (proSuccess > flashSuccess) {
        console.log("✅ 추천 모델: gemini-2.5-pro");
        console.log(`   이유: 더 높은 성공률 (${proSuccess} vs ${flashSuccess})`);
    } else if (flashSuccess > proSuccess) {
        console.log("✅ 추천 모델: gemini-2.5-flash");
        console.log(`   이유: 충분한 성공률 + 빠른 응답 (${flashSuccess} vs ${proSuccess})`);
    } else {
        console.log("✅ 추천 모델: gemini-2.5-flash");
        console.log("   이유: 동일한 성공률에서 비용 효율성");
    }
    console.log();
    
    // 프롬프트 추천
    const promptStats = {};
    for (const promptKey of promptsToTest) {
        promptStats[promptKey] = results.filter((r) => r.prompt === promptKey && r.success).length;
    }
    const bestPromptKey = Object.entries(promptStats).sort((a, b) => b[1] - a[1])[0];
    if (bestPromptKey[1] > 0) {
        console.log(`✅ 추천 프롬프트: ${PROMPTS[bestPromptKey[0]].name}`);
        console.log(`   성공 횟수: ${bestPromptKey[1]}`);
    }
}

main().catch(console.error);
