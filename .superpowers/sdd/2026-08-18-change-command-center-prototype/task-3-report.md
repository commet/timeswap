# Task 3 report — auditable absence-case state machine

## Result

Replaced the single-request domain boundary with canonical workspace, revision, lesson, multi-lesson absence case, resolution, administrative task, publication, and audit types plus a pure immutable case service. The service creates and validates cases, enforces the state graph, records accountable audit events, gates publication readiness on the three required prototype tasks, protects terminal/published history, and links correction cases without superseding the source until the correction reaches `published`.

The web domain imports and re-exports the canonical `ClassIdentity` from `@timeswap/engine`; it does not define a second class identity. All operation IDs and timestamps are caller-supplied, and unassigned teachers use `{ state: 'unassigned' }`.

## RED / GREEN evidence

1. Creation RED: `npm run test -w web -- case-service.test.ts` failed before production files existed with `Cannot find module '../lib/case-service'` (1 failed suite, 0 tests). Creation GREEN: the same command passed 1/1 test after the minimal domain and creation service were added.
2. Validation RED: the focused command reported 5 failed and 2 passed because reversed dates, blank requesters, empty lesson sets, mismatched requester ownership, and cross-workspace lessons were accepted. Validation GREEN: 7/7 passed after input and lesson-boundary checks were added.
3. State-machine RED: the focused command reported 15 failed and 7 passed because `transitionCase` and `deleteCase` did not exist. State-machine GREEN: 22/22 passed after the exact forward graph, actor/time checks, rejection note storage, terminal-state protection, audit appends, and published deletion protection were implemented.
4. Administrative-policy RED: the focused command reported 1 failed and 22 passed because `createPrototypeAdminTasks` did not exist. GREEN: 23/23 passed after configuring required `neis`, `teacher_notice`, and `class_publication` tasks plus optional `internal_document`, and implementing task completion.
5. Supersession RED: the focused command reported 2 failed and 23 passed because `createCorrectionCase` did not exist. GREEN: 25/25 passed after linked draft correction creation and publish-time supersession were implemented.
6. Readiness-bypass RED: the focused command reported 1 failed and 25 passed because direct `admin_in_progress → ready_to_publish` accepted missing tasks. GREEN: 26/26 passed after the transition itself was gated on all required task kinds, preventing callers from bypassing policy.

## Verification commands and exact results

| Command | Result |
| --- | --- |
| `npm run test -w web -- case-service.test.ts` | passed: 1 file, 26 tests |
| `npm run test -w web` | passed: 5 files, 89 tests |
| `npm run typecheck -w web` | passed: `tsc --noEmit`, exit 0 |
| `rg -n "localStorage\|sessionStorage\|fetch\\(\|React\|Date\\.now\|Math\\.random" apps/web/lib/domain.ts apps/web/lib/case-service.ts apps/web/test/case-service.test.ts` | no matches |
| `git diff --check` | passed |

## Files

- `apps/web/lib/domain.ts` — schema-v2 canonical browser domain, reusing engine `ClassIdentity`.
- `apps/web/lib/case-service.ts` — pure creation, transition, deletion protection, administrative policy, task completion, correction, supersession, and immutable audit operations.
- `apps/web/test/case-service.test.ts` — 26 focused behavior tests covering the brief's creation, validation, transition, administration, immutability, and correction requirements.

## Self-review

- Checked the six specified forward edges literally; skipped edges and all four terminal states cannot reopen.
- Readiness cannot be reached by calling `transitionCase` around the task service: the state transition independently verifies the exact three required task kinds.
- `case.created` stores only the lesson count in audit details; it does not duplicate the free-text note. Each service return replaces only changed collections/records and preserves the caller's prior state.
- Correction creation retains the published source object unchanged and copies the lesson-id array. Publishing the correction creates new case objects, marks only its linked published source `superseded`, and records that source id in the status audit.
- Confirmed no React, browser storage, fetch, random ID generation, or current-clock access entered the domain/service boundary.
- Confirmed the test fixture copies its lesson array, avoiding cross-test mutation.

## Concerns

- This slice models `Publication` but does not create publication records; the later publication task owns that workflow. In this task, the successful `ready_to_publish → published` transition is the event that triggers linked-case supersession.

## Fix round 1 — complete, privacy-safe compound audit evidence

### Covering tests and TDD evidence

- Updated `stores the note when an in-review case is rejected` to assert the case retains the rejection note, the status audit contains only `previousStatus` and `nextStatus`, and serialized audit history does not contain the note text.
- Extended `becomes ready when all required tasks finish while the optional document stays open` to require a separate `admin.tasks_created` event scoped to the case with the four literal task IDs identified by their safe task-kind keys.
- Extended `supersedes the old case only when the correction reaches published` to require two distinct events: the correction's `ready_to_publish → published` status event and a `case.superseded` event scoped to the source case with `published → superseded` and the correction case id.
- RED: `npm run test -w web -- case-service.test.ts` exited 1 with 3 failed and 23 passed. The failures showed the rejection text still present in audit details, no task-creation event, and no source-case supersession event.
- GREEN: `npm run test -w web -- case-service.test.ts` exited 0 with 1 file and 26 tests passed.

### Implementation

- Removed the free-form rejection note from `case.status_changed` audit details while retaining the trimmed note on `AbsenceCase`.
- Added caller-supplied `taskAuditEventId` and an explicit `admin.tasks_created` audit event whose details identify `neis`, `teacher_notice`, `class_publication`, and `internal_document` task IDs.
- Added caller-supplied `supersessionAuditEventId` for correction publication and an explicit `case.superseded` audit event scoped to the source case. The compound operation validates both audit IDs before changing state.
- Extended the `AuditEvent.type` union only for `admin.tasks_created` and `case.superseded`.

### Verification commands and exact results

| Command | Result |
| --- | --- |
| `npm run test -w web -- case-service.test.ts` | passed: 1 file, 26 tests |
| `npm run test -w web` | passed: 5 files, 89 tests |
| `npm run typecheck -w web` | passed: `tsc --noEmit`, exit 0 |
| `git diff --check` | passed, exit 0; Git emitted only existing LF-to-CRLF working-copy warnings |

### Self-review and concerns

- Each compound mutation now has evidence scoped to the record it creates or changes, and all extra event IDs are supplied rather than generated from wall-clock/random state.
- Task audit details contain identifiers and coded kinds only; source supersession details contain statuses and the linked correction id only. Neither new event carries reason/note content.
- Intentionally did not address the separately recorded minor findings about blank existing IDs or backward timestamps.
