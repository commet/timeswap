# Task 6 report — real-structure demo corpus and regression scenarios

## Status

Implemented and verified the deterministic, provenance-aware demo workspace, all ten named scenarios, the aggregate research manifest, public-row diagnostics, and the compatibility exports from `lib/app.ts`.

Commit: `557ac80 feat(web): add operational demo scenarios`

## TDD record

### RED

Wrote `apps/web/test/demo.test.ts` before creating `apps/web/lib/demo.ts`. The test named the breaks it protects: missing or wrongly surfaced scenarios, unstable initial state, mixed provenance, incorrect resolution composition, unsafe recommendation on incomplete data, missed closure/concurrency invalidation, correction history loss, vocational identity collapse, duplicate/parallel confusion, and fabricated school-level corpus rows.

Command:

```text
npm run test -w web -- demo.test.ts
```

Result: exit 1. Vitest failed while importing `../lib/demo` with `Cannot find module '../lib/demo'`. This was the expected missing-feature failure; 0 tests ran because the production module did not yet exist.

### GREEN

Implemented the smallest complete fixture API and ran the focused suite.

Command:

```text
npm run test -w web -- demo.test.ts
```

Result: exit 0; 1 test file passed, 23 tests passed.

A focused web typecheck initially found an `AuditEvent.details` union containing optional `undefined`. The audit builder was made explicitly typed, then:

```text
npm run typecheck -w web
```

Result: exit 0.

## Implementation

- `apps/web/lib/demo.ts`
  - Exports the exact ten-id `DemoScenarioId` union, inventory, provenance label, `createDemoWorkspace`, and `loadDemoScenario`.
  - Uses a canonical fixed clock by default and stable scenario-prefixed IDs.
  - Separates official schedule-field provenance (`factSource`) from synthetic teacher, reason, approval, and burden provenance (`operationSource: synthetic-demo`).
  - Starts the default workspace at the same-day 3rd/4th-period swap.
  - Models the required operational outcomes for scenarios 1–8.
  - Normalizes the committed Task 1 public raw-row fixture for scenarios 9–10 without API access or a credential.
- `apps/web/test/demo.test.ts`
  - Covers inventory/surfacing, deterministic defaults, provenance, scenario structures, validation failures, correction linking, normalization regressions, and honest manifest provenance.
- `apps/web/lib/app.ts`
  - Re-exports the new demo entry points for the existing compatibility boundary. No one-off legacy request is created; `sampleSchool()` remains only as the reusable legacy schedule generator until the Task 7 UI replacement.
- `docs/research/neis-corpus-summary-2026-08-18.json`
  - Stores verified aggregate measurements and the three documented named observations only.
- `docs/superpowers/specs/2026-08-18-change-command-center-design.md`
  - Records the non-fabrication and credentialed-refresh rule.

## Controller ruling and manifest change

The original plan requested 12 named school/code rows, exact query weeks, per-school counts, and assertions that their sums equal the totals. The approved specification says the bulk responses and school-level query manifest were not committed. Following the controller ruling, the manifest therefore does **not** contain a `schools` list, invented codes, invented ISO query weeks, or per-school allocations.

It preserves:

- category counts only: four general/autonomous high schools, four vocational/meister high schools, and four middle schools;
- exact verified totals: 12,145 raw, 250 invalid, 393 exact duplicates, 11,502 valid unique, 1,631 professional rows, 464 professional blocks, and 288 parallel cells;
- only values actually stated for 서울공업고등학교, 대구공업고등학교, and 대전중학교;
- `schoolLevelRefresh.status: unavailable` and `requiresCredentialedCorpusRefresh: true`;
- explicit assertions that no API credential and no full response cache are stored.

Tests assert the exact aggregate totals and honest unavailable provenance instead of fabricated per-school sums.

## Verification

Focused demo test:

```text
npm run test -w web -- demo.test.ts
```

Result: exit 0; 23/23 passed.

Full root tests:

```text
npm test
```

Result: exit 0; engine 19 files and 160 tests passed; web 10 files and 151 tests passed.

Full root typecheck:

```text
npm run typecheck
```

Result: exit 0; engine and web TypeScript checks passed.

Whitespace/diff gate:

```text
git diff --check
```

Result: exit 0. Git emitted only the repository's LF-to-CRLF working-copy notices for two modified tracked files; there were no whitespace errors.

Credential scan:

```text
rg -n "KEY=|key=|apiKey|API_KEY|https?://.*KEY" apps/web/lib/demo.ts apps/web/test/demo.test.ts docs/research/neis-corpus-summary-2026-08-18.json
```

Result: no matches.

## Self-review

- Confirmed all ten IDs match the approved contract and only scenarios 1–8 are marked for the command center.
- Confirmed all generated IDs and timestamps are nonblank, deterministic, canonical, and entity creation/update times are monotonic.
- Confirmed the incomplete revision remains `complete: false`, reports 5 of 6 rows, and disables recommendation.
- Confirmed closure and concurrency scenarios fail whole-case validation for the intended reason.
- Confirmed the published correction remains a draft linked to the published source and the original publication remains visible.
- Confirmed public diagnostics import the small committed Task 1 fixture and perform no live fetch.
- Confirmed the manifest includes no school-code list, response URL, credential, or response cache.

## Concerns

