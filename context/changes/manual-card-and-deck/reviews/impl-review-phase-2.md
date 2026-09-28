<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Card and Deck (S-01)

- **Plan**: context/changes/manual-card-and-deck/plan.md
- **Scope**: Phase 2 of 3 (commit 58985af)
- **Date**: 2026-09-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated checks:
- `npm test` passes 47/47.
- `npm run lint` and `npm run build` both exit 0.
- `npx supabase test db` passes 21/21.

Manual check 2.5 was verified on the local stack: 401 without a session, 201 with a session, a forged `user_id` ignored, NUL rejected with 400, bad JSON rejected with 400, and the row owned by the session user.

Drift: every planned item MATCHES. Two EXTRAs, both benign: the PGRST103 fallback in `listFlashcards`, which the phase-3 page redirect depends on, and the service tests.

CSRF was checked in Astro 6.4.8 sources. `checkOrigin` returns 403 for cross-origin requests with a form or `text/plain` body. An `application/json` request needs a CORS preflight, and the Worker never answers one. `@supabase/ssr` cookies are `SameSite=Lax`.

## Findings

### F1 — Service test stub ignores the `count` option

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/flashcards.test.ts:17
- **Detail**: The stub's `select` reads only `opts.head` and always returns the queued `count`. Removing `{ count: "exact" }` from either query in `flashcards.ts` would still pass. Real supabase-js would then return `count: null`, so `total` would be 0 and pagination would break silently.
- **Fix**: Assert that `builder.select` is called with `("*", { count: "exact" })`, and with `("*", { count: "exact", head: true })` on the fallback.
- **Decision**: FIXED

### F2 — Route tests do not prove the branch order

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/flashcards/index.test.ts
- **Detail**: The 401 test never checks that `createClient` was not called. The no-client test sends valid JSON, so it would still pass if JSON parsing ran first. The plan fixes the order of the branches.
- **Fix**: In the 401 test, assert `createClient` was not called. In the no-client test, send an invalid body and still expect `server_error`.
- **Decision**: FIXED

### F3 — CSRF defence relies on an implicit framework default

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: astro.config.mjs
- **Detail**: `request.json()` ignores Content-Type, so a cross-site `text/plain` POST carrying JSON would reach the handler if `checkOrigin` were ever turned off. The protection exists only because `security.checkOrigin` defaults to true.
- **Fix**: Set `security: { checkOrigin: true }` explicitly, with a comment that the cookie-authenticated JSON routes depend on it.
- **Decision**: FIXED

### F4 — Database error logged in full

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/flashcards/index.ts:40-42
- **Detail**: `console.error(error)` on a `PostgrestError` includes `details`. For a CHECK violation, `details` is "Failing row contains (…)", which holds the user's card text. The log lands in Cloudflare Worker logs. No keys or headers are exposed.
- **Fix**: Log `{ code, message }` only.
- **Decision**: FIXED

### F5 — Request body size is not limited

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/flashcards/index.ts:22
- **Detail**: `request.json()` parses the whole body before validation. Workers accept bodies up to 100 MB, and an isolate has 128 MB of memory. Parsing happens only after the session check, so only a signed-in user could send one.
- **Fix A ⭐ Recommended**: Skip for the MVP.
  - Strength: The attacker must hold an account, and the platform caps the body size.
  - Tradeoff: One signed-in user could exhaust an isolate's memory.
  - Confidence: MED. This is a solo-user MVP without public sign-up promotion.
  - Blind spot: No load testing has been done.
- **Fix B**: Reject a `Content-Length` over 16 KB with `validation_failed` before parsing.
  - Strength: Cheap, and it stops the problem early.
  - Tradeoff: A chunked body has no `Content-Length`, so the check is partial. A full fix needs a streamed, bounded read.
  - Confidence: MED.
  - Blind spot: Behaviour of workerd with chunked bodies has not been checked.
- **Decision**: ACCEPTED (Fix A: skip for MVP; body size bounded only by platform limits, attacker needs an account)

### F6 — `count ?? 0` hides a missing count

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/flashcards.ts:40,43
- **Detail**: With no error and `count === null`, the deck would report 0 cards. That happens only if the `count` option goes missing, and then the result would look like an empty deck instead of a failure.
- **Fix**: Throw when `count === null`.
- **Decision**: FIXED
