<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Generate and Save Screens Under Failure

- **Plan**: `context/changes/testing-generate-save-failures/plan.md`
- **Scope**: Phase 5 of 6 (reviewed uncommitted, before the phase commit)
- **Date**: 2026-10-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Evidence

- **Drift check (sub-agent, read-only):**
  - All four planned changes MATCH. The §2 row #1 cell is word for word the plan's text, and no other cell in that row changed. §3 is untouched.
  - Every fact checked against its source agrees: issue numbers #40–#44 (`change.md` Notes), the four mutation scores (Runs 1, 4, 6, 10), installed versions, `stryker.config.json`, `.nvmrc` 22.14.0 against jsdom 30's `^22.22.2`, and the dates.
  - The four declared deviations are justified: concrete commands so that 5.1 can be checked, Runs 11–12 because the report records every run, caret ranges as in the rest of the §4 table, and the padding-tolerant awk regex.
- **Accuracy and safety check (sub-agent, read-only):**
  - Every command in §6.1, §6.2 and `AGENTS.md` is local. Stryker writes only gitignored `.stryker-tmp/` and `reports/mutation/`, no dashboard reporter is configured, and nothing reads `.dev.vars`.
  - These claims check out: auto-cleanup needs `globals`; the `act(async () => …)` pattern; the 1 s elapsed-seconds ticker (`useElapsedSeconds.ts:12`); jsdom has no `fetch` of its own; the listener-based suppression for both events; the three lint rules are errors under `strictTypeChecked`; no `data-testid` in the screens; `it.fails` passes on a typo.
  - Findings F1–F3 and F6–F9 come from this check.
- **Verified by the reviewer:**
  - `mockClear` empties the call lists but not `onceMockImplementations`; only `mockReset` does (`node_modules/@vitest/spy/dist/index.js:164-181`). Vitest 5.0.2 defaults: `clearMocks: true`, `mockReset: false`.
  - Only `proposals/_index.test.ts` and `_upstream.test.ts` mock `astro:env/server`. The other seven route tests mock `@/lib/supabase`. Only `proposals/index.ts`, `lib/supabase.ts` and `lib/config-status.ts` import `astro:env/server`.
  - Since the Phase 2 commit `bcf79f4`, the only changes under `src/` are the two new component test files. The mutated modules and the tests that cover them are unchanged against `bcf79f4` and `5bc06c9`.
- **Rejected sub-agent flags:**
  - "5.4 ticked before the review finished": the owner approved 5.4 explicitly before this review started.
  - "`## CI` in `AGENTS.md` says lint + build": the owner decided to leave it, to keep the plan's scope.
  - "§6.6 is longer than the schema's 2–3 lines": the plan's contract asked for this content.
- **Success criteria, re-run by the reviewer:**
  - `git diff HEAD -- src` is empty, so Runs 11–12 (16 s and 1 min 13 s, earlier in this session) still stand for the two Stryker commands; they were not repeated.
  - 5.1 `grep -rn 'KNOWN GAP #' src`: 6 pins. `npx vitest run src/pages/api/proposals/_upstream.test.ts`: 30 passed, 3 expected failures. `npx vitest run` on both component files: 29 passed, 3 expected failures, no unhandled-error banner, no `act` warning.
  - 5.2 The plan's command prints ` row, 0 anchors` (F5); `/^\| #1 +\|/` prints `1 row, 0 anchors`.
  - 5.3 `npx prettier --check …`: all files pass.
  - Phase interaction: `npm test`: 27 files, 382 passed, 6 expected failures (the six pins).
  - 5.4 Approved by the owner in the session.

## Findings

### F1 — §6.2's afterEach recipe leaves queued mock answers in place

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `context/foundation/test-plan.md:147`
- **Detail**: §6.2 says to call `cleanup()` and `vi.unstubAllGlobals()` in `afterEach`. Both reference files also call `mockReset()` on their module-level mocks (`GenerateProposals.test.tsx:54`, `ProposalReview.test.tsx:72-74`). Vitest's default `clearMocks` runs `mockClear`, which keeps `onceMockImplementations`. A test that fails before it consumes a queued `mockResolvedValueOnce` therefore leaks that answer into the next test's first `fetch`: the next failure is misattributed, or a test passes falsely.
- **Fix**: Add "and `mockReset()` on every module-level `vi.fn`" to that sentence.
- **Decision**: FIXED: §6.2 now adds `mockReset()` on every module-level `vi.fn`, and says why.

### F2 — §6.1 presents the proposals-only env mock as the rule for every route test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `context/foundation/test-plan.md:134`
- **Detail**: "a route test mocks `astro:env/server` with a `vi.mock` factory that exports every name the route imports". Only the two proposals tests do this, because only `proposals/index.ts` imports `astro:env/server` directly. The other seven route tests mock `@/lib/supabase` (e.g. `flashcards/_index.test.ts:6-7`). An agent that follows §6.1 for a database route would mock the env and still build a real Supabase client.
- **Fix**: "Mock the module that reads `astro:env/server`: `@/lib/supabase` for a database route, or `astro:env/server` itself, with a factory that exports every name the loaded modules import, when the route reads it directly, as `proposals` does."
- **Decision**: FIXED: §6.1 now says to mock the module that reads `astro:env/server`: `@/lib/supabase` for a database route, `astro:env/server` itself only when the route reads it directly.

