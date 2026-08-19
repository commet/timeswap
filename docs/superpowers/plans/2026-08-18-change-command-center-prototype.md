# 조율 변경 관제판 브라우저 프로토타입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 나이스 공개 시간표의 구조와 불완전성을 안전하게 다루면서, 교사의 부재 요청부터 담당자 승인·행정 마감·교사 및 학급 시간표 게시까지 하나의 변경 사건으로 전파되는 경쟁력 있는 브라우저 프로토타입을 완성한다.

**Architecture:** `@timeswap/engine`은 나이스 정규화와 시간표 제약 계산을 맡는 순수 계층으로 유지한다. 웹에는 변경 사건·게시본·감사 이력을 다루는 순수 도메인 서비스, 교체 가능한 저장소 인터페이스, 역할별 읽기 모델을 차례로 둔다. React 화면은 이 경계를 통해서만 상태를 바꾸며, 정적 배포를 유지하기 위해 URL query 기반 탐색과 브라우저 저장소를 사용한다. 공식 시간표 사실과 합성 교사·부재 사건은 출처 메타데이터로 분리한다.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript 7 strict mode, Vitest 4, Playwright 1.62, 나이스 교육정보 개방 포털 JSON API

**Spec:** `docs/superpowers/specs/2026-08-18-change-command-center-design.md`

## Global Constraints

- 범위는 승인된 설계의 단계 A뿐이다. 공유 서버, 계정, 실시간 알림, 나이스 쓰기 연동은 구현하지 않는다.
- 경쟁 서비스의 코드, 비공식 API, 전용 파일, 화면 자산, 데이터 체계를 사용하지 않는다. 입력은 나이스 공식 공개 API와 학교가 권한을 갖고 제공한 자료뿐이다.
- 사용자가 제공한 나이스 인증키는 코드, 테스트 fixture, 문서, URL 예시, 로그, Git, `localStorage`에 기록하지 않는다. 프로토타입에서는 React 세션 메모리에만 둔다.
- 실제 학교명·학급·날짜·과목은 공개 사실로 표시하고, 교사명·부재·승인·보강 부담은 합성임을 화면과 데이터에 명시한다.
- 필수값 누락, 페이지 총계 불일치, 미배정 교사, 휴업일, 병렬 강좌를 빈 시간으로 추론하지 않는다. 완전성을 증명하지 못하면 추천과 게시를 차단한다.
- 승인과 게시를 분리한다. 공개 학급 시간표에는 `published` 게시본만 투영한다.
- 모든 후보는 계산에 사용한 `BaseScheduleRevision.id`를 보존하고 승인 직전에 활성 버전과 전체 사건을 다시 검증한다.
- 새 동작은 가장 작은 실패 테스트를 먼저 실행한 뒤 최소 구현으로 통과시킨다. 각 작업이 끝날 때 관련 테스트와 전체 타입 검사를 실행한다.
- 주요 조작 대상은 44px 이상, 320px에서 문서 가로 넘침 0, 키보드만으로 핵심 여정 완료, `prefers-reduced-motion` 지원을 품질 관문으로 둔다.
- 기존 작업 트리에 사용자의 변경이 있으면 덮어쓰지 않는다. 작업별 커밋 전에 `git diff --check`와 `git status --short`로 범위를 확인한다.

## File and Responsibility Map

### Engine data boundary

- Modify `packages/engine/src/adapters/neis.ts`: 기존 기준 시간표·변경 이력 계산이 정규화 결과를 소비하도록 연결한다.
- Create `packages/engine/src/adapters/neis-normalize.ts`: 필수 필드 검증, 전체 학급 식별자, 완전 중복 제거, 병렬 강좌 묶음, 자료 진단.
- Modify `packages/engine/src/index.ts`: 새 정규화 계약을 공개한다.
- Create `packages/engine/test/neis-normalize.test.ts`: 직업계고 동명 반과 중복/병렬 강좌 회귀 테스트.
- Create `packages/engine/test/fixtures/neis-data-quality.json`: 공개 나이스 행에서 필요한 열만 남긴 소형 회귀 fixture. 인증키와 교사 정보는 포함하지 않는다.

### Web data, domain, and persistence boundary

- Modify `apps/web/lib/neis.ts`: 모든 페이지 수신, 총계 검증, 2023-08~2024 공백, 최근 수업 주 탐색, 오류 분류.
- Create `apps/web/lib/neis-session.ts`: 인증키를 메모리에서만 보유하는 세션 값.
- Modify `apps/web/lib/app.ts`: 인증키 영구 저장 제거, 기존 시간표 유틸리티만 유지.
- Create `apps/web/lib/domain.ts`: 변경 사건, 해결 항목, 행정 작업, 게시본, 감사 이벤트의 canonical types.
- Create `apps/web/lib/case-service.ts`: 상태 전이, 해결안 변경, 전체 충돌·버전 재검증, 게시 규칙.
- Create `apps/web/lib/repository.ts`: 브라우저 저장소 구현과 향후 서버 구현이 따를 `WorkspaceRepository` 인터페이스.
- Create `apps/web/lib/projections.ts`: 교사·담당자·공개 학급 화면 읽기 모델.
- Create `apps/web/lib/navigation.ts`: 정적 export에서 URL과 뒤로 가기를 보존하는 query 기반 위치 모델.
- Create `apps/web/lib/demo.ts`: 8개 사용자 여정의 합성 운영 사건과 공개 자료 출처 설명.
- Retire `apps/web/lib/requests.ts` after its v1 decoder is moved into `repository.ts`; 삭제는 마이그레이션 테스트가 통과한 작업에서만 한다.

### React boundary

- Refactor `apps/web/components/Workbench.tsx`: 거대 상태 오케스트레이터에서 저장소·내비게이션·역할 화면을 연결하는 얇은 shell로 축소한다.
- Create `apps/web/components/AppShell.tsx`, `RoleNavigation.tsx`, `DataHealthPanel.tsx`, `SetupFlow.tsx`.
- Refactor `Landing.tsx`, `TeacherHome.tsx`, `Grid.tsx`, `NeisLoader.tsx`.
- Create `AbsenceComposer.tsx`, `ResolutionMatrix.tsx`, `OpsCommandCenter.tsx`, `CaseDetail.tsx`, `PublicationCenter.tsx`, `PublicClassTimetable.tsx`, `ChangePulse.tsx`, `DemoScenarioPicker.tsx`.
- Retire `CandidateCompare.tsx`, `CoverCompare.tsx`, `OpsInbox.tsx`, `RequestStatusList.tsx` after replacement browser tests pass.

