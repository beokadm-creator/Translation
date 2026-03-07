/**
 * 영어 → 한국어 번역 테스트 스크립트
 * 사용법: npx ts-node test-translate.ts
 * 
 * 테스트 시나리오:
 * 1. 모델 비교 (flash vs pro)
 * 2. 프롬프트 구조 비교
 * 3. 입력 유형별 테스트
 */

const GEMINI_KEYS = [
    "AIzaSyAA6tsr0l11KlpiVNDCKEn4GNJRM9u962o",
    "AIzaSyAYO3OAfzPxa1kZGyPGOoJIbiRewaumVI8",
    "AIzaSyAMzzrp54aQywsPF-7BG4rPTkBVbda7jNc",
    "AIzaSyDMbGlFRZrVSJiUzwuWCTFT5gEjCEVbgIA",
]

// 테스트 케이스
const TEST_CASES = [
    { name: "1단어-일반", input: "Hello.", expected: "안녕하세요." },
    { name: "짧은문장-일반", input: "Good morning everyone.", expected: "여러분 좋은 아침입니다." },
    { name: "일반문장", input: "The patient is doing well after the surgery.", expected: "환자는 수술 후 잘 회복하고 있습니다." },
    { name: "의료용어-간단", input: "We will discuss implant placement today.", expected: "오늘 임플란트 식립에 대해 논의하겠습니다." },
    { name: "의료용어-복합", input: "The CBCT scan shows severe bone resorption around the implant fixture.", expected: "CBCT 스캔에서 임플란트 픽스처 주변의 심한 골흡수가 관찰됩니다." },
    { name: "긴문장", input: "In this presentation, I will discuss the latest advances in guided bone regeneration techniques for maxillary sinus augmentation procedures.", expected: "이 발표에서는 상악동 거상술을 위한 유도 골재생 기술의 최신 발전 사항에 대해 논의하겠습니다." },
]

// 프롬프트 변형
const PROMPT_VARIANTS = {
    A: {
        name: "현재-영어프롬프트",
        build: (input: string) => [
            `You are an expert live captioning AI for medical/dental conferences.`,
            `SOURCE: en (English)`,
            `INPUT: "${input}"`,
            `SESSION: Medical/Dental conference`,
            ``,
            `TASKS:`,
            `1. REFINE: Fix errors in English. Correct dental terms. Keep English only.`,
            `2. TRANSLATE to: Korean`,
            `3. OUTPUT JSON ONLY.`,
            ``,
            `CRITICAL: All language fields MUST be filled containing the translated text. Never return empty strings for translations.`,
            `FORMAT: {"refined": "...", "ko": "...Korean...", "isMedical": true}`
        ].join('\n')
    },
    B: {
        name: "다국어지시어",
        build: (input: string) => [
            `You are a professional translator for medical conferences.`,
            `Source: English | Target: Korean`,
            `Input: "${input}"`,
            ``,
            `Instructions:`,
            `1. First, refine the English text (fix errors, correct medical terms)`,
            `2. Then translate the refined text to Korean`,
            ``,
            `한국어 번역 규칙 (Korean Translation Rules):`,
            `- 반드시 자연스러운 한국어로 번역하세요`,
            `- 의료/치과 용어는 정확한 한국어 전문 용어를 사용하세요`,
            `- 이 필드는 절대 비워두지 마세요`,
            `- 한 단어라도 반드시 번역하세요`,
            ``,
            `Output JSON format only:`,
            `{"refined": "<English text>", "ko": "<Korean translation>", "isMedical": true/false}`
        ].join('\n')
    },
    C: {
        name: "Few-shot예시",
        build: (input: string) => [
            `You are a medical conference translator. Translate English to Korean.`,
            ``,
            `Example 1:`,
            `Input: "The implant was placed successfully."`,
            `Output: {"refined": "The implant was placed successfully.", "ko": "임플란트가 성공적으로 식립되었습니다.", "isMedical": true}`,
            ``,
            `Example 2:`,
            `Input: "Hello everyone."`,
            `Output: {"refined": "Hello everyone.", "ko": "여러분 안녕하세요.", "isMedical": false}`,
            ``,
            `Now translate this:`,
            `Input: "${input}"`,
            `Output:`
        ].join('\n')
    },
    D: {
        name: "간결형",
        build: (input: string) => [
            `Translate the following English text to Korean.`,
            `Medical/dental context.`,
            ``,
            `English: "${input}"`,
            ``,
            `Respond with JSON only: {"refined": "<English>", "ko": "<Korean>", "isMedical": boolean}`,
            `The "ko" field must contain the Korean translation. Never leave it empty.`
        ].join('\n')
    },
    E: {
        name: "Chain-of-Thought",
        build: (input: string) => [
            `You are a medical translator. Think step by step.`,
            ``,
            `Input: "${input}"`,
            ``,
            `Step 1: Identify the main content and any medical terms.`,
            `Step 2: Refine the English text if needed.`,
            `Step 3: Translate to natural Korean using appropriate medical terminology.`,
            `Step 4: Verify the Korean translation is complete and accurate.`,
            ``,
            `Output JSON: {"refined": "...", "ko": "...", "isMedical": true/false}`
        ].join('\n')
    }
}