### F3 — §6.6 states the double-submit guarantee as "one request per click"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `context/foundation/test-plan.md:188`
- **Detail**: The test behind it is RV-3, "a double click on Save sends one request". Read literally, "one request per click" lets a double click send two, which is exactly the duplicate that risk #3 guards against.
- **Fix**: Replace "sends one request per click" with "sends one request for a double click".
- **Decision**: FIXED: §6.6 now reads "sends one request for a double click".

### F4 — The plan's 5.2 check matches no row, and Phase 5's deviations are not in the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/testing-generate-save-failures/plan.md:686`
- **Detail**: `/^\| #1 \|/` requires one space after `#1`. Prettier pads the cell to `| #1   |`, so the command prints ` row, 0 anchors`, a vacuous pass. 5.2 was verified with `/^\| #1 +\|/` and by reading the cell. The plan still carries the broken regex, and it does not record the other three deviations either (concrete commands with `--timeoutMS`, Runs 11–12, caret ranges). A full-plan review that uses the plan as ground truth would trust the vacuous check and flag the deviations again. Phases 2–4 record theirs in an "As implemented" note.
- **Fix**: Add an "As implemented (impl-review phase 5, F4)" note under Phase 5 that lists the corrected regex and the three deviations.
- **Decision**: FIXED: Phase 5 now carries an "As implemented (impl-review phase 5, F4)" note below its Automated Verification list: the corrected regex, the three deviations, and what this review fixed.

### F5 — Runs 11 and 12 claim that no file under `src/` changed

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `context/changes/testing-generate-save-failures/mutation-report.md:202`, `:212`
- **Detail**: `GenerateProposals.test.tsx` and `ProposalReview.test.tsx` landed after Run 4, and `ProposalReview.test.tsx` after Run 6. The conclusion holds: the mutated modules and the tests that cover them are unchanged, and the dry-run counts match (88 and 17). Only the sentence is false.
- **Fix**: "the mutated files and the tests that cover them are unchanged since Run 4" (Run 6 for Run 12).
- **Decision**: FIXED: Runs 11 and 12 now say the mutated files and the tests that cover them are unchanged.

### F6 — §6.1's location rule ignores `_`-prefixed directories

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/test-plan.md:129`
- **Detail**: "Under `src/pages/` the file name starts with `_` … Astro routes every other file there." The guard accepts any `_`-prefixed path segment (`src/pages-layout.test.ts:16`), and the `AGENTS.md` hard rule allows a `_`-prefixed directory. Following §6.1 still gives a compliant file, but the sentence is stricter than the rule it describes.
- **Fix**: "the file name, or a directory above it, starts with `_`".
- **Decision**: FIXED: §6.1 now reads "the file name, or a directory above it, starts with `_`".

### F7 — The Stryker examples carry line ranges that will drift

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `context/foundation/test-plan.md:143`, `:163`
- **Detail**: The ranges match today's files. After the next edit to `generation.ts`, `index.ts` or `GenerateProposals.tsx`, they point at other code, and the cookbook never says to re-derive them. The plan did ("re-check both ranges against the current file").
- **Fix**: Add "re-derive `<from>-<to>` from the current file before a run" next to the first example.
- **Decision**: FIXED: §6.1 dates the ranges and says to re-derive them before a run; at the owner's choice, §6.2's Stryker example points to that rule too.

### F8 — The pin lifecycle stops before the pin turns red

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `context/foundation/test-plan.md:135-140`
- **Detail**: §6.1 says how to create a pin, not what to do when it fails because the gap is fixed. The test comments say "flip it to it", but nothing says to drop the `KNOWN GAP #n:` prefix, so the `grep` in §6.1 would keep listing a fixed gap as open.
- **Fix**: Add "When it turns red, flip it to `it` and drop the `KNOWN GAP #n:` prefix."
- **Decision**: FIXED: §6.1 now says to flip a fixed pin to `it` and drop its `KNOWN GAP #n:` prefix.

### F9 — §8 says strategy was last reviewed on 2026-10-26, after a §2 backport

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `context/foundation/test-plan.md:210`
- **Detail**: §2 row #1 changed today, carrying the owner's decision of 2026-10-27. The plan deliberately bumped only "Last updated" and "Stack versions last verified", so the ledger understates when strategy text last changed.
- **Fix**: Append "(§2 row #1 backported 2026-10-31, owner decision 2026-10-27)" to the strategy line.
- **Decision**: FIXED: §8's strategy line notes the §2 row #1 backport (2026-10-31, owner decision 2026-10-27).
