# Language Expansion, Persona Management & Performance Optimization

## TL;DR
> **Summary**: Add Japanese(ja) and Simplified Chinese(zh-CN) translation to the real-time medical conference pipeline, implement per-Hall AI persona management stored in RTDB, and optimize frontend rendering for frequent RTDB updates.
> **Deliverables**: Dynamic multi-language translation backend, persona CRUD UI in admin dashboard, throttled frontend rendering with stable re-render patterns
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: T1 → T5 → T6/T7/T8, T3 → T9

## Context
### Original Request
세 가지 개선 사항: 1) 일본어/중국어 번역 파이프라인 확장, 2) Hall 단위 AI 페르소나 관리 기능, 3) 프론트엔드 렌더링 성능 최적화.

### Interview Summary
- 중국어는 간체(zh-CN) 단일 지원
- 페르소나는 RTDB `/projects/{projectId}/settings/persona` 하위 확장
- 테스트 프레임워크 없이 진행, QA 시나리오만 포함
- 3개 작업 스트림 병렬 Wave 진행

### Gap Analysis (self-performed — Metis unavailable)
1. **동적 타겟 언어 보장**: ko/en 고정 관념을 버림. 관리자가 선택한 `targetLanguages` 배열만 번역 대상이 됨.
2. **헤더 크기 제한**: 페르소나 프롬프트는 수백 단어 가능 → HTTP 헤더 대신 processAudio에서 RTDB 직접 읽기 (로컬 캐시 고려)
3. **부분 번역 실패**: 부분 실패 시 에러 처리하지 않고, 성공한 언어만 저장하고 실패한 언어는 빈 문자열.
4. **sourceLang 감지**: sourceLang은 기존처럼 클라이언트에서 설정 (ko, en, ja, zh 등).
5. **스트림 기존 데이터**: 필드가 없는 기존 스트림 엔트리 → `undefined` 체크로 안전하게 폴백.
6. **중국어 키 통일**: `zh` 로 키를 통일하여 데이터 및 UI에 접근.

## Work Objectives
### Core Objective
실시간 의학 회의 번역 시스템에 일본어·중국어(간체) 번역을 추가하고, 각 Hall마다 독립적인 AI 페르소나(프롬프트)를 관리할 수 있게 하며, 빈번한 RTDB 업데이트에도 안정적인 프론트엔드 렌더링을 보장한다.

### Deliverables
1. 동적 타겟 언어 번역 파이프라인 (ko, en, ja, zh-CN)
2. 관리자 UI 내 AI 페르소나 CRUD 탭
3. useProjectStream 업데이트 쓰로틀링
4. AudienceView/OverlayView 다국어 표시 확장

### Definition of Done
- [ ] `processAudio`가 선택된 `targetLanguages`에 대해서만 번역을 수행하여 RTDB에 저장함 (하드코딩 제거)
- [ ] 관리자 UI에서 Hall별 페르소나 프롬프트를 저장하고, 저장된 프롬프트가 실제 번역에 반영됨
- [ ] UI가 동적 타겟 언어를 기반으로 탭 및 내용을 표시함
- [ ] RTDB 초당 10회 업데이트 시에도 AudienceView 렌더링 프레임 드랍이 없음
- [ ] `npm run build` — client, functions 모두 빌드 성공
- [ ] `npm run lint` — client, functions 모두 린트 통과

### Must Have
- 동적 targetLanguages 배열 기반 번역 및 UI 처리
- 페르소나 per-language 프롬프트 (ko, en, ja, zh 각각)
- useProjectStream 쓰로틀링 (최소 100ms 간격)

### Must NOT Have
- STT 엔진(Whisper/Deepgram) 교체
- 기존 한국어/영어 고정 방식 유지 (하드코딩 지양)
- 테스트 프레임워크 도입 (별도 작업으로 분리)
- WebSocket 오디오 전송으로의 전환 (HTTP POST 유지)

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: No automated tests. QA scenarios with manual verification steps.
- QA policy: Every task has agent-executable verification scenarios (build, lint, dev server check)
- Evidence: .sisyphus/evidence/task-{N}-{slug}.{ext}

## Execution Strategy
### Parallel Execution Waves

