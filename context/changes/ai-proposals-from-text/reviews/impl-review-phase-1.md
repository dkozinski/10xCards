<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Proposals from Pasted Text (S-02)

- **Plan**: `context/changes/ai-proposals-from-text/plan.md`
- **Scope**: Phase 1 of 4 (uncommitted working tree on `feat/ai-proposals-from-text`)
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION → APPROVED after triage (all 5 fixed; tests 83/83, lint 0, build 0; 4 new tests verified to fail against the pre-fix service)
- **Findings**: 0 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Success criteria were re-run for this review:
- `npm test`: 76/76
- `npm run lint`: exit 0
- `npm run build`: exit 0, with no `OPENROUTER_API_KEY`
- Manual 1.4: confirmed by the owner in-session

Reviewed and not raised, because the plan already decides them:
- abort-on-disconnect (What We're NOT Doing)
- the production missing-config banner (Phase 4 sets the secret before merge)
- an unbounded upstream body (bounded by `max_tokens`)

## Findings

### F1 — `response.body.cancel()` rejection escapes as a raw DOMException

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/generation.ts:140
- **Detail**: On a non-2xx response the service awaits `response.body?.cancel()`. If the 60 s abort fires while a slow error body is still streaming, `cancel()` rejects (verified in node) and a raw `DOMException` escapes instead of `GenerationError("upstream_http", status)`. The Phase 2 route would then answer 500 `server_error` instead of 502 `generation_failed`. No text leaks, but the error is misclassified.
- **Fix**: `await response.body?.cancel().catch(() => undefined)`, plus a test where `cancel()` rejects.
- **Decision**: FIXED

### F2 — Tests weaker than plan §6 on the coupled limits and privacy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/generation.test.ts:63-65, 139-142, 163-177
- **Detail**:
  - `max_tokens` is asserted only as `> 0`, although the plan couples 3500 to the 60 s timeout.
  - The model list is compared to the exported constant, so it is self-referential and would not catch a changed model ID.
  - The "200 with source text echoed in the error body" case does not assert that the message or `JSON.stringify(error)` is free of the text.
  - The plan asked for a fake-timer timeout test: the 60 s default and timer cleanup are unproven, the abort-during-`response.json()` branch is untested, and so is `content: null`.
- **Fix**: pin `max_tokens === 3500` and the literal model IDs. Add privacy assertions to the echoed-error case. Add a fake-timer test for the 60 s default with `vi.getTimerCount() === 0` after success and after failure. Add tests for abort during the body read and for `content: null`.
- **Decision**: FIXED

### F3 — Response-envelope edge cases misclassify valid or failed completions

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/generation.ts:78-86, 155-164
- **Detail**:
  - `error: null` counts as an error (`!== undefined`).
  - `usage: null` fails the whole envelope parse, although `usage` is informational only.
  - `finish_reason: "error"` with parseable partial content is returned as success.
  - `content: null` reaches `invalid_output` only by accident of `?? ""`.
- **Fix**:
  - `error != null`
  - `usage` `.nullish()` and never fatal
  - read `finish_reason` and treat `"error"` as `upstream_body_error`
  - handle null content explicitly as `invalid_output`
- **Decision**: FIXED

### F4 — Justified deviations not recorded in the plan

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md Phase 1 §5 vs src/lib/services/generation.ts:91, 182
- **Detail**:
  - Plan step 3 says to validate against `modelOutputSchema`. That was self-contradictory: its `.max(20)` and strict card shape would reject the whole output and make "drop invalid" and "cap at 20" unreachable. The code parses a loose `rawOutputSchema` instead.
  - `dropped` counts invalid cards plus those cut by the cap; the plan said invalid only.
  - Extra mappings not in the plan: network failure → `upstream_http` with no status, and non-JSON 200 → `upstream_body_error`. The Phase 2 route must accept `status` being undefined.
- **Fix**: add a `## Deviations` section to plan.md recording all three (precedent: deck-data-contract).
- **Decision**: FIXED

### F5 — Prompt hard-codes the card limits

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/generation.ts:17-22
- **Detail**: The system prompt writes "200" and "500" literally while interpolating `MAX_PROPOSALS` on the same line. If `FRONT_MAX`/`BACK_MAX` in `validation/flashcard.ts` change, the prompt drifts from the validation that drops cards.
- **Fix**: interpolate `FRONT_MAX` and `BACK_MAX`.
- **Decision**: FIXED
