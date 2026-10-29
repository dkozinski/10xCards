# Mutation Report — testing-generate-save-failures

Tracked record of every Stryker run in this change. The HTML report (`reports/mutation/`) stays local.

Each surviving mutant inside the targeted range gets one verdict, and every verdict gives a reason. The verdicts answer the M3L2 question: would this change, shipped, hurt a user or the business?

- **Killed by an added assertion**: a test now fails on the mutant.
- **Equivalent**: no input the code can receive tells the mutant from the original.
- **Cosmetic, ignored on purpose**: observable, but harmless to users; a test that pinned it would be a vibe test.

## Run 1 — Phase 1 smoke: `proposalSource`

- **Date**: 2026-10-28
- **Command**: `npx stryker run --mutate "src/lib/validation/generation.ts:47-53"`
- **Toolchain**: `@stryker-mutator/core` 10.1.1 and `@stryker-mutator/vitest-runner` 10.1.1; Vitest 5.0.2 with `pool: "forks"`, the same pool `npm test` uses; Node 22.14.0.
- **Purpose**: prove that the runner drives this repo's Vitest before Phases 2–4 rely on it. It does, so the manual-mutation fallback is not needed.
- **Result**: 14 mutants: 12 killed, 2 survived, 0 timed out, 0 without coverage, 0 errors. **Score: 85.71 %.**
  - 2.50 tests ran per mutant on average, so per-test coverage works.
  - The run took 7 s.

| #   | Location              | Mutant                                     | Verdict                      | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------- | ------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `generation.ts:51:41` | `original.front.trim()` → `original.front` | Cosmetic, ignored on purpose | Reachable only through a non-API body. Our server builds every proposal with `createFlashcardSchema`, which trims (`src/lib/validation/flashcard.ts:21`, applied in `src/lib/services/generation.ts:205-208`). An untrimmed original can only come from a foreign body, which the client passes on unvalidated (`GenerateProposals.tsx:102-103`). The effect would be a wrong `ai_edited` label and an "Edited" badge on an untouched card, not lost data. |
| 2   | `generation.ts:51:90` | `original.back.trim()` → `original.back`   | Cosmetic, ignored on purpose | Same as #1, for `back`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Run 2 — Phase 1 smoke after the allowlist

- **Date**: 2026-10-28
- **Command**: the same as Run 1. It also ran once with `--cleanTempDir false`, so the sandbox could be inspected.
- **Change**: `ignorePatterns` is now a root-anchored allowlist: `/*`, then `!/src`, `!/package.json`, `!/tsconfig.json` and `!/vitest.config.ts`.
  - Stryker ignores `.gitignore`.
  - The earlier denylist still let `supabase/.temp/`, `supabase/snippets/`, `.vscode/`, `CLAUDE.md` and untracked private files into the sandbox (impl-review phase 1, F1).
- **Sandbox contents**: `node_modules` (a symlink), `package.json`, `src`, `tsconfig.json` and `vitest.config.ts`. No secret or private file name appears anywhere outside `node_modules`.
- **Result**: unchanged from Run 1: 14 mutants, 12 killed, 2 survived, a score of 85.71 %. The survivors and verdicts are the same as in Run 1.

## Run 3 — Phase 2: upstream classification and route mapping

- **Date**: 2026-10-28
- **Command**: `npx stryker run --mutate "src/lib/services/generation.ts:176-211,src/pages/api/proposals/index.ts:61-80"`
- **Ranges**: re-checked against the files before the run.
  - `generation.ts:176-211` runs from the comment above `completionSchema.safeParse` to the `no_valid_cards` throw.
  - `index.ts:61-80` is the route's `catch` block, which maps each failure to a status and code.
- **Tests**: the dry run ran 86 tests, from the three files tied to the mutated modules: `generation.test.ts`, `_index.test.ts` and `_upstream.test.ts`.
- **Result**: 67 mutants: 57 killed, 10 survived, 0 timed out, 0 without coverage, 0 errors. **Score: 85.07 %** (`generation.ts` 87.76 %, `index.ts` 77.78 %).
  - 9.99 tests ran per mutant on average.
  - The run took 14 s.