**Wave 1: Foundation** (4 tasks, max parallelism — shared types and infrastructure)
- T1: TypeScript type extensions (TranslationResult, persona types) — `quick`
- T2: X-Target-Languages header parsing in processAudio — `quick`
- T3: useProjectStream throttling — `quick`
- T4: database.rules.json review — `quick`

**Wave 2: Backend Core** (1 task, sequential — single file stt.ts)
- T5: Refactor stt.ts for dynamic languages + persona loading — `deep`

**Wave 3: Frontend Implementation** (3 tasks, parallel — independent components)
- T6: AdminDashboard persona management UI — `visual-engineering`
- T7: AudienceView multi-language display — `quick`
- T8: OverlayView multi-language support — `quick`

**Wave 4: Performance Polish** (1 task)
- T9: AudienceView segmentsMap optimization — `quick`

**Wave 5: Final Verification** (4 parallel reviews)

### Dependency Matrix
| Task | Blocked By | Blocks |
|------|-----------|--------|
| T1 | — | T5, T6, T7 |
| T2 | T1 | T5 |
| T3 | — | T9 |
| T4 | — | T6 |
| T5 | T1, T2 | T6, T7, T8 |
| T6 | T1, T4, T5 | — |
| T7 | T1, T5 | — |
| T8 | T1, T5 | — |
| T9 | T3 | — |
| F1-F4 | ALL | — |

### Agent Dispatch Summary
| Wave | Tasks | Categories |
|------|-------|------------|
| 1 | 4 | quick × 4 |
| 2 | 1 | deep × 1 |
| 3 | 3 | visual-engineering × 1, quick × 2 |
| 4 | 1 | quick × 1 |
| 5 | 4 | oracle, unspecified-high × 2, deep |

## TODOs
> Implementation + Test = ONE task. Never separate.

- [ ] 1. Extend TypeScript Types for Dynamic Languages and Persona

  **What to do**:
  1. `functions/src/stt.ts:199-206` — `TranslationResult` 인터페이스를 동적 언어를 지원하도록 리팩터:
     ```typescript
     interface TranslationResult {
         refined: string;
         isMedical: boolean;
         provider: string;
         ms: number;
         [lang: string]: string | boolean | number; // 동적 언어 지원
     }
     ```
  2. `client/src/types/index.ts` — `ProjectSettings` 인터페이스에 `persona?` 하위 객체 추가:
     ```typescript
     persona?: {
       enabled: boolean
       basePromptKo?: string
       basePromptEn?: string
       basePromptJa?: string
       basePromptZh?: string
       customInstructions: string
       medicalTerms: string
     }
     ```
  3. `client/src/types/index.ts` — `ProjectSettings`의 `targetLanguages` 타입을 `string[]` 또는 `"ko" | "en" | "ja" | "zh"[]` 로 통일 확인
  4. `client/src/hooks/useProjectStream.ts` — 스트림 아이템 타입을 인덱스 시그니처(`[lang: string]: any`)를 통해 동적 언어를 지원하도록 정리

  **Must NOT do**:
  - `zh-CN` 대신 `zh` 로 통일.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 순수 타입 정의 변경, 로직 없음
  - Skills: [] — Reason: 타입 수정에 특수 스킬 불필요
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T5, T6, T7 | Blocked By: none

  **References**:
  - Type: `functions/src/stt.ts:199-206` — 현재 TranslationResult 인터페이스 (ko, en, refined, isMedical, provider, ms)
  - Type: `client/src/types/index.ts` — ProjectSettings 인터페이스 (overlay, ai, targetLanguages 등)
  - Pattern: `client/src/hooks/useProjectStream.ts:109-140` — 스트림 아이템 병합 로직에서 사용하는 데이터 구조

  **Acceptance Criteria**:
  - [ ] `npm run build` — functions 디렉토리에서 빌드 성공
  - [ ] `npm run build` — client 디렉토리에서 빌드 성공
  - [ ] `TranslationResult`에 `ja?: string`, `zh?: string` 필드가 존재함
  - [ ] `ProjectSettings`에 `persona?` 하위 객체가 존재함

  **QA Scenarios**:
  ```
  Scenario: Type check passes
    Tool: Bash
    Steps: cd functions && npx tsc --noEmit && cd ../client && npx tsc --noEmit
    Expected: Both commands exit with code 0, no type errors
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: Backward compatibility — existing code still compiles
    Tool: Bash
    Steps: cd functions && npm run build && cd ../client && npm run build
    Expected: Build succeeds without errors. No import/export failures.
    Evidence: .sisyphus/evidence/task-1-build.txt
  ```

  **Commit**: YES | Message: `refactor(types): extend TranslationResult and ProjectSettings for ja/zh and persona` | Files: `functions/src/stt.ts`, `client/src/types/index.ts`, `client/src/hooks/useProjectStream.ts`

