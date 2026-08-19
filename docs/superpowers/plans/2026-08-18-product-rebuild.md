# 조율 제품 재구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 시간표 중심의 교사·일과 담당 전체 여정을 독립적인 조율 제품으로 재구축한다.

**Architecture:** 기존 탐색 엔진은 유지하고, 날짜와 요청 상태를 갖는 순수 도메인 모델을 웹
라이브러리에 추가한다. 화면은 교사 홈, 후보 비교, 일과 요청함으로 분리하고 브라우저 저장소를
어댑터로 사용해 전체 여정을 실제로 조작할 수 있게 한다.

**Tech Stack:** Next.js 16, React 19, TypeScript 7, Vitest 4, Playwright

**Spec:** docs/superpowers/specs/2026-08-18-product-rebuild.md

## Global Constraints

- 다른 상용 서비스의 데이터, 비공식 API, 학교 코드, 전용 파일 형식을 사용하지 않는다.
- 나이스 공개 데이터와 학교가 권한을 갖고 제공한 자료만 입력으로 쓴다.
- 새 동작은 실패하는 테스트를 먼저 실행한 뒤 구현한다.
- 주요 모바일 터치 대상은 최소 44px이다.
- 교체 후보는 반복 카드가 아닌 선택 가능한 비교표로 표시한다.
- 실제 서버가 없는 동작은 이 기기의 데모 학교 공간이라고 사실대로 표시한다.

---

### Task 1: 독립 제품 기록과 실행 기반 정리

**Files:**
- Modify: 02-spike-record.md
- Modify: 00-research.md
- Modify: README.md
- Modify: package.json
- Modify: scripts/serve-checked.mjs
- Test: scripts/check-config.mjs

**Interfaces:**
- Consumes: 루트 npm workspace 명령
- Produces: Windows와 CI에서 같은 루트 URL 및 npm run demo 명령

- [ ] **Step 1:** scripts/serve-checked.mjs의 루트 경로를 검증하는 실패 재현을 실행한다.
- [ ] **Step 2:** 요청 경로의 선행 슬래시를 제거해 정적 루트를 벗어나지 않게 수정한다.
- [ ] **Step 3:** 루트 demo 스크립트를 엔진 workspace 명령으로 연결한다.
- [ ] **Step 4:** 현재 문서에서 비공식 서비스 엔드포인트와 호환 계획을 제거하고 공식 데이터 원칙으로 다시 쓴다.
- [ ] **Step 5:** npm run check, npm run demo와 루트 HTTP 200을 확인한다.

### Task 2: 날짜와 요청 상태 도메인

**Files:**
- Create: apps/web/lib/requests.ts
- Test: apps/web/test/requests.test.ts
- Modify: apps/web/lib/app.ts

**Interfaces:**
- Produces: ChangeRequest, RequestStatus, createRequest, transitionRequest,
  requestSummary, loadRequests, saveRequests

- [ ] **Step 1:** 요청 생성 시 날짜·교사·수업·후보가 보존되는 실패 테스트를 작성하고 실행한다.
- [ ] **Step 2:** 허용되지 않은 상태 전이와 빈 수업 요청을 거부하는 실패 테스트를 작성하고 실행한다.
- [ ] **Step 3:** 최소 도메인 구현으로 테스트를 통과시킨다.
- [ ] **Step 4:** 손상된 브라우저 저장값이 빈 요청 목록으로 복구되는 테스트와 구현을 추가한다.
- [ ] **Step 5:** 요청 테스트와 기존 웹 테스트를 함께 실행한다.

### Task 3: 시간표 중심 교사 홈

**Files:**
- Create: apps/web/components/TeacherHome.tsx
- Create: apps/web/components/TodayStrip.tsx
- Modify: apps/web/components/Workbench.tsx
- Modify: apps/web/components/Grid.tsx
- Modify: apps/web/app/globals.css
- Test: scripts/smoke.mjs

**Interfaces:**
- Consumes: 현재 교사, 주간 시간표, 요청 목록
- Produces: 오늘/주간 전환과 변경 요청 진입

- [ ] **Step 1:** 스모크에 모바일 첫 화면의 오늘 수업과 44px 행동 버튼 검사를 추가해 실패를 확인한다.
- [ ] **Step 2:** 교사 홈 머리글, 오늘 수업 띠, 요청 상태 요약을 구현한다.
- [ ] **Step 3:** 기존 시간표는 주간 보기의 중심 콘텐츠로 유지한다.
- [ ] **Step 4:** 모바일에서 오늘 보기를 기본으로 하고 주간 보기는 명시적으로 전환하게 한다.
- [ ] **Step 5:** 키보드 포커스와 축소 모션 스타일을 추가하고 스모크를 재실행한다.

### Task 4: 반복 카드 없는 후보 비교

**Files:**
- Create: apps/web/components/CandidateCompare.tsx
- Modify: apps/web/components/Panel.tsx
- Modify: apps/web/components/Workbench.tsx
- Modify: apps/web/app/globals.css
- Test: scripts/smoke.mjs

**Interfaces:**
- Consumes: RecommendResult.candidates
- Produces: 선택 후보 하나, 시간표 미리보기, 단일 이 안으로 요청 행동

