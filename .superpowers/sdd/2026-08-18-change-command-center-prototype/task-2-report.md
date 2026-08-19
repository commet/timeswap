# Task 2 report — live NEIS loading

## Result

Implemented a browser-only, typed NEIS boundary that fetches complete raw page sets, rejects incomplete data, detects the documented historical gap, selects a recent non-empty teaching week, maps official failures, and keeps the key only in a closure-backed in-memory session.

## RED / GREEN evidence

1. RED: `npm run test -w web -- neis.test.ts` before implementation failed as intended: 8/8 tests failed because `fetchAllNeisRows` and `findRecentTeachingWeek` did not exist, historical-gap handling was absent, and the previous keyless response lacked `complete`.
2. GREEN (focused): `npm run test -w web -- neis.test.ts` passed with 9/9 tests. It covers 1,001 raw rows/pagination, raw duplicate retention, stalled identical pages, total mismatch, historical gap, keyless truncation, recent-week fallback, five-week NO_DATA, and rate/auth/transport mapping.
3. GREEN (session): `npm run test -w web -- app.test.ts` passed with 43/43 tests, including the storage-spy session regression.

## Verification commands and results

| Command | Result |
| --- | --- |
| `npm run test -w web -- neis.test.ts` | 9/9 passed |
| `npm run test -w web` | 4 files, 63/63 tests passed |
| `npm run typecheck -w web` | passed (`tsc --noEmit`) |
| `rg -n "NEIS_KEY_STORE|loadNeisKey|saveNeisKey" apps/web` | no matches |
| `git diff --check` | passed |

## Files changed

- `apps/web/lib/neis.ts`: typed request/endpoints, complete-page loader, typed failures, historical gap, recent-week selection, complete schedule results.
- `apps/web/lib/neis-session.ts`: closure-backed session-only key.
- `apps/web/lib/app.ts`: removed persistent key storage APIs.
- `apps/web/components/NeisLoader.tsx`: blocks incomplete timetable versions, uses recent complete teaching week, labels keyless searches as previews, and states session-only handling.
- `apps/web/components/Workbench.tsx`: removes Web Storage key restore/save and writes the in-memory session.
- `apps/web/test/neis.test.ts`, `apps/web/test/app.test.ts`: regression coverage.

## Self-review

- Compared official head totals against raw received rows; no duplicate fact is deduplicated in the browser loader.
- A repeated whole page or row-total disagreement raises `INCOMPLETE_PAGE_SET`; callers do not receive a partial schedule.
- Confirmed no `console`/logger calls around request construction. `URLSearchParams` is used only for ordinary request parameters; the key is appended without URL encoding, is never returned by this API, stored, or logged.
- Confirmed the removed persistent-key identifiers have no production or test matches.

## Concerns

- NEIS authentication itself requires a query field; the key is necessarily present in the outbound request URL visible to the browser network layer. This change avoids persistence, logging, UI-returned URLs, and URL encoding, but cannot change the upstream API protocol.