- [ ] 2. Add X-Target-Languages Header Parsing in processAudio

  **What to do**:
  1. `functions/src/stt.ts:367-378` — 헤더 파싱 섹션에 `x-target-languages` 헤더 추가:
     ```typescript
     const targetLanguages = (req.headers['x-target-languages'] as string || 'ko,en').split(',').map(l => l.trim());
     ```
  2. 기본값 `'ko,en'` 설정하여 기존 클라이언트(헤더 미전송) 후방 호환 보장
  3. `x-project-id` 헤더 파싱 추가 (페르소나 로딩에 필요):
     ```typescript
     const projectId = req.headers['x-project-id'] as string || '';
     ```
  4. 파싱된 `targetLanguages`와 `projectId`를 STT/번역 파이프라인으로 전달할 준비 (함수 시그니처에 추가하지는 않음 — T5에서 연결)

  **Must NOT do**: 
  - 기존 헤더 파싱 로직 변경하지 않기
  - targetLanguages 값을 아직 사용하지 않기 (T5에서 사용)

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 단순 헤더 읽기 추가
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T5 | Blocked By: T1 (type readiness)

  **References**:
  - Pattern: `functions/src/stt.ts:367-378` — 기존 x-active-session-id, x-custom-keywords 파싱 패턴
  - Pattern: `functions/src/stt.ts:325-341` — processAudio 함수 정의와 CORS 설정

  **Acceptance Criteria**:
  - [ ] `npm run build` — functions 빌드 성공
  - [ ] `targetLanguages` 변수가 헤더에서 파싱됨
  - [ ] `projectId` 변수가 헤더에서 파싱됨
  - [ ] 기본값 'ko,en'이 적용됨

  **QA Scenarios**:
  ```
  Scenario: Header parsing with values
    Tool: Bash
    Steps: cd functions && npm run build
    Expected: Build succeeds. Verify in code that x-target-languages and x-project-id are parsed with defaults.
    Evidence: .sisyphus/evidence/task-2-headers.txt

  Scenario: Backward compatibility — no header sent
    Tool: Bash (curl)
    Steps: curl -X POST http://localhost:5001/translation-app/us-central1/processAudio -H "Content-Type: audio/wav" --data-binary @test.wav 2>&1 | head -5
    Expected: Function does not crash on missing x-target-languages header (defaults to ko,en)
    Evidence: .sisyphus/evidence/task-2-backward.txt
  ```

  **Commit**: NO (part of Wave 2 commit with T5)

