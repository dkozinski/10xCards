<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate and Save Screens Under Failure

- **Plan**: `context/changes/testing-generate-save-failures/plan.md`
- **Scope**: Phase 4 of 6 (reviewed uncommitted, before the phase commit)
- **Date**: 2026-10-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Evidence

- **Drift check (sub-agent, read-only):**
  - RV-1 to RV-8, the #43 pin and the mutation run all MATCH the plan's intent. No expected value is computed with `proposalSource`, and every body is literal.
  - The three tests and one assertion added by the mutation triage are justified by sources: `MAX_PROPOSALS = 20`, the route's `_root` answer, and archived impl-review phase 3, F2.
  - Every Run 7 verdict holds. The sub-agent tried each answer the route can give (a non-object body, more than 20 cards, unknown keys, nested paths) and found none that tells an "Equivalent" mutant apart. Each "Killed" mutant fails the assertion that its verdict names.
  - `src/lib`, `src/components/**/*.tsx` (non-test), `package.json` and the configs are unchanged against HEAD.
- **Safety and pattern check (sub-agent, one probe file created and deleted):**
  - With `it.fails` flipped to `it`, #43 fails with `Unable to find an element with the text: Could not save. Please try again.`
  - Without the scoped listener, Vitest reports `Unhandled Rejection … cardErrors ProposalReview.tsx:45:40`, so the listener is needed.
  - Under this jsdom setup `window === globalThis`, so `vi.stubGlobal("location", …)` reaches `window.location.assign`. Without the stub, RV-1 fails and jsdom prints "Not implemented: navigation", so the `assign` assertions depend on the stub.
  - Isolation holds: `afterEach` cleans up, resets the three mocks and unstubs globals. The pin removes its listener in `finally`, and a `--sequence.shuffle` run is green.
  - There are no substantive mismatches with the Phase 3 sibling: test names, `$row`, helper shapes, jest-dom matchers, and an `await` on every `user.*` call.
- **Success criteria, re-run by the reviewer:**
  - 4.1 `npx vitest run src/components/generate/ProposalReview.test.tsx`: 13 passed, 1 expected failure. The sub-agent saw the same on three more runs and one shuffled run.
  - 4.2 `npm test`: 27 files, 381 passed, 6 expected failures. No stderr, no `act` warning, no unhandled-error banner.
  - 4.3 Confirmed independently by the probe above.
  - 4.4 `npm run lint`: exit 0.
  - 4.5 Run 7 and Run 8 give every survivor a verdict, but the 6 timed-out mutants have none (F1).
  - 4.6 (manual): the owner confirmed in this session that the test list covers the risk #3 scenarios.

## Findings

### F1 — Six timed-out mutants are untriaged, and two hide an untested answer

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-generate-save-failures/mutation-report.md, Run 7 and Run 8; src/components/generate/ProposalReview.tsx:159-160
- **Detail**: Stryker counts a timeout as detected, so the 92.79 % score includes six mutants that no test told apart from the original:
  - `131:9`, `if (pending)` → `false`;
  - `132:5`, `setError(null)` removed;
  - `145:18` and `145:36`, the headers;
  - `159:18`, `body?.error` → `body.error`;
  - `160:31`, `body?.saved_count` → `body.saved_count`.

  The last two are real. Every RV-4 row answers with JSON or rejects, so no save test sends a body that `.catch(() => null)` turns into `null`. If an edge or proxy HTML page answers a save, these mutants throw while `pending` is set. The spinner then sticks with no Try again, and the only way out is a reload, which loses the review. The archived plan lists a "malformed 200" among the ambiguous failures (`review-and-save-proposals/plan.md:391`), and the component's own comment names such a body (`:157`). GS-1 already has an HTML-body row for the generate side.

- **Fix**: Add an RV-4 row "a 200 with an HTML body". Re-run Stryker as Run 9, and give every timeout a verdict: `131:9` is equivalent, because Save and Try again are disabled while pending; `132:5` is cosmetic, because the stale alert shows only while the retry is in flight; `145:*` is equivalent, as in Run 5 #12 and #14; `159`/`160` should be killed by the new row.
- **Decision**: FIXED. RV-4 has the HTML-body row. Run 9 showed that timeouts shift between runs, so Run 10 repeated it with `--timeoutMS 30000`: 99 killed, 12 survived, 0 timed out, 89.19 %. `159`/`160` are killed. `131:9`, `145:18` and `145:36` are equivalent, and `132:5` is cosmetic (Run 10 #17–#20).

### F2 — Two lock paths of the review are not pinned

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/generate/ProposalReview.test.tsx:164-197 (RV-4), :141-160 (RV-3)
- **Detail**: The two gaps sit in the JSX, outside the Stryker ranges.
  - **Revert while frozen.** No card in RV-4 or RV-6b is edited, so the Revert button is never rendered while the list is frozen. If `disabled={locked}` is dropped from Revert alone, nothing fails. Yet the user could then revert while frozen: the screen would show the original wording while Try again still sends the edited one. That is the "edits after a save that committed" regression RV-4 names.
  - **Per-card controls while pending.** RV-3 checks only that Save is disabled in flight. If the per-card lock became `frozen !== null`, the user could reject a card while the save is in flight. The card would land in the deck while the list shows it as rejected, which is consent-before-save (risk #3).
- **Fix**: In RV-4, edit card 1 before Save and expect 6 locked controls instead of 5. In RV-3, assert that every per-card control is disabled while "Saving…" is shown.
- **Decision**: FIXED. RV-4 now edits card 1 and expects 6 locked controls, and RV-3 checks the per-card controls while the save is in flight. A probe on a copy of the component confirmed both. With Revert unlocked, all 4 RV-4 rows fail. With the per-card lock reduced to `frozen !== null`, RV-3 fails.

### F3 — RV-8 asserts less than its siblings

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/generate/ProposalReview.test.tsx:342-374
- **Detail**:
  - "Opens its editor" rests on an unasserted precondition: nothing checks that card 1's editor is closed after Restore, before Save. Today the `openWith` mutant is killed, but only because Reject happens to close the editor.
  - The alert check only asserts that an alert exists, while RV-5 checks that it names one card (archived impl-review phase 3, F2, covers client-side validation too).
- **Fix**: Before Save, assert `within(card(1)).queryByLabelText("Front")` is absent. Change the alert check to `toHaveTextContent(/1 card/)`.
- **Decision**: FIXED: both checks added

### F4 — The plan does not record the as-implemented deviations

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: plan.md Phase 4 §1; ProposalReview.test.tsx
- **Detail**: Each deviation is a faithful strengthening, but Phase 5's cookbook and the PR will be written from the plan, which still describes the original table. Phase 3 recorded its deviations inline (impl-review phase 3, F2).
  - RV-4 checks the save deadline in all three rows, not only the network row.
  - RV-5 starts from a frozen list (network failure, Try again, then 400) and ends with a re-save. Starting unfrozen could not catch the plan's own regression, "list left frozen after a 400".
  - RV-6 is two tests.
  - RV-8 builds the invalid card by edit, reject and restore, the only way to keep an invalid card with its editor closed.
  - RV-1 checks the unload guard before and after the save. RV-6's first test checks only that the guard is still armed after the 401; the implementer's summary overstated this.
  - The mutation triage added two RV-5 tests (a two-digit index; an error that names no card) and the `/1 card/` check in RV-5.
- **Fix**: Amend Phase 4 §1 inline with an "As implemented (impl-review phase 4, F4)" list, as Phase 3 did.
- **Decision**: FIXED. Phase 4 §1 now carries the list below its table, including the review's own additions (F1–F3).
