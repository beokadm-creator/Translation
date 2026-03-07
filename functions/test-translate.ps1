# 영어 -> 한국어 번역 테스트
# 실행: powershell -ExecutionPolicy Bypass -File test-translate.ps1

$ApiKey = "AIzaSyAA6tsr0l11KlpiVNDCKEn4GNJRM9u962o"
$FlashUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=$ApiKey"
$ProUrl = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=$ApiKey"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "영어 -> 한국어 번역 테스트" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$results = @()

# 테스트 케이스
$testInput = "The patient has severe peri-implantitis."

# 프롬프트 변형
$prompts = @{
    "A-현재" = @"
You are an expert live captioning AI for medical/dental conferences.
SOURCE: en (English)
INPUT: "$testInput"
SESSION: Medical/Dental conference

TASKS:
1. REFINE: Fix errors in English. Correct dental terms. Keep English only.
2. TRANSLATE to: Korean
3. OUTPUT JSON ONLY.

CRITICAL: All language fields MUST be filled containing the translated text. Never return empty strings for translations.
FORMAT: {"refined": "...", "ko": "...Korean...", "isMedical": true}
"@

    "B-다국어" = @"
You are a professional translator for medical conferences.
Source: English | Target: Korean
Input: "$testInput"

Instructions:
1. First, refine the English text (fix errors, correct medical terms)
2. Then translate the refined text to Korean

한국어 번역 규칙 (Korean Translation Rules):
- 반드시 자연스러운 한국어로 번역하세요
- 의료/치과 용어는 정확한 한국어 전문 용어를 사용하세요
- 이 필드는 절대 비워두지 마세요
- 한 단어라도 반드시 번역하세요

Output JSON format only:
{"refined": "<English text>", "ko": "<Korean translation>", "isMedical": true/false}
"@

    "C-FewShot" = @"
You are a medical conference translator. Translate English to Korean.

Example 1:
Input: "The implant was placed successfully."
Output: {"refined": "The implant was placed successfully.", "ko": "임플란트가 성공적으로 식립되었습니다.", "isMedical": true}

Example 2:
Input: "Hello everyone."
Output: {"refined": "Hello everyone.", "ko": "여러분 안녕하세요.", "isMedical": false}

Now translate this:
Input: "$testInput"
Output:
"@

    "D-간결" = @"
Translate the following English text to Korean. Medical/dental context.

English: "$testInput"

Respond with JSON only: {"refined": "<English>", "ko": "<Korean>", "isMedical": boolean}
The "ko" field must contain the Korean translation. Never leave it empty.
"@

    "E-CoT" = @"
You are a medical translator. Think step by step.

Input: "$testInput"

Step 1: Identify the main content and any medical terms.
Step 2: Refine the English text if needed.
Step 3: Translate to natural Korean using appropriate medical terminology.
Step 4: Verify the Korean translation is complete and accurate.

Output JSON: {"refined": "...", "ko": "...", "isMedical": true/false}
"@
}

function Test-Gemini {
    param(
        [string]$Url,
        [string]$Prompt,
        [string]$ModelName,
        [string]$PromptName
    )
    
    $body = @{
        contents = @(
            @{
                parts = @(
                    @{
                        text = $Prompt
                    }
                )
            }
        )
        generationConfig = @{
            responseMimeType = "application/json"
        }
    } | ConvertTo-Json -Depth 10
    
    try {
        $startTime = Get-Date
        $response = Invoke-RestMethod -Uri $Url -Method Post -ContentType "application/json" -Body $body
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalMilliseconds
        
        $rawText = $response.candidates[0].content.parts[0].text
        $cleanText = $rawText -replace '```json\s*|```', ''
        $data = $cleanText | ConvertFrom-Json
        
        $hasKorean = $data.ko -match '[가-힣]'
        $koreanLength = if ($data.ko) { $data.ko.Length } else { 0 }
        
        return @{
            Success = $hasKorean -and $koreanLength -gt 0
            Model = $ModelName
            Prompt = $PromptName
            KoreanText = $data.ko
            Refined = $data.refined
            IsMedical = $data.isMedical
            Duration = [math]::Round($duration, 0)
            Error = $null
        }
    }
    catch {
        return @{
            Success = $false
            Model = $ModelName
            Prompt = $PromptName
            KoreanText = $null
            Refined = $null
            IsMedical = $null
            Duration = 0
            Error = $_.Exception.Message
        }
    }
}

# 테스트 실행
$testCases = @(
    @{ Model = "flash"; Url = $FlashUrl }
    @{ Model = "pro"; Url = $ProUrl }
)

$totalTests = $testCases.Count * $prompts.Count
$currentTest = 0

foreach ($testCase in $testCases) {
    foreach ($promptKey in $prompts.Keys) {
        $currentTest++
        Write-Host "[$currentTest/$totalTests] Testing: $($testCase.Model) + $promptKey" -ForegroundColor Yellow
        
        $result = Test-Gemini -Url $testCase.Url -Prompt $prompts[$promptKey] -ModelName $testCase.Model -PromptName $promptKey
        $results += $result
        
        if ($result.Success) {
            Write-Host "  ✅ SUCCESS" -ForegroundColor Green
            Write-Host "  Korean: $($result.KoreanText)" -ForegroundColor White
            Write-Host "  Time: $($result.Duration)ms" -ForegroundColor Gray
        }
        else {
            Write-Host "  ❌ FAILED" -ForegroundColor Red
            if ($result.Error) {
                Write-Host "  Error: $($result.Error)" -ForegroundColor Red
            }
            else {
                Write-Host "  Korean: (empty or no Hangul)" -ForegroundColor Red
            }
        }
        Write-Host ""
        
        Start-Sleep -Milliseconds 500
    }
}