- [ ] 3. Add useProjectStream Update Throttling

  **What to do**:
  1. `client/src/hooks/useProjectStream.ts:91-99` — `onValue` 콜백 내부에 쓰로틀링 추가:
     - `setTimeout` 기반 간단한 쓰로틀 구현 (100ms 간격)
     - 또는 `useRef`에 마지막 업데이트 시간 저장 후 비교
  2. 쓰로틀 로직:
     ```typescript
     const lastUpdateRef = useRef(0);
     // onValue 콜백 내:
     const now = Date.now();
     if (now - lastUpdateRef.current < 100) return; // 100ms 쓰로틀
     lastUpdateRef.current = now;
     ```
  3. 단, 초기 로드(첫 번째 onValue)는 쓰로틀 제외하여 즉시 렌더링
  4. cleanup 함수에서 타이머 정리

  **Must NOT do**:
  - `loadOlderMessages` 함수 변경하지 않기
  - 데이터 변환 로직 변경하지 않기
  - 쓰로틀 간격을 너무 길게 설정하지 않기 (100ms 이하)

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 단일 파일, 10줄 내외 변경
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T9 | Blocked By: none

  **References**:
  - Pattern: `client/src/hooks/useProjectStream.ts:84-99` — onValue 구독 및 streamData 업데이트
  - Pattern: `client/src/hooks/useProjectStream.ts:109-140` — 데이터 병합 로직

  **Acceptance Criteria**:
  - [ ] `npm run build` — client 빌드 성공
  - [ ] 100ms 이내 연속 RTDB 업데이트 시 최초 1회만 상태 업데이트 발생
  - [ ] 초기 로드 시 쓰로틀 적용되지 않음

  **QA Scenarios**:
  ```
  Scenario: Build succeeds with throttling
    Tool: Bash
    Steps: cd client && npm run build
    Expected: Build succeeds without errors
    Evidence: .sisyphus/evidence/task-3-build.txt

  Scenario: Throttle prevents rapid updates
    Tool: Bash
    Steps: cd client && npm run lint
    Expected: Lint passes, no warnings about unused refs or timers
    Evidence: .sisyphus/evidence/task-3-lint.txt
  ```

  **Commit**: YES | Message: `perf(stream): add 100ms throttling to useProjectStream RTDB updates` | Files: `client/src/hooks/useProjectStream.ts`

- [ ] 4. Review database.rules.json for Persona Path

  **What to do**:
  1. `database.rules.json` 읽기 — 현재 `/projects/{projectId}/settings` 경로의 규칙 확인
  2. `/projects/{projectId}/settings` 하위에 `persona` 필드 추가 시 별도 규칙 필요한지 판단
  3. 현재 규칙이 `settings` 전체에 `".write": "auth != null"` 적용되어 있으면 변경 불필요
  4. 변경 필요한 경우에만 rules 업데이트

  **Must NOT do**:
  - 기존 보안 규칙 약화하지 않기
  - 불필요한 규칙 추가하지 않기

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 설정 파일 검토, 변경 최소화
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: T6 | Blocked By: none

  **References**:
  - Config: `database.rules.json` — 전체 RTDB 보안 규칙
  - Pattern: `client/src/components/AdminDashboard.tsx:95-129` — settings 저장 경로 (projects/{id}/settings/overlay, /ai, /hideRaw)

  **Acceptance Criteria**:
  - [ ] persona 데이터가 기존 settings 규칙으로 커버되는지 확인됨
  - [ ] 변경 필요 시 rules 파일이 업데이트됨
  - [ ] 변경 불필요 시 "No changes needed" 문서화됨

  **QA Scenarios**:
  ```
  Scenario: Rules validation
    Tool: Bash
    Steps: firebase database:get / --rules 2>/dev/null || cat database.rules.json
    Expected: Rules JSON is valid. settings path has auth!=null for writes.
    Evidence: .sisyphus/evidence/task-4-rules.txt
  ```

  **Commit**: YES (if changes needed) | Message: `chore(rules): ensure persona path covered by settings rules` | Files: `database.rules.json`

