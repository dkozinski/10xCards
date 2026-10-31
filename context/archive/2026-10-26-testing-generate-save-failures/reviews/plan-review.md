<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Generate and Save Screens Under Failure

- **Plan**: `context/changes/testing-generate-save-failures/plan.md`
- **Mode**: Deep
- **Date**: 2026-10-27
- **Verdict**: REVISE
- **Findings**: 0 critical, 3 warnings, 4 observations
- **Triage**: 2026-10-28 — all 7 fixed (F1, F2 via Fix A). Verdict after fixes: SOUND

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

- 17/17 paths ✓, 7/7 symbols ✓, 6/6 Stryker line ranges match their function boundaries ✓, Progress↔Phases ✓, brief↔plan ✓.
- A deep verification pass (one sub-agent, six questions, read-only) checked the riskiest claims.
  - **Confirmed:**
    - The pre-fix production probe will answer 500. The bundled `src/pages/api/proposals/index.test.ts` calls `vi.mock` at module top level, and outside Vitest that throws "Vitest mocker was not initialized in this environment".
    - The eight renames break nothing. Astro 6.4.8 skips `_`-prefixed names (`create-manifest.js:92`). No config, script or CI step references the files, and nothing imports them.
    - Vitest's jsdom environment takes `DOMException`, `Event` and `location` from jsdom. `fetch`, `Response`, `AbortSignal`, `AbortController` and `crypto` stay Node's.
    - Test files are isolated (`isolate: true`, pool `forks`).
    - jsdom is not installed yet. The plan adds it in Phase 3.
  - **Contradicted:** the plan's claim that the G4 pin "cannot be executable" (F1).

## Findings

### F1 — G4 can be an executable pin; test-scoped listeners must be removed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details; Phase 3 §3; Phase 4 §2; criterion 3.4
- **Detail**:
  - **The claim.** The plan says G4 "cannot be executable", because Vitest fails the run on an unhandled rejection even inside `it.fails`.
  - **What the worker does.** `node_modules/vitest/dist/chunks/init.IsjtLXKe.js:101-103` skips reporting when the user has registered a listener: "if there is another listener, assume that it's handled by user code". So a test-scoped `process.on("unhandledRejection", …)` keeps the run clean.
  - **Window errors.** The same listener counting applies to jsdom window `error` events (`index.hTNFpC24.js:1241-1263`). The G3 listener must therefore be removed after its test. Otherwise it silences every later error in the file.
  - **Trap.** A pin must never wait for the rejection itself. Once Lesson 5 fixes the gap, there is no rejection, so the test would time out. `it.fails` would then report a pass, and the pin would never turn red.
- **Fix A ⭐ Recommended**: Make G4 an `it.fails` in both component files, using a `process.on("unhandledRejection")` listener scoped to the test.
  - The listener is added before the action and removed in `finally`.
  - The pin waits for the desired outcome, never for the rejection.
  - The G3 `window` `error` listener gets the same add/remove scoping.
  - Update Critical Implementation Details, Phase 3 §3, Phase 4 §2, criterion 3.4 and Progress 3.4.
  - Strength: executable pins, as the owner decided; each pin turns red when Lesson 5 fixes its gap.
  - Tradeoff: a global-listener pattern in tests; a listener left in place masks errors in later tests of the same file.
  - Confidence: HIGH — the Vitest worker code was read directly.
  - Blind spot: when Node emits `unhandledRejection` relative to `findBy…` polling; removing the listener in `finally`, after the assertion settles, covers it.
- **Fix B**: Keep G4 as `it.todo`, correct the stated rationale, and add removal of the G3 listener.
  - Strength: simpler test code.
  - Tradeoff: G4 will not alert when it is fixed; this departs from the "executable pins" decision.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (2026-10-28). Also aligned the G4 row of the gap table, Implementation Approach and the §6.1 cookbook bullet; added Phase 4 criterion 4.3 (Progress 4.3–4.6 renumbered).

### F2 — Q-6 is left out of the trackers

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 6 — Release
- **Detail**:
  - This change commits `test-plan.md`, which is the answer to Q-6: yes, phased, starting with generate/save.
  - It also ships the first deliberate checks of the guardrail "no card reaches the deck without an explicit save".
  - The plan never mentions GitHub #6, roadmap Open Roadmap Question 6 or Linear DAW-10.
  - `lessons.md` already holds a rule about exactly this drift: "Merge slice PR = zamknięte issues, ale nie zsynchronizowane trackery".
  - The `tasks-github.md` Lifecycle row "Answer a question" says: write the Decision, then close the issue; update the PRD and roadmap.
- **Fix A ⭐ Recommended**: In Phase 6, before the merge, write the Decision into #6 (body and comment), into roadmap Q-6 and into DAW-10. The PR carries `Refs #6`. #6 stays open until rollout Phase 2 ships checks for the second guardrail, review-session reliability.
  - Strength: the trackers tell the truth: decided, half delivered.
  - Tradeoff: #6 stays open longer, and one more sync step comes later.
  - Confidence: HIGH — based on the roadmap Q-6 text and the Lifecycle table.
  - Blind spot: whether the owner treats Q-6 as answered by the test plan alone.
