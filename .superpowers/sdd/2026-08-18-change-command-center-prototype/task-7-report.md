# Task 7 report — entry, app shell, role navigation, and one-time setup

## Status

Implemented the controlled React integration boundary and verified the full Task 7 vertical slice. `Workbench` now owns the schema-v2 repository, query/popstate navigation, and closure-backed NEIS key session; `AppShell` is controlled by `WorkspaceState` and `AppLocation`. The existing teacher/ops components remain behind an in-memory legacy role adapter for Tasks 8–11.

## RED / GREEN record

### RED 1 — landing browser contract

Changed `scripts/smoke.mjs` before the landing implementation and ran it against the checked static build.

```text
npm run smoke
```

Exit 1. The old landing failed exactly on the three missing actions:

- `우리 학교 시간표 열기`
- `일과 담당자로 시작`
- `예시 학교 둘러보기`

After adding setup assertions, the same RED run also reported no ordered setup stages and no locked invitation step.

### RED 2 — exact teaching week and setup pure boundary

Added the selected-week assertion to `neis.test.ts` and created `shell.test.ts` before production code.

```text
npm run test -w web -- neis.test.ts shell.test.ts
```

Exit 1. `findRecentTeachingWeek(...).range` was `undefined`, and `../components/SetupFlow` did not exist. This directly captured the deferred Task 2 bug and the missing setup boundary.

### GREEN 1 — loader and setup state

- `findRecentTeachingWeek` now returns the exact selected Monday–Friday range.
- `NeisLoader` loads the school calendar for that same range, rather than persisting the broad five-week search window.
- `createWorkspaceFromNeis` persists exact range, academic year, raw/page/accepted/quarantined/duplicate/parallel counts, and official load time in the active revision.
- Invitation URLs are built only through the `AppLocation` allowlist.

```text
npm run test -w web -- neis.test.ts shell.test.ts
```

Exit 0: 2 files, 12/12 tests passed.

### RED / GREEN 3 — completeness checkpoint

Self-review found that a loaded-but-incomplete bundle could open the teacher-mapping tab. Added a regression first:

```text
npm run test -w web -- shell.test.ts
```

RED: exit 1, `canEnterSetupStage is not a function` (3 passed, 1 failed).

Implemented the rail gate: teacher mapping and unresolved review require a complete source; invitation links additionally require zero unresolved/duplicate teacher conflicts.

```text
npm run test -w web -- shell.test.ts neis.test.ts
```

GREEN: exit 0, 2 files, 13/13 tests passed.

## Implementation

### Controlled shell and persistence

- `Workbench` initializes one `WorkspaceRepository`, parses the initial query location, subscribes to popstate, and owns one closure-backed NEIS session.
- The session key is reflected only in React memory and the closure; it is cleared when setup completes, exits, or browser navigation leaves setup.
- Schema-v2 repository save/load is the sole school-workspace persistence path. Old raw timetable/change writes were removed from component handlers. Theme, teacher choice, reason, and off-day UI preferences remain compatibility preferences.
- Demo entry originates only from `createDemoWorkspace`; no UI component calls `sampleSchool()`.

### Landing and role navigation

- The first viewport is school-entry-first: school name/received link, one primary open action, secondary ops setup, and immediate example entry.
- The trust line is compact and states the official/school-owned boundary.
- No credential field or file-format explanation is present on landing.
- Role navigation is explicitly labeled `체험 역할` and says it is not login/authorization.
- Teacher, ops, and class locations contain only public view identity.
- Scenarios 1–8 retain the exact label `공개 시간표 관측 구조 기반 · 일정·교사·사건은 예시`.

### One-time school setup

The visible and gated sequence is:

1. 학교 검색
2. 세션 인증키
3. 공식 자료 불러오기
4. 완전성 확인
5. 교사 연결
6. 미해결 검토
7. 초대 링크