- [ ] 5. Refactor stt.ts: Dynamic Languages + Persona Loading (CORE TASK)

  **What to do**:

  **Part A: Dynamic buildTranslationResult** (lines 185-197)
  1. 함수 시그니처에 `targetLanguages: string[]` 파라미터 추가
  2. 기존 ko/en 분기 로직을 동적 루프로 변경:
     ```typescript
     function buildTranslationResult(
       data: any, rawText: string, sourceLang: string, targetLanguages: string[]
     ): TranslationResult {
       const refined = sanitize(data.refined || rawText);
       const result: TranslationResult = { refined, isMedical: false, provider: '', ms: 0 };
       
       for (const lang of targetLanguages) {
         if (lang === sourceLang) {
           result[lang] = refined;
         } else if (data[lang]) {
           result[lang] = sanitize(data[lang]);
         } else {
           result[lang] = ''; // 실패 시 빈 문자열
         }
       }
       return result;
     }
     ```

  **Part B: Dynamic OpenAITranslationProvider** (lines 213-256)
  1. `translate()` 메서드에 `targetLanguages: string[]` 파라미터 추가
  2. JSON 반환 형식에 targetLanguages 동적 반영:
     ```
     Return JSON with: {"refined": "cleaned text", ${langFields}}
     ```
  3. `DENTAL_PROMPT_KO`/`DENTAL_PROMPT_EN` 상수 → 페르소나 로딩 함수 또는 캐시로 교체. (필요 시 RTDB 쿼리)

  **Part C: Persona Loading** (new)
  1. `loadPersona(projectId: string): Promise<PersonaConfig | null>` 함수 추가. (필요하다면 메모리 캐싱 적용하여 DB 읽기 최소화)
  2. RTDB에서 `/projects/${projectId}/settings/persona` 읽기
  3. `enabled: true`인 경우 해당 프롬프트 사용, 아니면 기본 프롬프트 폴백
  4. 번역 요청 전 persona 로드하여 프롬프트에 주입

  **Part D: Wire targetLanguages + persona into pipeline**
  1. `processAudio`에서 파싱한 `targetLanguages`를 STT → 번역 파이프라인으로 전달
  2. 번역 실패 시 해당 언어는 빈 문자열로 저장, 다른 언어는 정상 저장

  **Must NOT do**:
  - 하드코딩된 'ko', 'en' 요구사항을 남기지 않기. (targetLanguages 배열에만 의존)

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: 핵심 파이프라인 리팩토링, 다수 함수 시그니처 변경
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: T6, T7, T8 | Blocked By: T1, T2

  **References**:
  - Core: `functions/src/stt.ts:185-197` — buildTranslationResult (현재 ko/en 하드코딩)
  - Core: `functions/src/stt.ts:199-206` — TranslationResult 인터페이스 (T1에서 확장됨)
  - Core: `functions/src/stt.ts:213-256` — OpenAITranslationProvider.translate()
  - Core: `functions/src/stt.ts:239-246` — 시스템 프롬프트 생성 (현재 ko/en JSON 강제)
  - Core: `functions/src/stt.ts:251-256` — JSON 파싱/검증 (ko/en 체크)
  - Core: `functions/src/stt.ts:319-321` — DENTAL_PROMPT_KO/EN 상수 (폴백 유지)
  - Core: `functions/src/stt.ts:367-378` — 헤더 파싱 (T2에서 확장됨)
  - Core: `functions/src/stt.ts:417-424` — RTDB translating 상태 쓰기
  - Core: `functions/src/stt.ts:507-524` — 번역 결과 RTDB 업데이트
  - External: `functions/src/api.ts` — admin.database() 사용 패턴 (RTDB 접근 참고)

  **Acceptance Criteria**:
  - [ ] `npm run build` — functions 빌드 성공
  - [ ] `buildTranslationResult(['ko','en','ja','zh-CN'], ...)` 호출 시 result에 ja/zh 필드 존재
  - [ ] `buildTranslationResult(['ko','en'], ...)` 호출 시 기존과 동일한 결과 (후방 호환)
  - [ ] OpenAITranslationProvider가 targetLanguages에 따라 동적 프롬프트 생성
  - [ ] 페르소나가 RTDB에 존재하면 로드되어 프롬프트에 반영됨
  - [ ] 페르소나 미설정 시 DENTAL_PROMPT 상수로 폴백됨

  **QA Scenarios**:
  ```
  Scenario: Build with dynamic languages
    Tool: Bash
    Steps: cd functions && npm run build
    Expected: Build succeeds. No TypeScript errors.
    Evidence: .sisyphus/evidence/task-5-build.txt

  Scenario: Multi-language request
    Tool: Bash
    Steps: Send audio chunk with X-Target-Languages: ja,zh and X-Project-Id
    Expected: RTDB entry contains ONLY ja, zh fields with translated text (and refined). ko/en are NOT generated unless requested.
    Evidence: .sisyphus/evidence/task-5-multilang.txt

  Scenario: Persona loading — no persona configured
    Tool: Bash
    Steps: Send audio to project without persona settings in RTDB
    Expected: Falls back to DENTAL_PROMPT_KO/EN constants. Translation completes successfully.
    Evidence: .sisyphus/evidence/task-5-persona-fallback.txt
  ```

  **Commit**: YES | Message: `feat(translation): dynamic multi-language pipeline with persona loading` | Files: `functions/src/stt.ts`

