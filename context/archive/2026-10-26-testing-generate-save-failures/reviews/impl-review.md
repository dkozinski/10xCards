<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate and Save Screens Under Failure

- **Plan**: `context/changes/testing-generate-save-failures/plan.md`
- **Scope**: Full plan, Phases 1–6 of 6 (Phases 1–5 also had phase reviews; this sweep covers Phase 6, the epilogue and cross-phase consistency)
- **Date**: 2026-10-31
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Evidence

- **Drift check (sub-agent, read-only against HEAD blobs):** every planned file matches its contract, including the "As implemented" amendments.
  - The eight renames are R100. `stryker.config.json` carries the exact allowlist and `pool: "forks"`. The lockfile resolves Stryker 10.1.1, jsdom 29.1.1 and the four Testing Library packages, and it adds 172 dev-only packages without changing any root dependency.
  - The final test files contain every row the plan names: S1–S5, F1, F1b, F2–F16, C1 and P1–P3 in `_upstream.test.ts`, GS-1–GS-7 in `GenerateProposals.test.tsx`, and RV-1–RV-8 in `ProposalReview.test.tsx`. There are six `KNOWN GAP` pins: #40 ×2, #41, #42 and #43 ×2.
  - Cross-phase: the Stryker ranges in test-plan §6.1/§6.2 and `mutation-report.md` still fit the production files. The dry-run test counts match the files, and the §6.6 scores match Runs 2, 4, 6, 10, 11 and 12.
  - "What We're NOT Doing" holds. In `src/lib` and `src/components`, only test files and `openrouter.fixtures.ts` changed. `.github/` and `.nvmrc` are unchanged.
- **Safety and pattern check (sub-agent, read-only):**
  - The Stryker allowlist, simulated with Stryker's own ignore logic, copies only `package.json`, `src`, `tsconfig.json` and `vitest.config.ts`.
  - Fixtures use synthetic text, the fake key `sk-or-test` and an all-zero user id.
  - Every `user.*`, `findBy*` and `waitFor` call is awaited. Every scoped listener and console spy is removed in `finally`. `afterEach` unstubs globals and resets module-level mocks.
  - Expected values are literal data; `proposalSource` and the parser are never used to build one.
- **Success criteria, re-run by the reviewer:**
  - `npm test`: 27 files, 388 tests, of which 382 passed and 6 failed as expected. Exit 0, with no `Unhandled`, `act(` or `Warning:` in the output. A second run with `generation.test.ts` excluded gave 349 passed and 6 expected failures; see Notes for why that file was excluded.
  - `npm run lint`: exit 0.
  - 6.1 `gh pr checks 45`: `ci` and `Workers Builds: 10xcards` both pass.
  - 6.2: the check runs on merge commit `0fe2ee8` are `ci` success and `Workers Builds: 10xcards` success.
  - 6.3: the PR #45 body records the pre-merge probe, "`GET /api/proposals/index.test` on production → **500**".
  - 6.4: #6 is open, its body has a `### Decision` section, and its last comment restates it. Linear DAW-10 carries the same Decision, and `roadmap.md:196` has it, added in `d51a5ba` before the merge.
  - 6.5: #40–#43 carry their `KNOWN GAP #n:` label. #42 links `ProposalReview.tsx#L214`, #43 shows `"details": {}`, and all five link permalinks at `d51a5ba`. The one exception is F3.
  - 6.6 and 6.7 were production actions. Their only trace is the `85ef5d8` commit message, "probes (500 before, 404 after)". The reviewer did not probe production again.
  - 5.1 was not re-run, because the Stryker runs behind it take minutes and Runs 11–12 record them.
