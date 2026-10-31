<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate and Save Screens Under Failure

- **Plan**: `context/changes/testing-generate-save-failures/plan.md`
- **Scope**: Phase 2 of 6 (reviewed uncommitted, before the phase commit)
- **Date**: 2026-10-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence

- **Drift check (sub-agent, read-only):** every planned row, pin and mutation-run requirement is in place.
  - `generation.ts` and `index.ts` are unchanged against HEAD.
  - Every field the builders emit has a doc source. `provider`, which the plan lists, is missing (F2).
  - Four small deviations and two additions are not recorded in the plan (F2, F3).
- **Safety and pattern check (sub-agent, read-only):**
  - No path reaches the real network, and stubs and spies are restored after each test.
  - Nothing reaches the Worker bundle, and lint and types are clean on the changed files.
  - It found one hole that lets a test pass without testing anything (F1), and three small hygiene points (F4–F6).
- **Success criteria, re-run by the reviewer:**
  - 2.1 `npx vitest run src/pages/api/proposals/_upstream.test.ts`: 30 passed, 3 expected failures.
  - 2.2 A temporary copy with the pins as plain `it`, deleted afterwards: all three fail at `expect(response.status).toBe(502)` with "expected 200 to be 502", and the 30 other tests pass. The drift sub-agent reproduced it independently, outside the repo.
  - 2.3 `npm test`: 25 files, 353 passed, 3 expected failures. `npm run lint`: exit 0.
  - 2.4 Stryker, re-run with the same command: 67 mutants, 60 killed, 7 survived, a score of 89.55 %. These are the same seven survivors as in Run 4, and each has a verdict in `mutation-report.md`. The drift sub-agent matched Runs 3 and 4 against both logs.
  - 2.5 (manual) is open: the owner has not yet checked the fixtures against the docs. It is correctly unchecked.
- **Phase 1 assumption, re-checked:** this phase adds a test under `src/pages/`.
  - `npm run build` passes.
  - In `dist/server/chunks`, `grep -rlF` finds no `.test.ts"` route, no `KNOWN GAP`, no `upstream contract` and no fixture id.
  - The positive control finds the `/api/proposals` route.
- **Notes (not findings):**
  - A pin can also stay green because of an unrelated failure, for example the helper's "upstream called once" guard. That is inherent to `it.fails`. Every other row shares the helper, so a run of the whole file turns red in that case; a run of `-t "KNOWN GAP"` alone would not.
  - Stryker's default `mutate` glob would include `*.fixtures.ts` in an unscoped run. Every run in this repo is scoped with `--mutate`, so nothing changes.
  - `tsc --noEmit` reports TS2352 at `src/lib/services/generations.test.ts:37`. This phase does not touch that file, and the error predates the change.
  - `.agents/` and `claude.zip` are untracked private files and stay out of the phase commit.

## Findings

### F1 — A broken fixture in an F row passes as a network failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/proposals/\_upstream.test.ts:44-55
- **Detail**: `generate()` calls each row's `answer()` inside the stubbed `fetch`.
  - **How it goes wrong.** Suppose building the answer throws, because of a typo or `new Response("{}", { status: 1000 })` (a RangeError). The stub rejects, and the service reads that as a network failure (`upstream_http`, `generation.ts:154-156`). The route then answers 502 `generation_failed`, which is exactly what every F row expects.
  - **Why the guard misses it.** `toHaveBeenCalledOnce()` passes, because the stub was called.
  - **Evidence.** Both the sub-agent and the reviewer reproduced it.
  - **Reach.** Until the check exists, nothing shows whether a current row is affected. The next row added with a mistake would pass without testing anything.
- **Fix**: In `generate()`, assert how the stub settled: `"fulfilled"` for every row, and `"rejected"` only for F16, the one row that means a network failure. `upstream.mock.settledResults` provides this in Vitest 5.
- **Decision**: FIXED — `generate()` asserts `settledResults`; a probe row that throws now fails with "expected 'rejected' to be 'fulfilled'"