- [ ] 6. AdminDashboard Persona Management UI

  **What to do**:
  1. `client/src/components/AdminDashboard.tsx` — 프로젝트 설정 영역에 **"AI 페르소나 관리"** 섹션/탭 추가
  2. 페르소나 편집 폼 구성:
     - 활성화 토글 (enabled: boolean)
     - 한국어 기본 프롬프트 (basePromptKo: textarea)
     - 영어 기본 프롬프트 (basePromptEn: textarea)
     - 일본어 기본 프롬프트 (basePromptJa: textarea)
     - 중국어 기본 프롬프트 (basePromptZh: textarea)
     - 공통 지시사항 (customInstructions: textarea)
     - 의학 용어 사전 (medicalTerms: textarea)
  3. 저장 로직: 기존 `saveProjectSettings` 패턴에 맞춰 `settings/persona` 경로에 저장:
     ```typescript
     updates[`projects/${activeProjectId}/settings/persona`] = personaData;
     ```
  4. 로드 로직: 설정 로드 시 `settings.persona` 읽기 (없으면 기본값)
  5. UI 스타일: 기존 AdminDashboard 설정 패널 스타일과 일치 (TailwindCSS 유틸리티)

  **Must NOT do**:
  - 기존 설정 탭(overlay, AI) 변경하지 않기
  - 페르소나 저장 시 다른 설정 덮어쓰지 않기
  - 복잡한 WYSIWYG 에디터 도입하지 않기 (plain textarea)

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: 새 UI 섹션 구현, 기존 스타일과 일치 필요
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: none | Blocked By: T1, T4, T5

  **References**:
  - Pattern: `client/src/components/AdminDashboard.tsx:42-93` — ProjectSettings 로드/저장 패턴
  - Pattern: `client/src/components/AdminDashboard.tsx:95-129` — saveProjectSettings 업데이트 경로
  - Type: `client/src/types/index.ts` — persona 타입 (T1에서 추가됨)
  - Style: `client/src/components/AdminDashboard.tsx` — TailwindCSS 클래스 패턴

  **Acceptance Criteria**:
  - [ ] `npm run build` — client 빌드 성공
  - [ ] "AI 페르소나 관리" 섹션이 AdminDashboard에 렌더링됨
  - [ ] 페르소나 저장 시 RTDB `settings/persona` 경로에 데이터가 저장됨
  - [ ] 페르소나 로드 시 저장된 값이 폼에 표시됨
  - [ ] 기존 설정 탭 기능에 영향 없음

  **QA Scenarios**:
  ```
  Scenario: Persona UI renders
    Tool: Bash
    Steps: cd client && npm run build
    Expected: Build succeeds. No TypeScript or import errors.
    Evidence: .sisyphus/evidence/task-6-build.txt

  Scenario: Persona save/load cycle
    Tool: interactive_bash
    Steps: Launch dev server. Navigate to AdminDashboard. Fill persona fields. Save. Reload page.
    Expected: Persona fields retain saved values. RTDB shows data at settings/persona path.
    Evidence: .sisyphus/evidence/task-6-persona-cycle.txt

  Scenario: Existing settings unaffected
    Tool: interactive_bash
    Steps: Save persona. Verify overlay and AI settings still load correctly.
    Expected: All settings tabs work independently. No data loss.
    Evidence: .sisyphus/evidence/task-6-settings-intact.txt
  ```

  **Commit**: YES | Message: `feat(ui): add AI persona management section to AdminDashboard` | Files: `client/src/components/AdminDashboard.tsx`

