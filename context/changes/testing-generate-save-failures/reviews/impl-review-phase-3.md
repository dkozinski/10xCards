<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate and Save Screens Under Failure

- **Plan**: `context/changes/testing-generate-save-failures/plan.md`
- **Scope**: Phase 3 of 6 (reviewed uncommitted, before the phase commit)
- **Date**: 2026-10-29
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Evidence

- **Drift check (sub-agent, read-only):** §1–§4 are in place.
  - The five devDependencies resolved to jsdom 29.1.1, @testing-library/react 16.3.3, dom 10.4.2, user-event 14.6.8 and jest-dom 7.0.1. `.nvmrc` is unchanged, and the `include` glob is the only config change.
  - All GS-1 to GS-7 rows assert the behaviour in the plan's table, and the pins carry the right issue numbers (#42, #43).
  - `GenerateProposals.tsx` and `src/lib` are unchanged against HEAD.
  - The sub-agent checked the Run 5 locations and the claims about the route (`Content-Type` is never read; only `validation_failed` carries `details`; `fieldErrors` can be `{}`) against the source. All hold except one verdict (F1).
- **Safety and pattern check (sub-agent, read-only, one probe file created and deleted):**
  - With `it.fails` flipped to `it`, #42 fails with `Unable to find role="alert"` and #43 with `Unable to find … text: Invalid text.`, so both pins fail for the right reason.
  - Without the scoped listeners, the run reports an unhandled error and an unhandled rejection and `npm test` fails, so the listeners are needed.
  - Isolation holds: `afterEach` resets the module-level `fetchMock`, unstubs globals and cleans up, and the spy and listeners are removed in `finally`.
  - `src/pages-layout.test.ts` already matches `.tsx`. The new packages are devDependencies imported only by tests, so nothing reaches the Worker.
  - The file follows the sibling tests' conventions (`$row` naming, the KNOWN GAP block, `unstubAllGlobals`).
- **Success criteria, re-run by the reviewer:**
  - 3.1 `npx vitest run src/components/generate/GenerateProposals.test.tsx`: 15 passed, 2 expected failures. The sub-agents saw the same result on four more runs.
  - 3.2 `npm test`: 26 files, 368 passed, 5 expected failures.
  - 3.3 No stderr, no `act` warning and no unhandled-error banner in any run.
  - 3.4 Confirmed independently by the probe above.
  - 3.5 `npm run lint`: exit 0.
  - 3.6 Run 5 and Run 6 in `mutation-report.md` give every survivor a verdict. One verdict is wrong (F1).
  - 3.7 (manual): the owner confirmed in this session that the verbose list covers the risk #1 screen scenarios.

## Findings

### F1 — Mutant #8 is not equivalent

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-generate-save-failures/mutation-report.md, Run 5 row 8 (`GenerateProposals.tsx:77:5`)
- **Detail**: The report calls removing `setFieldError(null)` equivalent, because the server's validation is deterministic. But the route checks the session and the API key before it validates (`index.ts:18-24`).
  - **How it shows.** The server rejects the text with a field error. The user resubmits the same text after the session expired. They then see the stale field error next to the 401 "sign in again" alert. The same happens with a 500 `server_error`.
  - **Why it matters.** The harm is small, a confusing message. But the triage record is what Phase 5's cookbook and the PR will quote, and "equivalent" claims no input can tell the mutant apart.
- **Fix**: Change row 8's verdict to "Cosmetic, ignored on purpose", and give the real reason: a stale field error can show next to a 401 or 500 alert after an unchanged resubmit. It is confusing but loses nothing, since the text stays and the next edit clears it.
- **Decision**: FIXED — row 8 is now "Cosmetic, ignored on purpose", with the 401/500 stale-message reason

### F2 — The plan does not record three small deviations

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: plan.md Phase 3 §2–§3; GenerateProposals.test.tsx:112-123, :170-179, :265-287
- **Detail**: Each is justified, but the plan still describes the original contract, and Phase 5's cookbook will be written from it.
  - **The deadline check** is a separate test, "GS-1: sends every generation with a client deadline", not part of the TimeoutError row. The intent is unchanged: the stub rejects with `TimeoutError` and the test asserts a live `AbortSignal`.
  - **The short-text test** is titled "GS-4", but GS-4 in the plan is the server's validation error. This test covers the client-side length check, which the mutation triage added (Run 6). The second GS-4 row, `fieldErrors: {}`, is a server answer and fits GS-4.
  - **The G3 pin** spies on `console.warn`, which the plan does not mention. React logs the render error there. The spy is restored in `finally` and commented.
- **Fix**: Amend Phase 3 §2–§3 inline with `(impl-review phase 3, F2)`, as Phase 2 did. Drop the "GS-4" prefix from the short-text test so its title names what it covers.
- **Decision**: FIXED — Phase 3 §2 and §3 amended inline; the short-text test lost its "GS-4" prefix

### F3 — The Try again check fails with an unreadable message

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/generate/GenerateProposals.test.tsx:107
- **Detail**: `expect(tryAgain() !== null).toBe(retry)` is a real check, not a tautology. But when it fails, Vitest prints only `expected false to be true`, without naming the button. The other assertions in the file use jest-dom matchers, which name the element and its state.
- **Fix**: Branch on `retry`: `if (retry) expect(tryAgain()).toBeInTheDocument(); else expect(tryAgain()).not.toBeInTheDocument();`.
- **Decision**: FIXED — the check branches on `retry` with jest-dom matchers
