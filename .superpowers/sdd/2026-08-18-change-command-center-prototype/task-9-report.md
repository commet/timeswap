# Task 9 report: unified resolution comparison

## Delivered

- Added `apps/web/lib/resolution.ts` as the typed source of truth for ranked move, swap, cycle, and cover rows, selection details, multi-lesson plan validation, progress, and redacted collaborator labels.
- Added `ResolutionMatrix`: one semantic radio table, keyboard row navigation, selected-detail preview, and exactly one submit action.
- Connected Task 8's canonical `CandidateHandoff` to `WorkspaceState` and the existing repository save boundary. Selecting a row is preview-only. The one primary action persists the selected resolution with the case.
- Added timetable source and destination highlighting, multi-lesson `해결` / `주의` / `미해결` progress, and complete parallel elective cover choices.
- Kept desktop fixed comparison columns. At 390px and 320px, the same facts render as labeled row pairs without horizontal scroll, with a 44px minimum primary action and safe sticky-action spacing.
- Deleted `apps/web/components/CandidateCompare.tsx` and `apps/web/components/CoverCompare.tsx` after coverage passed and production references reached zero.

## TDD record

Each behavior began with a focused failure before the smallest implementation change.

| Behavior | Observed RED | GREEN evidence |
| --- | --- | --- |
| Resolution rows | `Cannot find module ../lib/resolution` | Resolution row test passed after typed model was added. |
| Detail and selection model | Missing detail and selection functions | Detail, redaction, selection, and combined plan validation tests passed. |
| Matrix surface | `Cannot find module ../components/ResolutionMatrix` | Semantic radio matrix test passed. |
| Canonical handoff | Missing handoff payload helper | Composer reason and note propagation test passed. |
| Atomic persistence | Submitted resolution items were `[]` | Repository case-service test passed with one stored resolution. |
| Multi-lesson progress | Missing resolution-progress model | Full-case validation rail test passed. |
| Atomic whole-group cover | No valid cover row for the entire group | Group cover test passed with all lessons changed atomically. |
| Move, swap, cycle mix | Rows contained only cover candidates | Derived exchange tests passed with the three methods. |
| Timetable linkage | Resolution source/destination attributes were absent | Grid rendering test passed. |
| Responsive labels | Mobile table pseudo-label was absent | 390px and 320px smoke assertions passed. |
| Elective constraint | `resolutionConstraintForLesson` was not defined | Constraint unit test passed. |
| Production elective coverage | Previous static build lacked `.resolution-atomic-note` | Rebuilt production smoke passed with the group explanation and one whole-group cover. |

## Final verification

- Focused web tests: 58 tests passed before final combined suite.
- `npm test`: 19 engine files, 160 tests passed. 16 web files, 207 tests passed. Total 367 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Checked production server smoke: passed at 1440px, 390px, and 320px. It covers the sole matrix action, Arrow navigation and Space selection, preview-only selection, canonical save, source/destination highlights, multi-lesson validation, zero-exchange parallel elective cover, and mobile layout.
- `git diff --check`: passed.
- `rg -n "CandidateCompare|CoverCompare" apps/web`: no matches.

## Boundaries and concern

The matrix only derives display values from canonical workspace data, retains Task 8 save-failure behavior, and does not disclose raw `member:*` values. Ops command-center and publication flows were not redesigned.

The retired legacy `Panel` comparison area now directs users to the canonical teacher timetable route. No remaining Task 9 blocker or known defect remains.

## Review fix round 1

### Corrected behavior

- Removed ad-hoc move, swap, and cycle generation. The active target-week adapter now builds `TimetableInput` from canonical lessons and calls engine `recommend` for generated exchange rows.
- The adapter carries full class identity, parallel and atomic group ids, unknown-teacher `klassBusy` slots, and active-revision closures. Generated rows preserve engine order and retain redacted score and trace facts in the selected detail.
- Existing exchange items remain visible only when active revision validation accepts them. They are not used to fabricate generated candidates.
- Matrix confirmation now performs canonical duplicate detection before persistence and keeps the matrix open with an actionable existing-request message instead of creating a second submitted case.
- Teacher grid dates and numeric periods now union the selected preview destination, so an otherwise empty destination cell is rendered and marked.
- Blank or opaque stored collaborator labels fall back to `협조 교사`; the matrix never renders the stored opaque value.

### Review TDD record

| Behavior | Observed RED | GREEN evidence |
| --- | --- | --- |
| Engine class-unit constraints | An unrelated class produced `맞교환` | Engine-backed rows omit unrelated swap and cycle candidates. |
| Engine ranking evidence | Generated row count with `engineScore` was zero | Engine-ranked rows carry descending score and trace. |
| Selected engine detail | `엔진 검토 근거` was absent | Matrix renders selected score and redacted trace. |
| Opaque collaborator label | `MEMBER:han-sol` rendered in row detail | Row and detail render `협조 교사`. |
| Empty preview destination | Period 1 was absent when the teacher only had period 3 | The grid includes and marks the empty period 1 destination. |
| Matrix duplicate confirmation | Browser smoke created two submitted cases and showed no guidance | One submitted case remains and the matrix names the existing-request next action. |
| Mobile sticky detail | Final detail bottom was 844.34 while action top was 777 | Sticky-scroll margin keeps the final detail row clear at 390px. |

### Review verification

- Focused web suite: 4 files, 61 tests passed.
- `npm test`: 19 engine files, 160 tests passed. 16 web files, 210 tests passed. Total 370 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Checked production smoke: passed at 1440px, 390px, and 320px.
- `git diff --check`: passed.

One earlier parallel full-suite attempt hit the existing engine scale-test runner timeout despite reporting a 64.3ms per-recommendation average. A clean final `npm test` passed all 370 tests without changing engine code.

## Review fix round 2

### Corrected behavior

- Replaced the web-only cover picker with `@timeswap/engine` `coverCandidates` using the existing active target-week adapter and the absent requester id.
- Generated cover rows now retain engine score, ranked notes as redacted trace facts, and burden notes as warnings in both the row and selected detail.
- Parallel and atomic groups intersect engine-ranked candidates for every grouped lesson slot, sum the per-slot scores deterministically, and retain the canonical whole-group resolution item.
- Generated scored covers follow valid exchanges and precede any retained unscored canonical cover, with canonical-change deduplication preserving the engine-ranked item.

### Review TDD record

| Behavior | Observed RED | GREEN evidence |
| --- | --- | --- |
| Engine cover ranking | The local picker put `한솔` ahead of the lighter same-subject cover teacher. | The engine-ranked row puts `가벼운 보강 교사` first with positive score and trace. |
| Whole-group cover facts | A zero-exchange elective cover had no engine score or trace. | The valid 3-lesson cover includes engine score and trace while remaining a single atomic selection. |

### Review verification

- Focused `resolution.test.ts`: 11 tests passed.
- `npm test`: 19 engine files, 160 tests passed. 16 web files, 211 tests passed. Total 371 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Checked production smoke: passed at 1440px, 390px, and 320px, including the matrix keyboard flow, grouped cover, and mobile layout.
- `git diff --check`: passed.

No Task 10 or Task 11 surface was changed. No known blocker remains.