### Visual and verification boundary

- Refactor `apps/web/app/globals.css` into imports from `apps/web/styles/tokens.css`, `shell.css`, `timetable.css`, `workflow.css`, `responsive.css`.
- Extend `scripts/smoke.mjs` to cover the five critical browser journeys and three target widths.
- Create `scripts/visual-review.mjs` for deterministic screenshots of landing, teacher, comparison, command center, publication, and public class views.
- Update `README.md`, `docs/data-and-privacy-boundary.md`, and `04-operations.md` only after implementation behavior is verified.

---

### Task 1: Make NEIS rows lossless, diagnosable, and collision-safe

**Files:**
- Create: `packages/engine/src/adapters/neis-normalize.ts`
- Modify: `packages/engine/src/adapters/neis.ts`
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/test/neis-normalize.test.ts`
- Create: `packages/engine/test/fixtures/neis-data-quality.json`

**Interfaces:**

```ts
export interface ClassIdentity {
  schoolCode: string;
  academicYear: string;
  dayCourse: string;
  affiliation: string;
  major: string;
  grade: string;
  className: string;
}

export interface NeisNormalizationReport {
  accepted: NormalizedNeisRow[];
  quarantined: Array<{ row: NeisRow; missing: string[] }>;
  duplicateCount: number;
  parallelGroups: ParallelLessonGroup[];
}

export function normalizeNeisRows(rows: NeisRow[]): NeisNormalizationReport;
export function classIdentityKey(identity: ClassIdentity): string;
```

- [ ] **Step 1: Add a focused failing test for complete class identity.** Create two high-school rows with the same grade and class number but different `ORD_SC_NM` or `DDDEP_NM`. Assert that `classIdentityKey` produces two keys and that both normalized rows survive.

```ts
it('keeps same-named vocational classes separate by affiliation and major', () => {
  const report = normalizeNeisRows([
    row({ ORD_SC_NM: '공업계', DDDEP_NM: '기계과', GRADE: '2', CLASS_NM: '1' }),
    row({ ORD_SC_NM: '공업계', DDDEP_NM: '건축과', GRADE: '2', CLASS_NM: '1' }),
  ]);
  expect(new Set(report.accepted.map((item) => item.classKey)).size).toBe(2);
});
```

- [ ] **Step 2: Run the test and record the expected failure.** Run `npm run test -w @timeswap/engine -- neis-normalize.test.ts`. Expected: the new module cannot be resolved.
- [ ] **Step 3: Implement the canonical row contract.** Extend `NeisRow` with optional official fields `ATPT_OFCDC_SC_CODE`, `SD_SCHUL_CODE`, `DGHT_CRSE_SC_NM`, `ORD_SC_NM`, `DDDEP_NM`, `LOAD_DTM`; require date, grade, class, period, subject during normalization; normalize whitespace without inventing missing values.
- [ ] **Step 4: Add failing tests for quarantine and exact deduplication.** Assert that a missing `PERIO` row is quarantined, two byte-equivalent lesson facts become one accepted row, and the report counts one duplicate.

```ts
expect(report.quarantined[0]?.missing).toContain('PERIO');
expect(report.accepted).toHaveLength(1);
expect(report.duplicateCount).toBe(1);
```

- [ ] **Step 5: Implement exact fact keys.** Build the dedupe key from school, academic year, date, day course, affiliation, major, grade, class, period, stripped subject, and room. Do not include load timestamp because repeated loads of the same fact must collapse.
- [ ] **Step 6: Add the parallel-course failure test.** Supply two distinct subjects for the same full class identity, date, and period. Assert that both rows remain and one `ParallelLessonGroup` references both row ids.
- [ ] **Step 7: Feed normalized rows into `fromNeis`.** Preserve the current `fromNeis(rows)` public entry point, but call `normalizeNeisRows` first and use `classKey` rather than `${GRADE}-${CLASS_NM}` internally. Add `normalization` to `NeisReport` so the UI can show accepted, quarantined, duplicate, and parallel counts.
- [ ] **Step 8: Add the small public-data regression fixture.** Include representative, non-secret rows for Seoul Technical High School and Daegu Technical High School identity collisions plus one observed exact duplicate/true parallel pair. Add `source` and retrieval date in the fixture metadata; do not include the API key or invented teacher names.
- [ ] **Step 9: Run the engine suite.** Run `npm run test -w @timeswap/engine` and `npm run typecheck -w @timeswap/engine`. Expected: all prior NEIS change, holiday, grouping, and new normalization tests pass.
- [ ] **Step 10: Commit the vertical slice.** Run `git diff --check`, inspect that no credential assignment is present with `rg -n "KEY=.*[A-Za-z0-9]{8}" packages/engine`, then commit with `git commit -m "feat(engine): harden NEIS normalization"`.

### Task 2: Make live NEIS loading complete, explicit, and session-only

**Files:**
- Modify: `apps/web/lib/neis.ts`
- Create: `apps/web/lib/neis-session.ts`
- Modify: `apps/web/lib/app.ts`
- Create: `apps/web/test/neis.test.ts`
- Modify: `apps/web/test/app.test.ts`

**Interfaces:**

```ts
export type NeisFailureCode =
  | 'NO_DATA'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'HISTORICAL_GAP'
  | 'INCOMPLETE_PAGE_SET'
  | 'NETWORK';

export interface CompleteNeisResult<T> extends NeisCallResult<T> {
  fetchedAt: string;
  pageCount: number;
  complete: boolean;
}

