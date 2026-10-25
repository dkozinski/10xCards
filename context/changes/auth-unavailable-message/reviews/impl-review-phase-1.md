<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Auth Unavailable Message

- **Plan**: context/changes/auth-unavailable-message/plan.md
- **Scope**: Phase 1 of 2
- **Date**: 2026-10-25
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence

- **Drift**: every planned change is a MATCH. The four call sites changed `error.message` → `authErrorMessage(error)` plus one import per file, and nothing else. Nothing on the NOT-doing list was touched.
- **Classification boundary**, checked against auth-js 2.105.3:
  - gateway codes 502–504/520–524/530 and network failures → `AuthRetryableFetchError`;
  - a non-JSON body → `AuthUnknownError` (status undefined, so the name check is needed);
  - everything else → `AuthApiError(msg, status || 500)`, so 500/501/505 are caught by `>= 500`;
  - 400 credentials, 422 `AuthWeakPasswordError`, 429 rate limit and `AuthSessionMissingError` all pass through.
- **Cross-module robustness**: `isAuthError` checks the `__isAuthError` property, not `instanceof`, and there is a single copy of auth-js in `node_modules`. Verified directly.
- **Success paths**: unchanged. The helper runs only inside `if (error)`.
- **Redirect/XSS**: unchanged. The redirect paths are fixed, the value goes through `encodeURIComponent`, and React escapes it in `ServerError.tsx`.
- **Automated criteria**, re-run during the review:
  - targeted tests 8/8;
  - full suite 319/319 (23 files);
  - lint exit 0;
  - build exit 0.
- **Manual criteria 1.5–1.7** have observable evidence from the session:
  - the redirect `Location` carried the unavailable message;
  - the dev log showed `Supabase auth unavailable { name: 'AuthRetryableFetchError', status: 503, message: '{}' }` and the email appeared 0 times;
  - the stub received `POST /auth/v1/token?grant_type=password -> 503`;
  - `.dev.vars` sha256 matched the original after restore;
  - the owner confirmed the message in the browser.
- **Mutation check** during implementation: reverting `signin.ts` to `error.message` made the route test fail.
- **Unrelated untracked path** `.agents/`: present before this change and not part of it. Leave it out of the phase commit.

## Findings

### F1 — The "email not in log" assertion is a regression guard, not proof of scrubbing

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.test.ts (outage case)
- **Detail**: The stubbed error message is `"{}"`, so the email could only reach the log if a future change logs the form or request. That is still a valid guard, and it mirrors the `inspect` check in `flashcards/[id].test.ts`. It does not prove that server messages are scrubbed. The helper logs the GoTrue message verbatim; a 5xx from a custom auth hook could in principle quote user input. The risk is low: there are no custom hooks, and the observed messages are generic.
- **Fix**: None needed; recorded so the test is not over-read.
- **Decision**: SKIPPED

### F2 — The helper test lacks the realistic signup 4xx cases

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/auth-errors.test.ts
- **Detail**: The pass-through side of the boundary is pinned only by a 400. Signup's realistic errors are 422 `AuthWeakPasswordError` and 429 rate limit. A regression to, say, `>= 420` would not be caught.
- **Fix**: Add an `AuthWeakPasswordError` (422) case and a 429 `AuthApiError` case to the pass-through test as an `it.each`.
- **Decision**: FIXED (422 weak password + 429 rate limit added as it.each; mutation to >= 420 fails 2 cases)

### F3 — confirm.ts still shows raw client-side PKCE errors

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/auth/confirm.ts:64
- **Detail**: `exchangeCodeForSession` can fail locally with `AuthPKCEGrantCodeExchangeError` ("code verifier not found in storage"), which still renders as technical text. This was true before the change and is outside its scope (outage messaging only).
- **Fix**: Leave as is; candidate for a separate change if it is ever seen in practice.
- **Decision**: SKIPPED (out of scope; candidate for a separate change)
