<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate and Save Screens Under Failure

- **Plan**: `context/changes/testing-generate-save-failures/plan.md`
- **Scope**: Phase 1 of 6 (reviewed uncommitted, before the phase commit)
- **Date**: 2026-10-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 5 observations
- **Triage**: 2026-10-28 — all 6 fixed (F1 via Fix A; F5 scheduled in plan Phase 6). Verdict after fixes: APPROVED

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- **Drift check (sub-agent, read-only):** all seven Phase 1 items MATCH. Nothing crosses "What We're NOT Doing": no change in `src/lib`, `src/components`, CI, `.nvmrc`, `vitest.config.ts`, tsconfig or ESLint config.
- **Safety and pattern check (sub-agent, read-only):** nothing critical.
  - The layout guard follows Astro 6.4.8's real rule (`create-manifest.js:92`).
  - The lockfile adds 119 dev-only registry packages with integrity hashes and no install scripts.
  - The issue bodies hold no secrets, and every cited line matches `90550e7`.
- **Success criteria, re-run by the reviewer:**
  - 1.1 `npm test`: 24 files, 322 tests pass.
  - 1.2 The guard fails naming `api/tmp.test.ts`, then passes once it is removed.
  - 1.3 `npm run lint`: exit 0.
  - 1.4 The build passes; both greps find 0 files; the positive control finds the `/api/proposals` route.
  - 1.5 Stryker: 85.71 % (12/14), sandbox removed.
  - 1.6 and 1.7 have evidence: #40–#44 were verified against the approved texts, and the owner approved the AGENTS.md rule in-session.