export async function fetchAllNeisRows<T>(request: NeisRequest): Promise<CompleteNeisResult<T>>;
export async function findRecentTeachingWeek(query: TimetableQuery): Promise<CompleteNeisResult<NeisRow>>;
export function createNeisSession(): { getKey(): string; setKey(value: string): void; clear(): void };
```

- [ ] **Step 1: Write the pagination failure tests with mocked `fetch`.** Cover 1,001 raw rows over two pages, legitimate duplicate facts that still count as raw response rows, a repeated whole page that makes no progress, and a head total that does not equal the combined raw row count. Assert `INCOMPLETE_PAGE_SET` for stalled pages or total mismatch rather than returning a partial schedule.
- [ ] **Step 2: Run `npm run test -w web -- neis.test.ts`.** Expected: missing exports fail the suite.
- [ ] **Step 3: Extract a generic complete-page loader.** Request `pSize=1000`, increment `pIndex` until the official raw total is reached, retain response head metadata, and throw a typed error if an identical whole page repeats without progress or raw totals disagree. Individual duplicate facts are retained here and removed only by Task 1 normalization. Keep `schoolInfo`, `classInfo`, `SchoolSchedule`, `schulAflcoinfo`, `schoolMajorinfo`, `tiClrminfo`, `hisTimetable`, and `misTimetable` behind explicit endpoint functions.
- [ ] **Step 4: Add and pass historical-gap tests.** Reject queries whose requested period falls in the documented gap from 2023-08 through the 2024 academic year, with a Korean action message explaining that this range is unavailable through the normal API and must not be interpreted as a no-class week. Keep pre-July-2023 `*Timetablebgs` outside the product loader.
- [ ] **Step 5: Add and pass keyless/truncation tests.** A keyless timetable response with only five rows must return `complete: false` and prevent version creation. A school-name search may still show limited results but labels them as a preview.
- [ ] **Step 6: Add and pass recent-teaching-week tests.** Starting from a fixed date, simulate an empty week followed by a non-empty earlier week. Assert that the non-empty complete week is selected and that five empty complete weeks produce `NO_DATA`, not an empty timetable.
- [ ] **Step 7: Implement typed handling for official errors.** Map result code/message 337 to `RATE_LIMITED`, authentication errors to `AUTH_REQUIRED`, and transport failures to `NETWORK`. Preserve the last complete revision in callers; do not loop retry inside the API client.
- [ ] **Step 8: Remove persistent key functions.** Delete `NEIS_KEY_STORE`, `loadNeisKey`, and `saveNeisKey` from `apps/web/lib/app.ts`. Implement a closure-backed session object whose key never reaches Web Storage or a URL returned to the UI.

```ts
export function createNeisSession() {
  let key = '';
  return {
    getKey: () => key,
    setKey: (value: string) => { key = value.trim(); },
    clear: () => { key = ''; },
  };
}
```

- [ ] **Step 9: Add the security regression.** Assert that the source tree contains no call that stores a NEIS key and that `createNeisSession().setKey('secret')` changes no provided `Storage` spy. Run `rg -n "NEIS_KEY_STORE|loadNeisKey|saveNeisKey" apps/web` and expect no production matches.
- [ ] **Step 10: Run web unit and type tests.** Run `npm run test -w web` and `npm run typecheck -w web`.
- [ ] **Step 11: Commit the vertical slice.** Run `git diff --check`, inspect query logging manually, then commit with `git commit -m "feat(web): make NEIS loading complete and ephemeral"`.

### Task 3: Replace single requests with an auditable absence-case state machine

**Files:**
- Create: `apps/web/lib/domain.ts`
- Create: `apps/web/lib/case-service.ts`
- Create: `apps/web/test/case-service.test.ts`

**Interfaces:**

```ts
export type CaseStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'resolution_approved'
  | 'admin_in_progress'
  | 'ready_to_publish'
  | 'published'
  | 'rejected'
  | 'cancelled'
  | 'superseded';

export interface AbsenceCase {
  id: string;
  workspaceId: string;
  requesterTeacherId: string;
  fromDate: string;
  toDate: string;
  reason: '업무상 부재' | '연수·출장' | '학교 행사' | '기타';
  note?: string;
  lessonIds: string[];
  resolutionItems: ResolutionItem[];
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  supersedesCaseId?: string;
}

export interface WorkspaceState {
  schemaVersion: 2;
  workspace: SchoolWorkspace;
  revisions: BaseScheduleRevision[];
  lessons: Lesson[];
  cases: AbsenceCase[];
  adminTasks: AdminTask[];
  publications: Publication[];
  audit: AuditEvent[];
}
```

- [ ] **Step 1: Write the failing creation test.** Create a teacher with four lessons on one date, call `createAbsenceCase`, and assert one case holds all four lesson ids without duplicating the reason or note.
- [ ] **Step 2: Run `npm run test -w web -- case-service.test.ts`.** Expected: module resolution failure.
- [ ] **Step 3: Define canonical entities.** Add `SchoolWorkspace`, `BaseScheduleRevision`, `ClassIdentity`, `Lesson`, `ParallelLessonGroup`, `ResolutionItem`, `AdminTask`, `Publication`, and `AuditEvent`. Use string ids and ISO timestamps consistently. Represent unassigned teachers as `{ state: 'unassigned' }`, not an empty string.
- [ ] **Step 4: Implement creation and immutable audit appends.** `createAbsenceCase` validates date order, requester, at least one affected lesson, and a single workspace. It appends `case.created` without storing health details beyond the approved reason categories.
- [ ] **Step 5: Write a table-driven failing state test.** Assert every allowed edge in the specification and reject skipped edges such as `submitted → published`, reopening terminal states, and deleting published records.

```ts
const allowed: Array<[CaseStatus, CaseStatus]> = [
  ['draft', 'submitted'],
  ['submitted', 'in_review'],
  ['in_review', 'resolution_approved'],
  ['resolution_approved', 'admin_in_progress'],
  ['admin_in_progress', 'ready_to_publish'],
  ['ready_to_publish', 'published'],
];
```

- [ ] **Step 6: Implement `transitionCase`.** Require an actor id and timestamp, validate the transition matrix, store a rejection note for `rejected`, and append an audit event with previous and next status.
- [ ] **Step 7: Add administrative policy tests.** Configure prototype-required tasks as `neis`, `teacher_notice`, and `class_publication`. Assert that completing all required tasks moves the case to `ready_to_publish`, while optional `internal_document` may remain open.
- [ ] **Step 8: Add supersession tests.** `createCorrectionCase` must leave the published case immutable, create a new draft linked through `supersedesCaseId`, and only mark the old case `superseded` when the correction publication succeeds.
- [ ] **Step 9: Run all web unit and type tests.** Run `npm run test -w web` and `npm run typecheck -w web`.
- [ ] **Step 10: Commit the vertical slice.** Run `git diff --check` and commit with `git commit -m "feat(web): model auditable absence cases"`.

### Task 4: Put browser persistence and URL navigation behind replaceable boundaries

**Files:**
- Create: `apps/web/lib/repository.ts`
- Create: `apps/web/lib/navigation.ts`
- Create: `apps/web/test/repository.test.ts`
- Create: `apps/web/test/navigation.test.ts`
- Modify: `apps/web/lib/requests.ts`

**Interfaces:**

```ts
export interface WorkspaceRepository {
  load(workspaceId: string): WorkspaceState | null;
  save(state: WorkspaceState): { ok: true } | { ok: false; reason: 'quota' | 'unavailable' };
  export(state: WorkspaceState): string;
}

