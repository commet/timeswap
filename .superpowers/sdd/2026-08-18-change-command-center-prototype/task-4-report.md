# Task 4 report — persistence and navigation boundaries

## Delivered

- Added `WorkspaceRepository` with injectable `Storage`, schema-v2 serialization, typed save failures, export support, and v1 request migration.
- Added static-export-safe query navigation (`AppLocation`, parse/format, push/replace, and popstate subscription).
- Deleted `apps/web/lib/requests.ts`; legacy UI-only request transitions now live in `request-workflow.ts` with no storage API. The v1 decoder lives only in `repository.ts`.
- Added the `migration.v1` audit-event type required by migration.

## RED / GREEN

1. RED: `npm run test -w web -- repository.test.ts navigation.test.ts`
   - Failed as expected: `Cannot find module '../lib/repository'` and `Cannot find module '../lib/navigation'`.
2. GREEN: after the initial repository/navigation implementation, the focused suite passed (6 tests).
3. RED: after adding the durable-migration assertion, `npm run test -w web -- repository.test.ts` failed as expected because no schema-v2 key had been written.
4. GREEN: repository now writes the migrated v2 state through its own boundary; focused tests pass.
5. RED: malformed static-export path test failed because `/internal?...` parsed as a teacher location.
6. GREEN: parser now accepts only `/`; malformed/internal paths fall back to landing.
7. RED: malformed legacy date/timestamp fixture produced a second migrated case.
8. GREEN: the decoder now requires canonical ISO date/timestamp values and records both malformed entries in the diagnostic count.

## Verification

| Command | Result |
| --- | --- |
| `npm run test -w web -- repository.test.ts navigation.test.ts` | Passed: 2 files, 6 tests |
| `npm run test -w web` | Passed: 7 files, 94 tests |
| `npm run typecheck -w web` | Passed |
| `git diff --check` | Passed |
| `rg -n "from '@/lib/requests'|from '../lib/requests'" apps/web` | No imports found |

## Files

- Added: `apps/web/lib/repository.ts`, `apps/web/lib/navigation.ts`, `apps/web/lib/request-workflow.ts`
- Added tests: `apps/web/test/repository.test.ts`, `apps/web/test/navigation.test.ts`
- Updated legacy UI imports and tests; deleted `apps/web/lib/requests.ts`.

## Self-review

- Round-trip coverage includes revisions, multi-lesson-resolution-capable cases, admin tasks, publications, and audit records.
- Migration creates stable nonblank IDs for cases, lessons, resolutions, tasks, publications, and audit events; it skips malformed/duplicate legacy entries and records the skip count.
- URLs permit only public view identity fields. Unknown fields, incomplete locations, duplicates, and non-root paths resolve to landing, so NEIS keys, schedule payloads, and notes cannot enter links.
- Storage errors produce `quota` or `unavailable` on save; migration remains readable/exportable when persistence fails.

## Concerns

- The pre-existing timetable/cache and preference `localStorage` utilities in `apps/web/lib/app.ts` (plus UI preference calls in `Workbench.tsx`) are outside this schema-v2 repository slice and remain untouched. The legacy request workflow is now intentionally in-memory until the subsequent UI-to-`WorkspaceState` integration slice connects it to `WorkspaceRepository`.

## Review fix round 1/5

- Added RED regression coverage for malformed legacy `note`, `kind`, date/timestamp entries; the test verified they must be skipped while the valid entry migrates and the aggregate diagnostic count is `4`.
- Added RED coverage for `parseLocation('http://[bad')`; it initially threw `TypeError: Invalid URL` and now returns landing.
- Expanded the schema-v2 round-trip fixture to two lessons, a multi-lesson case, and resolution changes related to both lessons.
- GREEN commands/results:
  - `npm run test -w web -- repository.test.ts navigation.test.ts` — passed, 2 files / 6 tests.
  - `npm run test -w web` — passed, 7 files / 94 tests.
  - `npm run typecheck -w web` — passed.
  - `git diff --check` — passed.
