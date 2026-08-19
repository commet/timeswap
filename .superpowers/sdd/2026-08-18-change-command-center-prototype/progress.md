# SDD ledger — plan: docs/superpowers/plans/2026-08-18-change-command-center-prototype.md

Workspace: C:/Users/SAMSUNG/Documents/ChatGPT/timeswap/timeswap/.worktrees/change-command-center
Branch: codex/change-command-center-prototype
Execution base: 8baf8cb
Baseline: npm test — 205 passed, 0 failed (engine 152, web 53)

## Pre-flight self-consistency scan

| Task | Tests against implementation | Files/interfaces | Finding or ruling |
|---|---|---|---|
| 1 | normalization tests directly cover the new adapter and existing `fromNeis` | new adapter is exported by engine index | Clean |
| 2 | mocked fetch tests cover pagination, gaps, truncation, recent-week search, session key | `NeisRequest` is named but not defined | Ruling: export a typed request with endpoint, params, optional in-memory key, and injected fetch/clock where tests require them — avoids an `any` public API — cost if wrong: later client call sites need a small signature refactor |
| 3 | creation, transition, policy, supersession tests cover domain/service | `ClassIdentity` also belongs to Task 1 engine boundary | Ruling: import and reuse engine `ClassIdentity` in web domain instead of defining a second incompatible shape — cost if wrong: web may need a mapping type when server DTOs arrive |
| 4 | round-trip, migration, URL, history tests match repository/navigation | migration consumes Task 3 entities | Clean |
| 5 | projection, stale revision, concurrency, scale tests match service | “active accepted” case set is not enumerated | Ruling: conflict occupancy includes `resolution_approved`, `admin_in_progress`, `ready_to_publish`, and `published`; review-only states do not reserve slots — cost if wrong: schools that reserve tentative approvals would need a policy flag |
| 6 | inventory and manifest sum tests cover ten scenarios/provenance | manifest has exact measured totals but no raw corpus in Git | Ruling: store public school/query/count provenance plus representative raw-row fixture, never the credential or full local cache — cost if wrong: another researcher must repeat live retrieval to audit every row |
| 7 | landing/setup/back/keyboard smoke covers shell | setup consumes Task 2 and Task 4 boundaries | Clean |
| 8 | affected-lesson unit tests and teacher smoke match UI | plan modifies `case-service.ts` but omits it from Files | Ruling: include `apps/web/lib/case-service.ts` in Task 8 scope — cost if wrong: none beyond a slightly wider task diff |
| 9 | view-model and no-repeat-action smoke cover matrix | `resolutionRowsForLesson` has no owning source file | Ruling: create `apps/web/lib/resolution.ts` and test it from `resolution.test.ts`; keep candidate mapping out of React — cost if wrong: one extra module to maintain |
| 10 | metrics, timeline, actions, mobile-step smoke cover command center | all state changes route through Task 3/5 services | Clean |
| 11 | publication rule and two-page leak tests cover closure/public view | output functions and `publishCase` need clear ownership | Ruling: create `apps/web/lib/publication.ts` for pure document builders and keep `publishCase` in `case-service.ts` — cost if wrong: an extra import boundary |
| 12 | viewport, Axe, keyboard, screenshot checks cover styling/accessibility | dependency belongs to root where Playwright already lives | Clean after plan correction to root `package.json` |
| 13 | five E2E, failure flows, config checks cover all gates | final `serve` is blocking | Clean after plan correction to two terminals |

## Pre-flight shared-boundary scan