The health panel shows official total, fetched pages, accepted, quarantined, duplicates, parallel groups, exact selected week, academic year, and last load time. Teacher mapping supports the existing timetable JSON plus mapping-object JSON, individual inputs, and same-grade/same-subject bulk fill. Review shows unassigned mappings, duplicate-name conflicts, and grouped-course suspicions. Invitations stay locked until official completeness and teacher resolution pass.

## Browser evidence

The final browser run used a separately started `npm run serve` process and an external temporary screenshot directory (`%TEMP%/timeswap-task-7-final-shots`), so no screenshot artifact entered the worktree.

```text
$env:SHOT_DIR = "$env:TEMP/timeswap-task-7-final-shots"
npm run smoke
```

Exit 0:

```text
랜딩 행동·민감 입력 분리: 통과
최초 설정 순서·게이트: 통과
체험 역할·출처: 통과
모바일 폭: 390 문서 폭: 390 작은 조작: 0
검증 결과: 모두 통과
```

Evidence checked:

- first viewport contains the three exact entry actions;
- keyboard order reaches school input, primary entry, setup, demo, and setup school search;
- setup and role transitions move focus to the new page heading;
- browser back returns setup → landing and role view → landing with focus restored;
- demo saves schema-v2 repository state and does not store a key;
- 390px has no horizontal overflow or sub-44px visible control; 320px has no overflow;
- desktop landing, locked setup, ops role shell, and mobile landing screenshots were visually inspected.

## Final verification

| Command | Result |
| --- | --- |
| `npm run test -w web -- shell.test.ts neis.test.ts` | passed, 13/13 |
| `npm run typecheck` | passed, engine + web |
| `npm test` | passed, engine 19 files / 160 tests; web 11 files / 160 tests |
| `npm run build` | passed, static export generated |
| separate `npm run serve` + `npm run smoke` | passed, all Task 7 flows |
| `npm run check` | passed, static export/header/CSP checks |
| `git diff --check` | passed; only Git LF→CRLF working-copy warnings |

Two earlier root test attempts hit the existing engine scale test's 5-second Vitest wrapper timeout while its printed measured search work was about 714–737 ms. After stopping the checked server, the focused scale suite passed 6/6 and two fresh full root runs passed; the final recorded full run is the green 160 + 160 result above.

## Files

Created:

- `apps/web/components/AppShell.tsx`
- `apps/web/components/RoleNavigation.tsx`
- `apps/web/components/SetupFlow.tsx`
- `apps/web/components/DataHealthPanel.tsx`
- `apps/web/test/shell.test.ts`

Modified:

- `apps/web/components/Landing.tsx`
- `apps/web/components/NeisLoader.tsx`
- `apps/web/components/Workbench.tsx`
- `apps/web/app/globals.css`
- `apps/web/lib/neis.ts`
- `apps/web/test/neis.test.ts`
- `scripts/smoke.mjs`

`apps/web/app/page.tsx` already had the correct single `<Workbench />` entry and required no behavior change.

## Self-review

- Confirmed `AppShellProps` matches the specified controlled contract.
- Confirmed no production component calls `sampleSchool`, `saveRaw`, `saveEntries`, `saveUnavail`, or `saveOffDays` for workspace state.
- Confirmed scenario provenance wording is imported from the single demo constant.
- Confirmed invitation URLs are constructed from `formatLocation` and contain no note, raw response, schedule payload, or key.
- Confirmed the broad five-week value is only a search window; UI/revision facts use `TeachingWeekResult.range` exactly.
- Confirmed incomplete/quarantined sources cannot advance to mapping, and incomplete/unresolved/duplicate teacher states cannot advance to invitation links.
- Confirmed normal button/input focus indicators remain; only programmatically focused route headings suppress the large decorative outline.
- Confirmed the tracked landing screenshot was restored and only the six Task 7 smoke artifacts were removed; final screenshots live outside the repository.

## Concerns / deferred ownership