// 모델 URL
const MODEL_URLS = {
    flash: (key: string) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    pro: (key: string) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`,
    flash15: (key: string) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`,
}

interface TestResult {
    model: string
    prompt: string
    testCase: string
    input: string
    success: boolean
    hasKorean: boolean
    koreanText: string
    responseTime: number
    error?: string
}

// Gemini API 호출
async function callGemini(
    model: 'flash' | 'pro' | 'flash15',
    prompt: string,
    keyIndex: number = 0
): Promise<{ data: any | null; responseTime: number; error?: string }> {
    const key = GEMINI_KEYS[keyIndex % GEMINI_KEYS.length]
    const url = MODEL_URLS[model](key)
    
    const startTime = Date.now()
    
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        })
        
        const responseTime = Date.now() - startTime
        
        if (!res.ok) {
            return { data: null, responseTime, error: `HTTP ${res.status}` }
        }
        
        const json = await res.json()
        const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
        
        if (!raw) {
            return { data: null, responseTime, error: 'Empty response' }
        }
        
        const clean = raw.replace(/```json\s*|```/g, '').trim()
        const data = JSON.parse(clean)
        
        return { data, responseTime }
    } catch (e: any) {
        return { data: null, responseTime: Date.now() - startTime, error: e.message }
    }
}

// 한국어 포함 여부 확인
function hasKorean(text: string): boolean {
    return /[가-힣]/.test(text)
}

// 결과 출력
function printResult(result: TestResult) {
    const status = result.success ? '✅' : '❌'
    const korean = result.hasKorean ? '🇰🇷' : '⚠️'
    
    console.log(`${status} [${result.model}] [${result.prompt}] [${result.testCase}]`)
    console.log(`   Input: "${result.input.slice(0, 50)}..."`)
    console.log(`   Korean (${korean}): "${result.koreanText.slice(0, 80)}..."`)
    console.log(`   Time: ${result.responseTime}ms`)
    if (result.error) {
        console.log(`   Error: ${result.error}`)
    }
    console.log()
}

