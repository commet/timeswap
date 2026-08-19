# Task 10 report — live operational change command center

## Delivered

- Replaced the legacy inbox with `OpsCommandCenter`, `CaseDetail`, and `DemoScenarioPicker`.
- Derived the visible metrics directly from `projectOpsDashboard` and added a deterministic command-center projection for priorities, timeline markers, source warnings, intersections, and safe display labels.
- Routed selected cases and mobile list/detail/admin stages through `view=ops`, `case`, and `step` URL state without reload.
- Added auditable domain-service interventions: resolution replacement, cover selection through the ranked Task 9 rows, rejection with a required reason, and return-for-recomputation. Repository failures leave canonical state untouched and surface a recovery message.
- Added the reset-confirmed operational scenario picker for scenarios 2–8 only; it is locked for non-demo / NEIS workspaces. Scenarios 9–10 remain diagnostic-only.
- Kept publication out of this task: the command center shows pending administrative state and explicitly hands publishing to the next publication-center task.
- Removed `apps/web/components/OpsInbox.tsx` after replacement smoke coverage; `rg -n "OpsInbox" apps/web` now returns no matches.

## TDD record

Initial focused RED command:

```text
npm run test -w web -- navigation.test.ts case-service.test.ts ops-command-center.test.ts
```

Observed result: 3 failed tests / 40 passed. The failures proved the missing command-center module, absent audited resolution/recompute services, and dropped mobile `step` URL state. Before compiling the new production UI, the existing checked static smoke was also run with the new assertion and failed only with:

```text
일과 담당 예시가 canonical 변경 관제판을 열지 않음
```

The focused GREEN rerun passed 3 files / 46 tests. New coverage verifies projection-backed metric values, same-day and stale priority order, period markers, scenarios 2–8 and live reset blocking, audited resolution replacement, recomputation, and mobile step URL round trips.

## Final verification

```text
npm test
engine: 19 files, 160 tests passed
web:    17 files, 217 tests passed
total:  377 tests passed

npm run typecheck
passed

npm run build
passed

BASE_URL=http://localhost:3127 SHOT_DIR=... node scripts/smoke.mjs
passed

git diff --check
passed
```

The checked production smoke covers the 1440px desktop three-region command center, 390px URL-addressable list/detail flow, and 320px administrative step. It verifies dashboard counts, case URL selection without navigation reload, source health, timeline labels, interventions/rejection/recompute audit state, persistence failure safety, scenario filtering/reset protection, and mobile 44px/back-action checks. Screenshots were inspected for desktop, 390px list, and 320px administrative layouts.

## Concern

One first final `npm test` attempt hit the pre-existing engine scale-test runner timeout despite its logged per-recommendation work being within the test’s one-second budget. A fresh isolated engine rerun and the final root `npm test` both passed all 160 engine tests unchanged. No engine code was touched in Task 10.
