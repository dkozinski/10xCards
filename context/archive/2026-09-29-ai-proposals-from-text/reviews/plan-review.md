<!-- PLAN-REVIEW-REPORT -->
# Plan Review: AI Proposals from Pasted Text (S-02)

- **Plan**: `context/changes/ai-proposals-from-text/plan.md`
- **Mode**: Deep
- **Date**: 2026-09-29
- **Verdict**: REVISE → SOUND after triage (all 7 findings fixed in plan)
- **Findings**: 0 critical · 2 warnings · 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

- Paths: 10/10 ✓
- Symbols: 5/5 ✓ (`createFlashcardSchema`, `ApiErrorCode`/`STATUS`, `PROTECTED_ROUTES`, `configStatuses`, `z.toJSONSchema`)
- brief↔plan ✓
- Progress↔Phases ✓ (4/4 phases, 26/26 steps before triage; 27 after F1 added 2.8)

Deep verification (one sub-agent):
- `vi.mock("astro:env/server")` works under vitest 5.0.2; tested in a scratch dir.
- `generation_failed` blast radius is `api-errors.ts` (+ its test) and `AGENTS.md` only.
- The config banner renders on every Layout page.
- The middleware does not interfere with `POST /api/proposals`.
- `no-console` is `warn` and never fails lint or CI.

## Findings

### F1 — Real text calls happen before the OpenRouter account privacy setup

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 Manual (2.4–2.5) vs Phase 4 §1
- **Detail**: Phase 2 sends real PL/EN text to OpenRouter from local dev. The account-level defence in depth (key credit limit, I/O logging off, use of inputs off, ZDR enforced) was only scheduled for Phase 4, so the first billed calls with text went through an unchecked account.
- **Fix**: Move the account setup to a Phase 2 prerequisite, as new manual step 2.8 (existing titles unchanged). Phase 4 §1 keeps only the re-check plus `wrangler secret put`.
  - Strength: no text leaves the machine before the safeguards exist; the credit limit also caps local testing.
  - Tradeoff: the owner does the ~5-minute account setup earlier.
  - Confidence: HIGH — the ordering follows directly from the plan text.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — The model's JSON Schema carries `$schema` and has no array cap

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1, §5, §6
- **Detail**: Verified locally: `z.toJSONSchema(modelOutputSchema)` emits a top-level `"$schema": "https://json-schema.org/draft/2020-12/schema"`, which some structured-output endpoints reject. `cards` also had no `maxItems`, so an over-producing model could exhaust `max_tokens`, get truncated, and fail the whole request (`invalid_output`).
- **Fix**: `cards` gets `.max(20)` (→ `maxItems`), `$schema` is stripped before sending, and the service test asserts both.
- **Decision**: FIXED

### F3 — Route reads `astro:env` directly: works, but lint needs `astro sync`

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §4, Phase 2 §2
- **Detail**: The direct factory mock works (verified), but it is a new precedent next to the `@/lib/supabase` wrapper. The factory must export every imported name. After an `env.schema` change, a local type-checked lint needs a regenerated `.astro/env.d.ts`.
- **Fix**: Note `npx astro sync` after the schema edit (Phase 1 §4), and note the factory-mock requirement (Phase 2 §2).
- **Decision**: FIXED

### F4 — Success logging was undecided

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §1
- **Detail**: The plan said "log nothing (or one console.info …)", leaving the implementer to guess.
- **Fix**: Exactly one `console.info` with `{ count, dropped, latencyMs, usage }` and an eslint-disable comment. It is the only production signal for cost and latency, and it contains no content.
- **Decision**: FIXED

### F5 — The `Content-Length` guard is bypassed when the header is absent

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 (branch 3), §2
- **Detail**: A chunked request without `Content-Length` would skip the guard, and `request.json()` would read an unbounded body.
- **Fix**: Read `request.text()`, check the length (> 128 KiB → `validation_failed`), then `JSON.parse` (→ `invalid_json`). Test with a body sent without the header.
- **Decision**: FIXED

### F6 — The Workers Paid rule said "> 6 ms repeatedly"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2
- **Detail**: "Repeatedly" was undefined, so the owner's billing decision had no clear threshold.
- **Fix**: Median `cpuTime` of the measured requests > 6 ms, or any Error 1102 → subscribe before merge.
- **Decision**: FIXED

### F7 — No per-user limit; the credit cap is global

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: What We're NOT Doing
- **Detail**: One account generating in a loop can exhaust the shared monthly credit, and everyone then gets `generation_failed`. The plan did not name this.
- **Fix**: Record per-user rate limiting as deliberately out of scope, with the rationale (the credit limit is the global safety cap; revisit before wider sign-ups).
- **Decision**: FIXED