- [ ] 7. AudienceView Multi-Language Display

  **What to do**:
  1. `client/src/components/AudienceView.tsx` — 언어 선택 UI 동적화:
     - 프로젝트 설정의 `targetLanguages` 배열을 읽어 탭/버튼 옵션을 렌더링.
     - 현재 `activeLang` 상태가 `targetLanguages` 중 하나를 선택하도록 관리.
  2. `client/src/components/AudienceView.tsx:662-701` — 렌더링 루프:
     - `seg[activeLang]` 으로 동적 접근 (ko/en 하드코딩 제거).
     - 해당 언어 필드가 비어있거나 없는 경우 `refined` 또는 `original`로 폴백
  3. `client/src/components/TextItem.tsx` — 동적으로 넘어오는 텍스트를 그대로 표시하도록 확인.

  **Must NOT do**:
  - 특정 언어(ko, en, ja, zh)에 대한 if-else 하드코딩.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 동적 배열 렌더링으로 전환
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: none | Blocked By: T1, T5

  **References**:
  - Pattern: `client/src/components/AudienceView.tsx:662-701` — 렌더링 루프에서 activeLang 사용
  - Pattern: `client/src/components/TextItem.tsx:46` — targetLang 기반 표시 텍스트 계산
  - Type: `client/src/types/index.ts` — targetLanguages 배열

  **Acceptance Criteria**:
  - [ ] `npm run build` — client 빌드 성공
  - [ ] targetLanguages에 ja 포함 시 일본어 탭/버튼이 표시됨
  - [ ] 일본어 선택 시 seg.ja 필드값이 표시됨
  - [ ] ja 필드가 없는 기존 엔트리는 refined/original로 폴백됨

  **QA Scenarios**:
  ```
  Scenario: Multi-language tabs render
    Tool: Bash
    Steps: cd client && npm run build
    Expected: Build succeeds.
    Evidence: .sisyphus/evidence/task-7-build.txt

  Scenario: Japanese text display
    Tool: interactive_bash
    Steps: Open AudienceView for project with targetLanguages: ["ko","en","ja","zh-CN"]. Switch to Japanese tab.
    Expected: Japanese translation text displays. Segments without ja field show refined/original fallback.
    Evidence: .sisyphus/evidence/task-7-ja-display.txt
  ```

  **Commit**: YES | Message: `feat(ui): extend AudienceView with Japanese and Chinese language tabs` | Files: `client/src/components/AudienceView.tsx`

- [ ] 8. OverlayView Multi-Language Support

  **What to do**:
  1. `client/src/components/OverlayView.tsx:78-85` — `activeLang` 기반 텍스트 추출 로직을 동적으로 개선:
     ```typescript
     // 기존: ko/en 분기
     // 확장: targetLanguages에 따라 동적 접근 (seg[activeLang])
     ```
  2. 선택된 언어의 텍스트가 없는 세그먼트의 폴백 처리 (refined 또는 original)
  3. 폰트 렌더링: 일본어/중국어 CJK 문자가 기존 폰트 설정으로 정상 표시되는지 확인

  **Must NOT do**:
  - 특정 언어(ko, en, ja, zh)에 대한 if-else 하드코딩.

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 기존 패턴의 단순 확장
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: none | Blocked By: T1, T5

  **References**:
  - Pattern: `client/src/components/OverlayView.tsx:72-85` — 세그먼트 필터링 및 텍스트 추출
  - Pattern: `client/src/components/OverlayView.tsx:87-123` — 타이핑 애니메이션 (변경 불필요)
  - Pattern: `client/src/components/OverlayView.tsx:161-194` — 렌더링

  **Acceptance Criteria**:
  - [ ] `npm run build` — client 빌드 성공
  - [ ] activeLang이 'ja'일 때 일본어 텍스트가 오버레이에 표시됨
  - [ ] activeLang이 'zh-CN'일 때 중국어 텍스트가 오버레이에 표시됨
  - [ ] 기존 ko/en 오버레이 동작에 영향 없음

  **QA Scenarios**:
  ```
  Scenario: Build succeeds
    Tool: Bash
    Steps: cd client && npm run build
    Expected: Build succeeds
    Evidence: .sisyphus/evidence/task-8-build.txt

  Scenario: CJK rendering in overlay
    Tool: interactive_bash
    Steps: Open OverlayView. Set activeLang to 'ja'. Verify Japanese text renders correctly with overlay settings.
    Expected: CJK characters display without rendering issues. Font size/color/bg settings apply correctly.
    Evidence: .sisyphus/evidence/task-8-cjk-render.txt
  ```

  **Commit**: YES | Message: `feat(ui): extend OverlayView with Japanese and Chinese language support` | Files: `client/src/components/OverlayView.tsx`