- Live credentialed NEIS setup was not exercised in browser automation because no credential is stored or supplied. Complete-page, recent-week fallback, exact-range, typed failure, normalization, and session-only behavior remain covered by unit tests; browser smoke covers the no-key setup gate.
- The teacher/ops surface is intentionally a co-located legacy in-memory adapter. It keeps existing UI interactions available without writing the old workspace keys, but its events do not mutate canonical `WorkspaceState`; Tasks 8–11 own those state-backed replacements.
- The pre-existing engine scale test can approach its suite wrapper timeout under concurrent machine load even when its internal one-second-per-search assertions pass. The final isolated/full verification is green.

## Commit

`e096c6c feat(web): rebuild entry and school setup`

## Review fix round 1 — 2026-08-19

Addressed all three Important review findings with test-first regressions.

### RED — landing school query

Added a navigation round-trip assertion and a browser flow that enters `수지고등학교` on the landing page, intercepts the official school-search response locally, and requires the setup search to be prefilled and started automatically.

```text
npm run test -w web -- navigation.test.ts
```

Exit 1: 1 failed / 3 passed. Expected `/?view=setup&q=...`; received `/?view=setup`.

```text
npm run serve
npm run smoke
```

Smoke exited 1 after `page.waitForURL(/\?view=setup&q=/)` timed out at 30 seconds against the pre-fix build.

### GREEN — landing school query

`AppLocation.setup` now carries the optional allowlisted `schoolQuery`, and `AppShell` forwards non-link landing text into it. `SetupFlow` passes it to `NeisLoader`, which prefills the input and starts the first search once on mount.

```text
npm run test -w web -- navigation.test.ts
```

Exit 0: 1 file, 4/4 tests passed.

### RED / GREEN — clear credential at review completion

Added a regression using the real closure-backed NEIS session. The test sets `secret-key`, completes review, and requires `getKey()` to be empty before the completed workspace is returned.

```text
npm run test -w web -- shell.test.ts
```

RED exit 1: `completeSetupReview is not a function` (1 failed / 4 passed).

`completeSetupReview` now creates the canonical workspace and clears the credential before `SetupFlow` saves the workspace, sets completed state, or changes to the invitation stage.

```text
npm run test -w web -- shell.test.ts
```

GREEN exit 0: 1 file, 5/5 tests passed.

### RED / GREEN — opaque teacher invitation identity

Added a regression using the entered display name `김서준`. It requires the canonical mapped teacher and invitation query to use the same deterministic `member:<16 hex>` identity, verifies repeated construction is stable, and verifies neither ID nor URL query equals or contains the name. The link label remains `김서준` separately.

```text
npm run test -w web -- shell.test.ts
```

RED exit 1: expected `/^member:[0-9a-f]{16}$/`; received `김서준` (1 failed / 5 passed).

NEIS teacher mappings now derive a workspace-scoped opaque member ID. `createInvitationLinks` accepts a separate display-label lookup and places only the opaque ID in the allowlisted `teacher` query.

```text
npm run test -w web -- shell.test.ts navigation.test.ts neis.test.ts
```

GREEN exit 0: 3 files, 19/19 tests passed.

### Review-round final verification

| Command | Result |
| --- | --- |
| `npm test` | passed, engine 19 files / 160 tests; web 11 files / 163 tests |
| `npm run typecheck` | passed, engine + web |
| `npm run build` | passed, static export generated |
| separate `npm run serve` + `SHOT_DIR=%TEMP%/timeswap-task-7-review-1-shots npm run smoke` | passed, including landing prefill and intercepted automatic school search |
| `npm run check` | passed |
| `git diff --check` | passed; only Git LF→CRLF working-copy warnings |

Final smoke output:

```text
랜딩 행동·민감 입력 분리: 통과
최초 설정 순서·게이트: 통과
체험 역할·출처: 통과
모바일 폭: 390 문서 폭: 390 작은 조작: 0
검증 결과: 모두 통과
```

No repository screenshot was created or modified; review screenshots were written only below `%TEMP%`.

Review fix commit: `561d78e fix(web): close school setup review gaps`.
