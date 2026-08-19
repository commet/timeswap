# Task 5 report: role projections and approval revalidation

## Status

Implemented pure role projections for teachers, operations, and public class schedules. Added whole-case approval revalidation against the active revision, base occupancy, accepted case occupancy, structured class identities, closures, unknown teacher occupancy, and parallel groups.

## RED and GREEN evidence

### Public privacy boundary

RED command:

```text
npm run test -w web -- projections.test.ts
```

RED output:

```text
FAIL  test/projections.test.ts [ test/projections.test.ts ]
Error: Cannot find module '../lib/projections'
Test Files  1 failed (1)
exit code 1
```

GREEN command:

```text
npm run test -w web -- projections.test.ts
```

GREEN output:

```text
Test Files  1 passed (1)
Tests  3 passed (3)
exit code 0
```

The test supplies a publication record at `resolution_approved`, `ready_to_publish`, and `published`. Only `published` changes the public lesson. The serialized result is also checked for requester, reason, note, burden, score, audit actor, and publication actor fields.

### Teacher and ops projections

RED command:

```text
npm run test -w web -- projections.test.ts
```

RED output:

```text
Tests  2 failed | 3 passed (5)
TypeError: projectTeacherSchedule is not a function
TypeError: projectOpsDashboard is not a function
exit code 1
```

GREEN command:

```text
npm run test -w web -- projections.test.ts
```

GREEN output:

```text
Test Files  1 passed (1)
Tests  5 passed (5)
exit code 0
```

Later focused coverage added a positive three-assignment burden alert and explicit public private-field omissions.

### Stale revision approval

RED command:

```text
npm run test -w web -- revalidation.test.ts
```

RED output:

```text
Tests  1 failed (1)
TypeError: validateCasePlan is not a function
exit code 1
```

GREEN command:

```text
npm run test -w web -- revalidation.test.ts projections.test.ts
```

GREEN output:

```text
Test Files  2 passed (2)
Tests  6 passed (6)
exit code 0
```

The approval attempt throws a recomputation error while the input case remains `in_review`; no task or audit entry is appended.

### Concurrent and whole-case occupancy

Concurrent RED command:

```text
npm run test -w web -- revalidation.test.ts
```

Concurrent RED output:

```text
Tests  1 failed | 1 passed (2)
Expected valid false with teacher conflict, received valid true and conflicts []
exit code 1
```

Whole-case RED command:

```text
npm run test -w web -- revalidation.test.ts
```

Whole-case RED output:

```text
Tests  4 failed | 4 passed (8)
Missing teacher, unknown-occupancy, closure, and parallel-group conflicts
exit code 1
```

Self-review concurrency RED command:

```text
npm run test -w web -- revalidation.test.ts
```

Self-review RED output:

```text
Tests  1 failed | 9 passed (10)
Expected an already-moved source lesson to be invalid, received valid true
exit code 1
```

Final focused GREEN command:

```text
npm run test -w web -- projections.test.ts revalidation.test.ts
```

Final focused GREEN output:

```text
Test Files  2 passed (2)
Tests  25 passed (25)
Duration 474ms
exit code 0
```

This matrix covers the exact reservation statuses, base teacher and class conflicts, all seven class identity fields, unassigned occupancy, unresolved plans, incomplete revisions, closures, partial and complete parallel groups, source-slot removal for a whole-case swap, and already-moved source lessons.

### Existing suite contract update

First web suite command:

```text
npm run test -w web
```

First web suite output:

```text
Tests  1 failed | 107 passed (108)
Error: The resolution plan has unresolved conflicts.
```

The old transition-matrix fixture attempted approval with no resolution. It was updated to use an explicit revision-bound manual resolution. Rerun output at that point:

```text
Test Files  9 passed (9)
Tests  108 passed (108)
exit code 0
```

## Final verification

Focused:

```text
$ npm run test -w web -- projections.test.ts revalidation.test.ts
Test Files  2 passed (2)
Tests  25 passed (25)
Duration 474ms
exit code 0
```

Root tests:

```text
$ npm test
@timeswap/engine: Test Files 19 passed (19), Tests 160 passed (160)
web: Test Files 9 passed (9), Tests 119 passed (119)
exit code 0
```

Root typecheck:

```text
$ npm run typecheck
tsc -p packages/engine/tsconfig.json --noEmit
npm run typecheck -w web
tsc --noEmit
exit code 0
```

The 41-class fixture contains 41 deterministic class identities and 10 cases. Ten timed validations returned zero invalid plans and satisfied the less-than-1,000ms assertion. The full focused file completed in 27ms of test time and 474ms total Vitest duration.

Final diff check:

```text
$ git diff --check
exit code 0
```

Git emitted only the repository's LF-to-CRLF working-copy notices.

## Commit

```text
1b1b1c2 feat(web): derive role views and revalidate changes
6 files changed, 1441 insertions(+), 2 deletions(-)
```