export type AppLocation =
  | { view: 'landing' }
  | { view: 'setup' }
  | { view: 'teacher'; school: string; teacher: string }
  | { view: 'ops'; school: string; caseId?: string }
  | { view: 'class'; school: string; grade: string; className: string };
```

- [ ] **Step 1: Write failing storage round-trip tests.** Use an in-memory `Storage` double. Assert schema v2 preserves revisions, multi-lesson cases, tasks, publications, and audit events.
- [ ] **Step 2: Add a failing v1 migration test.** Encode one legacy `ChangeRequest`, load it through the new repository, and assert it becomes one `AbsenceCase` with one resolution item and a `migration.v1` audit event. Invalid legacy entries are skipped with a diagnostic count.
- [ ] **Step 3: Implement repository serialization and migration.** Make the repository the only production module that reads or writes the new workspace key. Return a typed failure instead of swallowing quota/security errors. Preserve `export()` even when saving is unavailable.
- [ ] **Step 4: Remove the legacy request storage API.** Move only the pure v1 decoder needed by migration into `repository.ts`; update tests, then delete `apps/web/lib/requests.ts` after `rg -n "from '@/lib/requests'|from '../lib/requests'" apps/web` returns no imports.
- [ ] **Step 5: Write failing URL parse/format tests.** Round-trip Korean school, grade, class, teacher, and case ids through `URLSearchParams`; malformed or incomplete locations must resolve to landing rather than throwing.

```ts
const location: AppLocation = {
  view: 'class', school: 'joyul-demo', grade: '2', className: '4',
};
expect(parseLocation(formatLocation(location))).toEqual(location);
```

- [ ] **Step 6: Implement query navigation.** Use paths that remain valid under static export, for example `/?view=class&school=joyul-demo&grade=2&class=4`. Expose `pushLocation`, `replaceLocation`, and `subscribeToPopState`; never put a NEIS key or internal note into the URL.
- [ ] **Step 7: Add back-button behavior tests.** With a small history double, assert teacher → case → ops → back returns to the case and then teacher view in order.
- [ ] **Step 8: Run focused and full tests.** Run `npm run test -w web -- repository.test.ts navigation.test.ts`, then `npm run test -w web` and `npm run typecheck -w web`.
- [ ] **Step 9: Commit the vertical slice.** Run `git diff --check`, inspect that `localStorage` calls exist only in the repository and unrelated preference utilities, then commit with `git commit -m "refactor(web): isolate persistence and navigation"`.

### Task 5: Derive every role view from revisions, cases, and publications

**Files:**
- Create: `apps/web/lib/projections.ts`
- Modify: `apps/web/lib/case-service.ts`
- Create: `apps/web/test/projections.test.ts`
- Create: `apps/web/test/revalidation.test.ts`

**Interfaces:**

```ts
export interface PlanValidation {
  valid: boolean;
  staleRevision: boolean;
  conflicts: Array<{
    lessonId: string;
    kind: 'teacher' | 'class' | 'closure' | 'unknown-occupancy' | 'parallel-group';
    message: string;
  }>;
}

export function validateCasePlan(state: WorkspaceState, caseId: string): PlanValidation;
export function projectTeacherSchedule(state: WorkspaceState, teacherId: string): TeacherScheduleView;
export function projectOpsDashboard(state: WorkspaceState, today: string): OpsDashboardView;
export function projectPublicClassSchedule(state: WorkspaceState, classKey: string): PublicClassView;
```

- [ ] **Step 1: Write the public-boundary failure test.** Create the same resolved case in `resolution_approved`, `ready_to_publish`, and `published`. Assert the public projection uses the base lesson for the first two and the changed lesson only for `published`.
- [ ] **Step 2: Run `npm run test -w web -- projections.test.ts`.** Expected: missing module failure.
- [ ] **Step 3: Implement immutable role projections.** The teacher projection exposes base, `변경 예정`, and published values; the public projection omits requester, reason, admin note, burden, candidate score, and audit actor. The ops projection counts unresolved lessons, pending cases, NEIS tasks, publication tasks, burden alerts, and source health from canonical state.
- [ ] **Step 4: Add a stale-revision failure test.** Compute a candidate against revision `r1`, make `r2` active, then attempt approval. Assert validation sets `staleRevision: true`, transition remains `in_review`, and no admin task is created.
- [ ] **Step 5: Implement revision checks.** Each `ResolutionItem` candidate records `computedAgainstRevisionId`; approval calls `validateCasePlan` against `workspace.activeRevisionId`. A stale candidate is never silently copied to the new revision.
- [ ] **Step 6: Add a concurrent-case failure test.** Two cases propose use of the same teacher and slot. Approve the first, then assert the second reports a teacher conflict and must be recomputed before approval.
- [ ] **Step 7: Implement whole-case collision checks.** Combine all selected resolution movements with active accepted/published cases, base teacher occupancy, full class identities, closures, and parallel groups. An unassigned teacher or unknown occupancy produces `unknown-occupancy`, not availability.
- [ ] **Step 8: Add the 41-class scale guard.** Build a deterministic 41-class fixture with 10 cases and measure ten validations using `performance.now()`. Assert completion under 1,000ms in the Vitest process while also asserting zero invalid plan approvals.
- [ ] **Step 9: Run focused and full suites.** Run `npm run test -w web -- projections.test.ts revalidation.test.ts`, `npm test`, and `npm run typecheck`.
- [ ] **Step 10: Commit the vertical slice.** Run `git diff --check` and commit with `git commit -m "feat(web): derive role views and revalidate changes"`.

### Task 6: Build the real-structure demo corpus and ten regression scenarios

**Files:**
- Create: `apps/web/lib/demo.ts`
- Create: `apps/web/test/demo.test.ts`
- Modify: `apps/web/lib/app.ts`
- Create: `docs/research/neis-corpus-summary-2026-08-18.json`
- Modify: `docs/superpowers/specs/2026-08-18-change-command-center-design.md`

**Interfaces:**

```ts
export type DemoScenarioId =
  | 'simple-swap'
  | 'full-day-absence'
  | 'elective-block'
  | 'practice-block'
  | 'closure-conflict'
  | 'incomplete-api'
  | 'concurrent-request'
  | 'published-correction'
  | 'vocational-class-identity'
  | 'duplicate-vs-parallel';