# 요약
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "테스트 결과 요약" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 모델별 성공률
Write-Host "📊 모델별 성공률:" -ForegroundColor White
foreach ($model in @("flash", "pro")) {
    $modelResults = $results | Where-Object { $_.Model -eq $model }
    $successCount = ($modelResults | Where-Object { $_.Success }).Count
    $total = $modelResults.Count
    $rate = if ($total -gt 0) { [math]::Round(($successCount / $total) * 100, 1) } else { 0 }
    Write-Host "  $model : $successCount/$total ($rate%)" -ForegroundColor $(if ($rate -ge 80) { "Green" } elseif ($rate -ge 50) { "Yellow" } else { "Red" })
}
Write-Host ""

# 프롬프트별 성공률
Write-Host "📝 프롬프트별 성공률:" -ForegroundColor White
foreach ($promptKey in $prompts.Keys) {
    $promptResults = $results | Where-Object { $_.Prompt -eq $promptKey }
    $successCount = ($promptResults | Where-Object { $_.Success }).Count
    $total = $promptResults.Count
    $rate = if ($total -gt 0) { [math]::Round(($successCount / $total) * 100, 1) } else { 0 }
    Write-Host "  $promptKey : $successCount/$total ($rate%)" -ForegroundColor $(if ($rate -ge 80) { "Green" } elseif ($rate -ge 50) { "Yellow" } else { "Red" })
}
Write-Host ""

# 평균 응답 시간
Write-Host "⏱️ 모델별 평균 응답 시간:" -ForegroundColor White
foreach ($model in @("flash", "pro")) {
    $modelResults = $results | Where-Object { $_.Model -eq $model -and $_.Duration -gt 0 }
    if ($modelResults.Count -gt 0) {
        $avg = ($modelResults | Measure-Object -Property Duration -Average).Average
        Write-Host "  $model : $([math]::Round($avg, 0))ms" -ForegroundColor White
    }
}
Write-Host ""

# 최적 조합
Write-Host "🏆 최적 조합:" -ForegroundColor White
$successfulResults = $results | Where-Object { $_.Success }
if ($successfulResults.Count -gt 0) {
    # 모델+프롬프트 조합 분석
    $combos = @{}
    foreach ($r in $successfulResults) {
        $key = "$($r.Model)+$($r.Prompt)"
        if (-not $combos.ContainsKey($key)) {
            $combos[$key] = @{ Count = 0; TotalTime = 0 }
        }
        $combos[$key].Count++
        $combos[$key].TotalTime += $r.Duration
    }
    
    $sortedCombos = $combos.GetEnumerator() | Sort-Object { $_.Value.Count } -Descending
    
    foreach ($combo in $sortedCombos | Select-Object -First 3) {
        $avgTime = [math]::Round($combo.Value.TotalTime / $combo.Value.Count, 0)
        Write-Host "  $($combo.Key): $($combo.Value.Count)회 성공, 평균 ${avgTime}ms" -ForegroundColor Green
    }
}
else {
    Write-Host "  ❌ 모든 테스트 실패" -ForegroundColor Red
}
Write-Host ""

# 추천
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "📌 추천 설정" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$flashSuccess = ($results | Where-Object { $_.Model -eq "flash" -and $_.Success }).Count
$proSuccess = ($results | Where-Object { $_.Model -eq "pro" -and $_.Success }).Count

if ($proSuccess -gt $flashSuccess) {
    Write-Host "✅ 추천 모델: gemini-2.5-pro" -ForegroundColor Green
    Write-Host "   이유: 더 높은 번역 성공률 ($proSuccess vs $flashSuccess)" -ForegroundColor Gray
}
elseif ($flashSuccess -gt $proSuccess) {
    Write-Host "✅ 추천 모델: gemini-2.5-flash" -ForegroundColor Green
    Write-Host "   이유: 충분한 성공률 + 빠른 응답 ($flashSuccess vs $proSuccess)" -ForegroundColor Gray
}
else {
    Write-Host "✅ 추천 모델: gemini-2.5-flash" -ForegroundColor Green
    Write-Host "   이유: 동일한 성공률에서 비용 효율성" -ForegroundColor Gray
}
Write-Host ""

# 프롬프트 추천
$promptStats = @{}
foreach ($promptKey in $prompts.Keys) {
    $promptResults = $results | Where-Object { $_.Prompt -eq $promptKey }
    $successCount = ($promptResults | Where-Object { $_.Success }).Count
    $promptStats[$promptKey] = $successCount
}

$bestPrompt = $promptStats.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1
if ($bestPrompt.Value -gt 0) {
    Write-Host "✅ 추천 프롬프트: $($bestPrompt.Key)" -ForegroundColor Green
    Write-Host "   성공 횟수: $($bestPrompt.Value)" -ForegroundColor Gray
}
Write-Host ""