- [ ] **Step 1:** 후보마다 복사·반영 버튼이 반복되지 않고 단일 주요 행동만 존재하는 스모크 검사를 추가한다.
- [ ] **Step 2:** 후보를 행으로 비교하는 표와 모바일 요약 행을 구현한다.
- [ ] **Step 3:** 행 선택을 기존 미리보기 상태와 연결한다.
- [ ] **Step 4:** 세부 근거는 선택한 행 아래 한 곳에서만 펼친다.
- [ ] **Step 5:** 데스크톱과 모바일 후보 선택 스모크를 통과시킨다.

### Task 5: 요청 제출과 상태 확인

**Files:**
- Create: apps/web/components/RequestComposer.tsx
- Create: apps/web/components/RequestStatusList.tsx
- Modify: apps/web/components/Workbench.tsx
- Modify: apps/web/app/globals.css
- Test: scripts/smoke.mjs

**Interfaces:**
- Consumes: 선택한 결강 수업과 후보
- Produces: 날짜가 있는 검토 중 요청과 취소 가능한 상태 목록

- [ ] **Step 1:** 요청 제출 후 상태가 검토 중으로 보이는 스모크 검사를 추가하고 실패를 확인한다.
- [ ] **Step 2:** 상세 사유 대신 업무상 부재 범주와 담당자 메모를 분리한다.
- [ ] **Step 3:** 요청 제출 확인 화면과 중복 요청 방지를 구현한다.
- [ ] **Step 4:** 검토 전 요청 취소와 상태 목록을 구현한다.
- [ ] **Step 5:** 새로고침 복원과 취소 스모크를 실행한다.

### Task 6: 일과 담당 요청함과 행정 마무리

**Files:**
- Create: apps/web/components/OpsInbox.tsx
- Create: apps/web/components/OpsDetail.tsx
- Create: apps/web/components/AdminChecklist.tsx
- Modify: apps/web/components/Workbench.tsx
- Modify: apps/web/components/Changes.tsx
- Modify: apps/web/app/globals.css
- Test: scripts/smoke.mjs

**Interfaces:**
- Consumes: 요청 목록과 현재 시간표
- Produces: 승인·반려·게시 상태, 나이스 입력·공지·결재 체크리스트

- [ ] **Step 1:** 담당자 모드에서 대기 요청을 열고 승인하는 실패 스모크를 작성한다.
- [ ] **Step 2:** 상태·날짜 필터가 있는 요청함을 구현한다.
- [ ] **Step 3:** 후보 확인, 승인, 반려 사유 입력을 구현한다.
- [ ] **Step 4:** 승인 뒤 세 단계 행정 체크리스트와 게시 완료 상태를 구현한다.
- [ ] **Step 5:** 승인과 행정 완료 전 과정을 스모크로 검증한다.

### Task 7: 랜딩과 설정 흐름 재작성

**Files:**
- Modify: apps/web/components/Landing.tsx
- Modify: apps/web/components/NeisLoader.tsx
- Create: apps/web/components/SchoolSetup.tsx
- Modify: apps/web/app/globals.css
- Test: scripts/smoke.mjs

**Interfaces:**
- Produces: 교사용 바로 시작, 관리자용 학교 설정, 분리된 샘플 체험

- [ ] **Step 1:** 랜딩의 주요 행동이 두 개 이하이고 샘플이 보조 행동인지 검사한다.
- [ ] **Step 2:** 저장된 교사는 한 번의 행동으로 시간표에 들어가게 한다.
- [ ] **Step 3:** 실제 사용은 관리자 학교 설정으로 분리하고 나이스 인증키 입력은 그 안에 둔다.
- [ ] **Step 4:** 학교 설정이 한 사람만 수행하는 절차임을 화면 구조로 명확히 한다.
- [ ] **Step 5:** 랜딩과 설정 스모크를 통과시킨다.

### Task 8: 시각 시스템과 반응형 마감

**Files:**
- Modify: apps/web/app/globals.css
- Modify: 모든 변경된 컴포넌트
- Modify: scripts/smoke.mjs

**Interfaces:**
- Produces: 1360px, 768px, 390px, 320px에서 일관된 레이아웃

- [ ] **Step 1:** porcelain·ink·indigo·coral·teal 토큰과 간격·타입 스케일을 정의한다.
- [ ] **Step 2:** 불필요한 카드 중첩과 테두리를 제거하고 시간표를 가장 높은 위계에 둔다.
- [ ] **Step 3:** 모바일 하단 행동 영역, safe-area, 44px 터치 대상을 구현한다.
- [ ] **Step 4:** 1360px와 390px 스크린샷을 생성해 과밀·잘림·행동 중복을 눈으로 검토한다.
- [ ] **Step 5:** 발견한 시각 결함을 수정하고 같은 크기로 다시 촬영한다.

### Task 9: 전체 검증과 문서 동기화

**Files:**
- Modify: README.md
- Modify: 04-operations.md
- Modify: scripts/smoke.mjs

**Interfaces:**
- Produces: 실제 동작과 일치하는 개발·운영 문서

- [ ] **Step 1:** npm run check와 npm run typecheck을 실행한다.
- [ ] **Step 2:** npm test를 단독 실행해 전체 테스트 수와 실패 0을 확인한다.
- [ ] **Step 3:** npm run build 뒤 로컬 서버 루트가 200인지 확인한다.
- [ ] **Step 4:** 데스크톱·모바일 전체 스모크와 화면 갈무리를 실행한다.
- [ ] **Step 5:** README의 기능·명령·자료 원칙을 실제 상태와 맞추고 git diff를 자체 검토한다.