export function createDemoWorkspace(now?: string): WorkspaceState;
export function loadDemoScenario(id: DemoScenarioId, now?: string): WorkspaceState;
```

- [ ] **Step 1: Write a failing inventory test.** Assert all ten ids exist, each scenario has a deterministic initial view and expected outcome, user-facing scenarios 1–8 appear in the command center, and data-quality scenarios 9–10 remain in diagnostics/tests.
- [ ] **Step 2: Run `npm run test -w web -- demo.test.ts`.** Expected: missing exports fail.
- [ ] **Step 3: Create a provenance-aware fixture builder.** Set `factSource` to official NEIS metadata for public schedule facts and `operationSource` to `synthetic-demo` for teachers, absence reasons, approvals, and burden. The UI label must read `공식 시간표 구조 · 교사와 사건은 예시`.
- [ ] **Step 4: Implement the simple swap and full-day cases.** The default entry opens a same-day 3rd/4th-period swap. The full-day case has four affected lessons with exactly two swap resolutions, one cover resolution, and one unresolved item.
- [ ] **Step 5: Implement the elective, practice, closure, and incomplete-source cases.** Preserve elective parallel groups atomically, keep a three-period professional-practice block unsplittable, reject a closure move, and model a 5-of-6 API response whose revision remains incomplete and recommendation-disabled.
- [ ] **Step 6: Implement concurrency and correction cases.** One stale request becomes invalid after another approval. A published case correction starts as a linked draft and leaves the old publication visible until replacement publication.
- [ ] **Step 7: Connect the two engine data regressions.** Load the Task 1 fixture for full vocational class identity and exact-duplicate versus real-parallel assertions. They must not depend on a live API or authentication key.
- [ ] **Step 8: Preserve and test the measured corpus manifest.** Write `docs/research/neis-corpus-summary-2026-08-18.json` with the 12 public school codes/names, the complete teaching week queried for each school, per-school counts, endpoint, retrieval date, and totals: 12,145 raw rows, 250 invalid, 393 exact duplicates, 11,502 valid unique, 1,631 professional rows, 464 blocks, and 288 parallel cells. Store no response URL with a key. Parse the manifest in `demo.test.ts` and assert its per-school sums equal the documented totals; treat them as research provenance, not runtime success thresholds.
- [ ] **Step 9: Remove obsolete one-off sample request creation.** Retain reusable schedule generation from `sampleSchool()` only where needed, and make all UI demo state originate in `createDemoWorkspace`.
- [ ] **Step 10: Run the suite and commit.** Run `npm test`, `npm run typecheck`, `git diff --check`, then commit with `git commit -m "feat(web): add operational demo scenarios"`.

### Task 7: Rebuild entry, app shell, role navigation, and one-time school setup

**Files:**
- Create: `apps/web/components/AppShell.tsx`
- Create: `apps/web/components/RoleNavigation.tsx`
- Create: `apps/web/components/SetupFlow.tsx`
- Create: `apps/web/components/DataHealthPanel.tsx`
- Modify: `apps/web/components/Landing.tsx`
- Modify: `apps/web/components/NeisLoader.tsx`
- Modify: `apps/web/components/Workbench.tsx`
- Modify: `apps/web/app/page.tsx`
- Modify: `scripts/smoke.mjs`

**Component contracts:**

```tsx
type AppShellProps = {
  state: WorkspaceState | null;
  location: AppLocation;
  saveState(next: WorkspaceState): void;
  navigate(next: AppLocation): void;
};

