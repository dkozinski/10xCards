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
