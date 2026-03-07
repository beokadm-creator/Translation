@echo off
chcp 65001 >nul
echo ========================================
echo 영어 -^> 한국어 번역 테스트
echo ========================================
echo.

set API_KEY=AIzaSyAA6tsr0l11KlpiVNDCKEn4GNJRM9u962o
set FLASH_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=%API_KEY%
set PRO_URL=https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=%API_KEY%

echo [TEST 1] gemini-2.5-flash + 현재 프롬프트
echo 입력: "The patient has severe peri-implantitis."
echo.

curl -s -X POST "%FLASH_URL%" ^
  -H "Content-Type: application/json" ^
  -d "{\"contents\":[{\"parts\":[{\"text\":\"You are an expert live captioning AI for medical/dental conferences. SOURCE: en (English). INPUT: \\\"The patient has severe peri-implantitis.\\\". TASKS: 1. REFINE in English. 2. TRANSLATE to Korean. 3. OUTPUT JSON ONLY. CRITICAL: The ko field MUST contain Korean translation. Never leave it empty. FORMAT: {\\\"refined\\\": \\\"...\\\", \\\"ko\\\": \\\"...Korean...\\\", \\\"isMedical\\\": true}\"}]}],\"generationConfig\":{\"responseMimeType\":\"application/json\"}}" > test_result_1.json

echo 결과:
type test_result_1.json
echo.
echo.

echo [TEST 2] gemini-2.5-pro + 현재 프롬프트
echo.

curl -s -X POST "%PRO_URL%" ^
  -H "Content-Type: application/json" ^
  -d "{\"contents\":[{\"parts\":[{\"text\":\"You are an expert live captioning AI for medical/dental conferences. SOURCE: en (English). INPUT: \\\"The patient has severe peri-implantitis.\\\". TASKS: 1. REFINE in English. 2. TRANSLATE to Korean. 3. OUTPUT JSON ONLY. CRITICAL: The ko field MUST contain Korean translation. Never leave it empty. FORMAT: {\\\"refined\\\": \\\"...\\\", \\\"ko\\\": \\\"...Korean...\\\", \\\"isMedical\\\": true}\"}]}],\"generationConfig\":{\"responseMimeType\":\"application/json\"}}" > test_result_2.json

echo 결과:
type test_result_2.json
echo.
echo.

echo [TEST 3] gemini-2.5-flash + 다국어 프롬프트
echo.

curl -s -X POST "%FLASH_URL%" ^
  -H "Content-Type: application/json" ^
  -d "{\"contents\":[{\"parts\":[{\"text\":\"Translate English to Korean for medical conference. Input: \\\"The patient has severe peri-implantitis.\\\" 한국어 번역 필수: 반드시 자연스러운 한국어로 번역하세요. 의료 용어는 정확한 한국어 전문 용어를 사용하세요. 이 필드는 절대 비워두지 마세요. Output JSON: {\\\"refined\\\": \\\"<English>\\\", \\\"ko\\\": \\\"<Korean>\\\", \\\"isMedical\\\": boolean}\"}]}],\"generationConfig\":{\"responseMimeType\":\"application/json\"}}" > test_result_3.json

echo 결과:
type test_result_3.json
echo.
echo.

echo [TEST 4] gemini-2.5-flash + Few-shot 예시
echo.

curl -s -X POST "%FLASH_URL%" ^
  -H "Content-Type: application/json" ^
  -d "{\"contents\":[{\"parts\":[{\"text\":\"Medical translator. Translate English to Korean. Example 1: Input: 'Hello.' Output: {\\\"refined\\\": \\\"Hello.\\\", \\\"ko\\\": \\\"안녕하세요.\\\", \\\"isMedical\\\": false}. Example 2: Input: 'The implant was placed.' Output: {\\\"refined\\\": \\\"The implant was placed.\\\", \\\"ko\\\": \\\"임플란트가 식립되었습니다.\\\", \\\"isMedical\\\": true}. Now translate: Input: 'The patient has severe peri-implantitis.' Output:\"}]}],\"generationConfig\":{\"responseMimeType\":\"application/json\"}}" > test_result_4.json

echo 결과:
type test_result_4.json
echo.
echo.

echo [TEST 5] gemini-2.5-flash + 간단한 프롬프트
echo.

curl -s -X POST "%FLASH_URL%" ^
  -H "Content-Type: application/json" ^
  -d "{\"contents\":[{\"parts\":[{\"text\":\"Translate to Korean: The patient has severe peri-implantitis. JSON: {\\\"refined\\\": \\\"...\\\", \\\"ko\\\": \\\"...\\\"}\"}]}],\"generationConfig\":{\"responseMimeType\":\"application/json\"}}" > test_result_5.json

echo 결과:
type test_result_5.json
echo.
echo.

echo ========================================
echo 테스트 완료
echo ========================================
pause