export function AppShell(props: AppShellProps): React.ReactNode;
```

- [ ] **Step 1: Add failing landing browser assertions.** In `scripts/smoke.mjs`, assert the first viewport offers `우리 학교 시간표 열기`, `일과 담당자로 시작`, and `예시 학교 둘러보기`; there is no API-key field or file-format explanation on the landing page.
- [ ] **Step 2: Build a thin controlled `AppShell`.** Make `Workbench` initialize repository, navigation subscription, and session-only NEIS key, then delegate rendering. Remove engine search, request transition, and raw storage writes from component event handlers as their services become available.
- [ ] **Step 3: Rework landing around school entry.** Provide school-name search or received-link paste as the primary path, setup as secondary, and demo as immediate low-friction entry. State the official/school-owned data boundary in one compact trust line.
- [ ] **Step 4: Add role navigation without pretending authentication.** Label the prototype role switcher `체험 역할`; use Teacher, 일과 담당, 학급 공개 views. Never present this switcher as production access control.
- [ ] **Step 5: Write and run setup-flow browser failures.** Assert the ordered stages are school search → session key → official data load → completeness review → teacher mapping → unresolved review → invitation links. The invitation step must remain disabled when completeness is false or unresolved teachers exist.
- [ ] **Step 6: Implement setup with `NeisLoader`.** Show page totals, accepted/quarantined/duplicate/parallel counts, latest teaching week, academic year, and last load time. Clear the in-memory key after setup completes or the user exits.
- [ ] **Step 7: Implement teacher mapping input.** Support the existing JSON import plus bulk mapping controls; show unresolved duplicate names and grouped-course suspicions. Use synthetic mappings automatically only in example-school mode and label them.
- [ ] **Step 8: Generate static invitation links.** Teacher links include school and synthetic teacher id; class links include school, grade, and class. They must contain no internal note, raw schedule payload, or NEIS key.
- [ ] **Step 9: Verify keyboard and back navigation.** Tab through landing actions and setup inputs; use browser back from setup to landing and from role view to school entry. Focus must move to the new page heading.
- [ ] **Step 10: Run build and focused smoke.** Run `npm run typecheck`, `npm run build`, start `npm run serve` in a separate terminal, and run `npm run smoke`. Expected: landing, demo entry, setup gating, and back navigation pass.
- [ ] **Step 11: Commit the vertical slice.** Run `git diff --check` and commit with `git commit -m "feat(web): rebuild entry and school setup"`.

### Task 8: Make the teacher journey timetable-first and case-based

**Files:**
- Modify: `apps/web/components/TeacherHome.tsx`
- Modify: `apps/web/components/Grid.tsx`
- Create: `apps/web/components/AbsenceComposer.tsx`
- Modify: `apps/web/components/Workbench.tsx`
- Create: `apps/web/test/absence-composer.test.ts`
- Modify: `scripts/smoke.mjs`

**Pure selection contract:**

```ts
export function lessonsAffectedByAbsence(
  lessons: Lesson[],
  teacherId: string,
  fromDate: string,
  toDate: string,
): Lesson[];
```

- [ ] **Step 1: Write failing affected-lesson tests.** Cover a single period, four lessons across one day, an inclusive date range, published schedule changes, and an unassigned lesson that must not be claimed by the teacher.
- [ ] **Step 2: Implement the pure selector in `case-service.ts`.** Sort by date and period, preserve block/group membership, and return stable ids for selection.
- [ ] **Step 3: Add failing teacher-home smoke assertions.** At 390px, the first viewport must show now/next lesson, today’s change count, and one persistent `변경 요청` action before the weekly timetable. The Today tab starts selected.
- [ ] **Step 4: Rebuild today and week views from projections.** Use a period rail for today and the existing grid for week. Published changes show new subject plus smaller original subject; approved but unpublished changes use `변경 예정` text and dashed treatment.
- [ ] **Step 5: Implement case composition.** Selecting a lesson pre-fills date and lesson. Changing to a full-day absence automatically selects all affected lessons, allows explicit deselection, and shows affected lesson count and collaborating teacher count before candidate calculation.
- [ ] **Step 6: Enforce approved reason capture.** Provide four reason categories and a short coordination memo. Do not request diagnosis, medical details, phone number, or unrestricted personal profile data.
- [ ] **Step 7: Add unavailable-source behavior.** If the active revision or teacher mapping is incomplete, show the exact known/expected count and corrective action, disable recommendation, and still allow exporting a diagnostic report.
- [ ] **Step 8: Add request-submission focus behavior.** After submission, focus the case status heading and clear transient absence markings. Duplicate submission for the same teacher, date range, and lesson set is rejected with an actionable message.
- [ ] **Step 9: Run unit, type, and browser tests.** Run `npm run test -w web -- absence-composer.test.ts`, `npm run typecheck`, build, serve, and `npm run smoke` at 1440px and 390px.
- [ ] **Step 10: Commit the vertical slice.** Run `git diff --check` and commit with `git commit -m "feat(web): make teacher requests case based"`.

### Task 9: Replace candidate reading with one resolution matrix and whole-case preview

**Files:**
- Create: `apps/web/components/ResolutionMatrix.tsx`
- Modify: `apps/web/components/Grid.tsx`
- Modify: `apps/web/components/Workbench.tsx`
- Delete: `apps/web/components/CandidateCompare.tsx`
- Delete: `apps/web/components/CoverCompare.tsx`
- Create: `apps/web/test/resolution.test.ts`
- Modify: `scripts/smoke.mjs`

**View model:**

```ts
export interface ResolutionRow {
  id: string;
  method: '빈 교시 이동' | '맞교환' | '연쇄 교환' | '보강';
  collaborators: string[];
  movedUnitCount: number;
  studentImpact: string;
  burden: string;
  state: 'recommended' | 'valid' | 'warning';
  disabledReason?: string;
}
```

- [ ] **Step 1: Add a failing view-model test.** Merge engine move/swap/cycle candidates and cover candidates into one ranked list capped at five initial rows. Assert each row has every comparison column and only one selected-detail model.
- [ ] **Step 2: Implement `resolutionRowsForLesson`.** Preserve hard-invalid candidates as omitted, label soft risk as warnings, compute collaborator names and student impact once, and keep engine trace for selected detail only.
- [ ] **Step 3: Add the no-repeated-actions browser failure.** Count comparison rows and assert exactly one `이 해결안 선택` button exists below the table, not one per candidate. Verify selecting a row changes preview and detail without submitting.
- [ ] **Step 4: Implement the desktop matrix.** Use semantic radio selection inside a table with fixed columns 방법, 협조, 변경, 학생 영향, 부담, 상태. Support ArrowUp/ArrowDown row movement and Space selection.
- [ ] **Step 5: Implement mobile row summaries.** At 390px and 320px, preserve the same comparison information as labeled row pairs rather than horizontal scrolling. Keep one sticky primary action that does not cover the last detail row.
- [ ] **Step 6: Link selected detail to the timetable.** Highlight from/to slots, grouped units, original/new subjects, collaborators, and warning reasons. Respect reduced-motion by applying final highlights immediately.
- [ ] **Step 7: Implement multi-lesson resolution progress.** Show every affected lesson in one case rail with `해결`, `주의`, `미해결`; selecting a candidate updates one item and immediately re-runs `validateCasePlan` for the combined plan.
- [ ] **Step 8: Put cover beside sparse swap results.** When fewer than three valid exchange candidates exist, include cover rows in the same matrix. A zero-candidate elective block explains the atomic group constraint and still permits a valid cover choice.
- [ ] **Step 9: Remove old compare components only after coverage passes.** Update all imports, run `rg -n "CandidateCompare|CoverCompare" apps/web` and expect no production matches, then delete both files.
- [ ] **Step 10: Run tests and commit.** Run `npm test`, `npm run typecheck`, build, serve, and `npm run smoke`; then `git diff --check` and commit with `git commit -m "feat(web): unify resolution comparison"`.

### Task 10: Turn the ops inbox into a live change command center

**Files:**
- Create: `apps/web/components/OpsCommandCenter.tsx`
- Create: `apps/web/components/CaseDetail.tsx`
- Create: `apps/web/components/DemoScenarioPicker.tsx`
- Modify: `apps/web/components/Workbench.tsx`
- Delete: `apps/web/components/OpsInbox.tsx`
- Modify: `scripts/smoke.mjs`

**Component contracts:**

```tsx
type OpsCommandCenterProps = {
  dashboard: OpsDashboardView;
  selectedCaseId?: string;
  onSelectCase(caseId: string): void;
  onOpenScenario(id: DemoScenarioId): void;
};