- **Notes (not findings):**
  - **Review incident.** The drift sub-agent ran `npx vitest list --json …`, and Vitest treated `--json` as an output path. It overwrote `src/lib/services/generation.test.ts` in the working tree with a JSON listing and created an untracked `.vitest/`. HEAD is intact, and no finding depends on the corrupted copy. The sub-agent's attempt to restore the file was denied by the permission check. The owner then ran `git restore src/lib/services/generation.test.ts && rm -rf .vitest`, and the restored file passes 33/33.
  - **For rollout Phase 3 (risk #7).** `_upstream.test.ts` is the only test where the real service's diagnostics reach the real route's `console.*`. It mutes them without asserting that the source text stays out. The plan excludes this on purpose ("Asserting on log contents in the new upstream table"); research for rollout Phase 3 should start from it.
  - **Guard scope.** The layout guard enforces the `_` rule for tests only. An unprefixed helper such as `src/pages/api/helpers.ts` would still ship as an endpoint. `AGENTS.md:13-16` says so plainly. A future option: one guard that requires `export const prerender = false` in every unprefixed `.ts`/`.js` under `src/pages/`, which would enforce both hard rules.
  - **Branch.** `85ef5d8` and `2365c6c` sit on the local `chore/close-testing-generate-save-failures` and are not pushed. This is the repo's usual close-out flow (cf. `chore/close-home-page`), and this report joins them.
  - **Sub-agent items dismissed:**
    - The #43 pins wait for exact wording, as `plan.md:497` approved.
    - test-plan §3 still says "change opened"; `plan.md:641` leaves §3 for `/10x-test-plan` to reconcile.
    - The RV-4 deadline check sits in every row, as approved in impl-review phase 4, F4.
    - `stryker.config.json` has no default `mutate`, but every documented command passes `--mutate`.
    - The plan's References cite line numbers as of `90550e7`, a dated snapshot.

## Findings

### F1 — AGENTS.md says CI runs only lint and build

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AGENTS.md:130
- **Detail**: `## CI` says the workflow "runs lint + build" and "Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build step". `ci.yml:18-26` runs `npx astro sync`, lint, `npm test` and build, and `ci.yml:22` says "No SUPABASE\_\* env here on purpose". The same file now says at `:86` that Stryker never runs in CI, and test-plan §5 lists the unit and component gates as running in CI. Impl-review phase 1 noted the stale line ("Phase 5 edits the same file"), but Phase 5 left it. This change matters here: the new layout-guard hard rule is enforced only because CI runs `npm test`, and an agent reading `## CI` would conclude that nothing gates it.
- **Fix**: Reword to "runs `astro sync`, lint, `npm test` and build on every push and PR to `main`. It needs no secrets: both `astro:env` fields are optional secrets that resolve at runtime on the Worker."
- **Decision**: FIXED — `AGENTS.md:130` now lists `astro sync`, lint, `npm test` and build, and says no repository secrets are needed.

### F2 — The layout guard can pass without checking anything

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages-layout.test.ts:14-18
- **Detail**: Suppose a later edit breaks `TEST_FILE`, `PAGES` or the `sep` split, for example a move or a Windows path separator. The scan then finds no test files, `offenders` is `[]`, and the guard stays green. Stryker never mutates test files, so no tool would notice. Criterion 1.2 proved the positive case once, by hand. The comment at `:6-8` also still says Astro "turns every file under src/pages/ into a route", the wording impl-review phase 1, F4 corrected in AGENTS.md (".ts/.js file … into an endpoint").
- **Fix**: Split the scan into `tests` and `offenders`, add `expect(tests.length).toBeGreaterThan(0)` (9 `_*.test.ts` files exist today), and align the comment with `AGENTS.md:13-16`.
- **Decision**: FIXED — the guard splits the scan into `tests` and `offenders` and asserts `tests.length > 0`, and its comment matches `AGENTS.md:13-16`. A temporary `src/pages/api/tmp.test.ts` still fails it by name. Plan Phase 1 §2 records the second assertion.

### F3 — Issue #44 has no test-plan permalink

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: GitHub #44 (plan.md:745)
- **Detail**: Phase 6 §2 asks for "all five: … permalinks to `test-plan.md` and `research.md` at the pushed commit". #40–#43 link `test-plan.md` at `d51a5ba`. #44 links only `research.md`, although test-plan §6.6 (`test-plan.md:197`) records G5 as an open product question. Whoever picks up #44 lands on research, not on where the test plan tracks it. The `KNOWN GAP` label does not apply to #44, which has no pin.
- **Fix**: Add a `test-plan.md` permalink at `d51a5ba` to #44 (outward-facing: show the text and post only after owner approval), or record in the plan that #44 was meant to carry research only.
- **Decision**: FIXED (2026-10-31, text approved by the owner) — #44's last line now adds a permalink to test-plan §6.6 at `d51a5ba`, "tracks it as an open product question with no test". The rest of the body is unchanged.

### F4 — Progress 6.4 cites the wrong commit for its repo part

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-generate-save-failures/plan.md:914
- **Detail**: 6.4 ("Q-6 Decision written in #6, roadmap and DAW-10 before the merge") cites `85ef5d8`. Its repo part, the `roadmap.md:196` Decision, landed in `d51a5ba`, at 14:13, before the 14:20 merge. `85ef5d8` only ticks boxes. The Progress convention says to append the SHA "when a step lands". A reader who checks the trace for "before the merge" finds a commit made after it.
- **Fix**: Change the 6.4 SHA to `d51a5ba`.
- **Decision**: FIXED — Progress 6.4 now cites `d51a5ba`.
