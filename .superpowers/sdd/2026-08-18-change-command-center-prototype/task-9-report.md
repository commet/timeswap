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