type CaseDetailProps = {
  state: WorkspaceState;
  caseId: string;
  onChange(next: WorkspaceState): void;
};
```

- [ ] **Step 1: Add failing dashboard browser assertions.** The ops start screen must show today changes, unresolved lessons, approval-waiting cases, NEIS-pending tasks, publish-pending tasks, burden alerts, and source health. Assert counts equal `projectOpsDashboard` for the deterministic demo clock.
- [ ] **Step 2: Implement the desktop three-region layout.** Put the prioritized case list on the left, today period timeline and operational metrics in the center, and selected case summary on the right. Selecting a case updates the URL `case` parameter and the detail without a page reload.
- [ ] **Step 3: Build the period timeline.** Plot changed periods by time rather than as repeated cards. Each marker names affected teacher/class count, uses text plus color for state, and opens the corresponding case.
- [ ] **Step 4: Implement prioritization.** Sort unresolved same-day absences first, then stale/invalid plans, submitted cases, administrative delays, and future cases. Show the reason for priority as visible text.
- [ ] **Step 5: Build `CaseDetail`.** Summarize requester, range, affected/solved counts, urgency, intersecting cases, data warnings, and the selected resolution per lesson. Provide one whole-case validation result above approval actions.
- [ ] **Step 6: Allow accountable intervention.** The ops user can select another valid candidate, switch a lesson to cover, leave a rejection reason, or return a case for recomputation. Every action uses `case-service.ts` and creates an audit event.
- [ ] **Step 7: Build the mobile step flow.** Under 760px, render 사건 목록 → 사건 상세 → 행정 마감 as separate URL-addressable steps with a visible back action. Do not compress the desktop three-column layout into narrow cards.
- [ ] **Step 8: Add the scenario picker.** Make scenarios 2–8 available under `현실 사례 바꾸기`, show the intended conflict in one sentence, and reset only the demo workspace after confirmation. Keep scenarios 9–10 out of the operational picker.
- [ ] **Step 9: Delete the old inbox after smoke coverage passes.** Run `rg -n "OpsInbox" apps/web`; update imports and remove `OpsInbox.tsx` only when no production reference remains.
- [ ] **Step 10: Verify and commit.** Run `npm run typecheck`, build, serve, and `npm run smoke` at 1440px, 390px, and 320px. Run `git diff --check` and commit with `git commit -m "feat(web): build the change command center"`.

### Task 11: Close the administrative loop and publish one shared truth

**Files:**
- Create: `apps/web/components/PublicationCenter.tsx`
- Create: `apps/web/components/PublicClassTimetable.tsx`
- Create: `apps/web/components/ChangePulse.tsx`
- Modify: `apps/web/components/TeacherHome.tsx`
- Modify: `apps/web/components/Workbench.tsx`
- Modify: `apps/web/lib/app.ts`
- Modify: `scripts/smoke.mjs`

**Output contracts:**

```ts
export function buildNeisInputList(state: WorkspaceState, caseId: string): string;
export function buildTeacherNotice(state: WorkspaceState, caseId: string): string;
export function buildClassPublicationPreview(state: WorkspaceState, caseId: string): PublicClassView[];
export function publishCase(state: WorkspaceState, caseId: string, actorId: string, at: string): WorkspaceState;
```

- [ ] **Step 1: Add failing publication-rule tests.** Assert `publishCase` rejects unresolved items, invalid plans, stale revisions, and incomplete required tasks. Assert a successful publication records revision id, case id, changed lesson ids, timestamp, and actor id.
- [ ] **Step 2: Implement task generation at approval.** Create `neis`, `teacher_notice`, `class_publication`, and optional `internal_document` tasks from the same resolution facts. Reuse facts in all documents; do not reconstruct them from display text.
- [ ] **Step 3: Build the publication center.** Show approval as complete but publication as pending, provide NEIS input list, teacher notice, class preview, internal-record print, and explicit task completion controls. Keep `게시` disabled until the domain returns `ready_to_publish`.
- [ ] **Step 4: Add clipboard/print failure handling.** A denied clipboard keeps the task incomplete and offers selectable text. A print cancellation does not mark the internal document complete. Storage failure after task updates shows export recovery before another action.
- [ ] **Step 5: Implement the read-only class timetable.** It shows school, grade/class, today/tomorrow/week, changed badge, original subject, and publication time. It exposes no teacher absence reason, candidate score, burden, admin note, or audit actor.
- [ ] **Step 6: Add the public-leak browser gate.** Before publication, open the class URL in a second page and assert the base schedule remains. After publication, reload the same URL and assert the changed lesson and timestamp appear.
- [ ] **Step 7: Update teacher projection rendering.** Approved/unpublished resolutions appear as `변경 예정`; published resolutions become the definitive teacher timetable. Both roles must show the same subject/class/period facts from one publication id.
- [ ] **Step 8: Implement `ChangePulse`.** On publication, visually connect the case, affected teacher timetable, and affected class timetable with a short state-propagation rail. Under reduced motion, announce the three updated destinations through an `aria-live` status without animation.
- [ ] **Step 9: Implement correction publication.** The correction case preview identifies the prior publication. On success, the prior case becomes superseded, a new publication becomes active, and the public timetable shows only the replacement while audit history preserves both.
- [ ] **Step 10: Run the end-to-end publication flow.** Build and serve, then run the smoke path teacher request → ops alternative → approval → administrative tasks → public precheck → publish → teacher/public verification → correction.
- [ ] **Step 11: Commit the vertical slice.** Run `npm test`, `npm run typecheck`, `git diff --check`, then commit with `git commit -m "feat(web): publish changes across every timetable"`.

### Task 12: Finish the visual system, mobile behavior, and accessibility

**Files:**
- Create: `apps/web/styles/tokens.css`
- Create: `apps/web/styles/shell.css`
- Create: `apps/web/styles/timetable.css`
- Create: `apps/web/styles/workflow.css`
- Create: `apps/web/styles/responsive.css`
- Modify: `apps/web/app/globals.css`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/visual-review.mjs`
- Modify: `scripts/smoke.mjs`

**Visual tokens:**

```css
:root {
  --paper: #f3f0e9;
  --surface: #fffdf8;
  --ink: #172033;
  --muted: #667085;
  --line: #d7d3ca;
  --cobalt: #3157c8;
  --coral: #c95045;
  --teal: #08786c;
  --pending: #697386;
  --focus: #1746c6;
  --tap: 44px;
}
```

- [ ] **Step 1: Add automated viewport and target-size failures.** Extend smoke metrics to all visible buttons, links, form controls, and interactive timetable cells at 390px and 320px. Fail on any primary control below 44×44, document width greater than viewport by more than 1px, or sticky action covering the focused element.
- [ ] **Step 2: Split global styles by responsibility.** Keep reset and imports in `globals.css`; move tokens, shell, timetable, workflow, and responsive rules into the five files above. Remove selectors for retired components after `rg` proves they are unused.
- [ ] **Step 3: Establish hierarchy without card repetition.** Give weekly timetables, today rails, comparison matrices, and status rails distinct shapes. Use whitespace, alignment, typography, and limited surfaces before borders or shadows. Keep fixed-width numerals for periods, counts, and times.
- [ ] **Step 4: Finish responsive layouts at 1440, 390, and 320.** Desktop keeps schedule plus work rail; mobile uses today-first navigation and one-action task screens; 320px converts data tables to labeled rows without hiding information.
- [ ] **Step 5: Add contrast and semantic accessibility checks.** Install `@axe-core/playwright` as a root dev dependency, run Axe on landing, teacher, matrix, command center, publication, and public class screens, and fail for serious/critical violations. Manually verify token pairs meet WCAG 2.1 AA for normal text.
- [ ] **Step 6: Finish keyboard behavior.** Add a skip link, landmark headings, table/radio semantics, visible focus, focus restoration after modal-like steps, and keyboard completion of request → approve → publish. Never rely on drag or hover.
- [ ] **Step 7: Finish reduced motion and announcements.** Disable smooth scrolling and pulse transitions under `prefers-reduced-motion: reduce`; use polite announcements for saved, approved, rejected, blocked, and published state changes.
- [ ] **Step 8: Capture deterministic visual-review screenshots.** `scripts/visual-review.mjs` resets the demo clock and captures six core screens at 1440×960, 390×844, and 320×740 into the ignored screenshot directory supplied by `SHOT_DIR`.
- [ ] **Step 9: Inspect every screenshot with a visual checklist.** Verify no clipped Korean text, duplicated primary actions, invisible original subjects, misleading disabled states, empty dead zones, or timetable cells smaller than their readable content. Record and fix each observed defect before recapturing the same view.
- [ ] **Step 10: Run full quality checks and commit.** Run `npm test`, `npm run typecheck`, `npm run build`, `npm audit --omit=dev`, and browser smoke. Run `git diff --check` and commit with `git commit -m "style(web): finish responsive command center UI"`.

