<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-06 Account and Data Deletion

- **Plan**: context/changes/account-and-data-deletion/plan.md
- **Scope**: Phase 2 of 4 (uncommitted working tree)
- **Date**: 2026-10-11
- **Verdict**: APPROVED (all findings fixed)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Checks re-run 2026-10-11

- **Vitest:** 310/310.
- **Lint:** exit 0.
- **Build:** passes.
- **`astro check`:** 1 error. It is pre-existing and unrelated (`src/lib/services/generations.test.ts:37`, ts2352 from S-03); there are none in the new files.
- **Manual 2.4 mutation check:** confirmed by the owner.

## Confirmed by the reviewers

- **Authentication:** 401 is returned before `createClient`.
- **Email gate:** every mismatch returns before the RPC.
- **Failed delete:** never signs out and never answers 204.
- **Logs and responses:** logs carry `{code, message}` only, and the client gets fixed messages.
- **Cookies:**
  - `signOut` ignores 401/403/404 and clears the session.
  - `@supabase/ssr` writes the cookies through `setAll` before `signOut` resolves.
  - Astro attaches them to the 204.
- **CSRF:** both `DELETE` and `application/json` force a preflight that the app never answers.
- **Types:** `rpc("delete_my_account")` type-checks, and `data` narrows to `boolean`.
- **Tests:** they catch an `rpc` → `signOut` order reversal, a delete on a mismatched email, and a sign-out after a failed delete.

## Findings

### F1 — A throwing signOut turns a completed delete into a 500

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/account/index.ts:84
- **Detail**: `signOut` can throw rather than return `{error}`. `_notifyAllSubscribers` re-throws a subscriber error, for example from `cookies.set` inside `setAll`. The account is already gone, yet the client would get a 500 and show "not deleted, try again".
- **Fix**: Wrap the call in try/catch and log the failure, so a committed delete always answers 204. Add a test in which `signOut` rejects.
- **Decision**: FIXED (try/catch + rejecting-signOut test; mutation without the catch fails that test)

### F2 — The request schema lives outside `src/lib/validation/`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/account.ts
- **Detail**: `src/lib/validation/review.ts` has exactly this shape: island-shared, no server imports, a schema, a message constant and a pure predicate (`dayEndInWindow`). The flashcard and generation schemas used by islands live there too. `account.ts` follows the plan's file name but breaks the "request schemas live in validation/" convention.
- **Fix**: Move it to `src/lib/validation/account.ts` (with its test) before the Phase 3 island imports it. Note the move in the plan.
- **Decision**: FIXED (moved to src/lib/validation/account.ts; plan Phase 2 notes the move)

### F3 — The "already gone (another tab)" comment describes the wrong path

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/account/index.ts:69-70; src/lib/services/account.ts:11
- **Detail**: A second tab acting after the delete gets 401: `getUser()` fails, so `locals.user` is null. `false` happens only in a true race, where both requests passed `getUser()` before the delete committed. The island already maps 401 to the sign-in page (plan, Phase 3).
- **Fix**: Reword both comments to "a concurrent request deleted it first".
- **Decision**: FIXED

### F4 — The Set-Cookie on the 204 is not covered by any automated test

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/account/index.test.ts
- **Detail**: The unit tests mock `signOut` and `cookies`, which is inherent at this layer.
- **Fix**: In the Phase 3 manual run (3.5), check in DevTools that the DELETE response carries expiring `sb-*` cookies. No code change.
- **Decision**: FIXED (plan manual 3.5 now includes the DevTools Set-Cookie check)
