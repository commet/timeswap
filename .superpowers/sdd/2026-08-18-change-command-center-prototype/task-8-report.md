# Task 8 report — teacher timetable-first case journey

## RED / GREEN

- RED: added `lessonsAffectedByAbsence` tests for one period, four lessons in a day, inclusive dates, a replacement owned by another teacher, and unassigned lessons. The focused run failed with `TypeError: lessonsAffectedByAbsence is not a function`.
- GREEN: implemented the stable, date/period-sorted canonical selector. The focused case-service suite passed.
- RED: added duplicate-case matching tests; the focused run failed with `TypeError: findDuplicateAbsenceCase is not a function`.
- GREEN: added order-insensitive teacher/date-range/lesson-set detection.
- RED: added composer helper tests before the component existed; the test run failed because `AbsenceComposer` was absent. Added the canonical display-label state extension first, then implemented whole-day selection, source/mapping readiness, and atomic warnings.
- GREEN: composer helper tests passed. A later explicit-deselection test failed until `toggleLessonSelection` was extracted and used by the composer.
- Browser RED/GREEN: the submission smoke initially exposed a remount that lost the submitted-state heading. Keeping the composer instance through the status state corrected it; the focus and cleared-marking checks now pass.

## Commands and observed output

- `npm run test -w web -- case-service.test.ts` — RED twice as above, then `31 passed` and later `32 passed`.
- `npm run test -w web -- absence-composer.test.ts` — RED for the missing component and deselection helper; final focused result: `4 passed`.
- `npm test` — engine: `19 files / 160 tests passed`; web: `12 files / 173 tests passed`.
- `npm run typecheck` — passed (engine and web).
- `npm run build` — Next production build completed successfully.
- `npm run serve` followed by `npm run smoke` with Chromium — passed. The smoke includes the Task 8 canonical teacher route at 1440px and 390px, submission/focus/duplicate checks, candidate handoff, incomplete-source gating, and diagnostic export affordance.
- `git diff --check` — passed (only Git's LF→CRLF working-tree notices were emitted).

## Files changed

- `apps/web/lib/case-service.ts`: affected-lesson and duplicate-case pure selectors.
- `apps/web/lib/domain.ts`, `apps/web/components/SetupFlow.tsx`, `apps/web/lib/demo.ts`: explicit canonical `teacherLabels` mapping, including demo and setup creation.
- `apps/web/components/TeacherHome.tsx`, `apps/web/components/Grid.tsx`, `apps/web/components/AbsenceComposer.tsx`: projection-driven today/week timetable, period rail, canonical case composer, readiness warning, and callback-only candidate handoff.
- `apps/web/components/AppShell.tsx`, `apps/web/components/RoleNavigation.tsx`, `apps/web/components/Workbench.tsx`: controlled `saveState` path that creates/submits canonical cases and retains class/ops legacy routing.
- `apps/web/app/globals.css`, `scripts/smoke.mjs`: responsive teacher UI and 1440/390 browser verification.
- `apps/web/test/case-service.test.ts`, `apps/web/test/absence-composer.test.ts`, `apps/web/test/demo.test.ts`, `apps/web/test/shell.test.ts`: coverage for new contracts and labels.

## Self-review

- Teacher requests only call canonical `createAbsenceCase` + `transitionCase` and persist through Workbench/AppShell `saveState`; the new teacher route does not access legacy request keys.
- The teacher UI reads `projectTeacherSchedule`, so `변경 예정` and published values stay derived from Task 5 projections. Published cards render the changed subject with a smaller original-subject treatment; planned cards are dashed.
- Opaque IDs are never used as the teacher-facing label. Missing canonical labels fall back to `담당 교사` and cause candidate handoff gating instead of parsing the URL identity.
- The candidate comparison UI is not implemented. Only the typed handoff payload/state is exposed for Task 9. Ops/publication flows remain delegated to the legacy adapter for their later tasks.

## Concerns / follow-up boundaries

- The canonical schedule model does not carry bell-time boundaries, so the today rail labels the first and second projected lessons as the immediate `지금`/`다음` flow rather than calculating a wall-clock period.
- Existing pre-Task-8 repositories can lack `teacherLabels`; they stay readable, render a neutral label, and correctly keep candidate handoff disabled until mapping is completed.

## Review fix round 1/5 — teacher journey gaps

### RED / GREEN

- RED: `absence-composer.test.ts` showed that a revision marked complete incorrectly enabled source readiness for a `7/6` row mismatch; `shell.test.ts` showed setup did not retain received and expected NEIS counts. GREEN: setup now writes `receivedRows` from the actual loaded bundle rows and `expectedRows` from NEIS `result.total`; readiness requires `revision.complete` and strict equality, with no active-lesson fallback. Tests also assert displayed `5/6` and `7/6` copy.
- RED: `teacher-diagnostics.test.ts` failed because no redacted diagnostic projection existed. GREEN: diagnostic download now contains only source/mapping counts, source/loaded-at/completion revision metadata, and non-identifying issue summaries. The test places lessons, labels, case notes, tasks, publications, audit actors, and checksums in input and verifies none are serialized.
- RED: submission persistence tests failed because the canonical save boundary could report a case id before storage saved. GREEN: `SaveResult` is returned by the controlled save callback; case submission only reports its id after repository success. Quota and security/unavailable failures keep the prior canonical state, show a recovery/export message, and have focused tests.
- RED: projection sorting placed period `10` before `2`, the teacher date helper was missing, and the week-slot helper was absent. GREEN: period ordering is numeric; an absent browser date is labelled `불러온 날짜`, not `오늘`; the grid preserves and renders every lesson in a shared date/period cell.
- RED: teacher projection values lacked original/new subject, class, room fields, and render checks could not find changed values. GREEN: base/pending/published values carry the real lesson fields and today/week surfaces render the changed details alongside a smaller original value.

### Commands and observed output

- Focused RED runs: `npm run test -w web -- absence-composer.test.ts shell.test.ts`, `... teacher-diagnostics.test.ts`, `... case-service.test.ts repository.test.ts`, and `... projections.test.ts teacher-schedule-view.test.ts` each failed for the intended missing/incorrect behavior before the corresponding implementation.
- Focused GREEN: `npm run test -w web -- absence-composer.test.ts projections.test.ts teacher-schedule-view.test.ts case-service.test.ts repository.test.ts teacher-diagnostics.test.ts shell.test.ts demo.test.ts` — `8 files / 96 tests passed`.
- Full `npm test` — engine: `19 files / 160 tests passed`; web: `14 files / 187 tests passed`.
- `npm run typecheck` — passed (engine and web). An earlier root attempt reported Windows `ENOSPC` before compilation; the clean retry passed.
- `npm run build` — Next production build completed successfully.
- `npm run smoke` against the checked static server — passed; it covers the canonical teacher route at both 1440px and 390px.
- `git diff --check` — passed.

### Files and self-review

- `SetupFlow`, `AbsenceComposer`, `Workbench`, repository/case services, and the shell adapter now use explicit NEIS counts, redacted diagnostics, and success-gated canonical persistence.
- Teacher projection/today/week code now has numeric periods, an honest loaded-date label, multi-lesson week slots, and explicit current/original values. Composer primary buttons retain the global 44px `.btn` minimum.
- No Task 9 candidate matrix, legacy ops screen, or publication workflow was changed. The only candidate behavior remains the existing typed handoff.

### Concerns

- Older saved revisions without explicit source counts remain safely blocked; the warning reports `0/0` rather than inventing equality from loaded lessons. A future migration could distinguish unavailable historical counts from an actual empty source.

## Review fix round 2/5 — honest persistence and teacher controls

### RED / GREEN

- RED: setup completion tests showed `completeSetupReview` cleared the session and returned a workspace regardless of the save result; demo entry tests showed no save-gated navigation helper. GREEN: both paths now await `SaveResult`; setup remains on the review screen with its session key and review state after quota/security failure, and demo navigation only follows a successful save.
- RED: the teacher schedule test still returned `불러온 날짜` and rendered `지금`/`다음`, which implies bell-time knowledge the canonical model does not have. GREEN: absent browser dates use `불러온 수업일`; the projected cards are labelled `오늘 첫 수업` and `그다음 수업`.
- RED: server-rendering a complete composer could not find a diagnostic action. GREEN: the existing redacted export is always a footer action, including save-failure recovery and complete workspaces; it never exports full canonical state.
- GREEN: teacher tabs, affected-lesson rows, reason labels, and the mobile whole-day control use a 44px minimum. The browser smoke now measures those controls at 390px.

### Commands and observed output

- Focused RED: `npm run test -w web -- shell.test.ts app-shell.test.ts absence-composer.test.ts teacher-schedule-view.test.ts` failed for the intended missing save gates, always-reachable diagnostic action, and honest labels.
- Focused GREEN: the same command passed with `4 files / 26 tests`.
- Full `npm test` — engine: `19 files / 160 tests passed`; web: `15 files / 196 tests passed`.
- `npm run typecheck` and `npm run build` — passed.
- `npm run smoke` — passed at desktop and 390px, including the new first-lesson copy and 44px composer control check.
- `git diff --check` — passed.

### Self-review / scope

- Setup failure does not clear the in-memory NEIS key, advance the stage, or mark a completed workspace. Its recovery message is visible on the review step and tells the user to retry after resolving browser storage.
- The demo failure remains on entry; Workbench’s existing save-error alert surfaces the storage failure. The only diagnostic export continues to use the redacted projection.
- No Task 9 comparison, ops, or publication code changed.