### Task 13: Lock all critical journeys, operational errors, and documentation

**Files:**
- Modify: `scripts/smoke.mjs`
- Modify: `scripts/check-config.mjs`
- Modify: `README.md`
- Modify: `docs/data-and-privacy-boundary.md`
- Modify: `04-operations.md`
- Modify: `docs/superpowers/specs/2026-08-18-change-command-center-design.md`

**Required browser journeys:**

1. Single lesson → compare → submit → ops alternative → approve → tasks → publish.
2. Full-day four lessons → two swaps + one cover + one unresolved → resolve final item → publish.
3. Atomic elective block → zero exchange candidates → cover approval.
4. Concurrent cases → stale candidate blocked → recompute → approve.
5. Published case → correction case → replacement publication.

- [ ] **Step 1: Make each journey independently resettable.** Add helpers that start from `loadDemoScenario`, assert the initial scenario id and fixed clock, and clean only the demo storage key. Do not depend on execution order.
- [ ] **Step 2: Add the five end-to-end flows.** At every state boundary, assert both visible status and canonical stored state. For publication flows, use a separate public page so leaked in-memory component state cannot make the test pass.
- [ ] **Step 3: Add three viewport passes.** Run journey 1 at 1440×960, 390×844, and 320×740; run journeys 2–5 at desktop and 390px. Measure horizontal overflow, target size, focus destination, and console/page errors after every major transition.
- [ ] **Step 4: Add keyboard-only journey 1.** Use Tab, arrow keys, Space, and Enter from landing through publication. Assert focus never falls back to `<body>` after submit, approve, task completion, or publish.
- [ ] **Step 5: Add operational failure flows.** Mock keyless five-row data, total mismatch, rate-limit code 337, offline fetch, storage quota failure, and clipboard denial. Assert each screen names the known count/cause, gives one corrective next action, and never creates a complete revision or publication.
- [ ] **Step 6: Harden configuration checks.** `scripts/check-config.mjs` must fail if source or tracked documents contain the supplied key prefix, `NEIS_KEY_STORE`, a competitor endpoint/domain, or a production route that exposes internal case fields.
- [ ] **Step 7: Update README only from verified behavior.** Document install/run commands, the three demo roles, scenario picker, live NEIS read-only setup, session-only key handling, browser-local prototype limitation, and all quality commands. Report the actual test count from the final run.
- [ ] **Step 8: Update privacy and operations boundaries.** State which data is official, synthetic, school-provided, browser-persisted, session-only, publicly projected, and intentionally excluded. Document that production requires a separately approved server credential and school-isolated access control.
- [ ] **Step 9: Mark the spec implementation status honestly.** Change the spec status to `단계 A 구현 완료 · 현장 리허설 대기` only after every P0 acceptance item below passes. Keep any failed item open rather than weakening the criterion.
- [ ] **Step 10: Run the final quality gate from clean processes.** In terminal A run the first five commands, then start and keep the server running with the sixth command:

```powershell
npm run check
npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm run serve
```

In a second terminal run `npm run smoke`. Expected: configuration, unit tests, static build, production audit, all five journeys, Axe, keyboard, 1440/390/320 layout, and public-data boundary pass with zero failures.

- [ ] **Step 11: Inspect the working tree and commit.** Run `git status --short`, `git diff --check`, and `git diff --stat`. Confirm screenshots, API response caches, authentication keys, and local `.env` files are not tracked. Commit with `git commit -m "test: lock command center prototype journeys"`.

## P0 Coverage Matrix

| Approved requirement | Owning task | Automated evidence |
|---|---:|---|
| School search, example entry, one-time ops setup | 2, 7 | `neis.test.ts`, landing/setup smoke |
| Complete official-data ingestion and diagnostic blocking | 1, 2 | engine normalization and web NEIS tests |
| Teacher today/week timetable and change before/after | 5, 8, 11 | projection tests and teacher smoke |
| Single-period and full-day absence cases | 3, 6, 8 | case service, demo, composer tests |
| Row-based exchange/chain/cover comparison | 9 | resolution unit and browser tests |
| Operations command center | 5, 10 | ops projection and dashboard smoke |
| Alternative selection, approval, rejection | 3, 5, 10 | transition/revalidation tests and smoke |
| Whole-case conflict and stale candidate revalidation | 5 | `revalidation.test.ts` |
| NEIS, notice, record, and publication closure | 3, 11 | publication unit and browser tests |
| Teacher/class propagation only after publication | 5, 11 | public-boundary unit and second-page smoke |
| Read-only class timetable without internal-data leakage | 5, 11 | projection redaction and public smoke |
| Eight user journeys and two data-quality regressions | 1, 6, 13 | demo inventory, fixture, five critical E2E paths |
| Storage, network, historical-gap, and partial-data failures | 2, 4, 13 | typed API, repository, operational smoke tests |
| Desktop, mobile, keyboard, accessibility | 7–13 | Playwright viewport, keyboard, Axe, visual review |

## Completion Evidence to Record

- Final engine/web/unit test counts and elapsed time.
- Static build result and generated route size summary.
- Browser smoke results for five journeys and three widths.
- Screenshot paths for the six core screens at 1440, 390, and 320.
- Axe serious/critical violation count, sub-44px target count, and horizontal-overflow count.
- Production dependency audit result.
- `git status --short` proving no key, cache, screenshot, or local environment file was committed.
- Open field-rehearsal risks carried into a new stage B specification; stage B and C implementation must not be silently folded into this plan.