// 메인 테스트 실행
async function runTests() {
    console.log('========================================')
    console.log('영어 → 한국어 번역 테스트 시작')
    console.log('========================================\n')
    
    const results: TestResult[] = []
    
    // 테스트할 조합 선택 (시간 단축을 위해 일부만 테스트)
    const modelsToTest: ('flash' | 'pro' | 'flash15')[] = ['flash', 'pro']
    const promptsToTest = ['A', 'B', 'C', 'D'] as const
    const casesToTest = [0, 2, 3, 5] // 1단어, 일반문장, 의료용어-간단, 긴문장
    
    let total = modelsToTest.length * promptsToTest.length * casesToTest.length
    let current = 0
    
    console.log(`총 테스트 케이스: ${total}개\n`)
    
    for (const model of modelsToTest) {
        for (const promptKey of promptsToTest) {
            const promptVariant = PROMPT_VARIANTS[promptKey]
            
            for (const caseIndex of casesToTest) {
                const testCase = TEST_CASES[caseIndex]
                current++
                
                console.log(`[${current}/${total}] Testing: ${model} + ${promptVariant.name} + ${testCase.name}`)
                
                const prompt = promptVariant.build(testCase.input)
                const { data, responseTime, error } = await callGemini(model, prompt, 0)
                
                const result: TestResult = {
                    model,
                    prompt: promptKey,
                    testCase: testCase.name,
                    input: testCase.input,
                    success: false,
                    hasKorean: false,
                    koreanText: '',
                    responseTime,
                    error
                }
                
                if (data && !error) {
                    result.koreanText = data.ko || ''
                    result.hasKorean = hasKorean(result.koreanText) && result.koreanText.length > 0
                    result.success = result.hasKorean
                }
                
                results.push(result)
                printResult(result)
                
                // API 속도 제한 방지
                await new Promise(r => setTimeout(r, 500))
            }
        }
    }
    
    // 요약 통계
    console.log('\n========================================')
    console.log('테스트 결과 요약')
    console.log('========================================\n')
    
    // 모델별 성공률
    console.log('📊 모델별 성공률:')
    for (const model of modelsToTest) {
        const modelResults = results.filter(r => r.model === model)
        const success = modelResults.filter(r => r.success).length
        const rate = ((success / modelResults.length) * 100).toFixed(1)
        console.log(`   ${model}: ${success}/${modelResults.length} (${rate}%)`)
    }
    console.log()
    
    // 프롬프트별 성공률
    console.log('📝 프롬프트별 성공률:')
    for (const promptKey of promptsToTest) {
        const promptResults = results.filter(r => r.prompt === promptKey)
        const success = promptResults.filter(r => r.success).length
        const rate = ((success / promptResults.length) * 100).toFixed(1)
        console.log(`   ${PROMPT_VARIANTS[promptKey].name}: ${success}/${promptResults.length} (${rate}%)`)
    }
    console.log()
    
    // 모델별 평균 응답 시간
    console.log('⏱️ 모델별 평균 응답 시간:')
    for (const model of modelsToTest) {
        const modelResults = results.filter(r => r.model === model && r.responseTime > 0)
        const avg = modelResults.length > 0 
            ? Math.round(modelResults.reduce((a, b) => a + b.responseTime, 0) / modelResults.length)
            : 0
        console.log(`   ${model}: ${avg}ms`)
    }
    console.log()
    
    // 최적 조합 찾기
    console.log('🏆 최적 조합 (성공한 경우):')
    const successful = results.filter(r => r.success)
    if (successful.length > 0) {
        // 모델+프롬프트 조합별 성공 횟수
        const comboMap = new Map<string, { model: string; prompt: string; count: number; avgTime: number }>()
        
        for (const r of successful) {
            const key = `${r.model}-${r.prompt}`
            const existing = comboMap.get(key)
            if (existing) {
                existing.count++
                existing.avgTime = (existing.avgTime + r.responseTime) / 2
            } else {
                comboMap.set(key, { model: r.model, prompt: r.prompt, count: 1, avgTime: r.responseTime })
            }
        }
        
        const sorted = Array.from(comboMap.values()).sort((a, b) => b.count - a.count)
        
        for (const combo of sorted.slice(0, 3)) {
            console.log(`   ${combo.model} + ${PROMPT_VARIANTS[combo.prompt as keyof typeof PROMPT_VARIANTS].name}: ${combo.count}회 성공, 평균 ${Math.round(combo.avgTime)}ms`)
        }
    } else {
        console.log('   ❌ 모든 테스트 실패')
    }
    console.log()
    
    // 추천 설정
    console.log('========================================')
    console.log('📌 추천 설정')
    console.log('========================================\n')
    
    const flashSuccess = results.filter(r => r.model === 'flash' && r.success).length
    const proSuccess = results.filter(r => r.model === 'pro' && r.success).length
    
    if (proSuccess > flashSuccess) {
        console.log('✅ 추천 모델: gemini-2.5-pro')
        console.log('   이유: 더 높은 번역 성공률')
    } else if (flashSuccess > proSuccess) {
        console.log('✅ 추천 모델: gemini-2.5-flash')
        console.log('   이유: 충분한 성공률 + 빠른 응답')
    } else {
        console.log('✅ 추천 모델: gemini-2.5-flash')
        console.log('   이유: 비용 효율성')
    }
    console.log()
    
    // 프롬프트 추천
    const promptSuccess = Array.from(promptsToTest).map(p => ({
        key: p,
        name: PROMPT_VARIANTS[p].name,
        count: results.filter(r => r.prompt === p && r.success).length
    })).sort((a, b) => b.count - a.count)
    
    if (promptSuccess[0].count > 0) {
        console.log(`✅ 추천 프롬프트: ${promptSuccess[0].name}`)
        console.log(`   성공 횟수: ${promptSuccess[0].count}/${casesToTest.length * modelsToTest.length}`)
    }
}

// 실행
runTests().catch(console.error)
