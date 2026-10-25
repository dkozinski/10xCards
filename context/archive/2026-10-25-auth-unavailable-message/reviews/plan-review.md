<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Auth Unavailable Message

- **Plan**: context/changes/auth-unavailable-message/plan.md
- **Mode**: Deep
- **Date**: 2026-10-25
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

- 7/7 paths ✓ (`signin.test.ts` is new, as planned).
- 6/6 symbols and cited lines ✓.
- Brief↔plan ✓.
- Claims checked against the code:
  - `AuthUnknownError` is built server-side only at `fetch.js:37`;
  - `AuthApiError` always carries a status (`fetch.js:72`);
  - `AuthError.status` is `number | undefined`;
  - `deploy:rollback` exists.

## Findings

### F1 — Local outage proof tests the wrong path and stops the local stack

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 — §4 Local outage proof
- **Detail**: Three problems.
  - A stopped Supabase refuses the connection, which auth-js turns into `AuthRetryableFetchError` with status 0 (`fetch.js:110-112`). The production `{}` came from the 502–530 branch (`fetch.js:28-30`), which this test never reaches.
  - The plan stopped the running local stack, yet read the publishable key from `supabase status`, which only prints it while the stack is up.
- **Fix A ⭐ Recommended**: Point `SUPABASE_URL` at a throwaway local 503 stub on `127.0.0.1:54399`.
  - Strength: exercises the exact production branch and leaves the stack untouched.
  - Tradeoff: one scratchpad script.
  - Confidence: HIGH — 503 is in `NETWORK_ERROR_CODES` (`fetch.js:22`).
  - Blind spot: none significant.
- **Fix B**: Point at a closed port.
  - Strength: no script.
  - Tradeoff: covers the status-0 branch only.
  - Confidence: HIGH.
  - Blind spot: none significant.
- **Decision**: FIXED (Fix A). §4, the manual criteria 1.5/1.6 (phase block and Progress), Testing Strategy and the brief were updated.

### F2 — The route test has no precedent for redirect or formData

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — §3 Tests
- **Detail**: The cited `flashcards/[id].test.ts` covers only the `createClient` mock and JSON responses. No test in the repo stubs `context.redirect` or sends a form body.
- **Fix**: State the context-stub shape in the contract: `request` with a form body, `cookies: {}`, and `redirect` returning a 302 with `Location`.
- **Decision**: FIXED