| #   | Location               | Mutant                                                                           | Verdict                                | Reason                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `generation.ts:180:30` | `completion.data.error != null` → `false`                                        | Killed by an added assertion (row F1b) | F1 uses the documented shape, "only an `error` object and no `choices`", so `!choice` rejects it with or without this check. The docs also say "Check the body for an `error` field even on a `200`". Row F1b sends a documented `error` next to a usable choice and expects 502. Without the check, the user would see cards from a generation that OpenRouter reported as failed (risk #1). |
| 2   | `generation.ts:180:7`  | the first two conditions, `!completion.success` and the `error` check, → `false` | Killed by an added assertion (row F1b) | The schema half is redundant: line 179 already turns a failed parse into `choice = undefined`, which `!choice` rejects. What remains is the `error` check from #1, which F1b now covers.                                                                                                                                                                                                      |
| 3   | `generation.ts:188:19` | `reason != null && …` → `true && …`                                              | Cosmetic, ignored on purpose           | `RegExp.test(null)` tests the string "null", which matches. So a failed generation with a null `finish_reason` logs `finishReason: null` instead of leaving the field out. Only the failure log changes, and no user text gets in. A test pinning null against absent would pin a log detail.                                                                                                 |
| 4   | `generation.ts:188:37` | `/^[a-z_]{1,32}$/` → `/[a-z_]{1,32}$/`                                           | Killed by an added assertion (service) | Without `^`, a `finish_reason` that merely ends in an identifier is kept whole. Upstream text, which can echo the user's text, would then reach Workers Logs (PRD NFR: the source text leaves no trace). The existing case put the text after the identifier and ended in a space, so it could not see the missing `^`. `generation.test.ts` now also sends text before an identifier.        |
| 5   | `generation.ts:195:7`  | `if (content == null)` → `if (false)`                                            | Equivalent                             | `JSON.parse(null)` parses the string "null" and returns `null`, which fails `rawOutputSchema`. `JSON.parse(undefined)` throws, and the `catch` maps it. Both end in the same `invalid_output` with the same diagnostics.                                                                                                                                                                      |
| 6   | `generation.ts:199:11` | `catch { throw … }` → `catch {}`                                                 | Equivalent                             | `output` stays `undefined`, which fails `rawOutputSchema` on the next line: the same `invalid_output` with the same diagnostics.                                                                                                                                                                                                                                                              |
| 7   | `index.ts:62:23`       | `Date.now() - started` → `Date.now() + started`                                  | Cosmetic, ignored on purpose           | Only `latencyMs` in the failure log changes; nothing the client receives. Log values are risk #7, rollout Phase 3, which the plan keeps out of this table. Revisit it there.                                                                                                                                                                                                                  |
| 8   | `index.ts:75:36`       | `"AI generation is misconfigured"` → `""`                                        | Cosmetic, ignored on purpose           | The status and the code stay. The client branches on `error.code` and shows its own copy (`GenerateProposals.tsx:101-115`); it never displays `error.message`.                                                                                                                                                                                                                                |
| 9   | `index.ts:76:41`       | `"Could not generate flashcards. Please try again."` → `""`                      | Cosmetic, ignored on purpose           | Same as #8.                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | `index.ts:80:37`       | `"Could not generate flashcards"` → `""`                                         | Cosmetic, ignored on purpose           | Same as #8.                                                                                                                                                                                                                                                                                                                                                                                   |

## Run 4 — Phase 2 after the added assertions

- **Date**: 2026-10-28
- **Command**: the same as Run 3.
- **Added**:
  - `_upstream.test.ts`: row F1b, a 200 with an `error` object next to a usable choice, which must answer 502 `generation_failed`.
  - `generation.test.ts`: "drops a finish_reason" now runs twice: with text after an identifier, the existing case, and with text before one.
- **Result**: 67 mutants: 60 killed, 7 survived, 0 timed out, 0 without coverage, 0 errors. **Score: 89.55 %** (`generation.ts` 93.88 %, `index.ts` 77.78 %).
  - The dry run ran 88 tests, and 9.34 tests ran per mutant on average.
  - The run took 13 s, and Stryker removed its sandbox afterwards.
- **Survivors**: Run 3's #1, #2 and #4 are killed. The 7 survivors are #3 and #5–#10, with the verdicts given in Run 3.