- **Fix B**: Write the Decision before the merge and put `Closes #6` in this PR.
  - Strength: the question asks "do they get checks, and starting where?", and that is now decided; one sync instead of two.
  - Tradeoff: the issue closes while the second guardrail has no dedicated check yet.
  - Confidence: MED.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (2026-10-28). New Phase 6 §3 (merge became §4), PR-body bullet, Desired End State bullet, criterion and Progress 6.4 (6.5–6.6 renumbered). PRD has no matching open question, so only #6, roadmap Q-6 and DAW-10 are synced.

### F3 — Criterion 5.2 cannot pass as written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 — Success Criteria (5.2)
- **Detail**:
  - The criterion "the §2 section contains no `src/` path" fails on today's unedited file.
  - §2 cites four hot-spot directories (`src/pages/api`, `src/components/generate`, `src/lib/services`, `src/components/deck`), and the test-plan rules allow them.
  - The implementer would either fail the criterion or delete legitimate evidence.
- **Fix**: Check only the edited cell, Risk Response Guidance row #1. It must contain no file path, `file:line`, function or schema name. The existing directory citations stay.
- **Decision**: FIXED (2026-10-28). Criterion 5.2 now runs a row-#1 `awk` check that prints `1 row, 0 anchors` (tested on today's file, plus a negative control with an injected anchor); Progress 5.2 retitled.

### F4 — Client request deadlines are untested

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 GS-1; Phase 4 RV-4
- **Detail**:
  - Removing `signal: AbortSignal.timeout(...)` from `GenerateProposals.tsx:87` or `ProposalReview.tsx:147` survives every planned test and Stryker. Stryker has no mutator that deletes a single property, and its object-literal mutant is caught by the request-body assertions instead.
  - The `TimeoutError` row proves that a timeout is handled, not that a deadline exists.
  - Without the deadline, a hung connection keeps the spinner until the edge gives up, at about 100 s.
- **Fix**: In GS-1 (timeout row) and RV-4 (network row), also assert that the stub received an `init.signal` that is an `AbortSignal` (Node's, as confirmed) and is not yet aborted.
- **Decision**: FIXED (2026-10-28). Both rows assert the deadline's presence (not its length, which needs fake timers); RV-4's oracle gains `review-and-save-proposals/plan.md:386` (30 s save timeout); GS-1's `:481` already covers the 75 s client timeout.

### F5 — Cap-versus-drop order is not decided by the table

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — upstream table, row S3
- **Detail**:
  - S3 (25 valid cards) cannot tell two orders apart: drop invalid cards first and then cap at 20, or cap at 20 first and then drop.
  - Counterexample: 22 cards with 3 invalid among the first 20. The first order shows 19 cards; the second shows 17.
  - Today the code drops first (`generation.ts:205-210`), and the archive does not state the order explicitly.
- **Fix**: Add row S5. 22 cards with 3 invalid among the first 20 return 200 with all 19 valid cards, because invalid cards do not use up the cap.
- **Decision**: FIXED (2026-10-28). Correction to the detail: the archive does state the order — the owner-approved pipeline in `ai-proposals-from-text/plan-brief.md:71` reads "drop invalid, cap 20". S5 cites it as its oracle and joins the coverage map row "#1 success with garbage".

### F6 — An issue field is promised, but no phase fills it

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §6
- **Detail**:
  - The issue bodies are to state "where it is pinned … filled in by Phases 2–4".
  - Phases 2–4 have no step that edits the issues.
  - Editing them is an outward-facing action that needs the owner's approval.
- **Fix**: Replace that field with "find the pin: `grep -rn 'KNOWN GAP #<n>' src`". The PR's `Refs #<n>` adds the backlink on GitHub.
- **Decision**: FIXED (2026-10-28). The grep pattern includes the title's colon (`'KNOWN GAP #<n>:'`), so `#4` cannot match `#40`.

### F7 — Harness traps from research are missing from the plan

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details; Phase 2 §3
- **Detail**:
  1. Type-aware lint on `.tsx` tests (research §5):
     - `no-floating-promises` on every `user.*` call;
     - `unbound-method`;
     - `no-non-null-assertion`.
  2. The 1 s `useElapsedSeconds` interval fires whenever a test holds `pending` for more than a second. That produces a React `act` warning, which criteria 3.3 and 4.2 treat as a failure, so the tests can turn flaky under load.
  3. Within one file, `vi.stubGlobal` stubs and mock implementations carry over between tests. Vitest 5 defaults clear only the call history (`clearMocks: true`; `unstubGlobals` and `restoreMocks` are false). The `_upstream.test.ts` contract has no `afterEach(() => vi.unstubAllGlobals())`.
- **Fix**: Add these three points to Critical Implementation Details, and add the `afterEach` to the Phase 2 §3 contract.
- **Decision**: FIXED (2026-10-28). New "Harness traps (research §5)" bullet. Refinements: only `GenerateProposals` runs `useElapsedSeconds`, so the tick threatens criterion 3.3, not 4.2; the G4 pin from F1 waits under 1 s (`{ timeout: 500 }`) because `pending` never clears on today's code; the defaults were verified in `node_modules/vitest/dist/chunks/defaults.D2ip7f-X.js:57-61`.