- **Notes (not findings):**
  - `npm audit` shows 2 new moderate advisories from the Stryker tree (`typed-rest-client` → `qs`). Only the dashboard reporter uses that code, and it is not enabled; the 23 other advisories pre-date this change.
  - The `AGENTS.md` "## CI" line ("lint + build") was already stale, because CI also runs `npm test` (`ci.yml:21`). Phase 5 edits the same file.
  - The drift sub-agent left `/tmp/drift-review/lock-head.json` (a copy of HEAD's lockfile) outside the repo. Its delete was denied; the owner removes it.

## Findings

### F1 — Stryker sandbox still copies secret-bearing and private files

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: stryker.config.json:9
- **Detail**: Stryker 10.1.1 does not honour `.gitignore`. It always skips only `node_modules`, `.git`, `*.tsbuildinfo`, `/stryker.log`, `.next`, `.nuxt` and `.svelte-kit` (`node_modules/@stryker-mutator/core/dist/src/fs/project-reader.js:10-18`).
  - **What still gets copied.** The plan's six patterns still let these into `.stryker-tmp/`:
    - `supabase/.temp/`, which holds `start-secrets`, `pooler-url`, `project-ref` and `linked-project.json`;
    - `supabase/snippets/`, which holds 11 Studio SQL queries;
    - `.vscode/launch.json` and `.vscode/settings.json`;
    - `CLAUDE.md`;
    - the untracked `.agents/` and `claude.zip`.
  - **Why it matters.** The copy is local and gitignored, but Stryker deletes it only after a successful run; a failed or interrupted run leaves it on disk. That contradicts the stated intent of Phase 1 §4: "The sandbox copy must not duplicate secrets."
  - **Second problem in the same line.** Patterns are matched against the bare entry name at any depth, ignoring case (`project-reader.js:211`, `:227`). So `dist` and `context` would also drop a future `src/**/context/` folder and break the dry run.
- **Fix A ⭐ Recommended**: Replace the denylist with an allowlist, `["/*", "!/src", "!/package.json", "!/tsconfig.json", "!/vitest.config.ts"]`, then re-run the smoke run.
  - Strength: only what the tests need is copied, so any secret or private file added later is excluded by default. Anchoring at the root removes the any-depth match. The sandbox is smaller.
  - Tradeoff: a test that later needs another root-level file fails the dry run until that file is allowed; the failure is loud and the fix is one line. The config no longer reads like the plan's denylist, though it keeps the plan's intent.
  - Confidence: HIGH — negation rules are handled in `project-reader.js:236-245`, and the re-run proves that the tests still pass in the sandbox.
  - Blind spot: whether a transform needs a root file beyond these four; the re-run answers it.
- **Fix B**: Keep the denylist, anchor every entry at the root, and extend it with `/supabase/.temp`, `/supabase/snippets`, `/.vscode`, `/CLAUDE.md`, `/.agents` and `/claude.zip`.
  - Strength: closest to the plan's wording; everything else is still copied.
  - Tradeoff: the owner's private untracked files get named in a tracked config of a public repo. Every new private file needs a new line, and files nobody has listed are still copied.
  - Confidence: HIGH.
  - Blind spot: files nobody has thought of yet.
- **Decision**: FIXED via Fix A (2026-10-28).
  - The allowlist is in `stryker.config.json:9`.
  - The re-run scored 85.71 % again, and the inspected sandbox held only `node_modules` (a symlink), `package.json`, `src`, `tsconfig.json` and `vitest.config.ts`.
  - It is recorded as mutation-report Run 2, and the plan's Phase 1 §4 contract is updated.
  - The inspected sandbox `.stryker-tmp/sandbox-QrWvAV` remains, because the delete was denied. It is gitignored and holds only the allowlisted files; the owner removes it.

### F2 — Mutation report calls the two survivors "Equivalent"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/testing-generate-save-failures/mutation-report.md:23-24
- **Detail**: The report defines Equivalent as "no input the code can receive tells the mutant from the original". The client can receive an untrimmed original, though:
  - `GenerateProposals.tsx:102-103` passes the proposals on unvalidated. That is the same foreign-body case that #42 and #43 treat as real.
  - With an untrimmed original, the mutant shows the "Edited" badge on a card nobody touched (`ProposalReview.tsx:214`) and saves it as `ai_edited` (`:116`).

  Ignoring the mutants is still right, since they cause no harm on our API contract, but the bucket is wrong.

- **Fix**: Relabel both rows "Cosmetic, ignored on purpose", with the reason "reachable only through a non-API body; the effect is a wrong `ai_edited` label, not lost data".
- **Decision**: FIXED (2026-10-28). Both Run 1 rows are relabelled, and the reason now names the foreign-body path (`GenerateProposals.tsx:102-103`) and the effect.

### F3 — `vitest.pool: "forks"` is an unplanned addition recorded only in the mutation report

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: stryker.config.json:6
- **Detail**: Neither `pool` nor `$schema` is in the Phase 1 §4 contract.
  - **Why `pool` is still needed.** The runner passes its own `pool` to `createVitest`, which overrides the config file, and its default is `threads` (`vitest-test-runner.js:106`). `npm test` runs Vitest 5.0.2's default, `forks`. Without the pin, the G3/G4 listener pins of Phases 3–4 would be mutation-tested in a different pool from the one they run in.
  - **Where the reason lives.** JSON cannot carry a comment, so the reason is recorded only in `mutation-report.md`.
- **Fix**: Add it to plan Phase 5 §2, in the new §4 Stryker row: the runner is pinned to `vitest.pool: "forks"`, the pool `npm test` uses. Test-plan §4 and §6 then carry the reason.
- **Decision**: FIXED (2026-10-28). The plan's Phase 1 §4 contract now lists `vitest.pool: "forks"` with its reason. Phase 5 §2's new §4 row names both config choices: `pool: forks`, and the allowlist from F1.

### F4 — The AGENTS.md rule overstates Astro's routing and covers only tests

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: AGENTS.md:13-16
- **Detail**: The rule is off in both directions:
  - **Too broad.** "Astro turns every other file there into a route" is not accurate. Astro 6.4.8 routes page extensions and `.js`/`.ts` endpoints only, and skips `.tsx` files and dot-files (`node_modules/astro/dist/core/routing/create-manifest.js:80-81`, `:92-97`).
  - **Too narrow.** A `.ts` fixture or helper under `src/pages/` would ship as an endpoint just as a test does, and the rule does not say so.

  Nothing is affected today, because Phase 2 puts its fixtures in `src/lib/services/`.

- **Fix**: Reword it to: "**Non-route files under `src/pages/` start with `_`** (`_index.test.ts`, `_helpers.ts`, or a `_`-prefixed directory). Astro turns every `.ts`/`.js` file there into an endpoint, so an unprefixed test ships to production with Vitest bundled into the Worker. `src/pages-layout.test.ts` enforces this for tests."
- **Decision**: FIXED (2026-10-28). The rule was reworded as proposed and the guard is unchanged; this supersedes the wording the owner approved under 1.7.

### F5 — Known-gap issue bodies: two imprecise triggers and links that assume a push

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: GitHub #40–#44
- **Detail**:
  - **#43.** The body says "a body without `fieldErrors` throws". Both islands first check `body?.error?.details` (`GenerateProposals.tsx:104`, `ProposalReview.tsx:174`), so only a `details` object without `fieldErrors`, such as `"details": {}`, throws. Without `details` the generic path runs.
  - **#42.** The body links only `ProposalReview.tsx:62-66`, which is where `[null]` throws. An item without `front` throws later, at `:214`, via `proposalSource` (`generation.ts:51`).
  - **All five.** They cite `context/foundation/test-plan.md` and `research.md` as plain paths that are not on GitHub yet, and `research.md` moves to `context/archive/` when the change is archived. The pin grep still says `KNOWN GAP #<n>:` although the numbers are now known.
  - **#40.** It quotes the decided risk #1 wording, which Phase 5 backports before the merge.
- **Fix**: Make one approved batch of edits once the branch is pushed (Phase 6):
  - #43 gets the exact repro body (`"details": {}`);
  - #42 gets the `:214` link;
  - all five get the real `KNOWN GAP #<n>:` label and permalinks to `test-plan.md` and `research.md` at the pushed commit.

  Record the step in plan Phase 6 §2.

- **Decision**: FIXED in plan (2026-10-28). Phase 6 §2 gains the edit batch, and a new manual criterion is added, Progress 6.5 (the old 6.5–6.6 became 6.6–6.7). The GitHub edits themselves wait for the push in Phase 6 and for the owner's approval of the texts.

### F6 — The Phase 1 commit will reformat the "unchanged" test-plan baseline

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md; AGENTS.md:130
- **Detail**: The pre-commit hook runs `prettier --write` on every staged `*.md` (`package.json` → `lint-staged`).
  - **What it would change.** 91 lines of `test-plan.md` (formatting only), every change-folder document, and one blank line at `AGENTS.md:130`, a drift that predates this change.
  - **Why it matters.** Plan Phase 1 §7 says "commit the file unchanged". Normalizing the file is what keeps Phase 5's diff clean, but today it would happen silently inside the hook.
- **Fix**: Before staging, run `npx prettier --write` on the markdown to be committed and show the resulting diff, so that the commit holds exactly what the owner reviewed.
- **Decision**: FIXED (2026-10-28). Nine markdown files were formatted, and the JSON files were already clean.
  - **What changed.** A comparison that ignores whitespace and table padding shows only three kinds of change: whitespace, table padding, and `*italic*` → `_italic_`.
  - **One exception.** Prettier corrupted one line of `research.md`, inserting a backslash into a code span and deleting spaces, because bold text wrapped a code span containing `**`. The line was reworded so that it survives Prettier.
  - **The hook would have done the same.** It would have made that corruption silently at commit time.
  - **Result.** Every commit-bound file now passes `prettier --check`.