### F2 — `provider` is left out of the success envelope, for a reason the docs contradict

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/openrouter.fixtures.ts:9-10; plan.md:319
- **Detail**: The plan lists `provider` among the envelope fields. The builder leaves it out, and its header says the docs show it "only on streaming chunks".
  - **That is not accurate.** The `/chat/completions` schema does lack it: neither the overview's `Response` type nor `ChatResult` in `openapi.json` has it. But `openapi.json` shows `provider: string | null` on a non-streaming `"chat.completion"` body: the Batch API result, `BatchObject.results[].response.body`.
  - **Tests are unaffected either way.** The parser drops unknown keys, and S1 still carries `id`, `object`, `created` and `model`.
  - **Who decides.** This is the question behind manual check 2.5.
- **Fix A ⭐ Recommended**: Restore `provider` as the plan lists it, and cite the Batch API result body as its source.
  - Strength: back in line with the approved plan and closer to what OpenRouter sends; the "no undocumented field" rule still holds.
  - Tradeoff: the citation is indirect, since the `/chat/completions` schema itself lacks the field.
  - Confidence: MED — two OpenRouter schemas disagree about the same object type.
  - Blind spot: whether a live `/chat/completions` answer carries `provider` today; checking it needs a billed call.
- **Fix B**: Keep `provider` out, correct the header's reason, and amend the plan's Phase 2 §1 contract.
  - Strength: the strictest reading of the endpoint's own schema.
  - Tradeoff: departs from the approved plan, and the fixture is a little less like a live answer.
  - Confidence: HIGH — the overview's `Response` and `ChatResult` both lack it.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix A, owner's choice) — `provider` restored, sourced from the Batch API result body

### F3 — The plan does not record five small deviations and additions

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: plan.md Phase 2 §1–§3; plan.md:784
- **Detail**: Each one is justified. But the plan still describes the original contract, and Phase 5's cookbook and the PR will be written from it.
  - **Fixture header.** It says checked 2026-10-28, not 2026-10-26, and cites `openapi.json` as a third source (for `index`). The References line (`:784`) still says 2026-10-26.
  - **Row F1b.** The mutation triage added it. Its body, an `error` next to a usable choice, is not a documented non-streaming shape; it guards the documented rule "Check the body for an `error` field even on a `200`". Its comment does not say that the combination is undocumented.
  - **"No assertion changes" (§2).** "drops a finish_reason" became an `it.each` with one new case, from the triage (mutant #4). Its assertions are unchanged.
  - **The rest of §2.** Besides `completion()`, every inline body moved to the builders. That follows the intent "the existing service tests run on documented bodies".
  - **§3.** The `astro:env/server` mock is a constant factory instead of the hoisted getter, because this file never needs a missing key.
- **Fix**: Add a dated addendum to Phase 2 §1–§3 and update the References date, as the Phase 1 review did for its §4. Reword F1b's comment to say that no documented body has both.
- **Decision**: FIXED — Phase 2 §1–§3 amended inline, F1b row added to the table, References dated; F1b comment reworded

### F4 — Expected usage numbers come from another file

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/generation.test.ts:120-126
- **Detail**: "returns trimmed proposals and usage" expects `{ prompt_tokens: 100, completion_tokens: 50, cost: 0.0001 }`.
  - Those numbers now come from the defaults in `openrouter.fixtures.ts:42`, so changing a default breaks this test from another file.
  - The truncated-reply test already passes its `usage` explicitly (`:196`).
- **Fix**: Pass `usage` through `extra` in this test, so the expected numbers sit next to the assertion.
- **Decision**: FIXED — the test passes its own `usage`

### F5 — A row label contradicts its body

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/generation.test.ts:185
- **Detail**: The row "truncated JSON (finish_reason length)" now sends the envelope's default, `finish_reason: "stop"`; before this phase it sent no `finish_reason` at all. Cut JSON with `finish_reason: "length"` has its own test (`:192`).
- **Fix**: Rename the row to "truncated JSON".
- **Decision**: FIXED — row renamed to "truncated JSON"

### F6 — A service test pins 403 as misconfiguration without pointing to #44

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/generation.test.ts:245
- **Detail**: `it.each([400, 401, 403, 404])` asserts `403 → upstream_config`.
  - That is today's decided behaviour (S-02), so the assertion is right.
  - But 403 also covers moderation blocks, and whether those stay a misconfiguration is open in #44 (G5).
  - The new table leaves 403 out with a comment (`_upstream.test.ts:10`). This row has no such pointer, so whoever decides #44 will not find it with `grep -rn '#44' src`.
- **Fix**: Keep the assertion, and add a one-line comment pointing to #44.
- **Decision**: FIXED — one-line comment pointing to #44
