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