## Files

- `apps/web/lib/projections.ts`: new projection contracts and pure projection/validation implementations.
- `apps/web/lib/case-service.ts`: approval now calls `validateCasePlan`.
- `apps/web/lib/domain.ts`: candidates require `computedAgainstRevisionId`; revisions may carry structured closures.
- `apps/web/test/projections.test.ts`: public boundary, teacher state, ops count, immutability, and burden tests.
- `apps/web/test/revalidation.test.ts`: revision, collision, reservation, closure, group, concurrency, and scale tests.
- `apps/web/test/case-service.test.ts`: transition fixture updated to satisfy the stronger approval precondition.

## Self-review

- Confirmed all projection functions are pure and do not import React or browser APIs.
- Confirmed public output contains only school, class key, public lesson facts, publication id, and publication timestamps. It carries no teacher assignment or case/audit/task object.
- Confirmed publication projection requires both `case.status === 'published'` and a publication for the active revision.
- Confirmed occupancy reservations use only `resolution_approved`, `admin_in_progress`, `ready_to_publish`, and `published`.
- Confirmed accepted source lesson ids are reserved even when another plan proposes a different destination.
- Confirmed unproven accepted movements remain unknown occupancy and do not free base slots.
- Confirmed class comparisons use structured fields. No new `split('|')` parsing was introduced.
- Confirmed corrections exclude their explicitly superseded source case during revalidation.
- Mutation check: removing the publication status gate, active revision check, approval gate, any reservation status, source reservation, class field, unknown occupancy branch, closure branch, or group atomicity branch causes a focused test failure.

## Concerns

- Burden alerts use a prototype threshold of three accepted assigned movements because the canonical schema does not yet contain a configurable burden policy. The projection exposes both the alert count and per-teacher accepted movement count so a later policy can replace the threshold without changing source facts.
- Revision closures are optional structured data on `BaseScheduleRevision`. Existing revision payloads remain valid, while later demo/loading tasks must populate this field to exercise closure behavior outside unit fixtures.

## Review fix round 1

### Findings resolved

- Approval coverage now requires an explicit movement for the affected lesson. A `manual` item covers only its own anchor and only when `manualAction` is nonblank.
- Teacher pending projections omit the whole pending plan unless every selected resolution was computed against the active revision.
- Teacher views prefer a pending correction for status and ordering while retaining the older published value as the current published fact.
- Ops unresolved counts and approval validation call the same `resolutionCoversLesson` predicate for swaps, cycles, parallel groups, unrelated movements, and manual outcomes.

### RED

Command:

```text
npm run test -w web -- projections.test.ts revalidation.test.ts case-service.test.ts
```

Output:

```text
Test Files  2 failed | 1 passed (3)
Tests  8 failed | 52 passed (60)
Failures:
- unrelated movement incorrectly covered its anchor
- empty manual resolution incorrectly validated
- stale pending value appeared as 변경 예정
- pending correction appeared as published
- multi-lesson swap, cycle, and group counts were unresolved
- unrelated movement made an affected lesson appear resolved
exit code 1
```

### Focused GREEN

Command:

```text
npm run test -w web -- projections.test.ts revalidation.test.ts case-service.test.ts
```

Output:

```text
Test Files  3 passed (3)
Tests  60 passed (60)
Duration 501ms
exit code 0
```

### Final verification

Full web suite:

```text
$ npm run test -w web
Test Files  9 passed (9)
Tests  128 passed (128)
Duration 902ms
exit code 0
```

Root typecheck:

```text
$ npm run typecheck
tsc -p packages/engine/tsconfig.json --noEmit
npm run typecheck -w web
tsc --noEmit
exit code 0
```

### Review-fix files

- `apps/web/lib/domain.ts`: optional explicit `manualAction` fact.
- `apps/web/lib/projections.ts`: shared coverage predicate, active-revision pending filter, and pending-first teacher status/order.
- `apps/web/test/revalidation.test.ts`: unrelated-movement, empty-manual, and explicit-manual approval tests.
- `apps/web/test/projections.test.ts`: stale pending, correction precedence, and shared multi-lesson count tests.
- `apps/web/test/case-service.test.ts`: valid manual transition fixture now supplies the explicit safe action.

### Review-fix self-review

- Confirmed the empty and unrelated movement mutations fail approval tests.
- Confirmed removing the revision filter fails the stale pending test.
- Confirmed restoring published-first status or ordering fails the correction test.
- Confirmed duplicating the former ops anchor lookup fails all multi-lesson count cases.
- Confirmed `manualAction` is never included in public or teacher projection values.
- Confirmed no React, browser API, or new `split('|')` dependency was introduced.

### Review-fix diff and commit

```text
$ git diff --check
exit code 0

c3f98d8 fix(web): harden plan coverage projections
5 files changed, 223 insertions(+), 11 deletions(-)
```

Git emitted only the repository's LF-to-CRLF working-copy notices.
