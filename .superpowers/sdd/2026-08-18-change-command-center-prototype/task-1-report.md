# Task 1 — NEIS normalization report

## Implementation

- Added the canonical `ClassIdentity`, collision-safe JSON keying, lossless source-row retention, whitespace normalization, required-field quarantine, exact lesson-fact deduplication, and parallel-lesson diagnostics in `packages/engine/src/adapters/neis-normalize.ts`.
- Extended `NeisRow` with the official NEIS identity and load-time fields. `fromNeis(rows)` now normalizes first and exposes the resulting `normalization` report on `NeisReport`.
- Kept legacy `grade-class` labels for non-colliding engine inputs; when multiple canonical identities share that label, `fromNeis` promotes them to their full canonical key so they cannot merge.
- Exported the normalizer and `ClassIdentity` from `@timeswap/engine` through `src/index.ts`.
- Added a public, credential-free regression fixture covering Seoul and Daegu technical-school identity collisions, an exact duplicate, and a true parallel lesson.

## TDD evidence

### RED

1. `npm run test -w @timeswap/engine -- neis-normalize.test.ts` failed because `../src/adapters/neis-normalize` did not exist.
2. After the identity contract was green, the quarantine and exact-deduplication tests failed: no quarantined row was returned and two equivalent facts were accepted.
3. The true-parallel test failed because no parallel group was returned.
4. The `fromNeis` integration test failed because two same-named vocational classes merged into one engine class.

### GREEN

- Focused normalization suite: `6 passed`.
- Full engine suite: `19 files passed`, `158 tests passed`.
- Engine typecheck: `tsc --noEmit` passed.
- `git diff --check` passed.
- Credential-pattern scan (`rg -n "KEY=.*[A-Za-z0-9]{8}" packages/engine`) found no matches.

## Files changed

- `packages/engine/src/adapters/neis-normalize.ts` (new)
- `packages/engine/src/adapters/neis.ts`
- `packages/engine/src/index.ts`
- `packages/engine/test/neis-normalize.test.ts` (new)
- `packages/engine/test/fixtures/neis-data-quality.json` (new)

## Self-review

- Verified all required normalization fields are quarantined without mutating the retained source row.
- Verified fact keys omit `LOAD_DTM`, include room and stripped subject, and use structured serialization to avoid separator collisions.
- Verified existing NEIS, holiday, grouping, partial-schedule, and change-detection tests still pass.
- Verified no NEIS credential is stored or requested.

## Concerns

- Historical note: the initial implementation retained short labels when unambiguous. Fix round 1 supersedes that behavior: `klass` is always canonical and `classLabel` is presentation-only.

## Fix round 1

### Change

- `fromNeis` now assigns `row.classKey` to every engine-facing `NeisCell.klass`, without considering the other rows in the import.
- Added `NeisCell.classLabel` as the explicit human-readable `grade-class` presentation value.
- `neisToTimetable` now resolves teacher mappings with the canonical class identity, so two classes sharing a display label can still receive distinct teacher assignments.
- Updated NEIS, holiday, grouping, marks, and partial-schedule tests to use the canonical identity for engine assertions and `classLabel` for display assertions.

### Tests and exact results

- `npm run test -w @timeswap/engine -- neis-normalize.test.ts` — passed: 1 file, 8 tests.
- `npm run test -w @timeswap/engine` — passed: 19 files, 160 tests.
- `npm run typecheck -w @timeswap/engine` — passed: `tsc --noEmit`.
- `git diff --check` — passed.

### Regression coverage

- `packages/engine/test/neis-normalize.test.ts` proves that independent one-row imports for different majors retain different engine identities while both present `2-1`, and that colliding classes resolve teachers by their distinct canonical identities.
- Existing `neis`, `holiday`, `grouping`, `neis-marks`, and `partial` tests continue to cover their previous behavior using the canonical key contract.

### Self-review and concern

- Confirmed `klass` is now invariant for a canonical class identity regardless of import completeness; `classLabel` is not used as an engine key.
- The pre-existing pipe-delimited base-map encoding remains unchanged; it is not expanded in this focused fix.