- [ ] 9. AudienceView segmentsMap Optimization

  **What to do**:
  1. `client/src/components/AudienceView.tsx:118-119` — `segmentsOrder`를 상태에서 `useMemo` 파생값으로 변경:
     ```typescript
     const segmentsOrder = useMemo(() => {
       return Object.keys(segmentsMap)
         .filter(id => segmentsMap[id]?.status !== 'merged')
         .sort((a, b) => (segmentsMap[a]?.timestamp || 0) - (segmentsMap[b]?.timestamp || 0));
     }, [segmentsMap]);
     ```
  2. `segmentsOrder` 상태 선언 제거 및 `setSegmentsOrder` 호출 모두 제거
  3. 리듀서(lines 298-336)에서 segmentsOrder 관련 로직 단순화
  4. `handleSpeak` useCallback의 의존성에서 `segmentsOrder` 제거 가능한지 확인

  **Must NOT do**:
  - segmentsMap 리듀서의 병합/정리 로직 변경하지 않기
  - TextItem 컴포넌트 수정하지 않기
  - 렌더링 결과(표시 순서)가 변경되지 않도록 보장

  **Recommended Agent Profile**:
  - Category: `quick` — Reason: 상태를 파생값으로 변경하는 패턴 최적화
  - Skills: [] — 
  - Omitted: [] — 

  **Parallelization**: Can Parallel: YES | Wave 4 | Blocks: none | Blocked By: T3

  **References**:
  - Pattern: `client/src/components/AudienceView.tsx:117-119` — segmentsMap/segmentsOrder 상태 정의
  - Pattern: `client/src/components/AudienceView.tsx:298-336` — segmentsMap 리듀서
  - Pattern: `client/src/components/AudienceView.tsx:662-701` — 렌더링 루프에서 segmentsOrder 사용

  **Acceptance Criteria**:
  - [ ] `npm run build` — client 빌드 성공
  - [ ] `segmentsOrder`가 useMemo 파생값으로 계산됨 (상태가 아님)
  - [ ] 렌더링 결과가 변경 전과 동일함
  - [ ] `setSegmentsOrder` 호출이 모두 제거됨

  **QA Scenarios**:
  ```
  Scenario: Build and type check
    Tool: Bash
    Steps: cd client && npm run build
    Expected: Build succeeds. No unused variable warnings for setSegmentsOrder.
    Evidence: .sisyphus/evidence/task-9-build.txt

  Scenario: Render output unchanged
    Tool: interactive_bash
    Steps: Launch dev server. Open AudienceView. Verify segment order matches before/after.
    Expected: Segments display in same chronological order. No visual changes.
    Evidence: .sisyphus/evidence/task-9-render-check.txt
  ```

  **Commit**: YES | Message: `perf(rendering): derive segmentsOrder from useMemo instead of separate state` | Files: `client/src/components/AudienceView.tsx`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle: verify all deliverables match plan spec
- [ ] F2. Code Quality Review — unspecified-high: lint, type-check, pattern consistency
- [ ] F3. Real Manual QA — unspecified-high: dev server 실행 후 각 시나리오 수동 검증
- [ ] F4. Scope Fidelity Check — deep: no scope creep, no missing features, backward compatibility verified

## Commit Strategy
- Wave 1: `refactor(types): extend TranslationResult and ProjectSettings for dynamic languages and persona`
- Wave 2: `feat(translation): dynamic multi-language translation pipeline with persona support`
- Wave 3: `feat(ui): persona management UI and multi-language display`
- Wave 4: `perf(rendering): optimize segmentsMap updates and stream throttling`
- Final: `feat(translation): add Japanese and Simplified Chinese support with persona management`

## Success Criteria
1. 관리자가 targetLanguages에 ja, zh-CN을 추가하고 오디오를 전송하면, RTDB에 ja/zh-CN 필드로 번역 결과가 저장된다
2. 관리자가 Hall 설정에서 페르소나 프롬프트를 수정하면, 다음 오디오 청크 번역부터 즉시 반영된다
3. 기존 ko/en 전용 프로젝트는 targetLanguages 미설정 상태에서도 동일하게 동작한다
4. `npm run build` && `npm run lint` 양쪽 모두 통과한다
5. 빈번한 RTDB 업데이트(초당 5-10회) 시 UI 렌더링이 안정적이다