| Producing task → consuming task | Shared file/interface | Finding or ruling |
|---|---|---|
| 1 → 2 | normalized raw count vs API raw total | Keep API completeness on raw response count; dedupe only after loading. Clean |
| 1 → 6 | `neis-data-quality.json`, `ClassIdentity`, parallel groups | Scenario 9–10 consume the exact engine contract. Clean |
| 2 → 7 | `neis.ts`, `NeisLoader`, ephemeral key | Setup never persists or URL-encodes the key. Clean |
| 2 → 13 | typed failures | Smoke mocks the typed boundary rather than message substrings where possible. Clean |
| 3 → 4 | `WorkspaceState`, v1 migration | Repository schema version remains 2. Clean |
| 3 → 5 | `case-service`, statuses, audit | Projection is read-only; approval invokes validation. Clean |
| 3 → 8 | `AbsenceCase`, lesson selector | Task 8 scope ruling recorded above |
| 3 → 10 | transitions and audit | Components never hand-edit canonical state. Clean |
| 3 → 11 | admin tasks, publication, supersession | Ownership ruling recorded above |
| 4 → 7 | repository, navigation, `Workbench` | Shell is the only React persistence/navigation owner. Clean |
| 4 → 13 | quota and malformed-state failures | Export recovery remains available. Clean |
| 5 → 6 | projections over deterministic demo state | Fixed clock required. Clean |
| 5 → 8 | teacher schedule projection | `변경 예정` and published remain distinct. Clean |
| 5 → 10 | ops dashboard and validation | Counts derive from canonical state. Clean |
| 5 → 11 | public/teacher projections | Only publication mutates public truth. Clean |
| 6 → 7 | demo entry state | Sample schedule is replaced by provenance-aware workspace. Clean |
| 6 → 10 | scenario picker | Operational picker includes 2–8 only. Clean |
| 6 → 13 | resettable scenario ids | E2E helpers use fixed clock and isolated demo storage. Clean |
| 7 → 8 | `Workbench`, `TeacherHome` | Shell remains thin; teacher view owns workflow UI. Clean |
| 7 → 9 | `Workbench`, `Grid` | Matrix owns comparison; shell only passes callbacks. Clean |
| 7 → 10 | `Workbench`, URL location | Mobile ops steps are URL-addressable. Clean |
| 7 → 11 | `Workbench`, role links | Public link carries no internal state. Clean |
| 7 → 12 | shell markup and CSS | Accessibility landmarks land before visual polish. Clean |
| 8 → 9 | `Grid`, selected lessons, case items | Matrix updates one item then validates the combined case. Clean |
| 8 → 11 | `TeacherHome` projection | Unpublished is pending; published is definitive. Clean |
| 9 → 10 | selected resolution items | Ops may replace only with currently valid alternatives. Clean |
| 9 → 12 | comparison semantics and responsive CSS | Mobile changes presentation, not information. Clean |
| 10 → 11 | case detail to publication center | Approval and publication stay separate. Clean |
| 10 → 12 | command-center layout | Mobile uses steps, not squeezed columns. Clean |
| 10 → 13 | ops smoke selectors | Prefer roles/names and stable data attributes for scenario identity. Clean |
| 11 → 12 | public/pulse semantics and motion | Reduced motion gets immediate state plus live announcement. Clean |
| 11 → 13 | public leak/correction flows | Separate page validates repository-backed truth. Clean |
| 12 → 13 | Axe, viewport metrics, screenshot paths | Final smoke consumes deterministic visual helpers. Clean |

## Progress

