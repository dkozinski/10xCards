<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Review and Save Proposals (S-03)

- **Plan**: context/changes/review-and-save-proposals/plan.md
- **Scope**: Phase 3 of 4 (commit 93cf49e)
- **Date**: 2026-10-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria: `npm test` 144/144, `npm run lint` clean, `npm run build` complete, `id="front"` still at NewFlashcardForm.tsx:66. Manual 3.3–3.10 confirmed by the owner one by one on the local stack.

Idempotency verified end to end: `generationId` is minted once (GenerateProposals.tsx:103), the frozen retry resends the identical command (ProposalReview.tsx:135), and the RPC claims the id with `on conflict do nothing`.

## Findings

### F1 — Frozen state never clears, even after an unambiguous retry reply

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/generate/ProposalReview.tsx:175-180
- **Detail**: `setFrozen` is only ever set (lines 152, 183), never cleared. If a Try again resend returns `validation_failed`, the editors open and accept typing, but Done/Reject/Save stay locked and Try again resends the same invalid command, so the user is stuck. The plan says validation_failed "does not freeze"; a 400 proves nothing was written (the route validates before the RPC). Reachable only when server and client validation diverge. On `unauthorized` after a frozen attempt, keeping the freeze is correct (the earlier attempt may have committed), and Try again works after signing in from another tab.
- **Fix A ⭐ Recommended**: `setFrozen(null)` in the validation_failed branch only.
  - Strength: Matches the plan contract exactly; safe because a 400 is returned before the RPC (api/generations/index.ts).
  - Tradeoff: None meaningful — one line.
  - Confidence: HIGH — branch order verified in the route and its tests.
  - Blind spot: A persistent `server_error` still loops; the only exit is leaving the page (with the unload prompt).
- **Fix B**: Fix A plus a "Start over" escape after repeated failures.
  - Strength: Exit from a deterministic server failure.
  - Tradeoff: New UI and copy ("cards may already be in your deck"), not in the plan.
  - Confidence: MEDIUM — the deterministic-500 cases (CHECK mismatch, foreign id) are guarded by zod and a random UUID.
  - Blind spot: Not manually testable without forcing a 500.
- **Decision**: FIXED (Fix A)

### F2 — Invalid cards on Save give no announcement or focus

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/ProposalReview.tsx:121-123, 175-177
- **Detail**: When client or server validation fails, the failing editors open silently. With up to 20 cards the failing one may be off-screen, and a screen reader hears nothing.
- **Fix**: Set a summary error via `setError` (ServerError is role="alert"), e.g. "2 cards need fixing before saving."
- **Decision**: FIXED

### F3 — Field / FieldErrors / firstErrors duplicated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/generate/ProposalReview.tsx:21-22, 40-42; src/components/deck/NewFlashcardForm.tsx:10-15
- **Detail**: CardField was extracted, but its error-mapping companions were copied into both callers.
- **Fix**: Export `FieldErrors` and `firstErrors` from CardField.tsx and import them in both.
- **Decision**: FIXED

### F4 — Session-expired message offers no way to keep the review

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/ProposalReview.tsx:180
- **Detail**: Signing in from this tab loses the list (after the unload prompt). The only path that keeps the work is signing in from another tab and saving again.
- **Fix**: Change the copy to "Your session has expired. Sign in again in another tab, then save."
- **Decision**: FIXED

### F5 — beforeunload handler omits legacy returnValue

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useUnsavedChangesGuard.ts:12-14
- **Detail**: Only `preventDefault()` is called. Chromium before 119 (2023) and some WebViews also need `e.returnValue = ""`. Current Chrome, Firefox and Safari work (3.8 passed).
- **Fix**: Add `e.returnValue = ""` with an eslint-disable for the deprecation rule.
- **Decision**: FIXED

### F6 — aria-describedby on a disabled Generate button

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/GenerateProposals.tsx:177, 193-197
- **Detail**: A disabled button is not focusable, so the hint is rarely announced through it; it is still visible text right under the button.
- **Fix**: Leave as is (visible hint suffices for the MVP), or switch to `aria-disabled` relying on the existing guard at line 69.
- **Decision**: FIXED