- The school-level corpus provenance is intentionally incomplete. Restoring names, codes, ISO query weeks, and per-school counts requires a new credentialed corpus refresh; they cannot be reconstructed from the committed repository.
- The current legacy UI still uses `sampleSchool()` because the controlled `WorkspaceState` shell is Task 7 scope. This task exposes `createDemoWorkspace()` from the existing app boundary so Task 7 can make it the sole UI demo origin without coupling the new domain fixture back to the legacy request model.

## Review fix round 1/5

Commit: `465cd23 fix(web): enforce atomic demo scenarios`

### RED

Added tests before implementation for all three Important review findings:

- the elective cover must contain all three parallel members in one cover resolution, contain zero exchange resolutions, and pass `validateCasePlan`;
- the professional-practice run must expose a real workspace atomic group, use one three-change resolution, validate when complete, and return an `atomic-group` conflict when reduced to one period;
- operational scenarios 1~8 must be `source: demo`, have `public-structure-derived-demo` fact provenance, and contain no `sourceFixture`; diagnostics 9~10 alone may use exact `official-neis` fixture provenance.

Command:

```text
npm run test -w web -- demo.test.ts revalidation.test.ts
```

RED result: exit 1; 12 intended demo tests failed and 35 tests passed. Failures showed the old `official-neis` tag on scenarios 1~8, the old UI label, the one-member elective cover, missing atomic group, and a one-period practice split incorrectly validating.

### GREEN and model changes

- Added optional `WorkspaceState.atomicLessonGroups` with the explicit `professional-practice-block` kind.
- Extended whole-case validation with the `atomic-group` conflict. Any resolution item touching one member must carry every member, so three independent items and a one-period split are both invalid.
- Changed both elective and practice cases to one atomic cover resolution containing every group member. The elective case retains zero move/swap/cycle resolutions.
- Removed diagnostic booleans as the source of truth; tests exercise workspace facts and the real validator.
- Replaced the shared provenance singleton with a fresh provenance object per workspace.

Focused command:

```text
npm run test -w web -- demo.test.ts revalidation.test.ts
```

GREEN result: exit 0; 2 files and 47/47 tests passed.

Full commands and outputs:

```text
npm test
```

Result: exit 0; engine 19 files/160 tests passed; web 10 files/153 tests passed.

```text
npm run typecheck
```

Result: exit 0; engine and web TypeScript checks passed.

```text
git diff --check
```

Result: exit 0 with only LF-to-CRLF working-copy notices and no whitespace errors.

### Corrected provenance wording

The visible operational label is now exactly:

```text
공개 시간표 관측 구조 기반 · 일정·교사·사건은 예시
```

Scenarios 1~8 use `factSource.kind: public-structure-derived-demo`, a `demo` revision source, and no exact fixture path. The schedule date, period, class identity, subject, and room are explicitly structure-derived synthetic facts. Scenarios 9~10 alone use `factSource.kind: official-neis`, `source: neis`, and `packages/engine/test/fixtures/neis-data-quality.json` as exact public-row evidence. `operationSource` remains `synthetic-demo` in both modes. The design specification now records the same boundary.

## Review fix round 2/5

Commit: `3798de3 fix(web): close atomic practice validation gaps`

### RED

Added generic whole-case validator regressions before changing production code:

- a case whose `lessonIds` selects one member while its resolution changes all three members must still fail, proving case-level atomic selection is enforced independently of change shape;
- a one-member `manual` item with empty changes and a nonblank manual action must produce `atomic-group`, proving `item.lessonId` cannot bypass the group;
- a resolution containing every member but scattering destinations across dates and nonconsecutive periods must produce `atomic-group`.

Initial focused command:

```text
npm run test -w web -- demo.test.ts revalidation.test.ts case-service.test.ts
```

Initial RED result: exit 1; 2 intended tests failed, 74 passed. The first subset assertion initially passed only because it also used a partial change and hit the earlier item-level check. The test was corrected to retain all three changes and isolate `AbsenceCase.lessonIds`.

Corrected RED command:

```text
npm run test -w web -- revalidation.test.ts
```

Corrected RED result: exit 1; exactly 3 intended tests failed and 22 passed. The validator returned no `atomic-group` for subset selection or scattered destinations, and returned only unknown-occupancy conflicts for the manual bypass.

### GREEN

Replaced the change-only atomic predicate with one validator routine used for both the current candidate and accepted-plan proof:

- if case `lessonIds` intersects a group, every member must be selected;
- a resolution item touches a group through either `item.lessonId` or any change;
- every touched group member must occur in that single item's changes, including manual items;
- source lessons establish original relative order;
- destinations must share one date and have integer consecutive periods in that order;
- an explicit full-block manual item is additionally limited to the original date/period slots;
- the valid complete practice cover remains green.

Focused command:

```text
npm run test -w web -- demo.test.ts revalidation.test.ts case-service.test.ts
```

GREEN result: exit 0; 3 files and 76/76 tests passed.

Full verification:

```text
npm test
```

Result: exit 0; engine 19 files/160 tests passed; web 10 files/156 tests passed.

```text
npm run typecheck
```

Result: exit 0; engine and web TypeScript checks passed.

```text
git diff --check
```

Result: exit 0 with only LF-to-CRLF working-copy notices and no whitespace errors.

### Self-review

The three realistic mutations are independently protected: deleting the case-selection check breaks the subset test; ignoring `item.lessonId` breaks the manual test; and removing destination date/order checks breaks the scattered-block test. A full non-manual cover stays at periods 2/3/4 and validates. A manual resolution can be valid only when it explicitly includes all member changes at those original contiguous slots.