Task 1: dispatched next
Task 1: fix round 1/5 (1 addressed, 0 open — canonical identity is now invariant across partial imports; commits eb6d56c..f708257)
Task 1: minor (deferred): canonical JSON class keys are still embedded in pipe-delimited composite keys; an official identity value containing `|` could corrupt downstream split parsing
Task 1: complete (commits 8baf8cb..f708257, review clean with 1 deferred minor)
Task 2: dispatched next
Task 2: minor (deferred): `NeisLoader` persists the old five-week range/text after `findRecentTeachingWeek` selects one complete Monday–Friday week; provenance display must be aligned in Task 7
Task 2: complete (commits f708257..0fb926d, review clean with 1 deferred minor)
Task 3: dispatched next
Task 3: fix round 1/5 (2 addressed, 0 open — rejection note removed from audit; compound task/supersession mutations now have explicit safe events; commits 36752ac..04c7f65)
Task 3: minor (deferred): required case/audit identifiers can be blank
Task 3: minor (deferred): mutation timestamps are syntactically checked but can move `updatedAt` backward
Task 3: complete (commits 0fb926d..04c7f65, review clean with 2 deferred minors)
Task 4: dispatched next
Task 4: fix round 1/5 (3 addressed, 0 open — malformed legacy optionals/kind skip safely, invalid URLs fall back, multi-lesson round trip covered; commits b18f0ee..f16efb4)
Task 4: minor (deferred): quota-specific save failure and `replaceLocation` behavior are implemented but not directly tested
Task 4: minor (deferred): invalid legacy `adminNote` is guarded in production but lacks its own regression fixture
Task 4: complete (commits 04c7f65..f16efb4, review clean with 2 deferred minors)
Task 5: dispatched next
Task 5: fix round 1/5 (4 addressed, 0 open — empty/unrelated resolution approval blocked, teacher pending revision-bound, pending correction visible, ops coverage unified; commits 1b1b1c2..c3f98d8)
Task 5: complete (commits f16efb4..c3f98d8, review clean)
Task 6: Ruling: the plan asks for 12 named school/code rows with per-school counts, but the approved spec retained only aggregate measurements and explicitly says bulk raw responses were not committed; do not fabricate a school-level breakdown. Preserve the verified aggregate totals/categories, named facts only for Seoul Technical, Daegu Technical, and Daejeon Middle where the spec names them, and label the manifest’s school-level list as requiring a credentialed corpus refresh — cost if wrong: the prototype lacks school-by-school auditability until the live corpus is repeated
Task 6: dispatched next
Task 6: fix round 1/5 (2 addressed, 1 open — elective cover and provenance fixed; atomic practice block still bypassable by a subset manual resolution or scattered destinations; commits 557ac80..465cd23)
Task 6: fix round 2/5 (1 addressed, 0 open — case subset, manual bypass, and scattered destinations now fail atomic validation; commits 465cd23..3798de3)
Task 6: minor (deferred): determinism regression compares every id/timestamp only for the default scenario, not all ten
Task 6: complete (commits c3f98d8..3798de3, review clean with 1 deferred minor and 1 preflight ruling)
Task 7: dispatched next
Task 7: fix round 1/5 (3 addressed, 0 open — landing query forwarded, key cleared at review completion, opaque invitation ids; commits e096c6c..561d78e)
Task 7: minor (deferred to Task 8): legacy role adapter displays opaque `member:*` ids as teacher names after invitation entry; canonical teacher view needs separate display labels
Task 7: minor (deferred): `createInvitationLinks` trusts arbitrary pre-existing teacher ids when called outside the NEIS setup path
Task 7: minor (deferred to Task 12): desktop role-navigation controls are 38px rather than the 44px minimum
Task 7: complete (commits 3798de3..561d78e, review clean with 3 deferred minors)
Task 8: dispatched next
Task 8: fix round 1/5 (1 Critical and 5 Important addressed — diagnostic export redacted, source counts strict, persistence atomic, period ordering/same-slot rendering/original-new projections fixed; commits 61b7cfb..21d4512)
Task 8: fix round 2/5 (2 Important and target-size minor addressed — setup/demo save gating, honest first/next labels, reachable safe diagnostics, 44px controls; commits 21d4512..7a91caf)
Task 8: minor (documented): legacy revisions without persisted source counts are conservatively blocked and display 0/0 until re-imported
Task 8: complete (commits 561d78e..7a91caf, review READY)
Task 9: dispatched next
Task 9: fix round 1/5 (4 Important addressed — engine-derived exchanges, duplicate protection, empty destination axes, opaque-label redaction; commits be5aa2a..5751f94)
Task 9: fix round 2/5 (1 Important addressed — engine-scored cover ranking with grouped-slot intersection; commits 5751f94..8b0d5bc)
Task 9: complete (commits 7a91caf..8b0d5bc, review READY; 371 tests and 1440/390/320 smoke green)
Task 10: dispatched next
