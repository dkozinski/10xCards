# Generate and Save Screens Under Failure — Implementation Plan

## Overview

This plan implements rollout Phase 1 of `context/foundation/test-plan.md`, covering risks #1 and #3. It adds tests that prove four things after a bad AI response or a failed save. The pasted text is never lost. The screen never locks. The app never fakes a success. No card is saved twice.

The tests sit at two boundaries:

- the HTTP boundary of `POST /api/proposals`, running in Node;
- the two React islands of the generate screen, running in jsdom (a simulated browser inside Vitest).

The four gaps that research found (G1–G4) are **pinned, not fixed**. Each gets a test that asserts the desired behaviour, plus a GitHub issue. The fixes belong to the Lesson 5 bug → fix → regression workflow.

Planning also found that the route tests under `src/pages/` ship to production as live endpoints. This change stops that.

## Current State Analysis

From `research.md`, verified on 2026-10-27 against `90550e7`:

- **Server classification is sound but tested against parser-shaped fixtures.**
  - The `completion()` helper (`src/lib/services/generation.test.ts:9-15`) emits only the fields the parser reads.
  - The route test mocks the whole service (`src/pages/api/proposals/index.test.ts:18-21`).
  - No test takes a raw OpenRouter body all the way to the HTTP status the client sees.
- **The client has no component tests.** The Vitest include `src/**/*.test.ts` (`vitest.config.ts:13`) silently skips `*.test.tsx`. The save-side invariants were verified only manually: payload building, freezing after an ambiguous failure, unfreezing on a 400.
- **The save is safe at the database.** The `save_generation` RPC is atomic and idempotent. pgTAP covers atomicity and a replay of the same payload, but runs locally only. Two cases are not proven anywhere: a replay that carries a _different_ payload, and a concurrent double submit.
- **Gaps** (research G1–G5). Tests that assert the desired behaviour fail on today's code:

| Gap | Today                                                                                                               | Desired (source)                                                                                           | Handling                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| G1  | `finish_reason` `length` or `content_filter` with parseable content → 200                                           | 502 `generation_failed` (OpenRouter docs: truncated or filtered completion; risk #1 "never fakes success") | `it.fails` pin + issue                                                                     |
| G2  | a choice-level `error` object is never read → 200 if content parses                                                 | 502 (OpenRouter documents `choices[].error`)                                                               | `it.fails` pin + issue                                                                     |
| G3  | `{proposals: [null]}` throws during render; the island unmounts and the text is lost                                | text kept, alert, Generate enabled (risk #1)                                                               | `it.fails` pin (or `it.todo`, see Critical Implementation Details) + issue                 |
| G4  | `validation_failed` without `details.fieldErrors` throws after `pending=true`; the spinner sticks (both components) | spinner clears, a message shows (risk #1)                                                                  | `it.fails` pin behind a test-scoped listener (see Critical Implementation Details) + issue |
| G5  | an OpenRouter moderation 403 → 500 "misconfigured"                                                                  | undecided (product question)                                                                               | issue only, no test                                                                        |

- **Discovered while planning: route tests are production routes.**
  - Astro turns every file in `src/pages/` into a route, including tests.
  - The local build from 2026-10-25 lists all eight `src/pages/api/**/*.test.ts` files as route components. One example is `"pathname":"/api/proposals/index.test"`.
  - Their code is bundled into the Worker. The proposals test chunk contains the test body, including the `SEKRET-ZRODLA` marker.
  - A ~566 KB chunk of Vitest internals is bundled too.
  - Workers Builds runs the same `astro build`, so production has most likely exposed these routes since S-01. Production itself was not probed.

## Desired End State

- `npm test` runs every Node suite plus two jsdom component suites, and the run is green.
  - Each known gap shows up as an expected failure (`it.fails`) or a `todo` titled `KNOWN GAP #<issue>:`.
  - The run shows no unhandled-error banner and no React `act` warning.
- **Risk #1, server half:** one table at the HTTP boundary pins the answer of `POST /api/proposals` for every documented OpenRouter response class. The fixtures are built from OpenRouter's documented shapes.
- **Risk #1, client half:** after every failure class, the generate screen still holds the pasted text and Generate is enabled. An alert explains what happened. A retry reaches the review without a page reload. A second submit while pending sends nothing.
- **Risk #3, client half:** the review sends exactly the approved set, in its post-edit wording, with the right origin label. A double click sends one request. After an ambiguous failure the list locks, and Try again resends the identical command. A `validation_failed` answer unlocks the list and marks the right card.
- **No test file under `src/pages/` is routed.**
  - A guard test keeps it that way.
  - `AGENTS.md` states the rule.
  - On production, `/api/proposals/index.test` returns 404.
- Every module this change tests has a narrow Stryker run on record. Its survivors are triaged in `mutation-report.md`.
- `test-plan.md` §2 states the decided protection for #1. §4, §5, §6 and §8 describe what shipped. Five GitHub issues track G1–G5.
- Q-6 (GitHub #6, roadmap Open Roadmap Question 6, Linear DAW-10) carries its Decision. #6 stays open until rollout Phase 2 ships checks for review-session reliability.

**Risk coverage map:**

| Scenario (test plan §2)                                  | Covered by                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| #1 malformed / empty upstream body                       | upstream table rows F1–F14; screen rows for 200 `[]` and an HTML body                 |
| #1 truncated                                             | F10 (cut JSON); pin P1 (parseable `length`)                                           |
| #1 late                                                  | existing service timeout tests (60 s abort); screen row for the client `TimeoutError` |
| #1 spinner never clears / text lost / retry needs reload | screen tests GS-1 to GS-3; pins G3, G4                                                |
| #1 success with garbage                                  | S2 (only valid cards survive), S5 (invalid cards do not use up the cap); pins P1–P3   |
| #3 rejected card saved / pre-edit wording / wrong label  | review tests RV-1, RV-2, RV-7                                                         |
| #3 double click duplicates                               | RV-3, RV-4 (same `generation_id` resent); DB replay = existing pgTAP                  |
| #3 failed save writes something                          | RV-4/RV-5 client side; DB atomicity = existing pgTAP                                  |

### Key Discoveries:

- **The service's default fetch reaches a global stub.** `doFetch` calls the global `fetch` at call time (`src/lib/services/generation.ts:117`), so `vi.stubGlobal("fetch", …)` lets a route test keep the real service.
- **The route imports `astro:env/server`** (`src/pages/api/proposals/index.ts:2`). Any route test must mock it, as `index.test.ts:10-15` does. That file mocks the service module-wide (`:18-21`), so the real-service table needs a file of its own.
- **Classification order** (`generation.ts:176-211`): error body / no choice / `finish_reason:"error"` → `content == null` → `JSON.parse` → `{cards: unknown[]}` → per-card schema (invalid cards dropped) → cap 20 → zero left → `no_valid_cards`. The route maps every kind to 502 except `upstream_config`, which maps to 500 (`index.ts:61-80`).
- **The generate island** (`src/components/generate/GenerateProposals.tsx`):
  - The guard `if (pending || review) return` sits at `:69`.
  - The fetch has a 75 s `AbortSignal.timeout` (`:83-88`).
  - A `TimeoutError` is detected with `instanceof DOMException` (`:91`).
  - The body is parsed with `.catch(() => null)` (`:100`).
  - `setPending(false)` at `:117` has no `finally`.
  - Try again shows only when the error is retryable (`:206`).
  - The text changes only on `onChange` (`:152-155`).
- **The review** (`src/components/generate/ProposalReview.tsx`):
  - `buildCommand` (`:110-128`) validates every kept card, including cards whose editor is still open.
  - `save` (`:130-194`) freezes the command after an ambiguous failure (`:149-155`, `:188-192`).
  - It unfreezes on `validation_failed` (`:174-184`).
  - It calls `disarm()` and then `window.location.assign("/deck")` on success (`:166-167`).
- **Query handles** (there are no `data-testid`s):
  - the label "Source text" and the buttons "Generate proposals" / "Generating…";
  - `role="alert"` (`src/components/auth/ServerError.tsx:12`);
  - the card controls' `aria-label`s, e.g. "Edit proposal 2" (`ProposalReview.tsx:272-315`);
  - the editor labels "Front" / "Back" (`src/components/deck/CardField.tsx:44`).
- **JSX in tests needs no plugin.** Vite's esbuild reads `jsx: react-jsx` from `tsconfig.json`.
- **jsdom has to stay on major 29.**
  - jsdom 30 requires Node ≥ 22.22.2; `.nvmrc` is 22.14.0.
  - Workers Builds picks its Node version from `.nvmrc` (Cloudflare "Build image" docs, checked 2026-10-27). Raising it would change the production build environment just for a test library.
  - jsdom 29.1.1 declares `node ^20.19.0 || ^22.13.0 || >=24.0.0` (npm, 2026-10-27).
- **Stubbing `location` works under jsdom.** Vitest 5.0.2 documents that a `vi.stubGlobal` value is visible as `window.X` under jsdom, so `vi.stubGlobal("location", …)` covers `window.location.assign`.
- **Stryker 10.1.1 should fit on paper.** core + vitest-runner declare peer `vitest >= 2.0.0` and `node >= 22`. The runner always uses `perTest` coverage, and `--mutate "file:start-end"` limits mutation to a line range.
- **Astro documents the fix.** It excludes `_`-prefixed files in `src/pages/` from routing "to put tests, utilities, and components in the same folder as their related pages" (routing guide, "Excluding pages").
- **Oracle sources for the screen behaviour** (archived owner decisions, not the code):
  - partial list = valid subset (`ai-proposals-from-text/plan-brief.md:37`);
  - Try again after `generation_failed`, a network error, a client timeout and a 200 without a list (`ai-proposals-from-text/plan.md:481`);
  - config failures are non-retryable (`:459`);
  - Generate is locked while a review is pending (`review-and-save-proposals/plan.md:419`);
  - Discard all keeps the text (`:43`);
  - a retry resends the same `generation_id` (`:92-93`);
  - freeze after an ambiguous failure (`:396`);
  - whitespace-only edits and reverts save as `ai` (`:267`);
  - cards with an open editor are validated and sent (`:384`).

## What We're NOT Doing

- **Fixing G1–G4.** They are pinned and tracked; fixing them is Lesson 5 (bug → fix → regression test).
- **G5.** It gets an issue only, with no test: the desired behaviour is a product decision still to make.
- **Production code changes in `src/lib` or `src/components`.** That includes no error boundary and no injectable navigation seam. Only test files, test config, tooling and docs change. The renames remove routes from the build output.
- **A replay with a different payload, or a concurrent double submit from two sessions.** Both need a real database. They are handed to rollout Phase 2 through §6.6.
- **Proving the origin label against a lying client.** The label is client-asserted by design (accepted risk). These tests prove only that the honest client labels correctly.
- **Deduplicating card content across two separate generations.** A "duplicate" here means the same save sent twice.
- **Semantic card quality.** A card that passes the schema but is useless is a rollout Phase 4 concern (LLM-as-judge).
- **Asserting on log contents in the new upstream table.** Risk #7 belongs to rollout Phase 3; the existing log tests stay.
- **A route-level timeout row.** The service tests already prove the 60 s abort with fake timers, and the route test proves timeout → 502.
- **CI changes.** CI already runs `npm test` on the latest Node 22. Stryker never runs in CI, and no mutation score is required.
- **Raising `.nvmrc` or taking jsdom 30.**
- **Restructuring route tests** beyond the `_` prefix.
- **e2e, browser automation and visual checks.**

## Implementation Approach

- **Classic layers only, with the cheapest real signal per risk.**
  - **Server half of #1:** a table at the HTTP boundary, run in Node. It keeps the real route and the real service, and stubs only the network edge.
  - **Client half of #1, and #3:** component tests in jsdom that assert what the user sees and what goes over the wire: the field's value, button state, the alert, and the request body.
  - The database half of #3 stays with the existing pgTAP and rollout Phase 2.
  - AI-native checks belong to rollout Phase 4.
- **Oracles come from sources, not from the implementation.** The sources are:
  - the OpenRouter docs, for the fixtures;
  - PRD FR-005–FR-007 and the resolutions of Open Questions 2–3;
  - the archived owner decisions listed above.

  Expected values are written as literal data. They are never computed with the code under test; for example, `proposalSource` is never called to build an expected label.

- **Known gaps are executable where the runner allows it.**
  - `it.fails` asserts the desired behaviour, so it starts failing the day the gap is fixed.
  - A gap that surfaces as an unhandled error is pinned too, behind a listener scoped to its test. `it.todo` is the fallback only when that listener cannot keep the run clean.
- **Every test phase ends with a narrow Stryker run** on the module it covers. Survivors are triaged with the M3L2 question "would this change hurt a user or the business?".
- **Execution and branching.**
  - All phases run through `/10x-implement`. They characterize existing code, so `/10x-tdd`'s "implementation absent" gate does not apply.
  - All commits go to the branch `test/generate-save-failures`, created from `main` before Phase 1's first change.

## Critical Implementation Details

- **Ordering.** The renames and the layout guard (Phase 1) land before any new file appears under `src/pages/`. `_upstream.test.ts` is created with its `_` prefix.
- **Pins must fail for the right reason.**
  - `it.fails` passes on _any_ failure, including a typo or a broken import. So write each pin first as `it`, run it, and confirm it fails at the intended assertion. Only then switch it to `it.fails`.
  - **A gap that shows up as an unhandled error still gets an executable pin.** This is G4: the TypeError rejects the promise of a handler that nobody awaits (`void generate()`, `void save()`). Vitest reports an unhandled rejection only while its own listener is the only one ("if there is another listener, assume that it's handled by user code", `node_modules/vitest/dist/chunks/init.IsjtLXKe.js:101-103`, Vitest 5.0.2). So the G4 pin registers its own `process.on("unhandledRejection", …)` listener. If the run still prints an unhandled-error banner, G4 becomes `it.todo`.
  - For G3, the test registers its own `window` `error` listener that calls `preventDefault()`. This stops Vitest's jsdom environment from re-raising React's uncaught render error. If the run still prints an unhandled-error banner, G3 becomes `it.todo`.
  - **Each such listener lives inside its test.** Vitest counts user listeners for both events (`window` `error`: `index.hTNFpC24.js:1241-1263`). A listener left in place silences every later error in the same file. Add it before the action, and remove it in `finally`, after the assertion settles.
  - **A pin waits for the desired outcome, never for the error.** Once Lesson 5 fixes the gap, the error no longer happens. A pin that waits for it would time out, `it.fails` would count the timeout as the expected failure, and the pin would never turn red.
- **jsdom specifics.**
  - **`fetch`:** it has no injection seam, so stub the global per test. Build the answers with Node's `Response.json(…)`; jsdom has no `fetch` of its own.
  - **Client timeout:** reject the stub with `new DOMException("…", "TimeoutError")` constructed in the test. That is the same global the component checks.
  - **Time:** no fake timers. Control timing with deferred promises, and resolve them inside `act` or follow them with a `findBy…` query, so React 19 does not warn about updates outside `act`.
  - **The ≥ 500-character text:** paste it with `user.paste` instead of typing it, which would fire one event per character.
  - **Environment APIs:** if `crypto.randomUUID` or `AbortSignal.timeout` were missing, the success-path tests would fail rather than pass. Stub them only in that case.
- **Harness traps (research §5).**
  - **Type-aware lint covers the `.tsx` tests.** `strictTypeChecked` applies to every file in `tsconfig.json`, tests included. `await` every `user.*` call (`no-floating-promises`). Assert on the `vi.fn()` you created (`const assign = vi.fn()`), not on `location.assign` (`unbound-method`). Narrow with an explicit check instead of `!` (`no-non-null-assertion`).
  - **The 1 s elapsed-time tick.** Only `GenerateProposals` runs `useElapsedSeconds`, a 1 s `setInterval`, while `pending` is set. A tick that lands outside `act` prints the warning that criterion 3.3 forbids, and whether it lands depends on machine load. Keep every pending window well under 1 s: resolve each deferred fetch right after the in-flight assertions. Where `pending` never clears on today's code (the G4 pin), wait with a timeout under 1 s, e.g. `findBy…` with `{ timeout: 500 }`.
  - **Stubs outlive their test.** Vitest 5.0.2 defaults clear only the call history (`clearMocks: true`; `restoreMocks`, `mockReset` and `unstubGlobals` are `false`). A `vi.stubGlobal` stub or a mock implementation carries into the next test of the same file unless `afterEach` calls `vi.unstubAllGlobals()`. Every file that stubs a global does this.
- **The build output holds a copy of the secrets.** The Cloudflare adapter writes `dist/server/.dev.vars`. Build checks search only `dist/server/chunks`, with `grep -rlF`, which prints file names and fixed strings only. Never open or print `.dev.vars`.
- **Stryker fallback.** Phase 1's smoke run may show that the vitest runner cannot drive Vitest 5.0.2. If so:
  - record the error in `mutation-report.md`;
  - use named manual mutations for Phases 2–4, as this repo has done since S-01;
  - note it in §4 and §6.6.
- **Test-plan baseline.** `context/foundation/test-plan.md` is untracked today. Phase 1 commits it unchanged, so that Phase 5's edits show up as a reviewable diff.

## Phase 1: Test layout, tooling and gap tracking

### Overview

Before any new test lands, make the test tree safe to grow and get the tools ready:

- route tests stop being production routes, and a guard keeps it that way;
- Stryker runs against this repo's Vitest;
- every known gap has an issue for its pin to cite.

### Changes Required:

#### 1. Route tests out of the router

**Files**: rename with `git mv`:

- `src/pages/api/account/index.test.ts` → `_index.test.ts`
- `src/pages/api/auth/signin.test.ts` → `_signin.test.ts`
- `src/pages/api/flashcards/[id].test.ts` → `_[id].test.ts`
- `src/pages/api/flashcards/index.test.ts` → `_index.test.ts`
- `src/pages/api/generations/index.test.ts` → `_index.test.ts`
- `src/pages/api/proposals/index.test.ts` → `_index.test.ts`
- `src/pages/api/reviews/index.test.ts` → `_index.test.ts`
- `src/pages/api/reviews/next.test.ts` → `_next.test.ts`

**Intent**: Astro excludes `_`-prefixed files from routing. Today all eight files sit in the production route manifest, and their code, plus Vitest, is bundled into the Worker.

**Contract**: rename only, no content change. Relative imports (`./index`, `./[id]`, …) still resolve in the same directory, and the test count stays the same.

#### 2. Layout guard

**File**: `src/pages-layout.test.ts` (new)

**Intent**: fail when a test or spec file under `src/pages/` is neither `_`-prefixed itself nor inside a `_`-prefixed directory. The failure names each offender.

§7 says configuration is not tested because the build fails loudly. That does not hold here: this mistake ships silently.

**Contract**: Node environment. It reads the tree with `node:fs` and makes one assertion: the list of offenders is empty.

#### 3. Rule in AGENTS.md

**File**: `AGENTS.md` → `## Hard rules`

**Intent**: record why route tests are `_`-prefixed, for agents and for the owner.

**Contract**: one bullet. Example wording: "**Tests under `src/pages/` start with `_`** (`_index.test.ts`). Astro turns every other file there into a route, so an unprefixed test ships to production as an endpoint with Vitest bundled into the Worker. `src/pages-layout.test.ts` enforces this."

#### 4. Mutation tooling

**Files**: `package.json`, `stryker.config.json` (new), `.gitignore`

**Intent**: a local, selective mutation gate (M3L2), run after each test phase as `npx stryker run --mutate "<file>:<start>-<end>"`. It never runs in CI.

**Contract**:

- devDependencies `@stryker-mutator/core@^10.1.1` and `@stryker-mutator/vitest-runner@^10.1.1`.
- `stryker.config.json`:
  - `testRunner: "vitest"`, `vitest.configFile: "vitest.config.ts"` and `vitest.pool: "forks"`. The runner passes its own pool to Vitest, `threads` by default, while `npm test` uses `forks` (impl-review phase 1, F3);
  - the default reporters: clear-text, progress, html;
  - `ignorePatterns` as a root-anchored allowlist: `["/*", "!/src", "!/package.json", "!/tsconfig.json", "!/vitest.config.ts"]`. The sandbox copy must not duplicate secrets or the stale build. Stryker ignores `.gitignore`, and a denylist (`dist`, `.dev.vars*`, `.env*`, `.wrangler`, `.claude`, `context`) still copied `supabase/.temp/` and other private files (impl-review phase 1, F1).
  - It is JSON, not `.mjs`, so it stays out of type-aware lint.
- `.gitignore`: `.stryker-tmp/` and `reports/mutation/`.

#### 5. Mutation report

**File**: `context/changes/testing-generate-save-failures/mutation-report.md` (new)

**Intent**: the tracked record of every run. The HTML report stays local.

**Contract**: one section per run. Each section gives:

- the command and the score;
- every surviving mutant inside the targeted range, with its verdict: killed by an added assertion, equivalent, or cosmetic and ignored on purpose. Every verdict gives a reason.

Phase 1 records a smoke run on `proposalSource` (`src/lib/validation/generation.ts:47-53`), which the existing `src/lib/validation/generation.test.ts` covers.

#### 6. Known-gap issues

**Where**: GitHub. This is outward-facing: show the five texts and open the issues only after the owner approves.

**Intent**: give each pin an issue number to cite, so Lesson 5 starts from a ready repro.

**Contract**:

- G1–G4 get the label `bug`; G5 gets `question`.
- Each G1–G4 issue states:
  - the observed behaviour;
  - the desired behaviour and its source;
  - how to find the pin: `grep -rn 'KNOWN GAP #<n>:' src` (the colon keeps `#4` from matching `#40`). The PR's `Refs #<n>` adds the backlink on GitHub, so no later phase edits the issue;
  - the fix path: flip the pin to `it`, then make the minimal fix.
- G5 starts with an investigation:
  - whether OpenRouter moderates our two models at all;
  - the real 403 body shape, read from `error.metadata` without reading `flagged_input`, which is user text;
  - the desired UX.
- Record the five issue numbers in `change.md` → `## Notes`.

#### 7. Test-plan baseline

**File**: `context/foundation/test-plan.md`

**Intent**: commit the file unchanged, so Phase 5's edits show up as a diff.

**Contract**: no content change.

### Success Criteria:

#### Automated Verification:

- Full suite passes with the renamed route tests and the layout guard: `npm test`
- The layout guard fails on an unprefixed test file under `src/pages/` (e.g. a temporary `src/pages/api/tmp.test.ts`) and passes once that file is deleted
- Lint passes: `npm run lint`
- The build routes no test file: `npm run build`, then `grep -rlF '.test.ts"' dist/server/chunks` and `grep -rlF 'SEKRET-ZRODLA' dist/server/chunks` both print nothing (before the renames, both print chunk names)
- Stryker runs against this repo: `npx stryker run --mutate "src/lib/validation/generation.ts:47-53"` completes, and its result is recorded in `mutation-report.md`

#### Manual Verification:

- The owner approved the five issue texts; the issues are open and their numbers are in `change.md`
- The owner reviewed the `AGENTS.md` rule

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Upstream contract at the API boundary

### Overview

Pin what `POST /api/proposals` answers for every documented OpenRouter response class. The pin is checked at the HTTP boundary, which is what the client actually sees. The fixtures are built from OpenRouter's documented shapes, not from what the parser reads.

### Changes Required:

#### 1. Documented-shape fixtures

**File**: `src/lib/services/openrouter.fixtures.ts` (new)

**Intent**: one place that builds OpenRouter bodies the way the docs describe them, so tests stop mirroring the parser. This answers the oracle problem from research §1.

**Contract**:

- A header cites https://openrouter.ai/docs/api/reference/overview and https://openrouter.ai/docs/api/reference/errors-and-debugging, checked 2026-10-28. It also cites https://openrouter.ai/openapi.json for two fields the `/chat/completions` schema omits: `choices[].index`, and `provider`, which the non-streaming `"chat.completion"` body of a Batch API result carries (impl-review phase 2, F2 and F3).
- A success builder returns the full envelope:
  - `id`, `provider`, `model`, `object` and `created`;
  - `choices[0]` = `{ index, finish_reason: "stop", native_finish_reason, message: { role: "assistant", content } }`;
  - `usage` with token counts and `cost`.

  Each test can override `content` (string or `null`), `finish_reason`, a choice-level `error`, or the whole `choices` array.

- An error builder returns `{ error: { code, message, metadata? } }`.
- No field that the docs do not show.

#### 2. Service tests on the documented envelope

**File**: `src/lib/services/generation.test.ts`

**Intent**: the existing service tests run on documented bodies, with their assertions unchanged.

**Contract**:

- `completion()` (`:9-15`) delegates to the success builder, and every other inline OpenRouter body uses the builders too (impl-review phase 2, F3).
- No assertion changes. Two exceptions came after the plan was approved:
  - The mutation triage (mutant #4) turned "drops a finish_reason" into an `it.each` with one new case. The existing assertions are unchanged.
  - "returns trimmed proposals and usage" passes its own `usage`, so the expected numbers sit next to the assertion and not in the builder's defaults (impl-review phase 2, F3 and F4).
- Service-only concerns stay in this file: the outgoing request, diagnostics, the timeouts, and the rule that the service never logs.

#### 3. Upstream contract table

**File**: `src/pages/api/proposals/_upstream.test.ts` (new)

**Intent**: run the real route with the real service; only `fetch` is stubbed. Each row maps a documented upstream situation to the HTTP status and `error.code` the client receives, or to the exact proposals.

**Contract**:

- Mock only `astro:env/server` (key present). The factory returns a constant, not the hoisted getter of `_index.test.ts:10-15`, because this file never needs a missing key (impl-review phase 2, F3).
- Each row also asserts how the stubbed `fetch` settled: `fulfilled`, and `rejected` only for F16. Otherwise an answer that throws while it is built passes as a network failure (impl-review phase 2, F1).
- Silence the route's `console.info` / `console.error` with spies.
- Stub `fetch` per row with `vi.stubGlobal`, and call `vi.unstubAllGlobals()` in `afterEach` (see Critical Implementation Details, _Stubs outlive their test_).
- Rows (oracle: OpenRouter docs, test-plan §2 #1 as decided on 2026-10-27, archived owner decisions):

| Row | Upstream answer                                                                                                  | Expected                                                                                                                                  | Regression caught                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| S1  | 200, `stop`, 3 valid cards                                                                                       | 200, the 3 trimmed cards in order                                                                                                         | success path broken by envelope fields                                              |
| S2  | 200, `stop`, 5 cards of which 2 have a 250-character front                                                       | 200, exactly the 3 valid cards in order                                                                                                   | invalid cards shown; or one bad card fails the whole result                         |
| S3  | 200, `stop`, 25 valid cards                                                                                      | 200, the first 20                                                                                                                         | cap removed                                                                         |
| S4  | 200, `finish_reason: null`, 3 valid cards                                                                        | 200 (owner decision: denylist, not allowlist)                                                                                             | an allowlist that turns a provider quirk into an outage                             |
| S5  | 200, `stop`, 22 cards of which 3 among the first 20 are invalid                                                  | 200, all 19 valid cards in order: invalid cards do not use up the cap (`ai-proposals-from-text/plan-brief.md:71`: "drop invalid, cap 20") | a cap applied before the drop, which shows 17                                       |
| F1  | 200 with a top-level `error` body (failure after a provider accepted)                                            | 502 `generation_failed`                                                                                                                   | an error body read as success                                                       |
| F1b | 200 with a top-level `error` next to a usable choice (added by the mutation triage; no documented body has both) | 502                                                                                                                                       | a usable choice that outranks the documented "check for `error` even on a 200" rule |
| F2  | 200 `{}`                                                                                                         | 502                                                                                                                                       | missing choices accepted                                                            |
| F3  | 200 `choices: []`                                                                                                | 502                                                                                                                                       |                                                                                     |
| F4  | a choice without `message`                                                                                       | 502                                                                                                                                       |                                                                                     |
| F5  | `finish_reason: "error"` with a choice-level `error` and parseable content                                       | 502                                                                                                                                       | partial content from a failed choice shown                                          |
| F6  | `content: null` ("no content generated" on cold start)                                                           | 502                                                                                                                                       |                                                                                     |
| F7  | `content: ""`                                                                                                    | 502                                                                                                                                       |                                                                                     |
| F8  | prose content                                                                                                    | 502                                                                                                                                       |                                                                                     |
| F9  | JSON wrapped in a Markdown fence                                                                                 | 502                                                                                                                                       | lenient parsing creeping in                                                         |
| F10 | `finish_reason: "length"` with cut JSON                                                                          | 502                                                                                                                                       |                                                                                     |
| F11 | `{"flashcards": […]}`                                                                                            | 502                                                                                                                                       |                                                                                     |
| F12 | `{"cards": []}`                                                                                                  | 502                                                                                                                                       | "a 200 with zero cards means nothing worth a card" (§2 _Must challenge_)            |
| F13 | every card invalid                                                                                               | 502                                                                                                                                       |                                                                                     |
| F14 | 200 with an HTML body                                                                                            | 502                                                                                                                                       |                                                                                     |
| F15 | HTTP 402, 408, 429, 500, 502, 503 with an error envelope                                                         | 502                                                                                                                                       | a transient failure reported as non-retryable                                       |
| F16 | the network fails (fetch rejects `TypeError`)                                                                    | 502                                                                                                                                       |                                                                                     |
| C1  | HTTP 400, 401, 404 with an error envelope                                                                        | 500 `server_error`                                                                                                                        | our misconfiguration shown as "usually temporary"                                   |

- 403 is deliberately absent; it belongs to the G5 issue.
- Each failure row also asserts the error body's `code`.

**Anti-pattern avoided**: fixtures shaped by the parser. Every row starts from the documented envelope.

#### 4. Pins for G1 and G2

**File**: `src/pages/api/proposals/_upstream.test.ts`

**Intent**: assert the desired behaviour now, so each gap is executable and the pin turns red when the gap is fixed.

**Contract**:

- Every pin is an `it.fails` titled `KNOWN GAP #<issue>: …`, and every pin expects 502 `generation_failed`:
  - P1: `finish_reason: "length"` with complete, parseable JSON (G1);
  - P2: `finish_reason: "content_filter"` with parseable JSON (G1);
  - P3: a choice-level `error` object with `finish_reason: "stop"` and parseable JSON (G2).
- Each pin first runs as `it` and must fail at the status assertion (200 received, 502 expected).

#### 5. Mutation run

**Intent**: show that the table kills the meaningful mutants of the classification and of the route mapping.

**Contract**:

- Command: `npx stryker run --mutate "src/lib/services/generation.ts:176-211,src/pages/api/proposals/index.ts:61-80"`. Re-check both ranges against the current file before the run.
- Survivors are triaged in `mutation-report.md`.

### Success Criteria:

#### Automated Verification:

- The upstream table passes and the pins report as expected failures: `npx vitest run src/pages/api/proposals/_upstream.test.ts`
- Each G1/G2 pin failed as `it` at the status assertion before becoming `it.fails`
- Full suite and lint pass: `npm test`, `npm run lint`
- Every Stryker survivor in the classification and mapping ranges has a verdict in `mutation-report.md`

#### Manual Verification:

- The owner checked the fixture builders against the two OpenRouter docs pages (no undocumented fields)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Generate screen under failure

### Overview

Set up component tests and use them to prove, through what the user sees, three things for every failure class: the pasted text stays, the action becomes available again, and a retry works without a reload.

### Changes Required:

#### 1. Component-test harness

**Files**: `package.json`, `vitest.config.ts`

**Intent**: render React islands in jsdom inside Vitest. Each file opts in on its own, so the Node suites keep Node's `Request` and `Response`.

**Contract**:

- devDependencies: `jsdom@^29.1.1`, `@testing-library/react@^16.3.3`, `@testing-library/dom@^10.4.2`, `@testing-library/user-event@^14.6.8`, `@testing-library/jest-dom@^7.0.1`.
- `include` (`:13`) becomes `src/**/*.test.{ts,tsx}`. Add no global `environment`, no `setupFiles` and no `globals`.
- Each component test file:
  - starts with `// @vitest-environment jsdom`;
  - imports `@testing-library/jest-dom/vitest`;
  - calls `cleanup()` and `vi.unstubAllGlobals()` in `afterEach`. Testing Library's auto-cleanup needs `globals: true`, which this repo does not use.

#### 2. Generate screen tests

**File**: `src/components/generate/GenerateProposals.test.tsx` (new)

**Intent**: prove the client half of risk #1 on the island exactly as `src/pages/generate.astro:19` mounts it.

**Contract**:

- Render `<GenerateProposals />` with no props.
- Stub `fetch`.
- Paste a text of at least 500 characters.
- Query by label and role.
- Tests, each named for its outcome:

| Test             | Behaviour asserted                                                                                                                                                                                                                                                                                                                    | Regression caught                                                                                                                                                            | Oracle                                                     | Edge / error case                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GS-1 (`it.each`) | After each bad answer, the field still holds the exact pasted text, Generate is enabled and reads "Generate proposals", an alert is shown, and Try again appears exactly for the transient classes. The `TimeoutError` row also asserts that the request carried a deadline: `init.signal` is an `AbortSignal` and is not yet aborted | spinner stuck; text cleared; retry affordance lost or offered where it cannot help; the client deadline removed, so a hung connection spins until the edge gives up (~100 s) | §2 #1; `ai-proposals-from-text/plan.md:459`, `:481`        | rows: 502 `generation_failed` (Try again); a client `TimeoutError` (Try again); a network `TypeError` (Try again); 200 `{proposals: []}` (Try again, never an empty review); 200 HTML body (Try again); 500 `server_error` (no Try again) |
| GS-2             | A retry after a 502 reaches the review without a reload: the same request body is sent twice, 2 proposals are shown, and the text is kept                                                                                                                                                                                             | a retry that sends stale or empty text; review not shown after a retry                                                                                                       | §2 #1 "retry without reload"                               | 502, then 200                                                                                                                                                                                                                             |
| GS-3             | A second submit while generating sends nothing; the button reads "Generating…" and is disabled until the answer arrives                                                                                                                                                                                                               | double request: two paid generations, or one list replacing another                                                                                                          | `review-and-save-proposals/plan.md:419`, §2 #1             | a double click while a deferred fetch is pending                                                                                                                                                                                          |
| GS-4             | A server validation error shows inline under the field and keeps the text                                                                                                                                                                                                                                                             | field error lost                                                                                                                                                             | the `fieldErrors` contract (`src/lib/api-errors.ts:24-26`) | 400 `validation_failed` with `fieldErrors.text`                                                                                                                                                                                           |
| GS-5             | An expired session asks the user to sign in again, offers no Try again, and keeps the text                                                                                                                                                                                                                                            | a retry loop on 401                                                                                                                                                          | `ai-proposals-from-text/plan.md:309`, `:481`               | 401                                                                                                                                                                                                                                       |
| GS-6             | An undecided review blocks a new generation: Generate is `aria-disabled` with the hint, and a click sends nothing                                                                                                                                                                                                                     | a new list silently replacing one the user has not decided on                                                                                                                | `review-and-save-proposals/plan.md:419`                    | a click on Generate while the review is shown                                                                                                                                                                                             |
| GS-7             | Discarding every proposal returns to the text, ready to generate again                                                                                                                                                                                                                                                                | text lost after Discard all                                                                                                                                                  | `review-and-save-proposals/plan.md:43`                     | all rejected, then the save answers `{saved_count: 0}`                                                                                                                                                                                    |

As implemented (impl-review phase 3, F2):

- The deadline check for GS-1 is a separate test, "GS-1: sends every generation with a client deadline". Its stub also rejects with `TimeoutError`, and it asserts a live `AbortSignal`, so the intent of the row is unchanged.
- The mutation triage (`mutation-report.md`, Run 6) added:
  - a second GS-4 row, `validation_failed` with `fieldErrors: {}`, which must show "Invalid text.";
  - a test without a GS id, "refuses a text under 500 characters without sending it", for the client-side length check;
  - `method: "POST"` in GS-2, and a check in GS-7 that "Proposals discarded" is no longer announced.

**Anti-patterns avoided**:

- Asserting full UI copy: tests check the meaning-bearing parts and the affordances.
- Mirroring `retryable: response.ok`: each row's expected affordance comes from the archived decisions.
- Testing only the happy path.

#### 3. Pins for G3 and G4

**File**: `src/components/generate/GenerateProposals.test.tsx`

**Intent**: make each gap visible next to the behaviour it breaks.

**Contract**:

- **G3** is an `it.fails`. When the answer is `200 {proposals: [null]}`, the desired result is: the text is still in the field, an alert is shown, and Generate is enabled. The test adds its own `window` `error` listener and removes it in `finally` (see Critical Implementation Details). If the run still prints an unhandled-error banner, use `it.todo`. React also logs the render error with `console.warn`, so the test spies on it and restores it in the same `finally` (impl-review phase 3, F2).
- **G4** is an `it.fails`. When the answer is `400 validation_failed` with `details: {}`, the desired result is that the spinner clears and "Invalid text." shows inline. The test adds its own `process.on("unhandledRejection", …)` listener before the submit and removes it in `finally`. It waits for "Invalid text.", never for the rejection.
- Both titles start with `KNOWN GAP #<issue>:`.

#### 4. Mutation run

**Contract**:

- Command: `npx stryker run --mutate "src/components/generate/GenerateProposals.tsx:67-118"`. The range is the `generate()` function, not the JSX; re-check it first.
- Survivors are triaged in `mutation-report.md`.

### Success Criteria:

#### Automated Verification:

- The generate screen suite passes in jsdom: `npx vitest run src/components/generate/GenerateProposals.test.tsx`
- Full suite passes, and the Node suites still run in Node: `npm test`
- The run output shows no unhandled-error banner and no React `act` warning
- The G3 and G4 pins each failed as `it` for the right reason before becoming `it.fails`, or are recorded as `it.todo` with the reason; each pin removes its listener in `finally`
- Lint passes, including type-aware rules on the `.tsx` test: `npm run lint`
- Every Stryker survivor in `generate()` has a verdict in `mutation-report.md`

#### Manual Verification:

- The owner read the verbose test list (`npx vitest run --reporter=verbose src/components/generate/GenerateProposals.test.tsx`) and confirmed that it covers the risk #1 screen scenarios

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Review and save under failure

### Overview

Prove the client half of risk #3 through the request the review sends and through what the user can still do after each outcome.

### Changes Required:

#### 1. Review and save tests

**File**: `src/components/generate/ProposalReview.test.tsx` (new)

**Intent**: pin the save's core invariant on the component: after an ambiguous failure, freeze; once the server proves nothing was written, unfreeze. Also pin the shape of the approved payload.

**Contract**:

- Render `<ProposalReview generationId proposals onDiscarded />` directly; its props are its contract with the parent.
- Stub `fetch` and `location` with `vi.stubGlobal("location", { assign: vi.fn() })`.
- Check the unload guard by dispatching a cancelable `beforeunload` event and reading `defaultPrevented`.
- Reach the controls by their `aria-label`, and the editors by label within each list item.
- Tests:

| Test             | Behaviour asserted                                                                                                                                                                                                                                                                                                                                              | Regression caught                                                                                                                                                                          | Oracle                                                                                                                                   | Edge / error case                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| RV-1             | Saving sends exactly the approved set. `generated_count` = 4, and the cards follow list order: the rejected card is absent; an edit left open (no Done) is saved as typed and labelled `ai_edited`; a whitespace-only edit is saved in the original wording as `ai`. After the 200 the page goes to `/deck` once, and the unload guard no longer blocks leaving | rejected card sent; pre-edit wording; wrong label or count; navigation lost; a "Leave site?" prompt after the save                                                                         | PRD FR-005–FR-007 and the Open Question 3 resolution; `review-and-save-proposals/plan.md:267`, `:384`                                    | 4 proposals with mixed actions; the expected body is literal data                    |
| RV-2             | An edit reverted to the original saves the original wording as `ai`                                                                                                                                                                                                                                                                                             | revert keeps the edited text or label                                                                                                                                                      | `review-and-save-proposals/plan.md:267`, `:435`                                                                                          | edit, then Revert                                                                    |
| RV-3             | A double click on Save sends one request                                                                                                                                                                                                                                                                                                                        | duplicate save                                                                                                                                                                             | §2 #3; `review-and-save-proposals/plan.md:44`                                                                                            | double click while a deferred fetch is pending                                       |
| RV-4 (`it.each`) | After an ambiguous failure the list locks (Edit, Reject and Save disabled), Try again resends a byte-identical body with the same `generation_id`, and a later success goes to `/deck` once. The network row also asserts that the save carried a deadline: `init.signal` is an `AbortSignal` and is not yet aborted                                            | edits after a save that committed but was never acknowledged; a new id on retry, which creates duplicates; the save deadline removed, so a hung save stays pending until the edge gives up | `review-and-save-proposals/plan.md:92-93`, `:386`, `:396`                                                                                | rows: network failure (fetch rejects); 500 `server_error`; 200 without `saved_count` |
| RV-5             | A `validation_failed` answer unlocks the list and puts the error on the card that was sent at that index                                                                                                                                                                                                                                                        | error shown on the wrong card once an earlier card is rejected; list left frozen after a 400                                                                                               | `review-and-save-proposals/plan.md:398`; `review-and-save-proposals/reviews/impl-review-phase-3.md:33` (unfreeze on `validation_failed`) | reject card 1; the server answers `cards.1.front`; the error appears on card 3       |
| RV-6             | A 401 on a first attempt keeps the list editable and asks the user to sign in in another tab. A 401 after an ambiguous failure keeps the list frozen, and Try again still resends the identical command                                                                                                                                                         | list frozen on a first-attempt 401; freeze dropped on a 401 after the first attempt may have committed; review lost by leaving the page                                                    | `review-and-save-proposals/plan.md:391`, `:398`; `review-and-save-proposals/reviews/impl-review-phase-3.md:33`, `:72-73`                 | 401 first; network failure, then 401                                                 |
| RV-7             | Rejecting every card discards: the body has `cards: []` with `generated_count` = N, the parent is told once, and there is no navigation                                                                                                                                                                                                                         | Discard all saving cards or navigating away                                                                                                                                                | `review-and-save-proposals/plan.md:43`                                                                                                   | all rejected                                                                         |
| RV-8             | An invalid kept card blocks the save and opens its editor with the error; an invalid card that was rejected does not block it                                                                                                                                                                                                                                   | invalid card sent; a rejected card blocking the save                                                                                                                                       | `review-and-save-proposals/plan.md:384`, `:438`                                                                                          | front cleared; a rejected card with a cleared front                                  |

As implemented (impl-review phase 4, F4):

- RV-4 checks the save deadline in every row, not only the network row. Every request creates the signal, so no row needs a condition.
- RV-5 starts from a frozen list: a network failure, then Try again, then the 400. On a first attempt nothing is locked, so only this order can catch "list left frozen after a 400". It ends by saving the fixed card again, and that body shows the list is no longer frozen.
- RV-6 is two tests, one per scenario in its edge column.
- RV-8 makes the invalid card by edit, reject and restore. That is the only way to keep an invalid card with its editor closed, so the test can prove that the save opens it.
- RV-1 checks the unload guard before and after the save; RV-6's first test checks that it is still armed after the 401.
- The mutation triage (`mutation-report.md`, Run 8) added:
  - "RV-5: marks a card past the tenth by its two-digit index";
  - "RV-5: a validation error that names no card says the save failed and leaves the list editable", with the route's `_root` answer;
  - a check in RV-5 that the alert names how many cards need fixing.
- The phase review added:
  - an RV-4 row for a 200 with an HTML body (F1);
  - an edited card in RV-4, so that Revert is among the locked controls, and a check in RV-3 that every per-card control is locked while the save is in flight (F2);
  - in RV-8, a check that card 1's editor is closed before Save and that the alert names one card (F3).

**Anti-patterns avoided**:

- A happy path with a single unedited card (§2 #3).
- Expected labels computed with `proposalSource`.
- Asserting the freeze through internal state instead of through disabled controls and the resent body.

#### 2. Pin for G4 in the review

**File**: `src/components/generate/ProposalReview.test.tsx`

**Contract**: an `it.fails` titled `KNOWN GAP #<issue>:`, with the same test-scoped `unhandledRejection` listener as Phase 3. When the answer is `validation_failed` without `fieldErrors`, the desired result is "Could not save. Please try again." with the list unlocked. The pin waits for that message, never for the rejection. Today `cardErrors` calls `Object.entries(undefined)` (`ProposalReview.tsx:45`, `:178`).

#### 3. Mutation run

**Contract**:

- Command: `npx stryker run --mutate "src/components/generate/ProposalReview.tsx:43-53,src/components/generate/ProposalReview.tsx:110-194"`. The ranges cover `cardErrors`, `buildCommand` and `save`; re-check them first.
- Survivors are triaged in `mutation-report.md`.

### Success Criteria:

#### Automated Verification:

- The review and save suite passes in jsdom: `npx vitest run src/components/generate/ProposalReview.test.tsx`
- Full suite passes with no unhandled-error banner and no React `act` warning: `npm test`
- The G4 pin failed as `it` for the right reason before becoming `it.fails`, or is recorded as `it.todo` with the reason; it removes its listener in `finally`
- Lint passes: `npm run lint`
- Every Stryker survivor in `cardErrors`, `buildCommand` and `save` has a verdict in `mutation-report.md`

#### Manual Verification:

- The owner read the verbose test list and confirmed that it covers the risk #3 scenarios

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Cookbook and test-plan sync

### Overview

Turn what shipped into the canonical answer to "how do I add a test for X here?", and backport the decided wording of risk #1.

### Changes Required:

#### 1. §2 Risk Response Guidance, row #1

**File**: `context/foundation/test-plan.md`

**Intent**: backport the research correction that the owner decided on 2026-10-27.

**Contract**:

- Only the "What would prove protection" cell changes. New text: "For each bad-response class, the API answers `generation_failed` (502). It never answers success with an empty list, and never success from a truncated or filtered completion. It returns a partial list only when the dropped cards were themselves invalid. The screen keeps the pasted text, re-enables the action and lets the user retry without reload".
- No file anchors (§1 principle #3).

#### 2. §4 Stack, §5 Quality Gates, §8 Freshness

**File**: `context/foundation/test-plan.md`

**Contract**:

- **§4, component row:** Testing Library (react 16.3.3, dom 10.4.x, user-event 14.6.8, jest-dom 7.0.1) with jsdom 29.1.1 under Vitest, opted in per file; `checked:` date. Add a note that jsdom 30 waits until `.nvmrc` is ≥ 22.22.2, because Workers Builds reads `.nvmrc`.
- **§4, new row:** mutation testing with Stryker 10.1.1 + vitest-runner, run locally and selectively after a risk phase; `checked:` date. Name the two config choices and why: `vitest.pool: "forks"`, the pool `npm test` uses (the runner defaults to `threads`); `ignorePatterns` as an allowlist, because Stryker ignores `.gitignore` and would otherwise copy secret-bearing files into its sandbox. **When NOT to use:** as a CI gate, or to chase 100 %. A test that pins a cosmetic detail just to kill a mutant is itself a vibe test.
- **§5:** the component-tests gate becomes "required (wired)". No new gate row.
- **§8 and the header:** "Last updated" and "Stack versions last verified" get the current date.
- Leave §3 Status alone. `/10x-test-plan` reconciles it from `## Progress`.

#### 3. §6 Cookbook

**File**: `context/foundation/test-plan.md`

**Contract**:

- **§6.1 Adding a unit test.** Cover:
  - location: next to the module; under `src/pages/`, the file name starts with `_`, and the layout guard enforces it;
  - fixtures built from documented shapes (`src/lib/services/openrouter.fixtures.ts`);
  - reference tests: `src/pages/api/proposals/_upstream.test.ts` for a contract table at the HTTP boundary, and `src/lib/services/generation.test.ts` for service-only concerns;
  - known-gap pins: `it.fails` titled `KNOWN GAP #n:`, first seen failing as `it`. A gap that surfaces as an unhandled error gets a listener scoped to its test and removed in `finally`, and the pin waits for the desired outcome, never for the error. `it.todo` only when that listener cannot keep the run clean;
  - commands: `npx vitest run <file>` and the Stryker command.
- **§6.2 Adding a component test.** Cover:
  - the per-file environment comment, the jest-dom import and explicit cleanup;
  - stubbing `fetch` and `location` with `vi.stubGlobal`;
  - pasting long text instead of typing it;
  - deferred promises instead of fake timers;
  - queries by role and label;
  - asserting what the user sees and what is sent (field value, enabled state, alert, request body);
  - both new files as reference tests, and the run command.
- **§6.4:** keep it TBD for rollout Phase 2, but update the interim note: route tests are `_`-prefixed.
- **§6.6, Phase 1 notes:**
  - what shipped;
  - G1–G5 with their issue numbers;
  - handed to rollout Phase 2: a replay with a different payload, and a concurrent double submit from two sessions;
  - the Stryker summary, pointing to this change's `mutation-report.md`.

#### 4. Commands in AGENTS.md

**File**: `AGENTS.md` → `## Commands`

**Intent**: list the test commands next to the others. Today `npm test` is missing from that list.

**Contract**:

- Add `npm test`, `npx vitest run <file>` and `npx stryker run --mutate "<file>:<from>-<to>"` (local only).
- Point to test-plan §6 for the patterns.

### Success Criteria:

#### Automated Verification:

- Every run command in §6.1 and §6.2 runs green exactly as written
- The edited §2 cell (Risk Response Guidance, row #1) carries no file anchors: `awk '/^\| #1 \|/{n++; if ($0 ~ /src\/|\.tsx?|:[0-9]/) bad++} END{print n" row, "bad+0" anchors"}' context/foundation/test-plan.md` prints `1 row, 0 anchors`, and the cell names no function or schema. The hot-spot directories cited elsewhere in §2 stay.
- Prettier check passes on the edited markdown: `npx prettier --check context/foundation/test-plan.md AGENTS.md context/changes/testing-generate-save-failures/*.md`

As implemented (impl-review phase 5, F4):

- 5.2 ran as `awk '/^\| #1 +\|/{…}'`. The regex above allows exactly one space after `#1`, but Prettier pads the cell to `| #1   |`, so it matches no row and prints ` row, 0 anchors`.
- §6.1 and §6.2 give concrete commands on the reference files instead of `<file>`, so that 5.1 can run them as written; the `<file>` form lives in `AGENTS.md`. §6.2's Stryker example adds `--timeoutMS 30000` for jsdom modules (`mutation-report.md`, Runs 9–10).
- The Stryker runs behind 5.1 are Runs 11 and 12 in `mutation-report.md`.
- The §4 Version column shows `package.json` ranges (`^10.4.2`), as the other rows of that table do.
- The phase review corrected (F1–F3, F5–F9):
  - §6.1: which module a route test mocks, `_`-prefixed directories, re-deriving Stryker ranges, and retiring a fixed pin;
  - §6.2: `mockReset()` in `afterEach`, and the range rule next to its Stryker example;
  - §6.6: one request for a double click;
  - §8: the strategy line notes the §2 backport;
  - the wording of Runs 11–12.

#### Manual Verification:

- The owner reviewed the diffs of `test-plan.md` and `AGENTS.md`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Release

### Overview

PR, Q-6 tracker sync, CI and merge. Merging to `main` deploys to production through Workers Builds. Then confirm that production no longer serves test routes.

### Changes Required:

#### 1. Pre-merge production probe

**Intent**: record what production serves for a test route today, as evidence for the PR.

**Contract**:

- Ask the owner first. Then run: `curl -s -o /dev/null -w '%{http_code}\n' https://10xcards.dkozinski.workers.dev/api/proposals/index.test`.
- The request reaches the live Worker and loads the bundled test module. The module's top level only declares mocks and suites, so no network or database call happens, but one line lands in Workers Logs.
- Expected: not 404 (most likely 500). Record whatever code comes back.

#### 2. Pull request

**Intent**: one PR from `test/generate-save-failures` into `main`.

**Contract**: the body covers:

- risks #1 and #3 and how they are now proven;
- the known gaps, linked with `Refs #…`, never `Closes`;
- Q-6, linked with `Refs #6`, never `Closes` (see §3);
- the routing fix, with the probe result;
- a link to `mutation-report.md`;
- the items handed to rollout Phase 2.

After the push, update the five known-gap issues once the owner approves the edited texts (impl-review phase 1, F5):

- #43: the exact repro, a `details` object without `fieldErrors` (`"details": {}`);
- #42: a link to `ProposalReview.tsx:214`, where an item without `front` throws;
- all five: the real `KNOWN GAP #<n>:` label, and permalinks to `test-plan.md` and `research.md` at the pushed commit.

#### 3. Q-6 decision in the trackers

**Intent**: this change answers Open Roadmap Question 6, "Do the two guardrail promises get automated checks, and if so, starting where?", and ships the first deliberate checks for consent before save. The trackers must say so before the merge (`context/foundation/lessons.md`, "Merge slice PR = zamknięte issues, ale nie zsynchronizowane trackery"). The PRD has no matching open question.

**Contract**:

- Outward-facing: show the Decision text, and write it only after the owner approves.
- The Decision: yes, phased, as `test-plan.md` §3 lays out. Rollout Phase 1 (this change) ships the first checks for consent before save; rollout Phase 2 covers review-session reliability on a real database.
- Before the merge, write it into:
  - GitHub #6: the **Decision** section of the body, plus a comment (`tasks-github.md` → Lifecycle, "Answer a question");
  - roadmap Q-6 (`context/foundation/roadmap.md`, Open Roadmap Questions), committed on this branch;
  - Linear DAW-10, the mirror of #6 (`tasks-linear.md`).
- #6 stays open, so the PR says `Refs #6`. It closes when rollout Phase 2 ships checks for review-session reliability; that sync belongs to rollout Phase 2.

#### 4. Merge and production check

**Intent**: prove that the deploy removed the test routes and changed nothing else.

**Contract**:

- After the Workers Builds deploy, the same probe returns `404`, and `curl -s https://10xcards.dkozinski.workers.dev/` contains `10xCards`.
- The owner signs in on production and opens `/generate`.
- Rollback: `npm run deploy:rollback` reverts code only; no data or schema is involved.

### Success Criteria:

#### Automated Verification:

- CI is green on the PR (lint, tests including the jsdom suites, build): `gh pr checks <n>`
- Workers Builds is green on the merge commit

#### Manual Verification:

- The pre-merge production probe result is recorded in the PR body
- Before the merge, the owner-approved Q-6 Decision is in #6 (body and comment), roadmap Q-6 and DAW-10, and #6 is still open
- After the push, #40–#44 carry the owner-approved edits (impl-review phase 1, F5)
- After the deploy, `/api/proposals/index.test` returns 404 and `/` serves the 10xCards page
- The owner signs in on production and `/generate` renders

---

## Testing Strategy

### Unit Tests:

- **Upstream contract table (Phase 2):** one row per documented OpenRouter class, mapped to the HTTP status and `error.code` the client sees, plus the success rows that pin the decided partial-list and cap behaviour.
- **Service tests:** they keep the outgoing-request, diagnostics, timeout and no-logging concerns, now on documented envelopes.
- **Layout guard:** no test file under `src/pages/` without a `_` prefix.

### Component Tests:

- **Generate screen (GS-1 to GS-7):** the text is kept, the action re-enabled and a retry works without reload after every failure class. No double submit. A review blocks a new generation. Discard keeps the text.
- **Review and save (RV-1 to RV-8):** the approved set is sent in post-edit wording with correct labels. One request per click. Freeze and identical resend after an ambiguous failure; unfreeze on 400, with errors mapped by the index of the sent cards. Discard. Validation blocks the save.

### Integration Tests:

- None new. Database atomicity and same-payload replay stay with the existing pgTAP suite (local). The different-payload replay and the concurrent double submit go to rollout Phase 2.

### Manual Testing Steps:

1. Phases 3 and 4: read the verbose test lists and tick off each risk scenario from the coverage map.
2. Phase 6: probe production before and after the deploy, then sign in and open `/generate`.

## Performance Considerations

- Paste instead of type for long text: typing 500 characters fires about 500 input events per test.
- Stryker runs are limited to the functions each phase covers; the vitest runner's `perTest` coverage reruns only the related tests. Expect minutes, not seconds, for the component modules.
- The build gets smaller: the Vitest chunk (~566 KB) and the eight test chunks leave the Worker.

## Migration Notes

None. No data or schema changes. The test-file renames keep history with `git mv`; archived plans keep citing the old paths as history.

## References

- Research: `context/changes/testing-generate-save-failures/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 risks #1 and #3, §3 Phase 1, §6)
- Archived decisions: `context/archive/2026-09-29-ai-proposals-from-text/`, `context/archive/2026-10-05-review-and-save-proposals/`
- OpenRouter: https://openrouter.ai/docs/api/reference/overview, https://openrouter.ai/docs/api/reference/errors-and-debugging (checked 2026-10-26, re-checked 2026-10-28), https://openrouter.ai/openapi.json (checked 2026-10-28)
- Cloudflare Workers Builds, build image (Node from `.nvmrc`): https://developers.cloudflare.com/workers/ci-cd/builds/build-image/ (checked 2026-10-27)
- Astro routing, "Excluding pages": https://docs.astro.build/en/guides/routing/#excluding-pages (checked 2026-10-27)
- Vitest 5.0.2 `vi.stubGlobal`; Stryker 10 configuration and vitest runner (checked 2026-10-27)
- Existing patterns: `src/pages/api/proposals/index.test.ts:10-21` (env and service mocks), `src/lib/services/generation.test.ts:56-66` (hanging fetch)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test layout, tooling and gap tracking

#### Automated

- [x] 1.1 Full suite passes with renamed route tests and the layout guard — 57ae7f7
- [x] 1.2 Layout guard fails on an unprefixed test under src/pages — 57ae7f7
- [x] 1.3 Lint passes — 57ae7f7
- [x] 1.4 Build routes no test file — 57ae7f7
- [x] 1.5 Stryker smoke run completes and is recorded — 57ae7f7

#### Manual

- [x] 1.6 Five known-gap issues opened after owner approval — 57ae7f7
- [x] 1.7 Owner reviewed the AGENTS.md rule — 57ae7f7

### Phase 2: Upstream contract at the API boundary

#### Automated

- [x] 2.1 Upstream contract table passes with pins as expected failures — bcf79f4
- [x] 2.2 Each G1/G2 pin failed as it at the status assertion first — bcf79f4
- [x] 2.3 Full suite and lint pass — bcf79f4
- [x] 2.4 Stryker survivors in classification and mapping triaged — bcf79f4

#### Manual

- [x] 2.5 Owner checked fixture builders against the OpenRouter docs — bcf79f4

### Phase 3: Generate screen under failure

#### Automated

- [x] 3.1 Generate screen suite passes in jsdom — 5bc06c9
- [x] 3.2 Full suite passes with node suites still in node — 5bc06c9
- [x] 3.3 No unhandled-error banner and no act warning — 5bc06c9
- [x] 3.4 G3 and G4 pins failed for the right reason before it.fails — 5bc06c9
- [x] 3.5 Lint passes on the tsx test — 5bc06c9
- [x] 3.6 Stryker survivors in generate() triaged — 5bc06c9

#### Manual

- [x] 3.7 Owner confirmed the test list covers risk #1 screen scenarios — 5bc06c9

### Phase 4: Review and save under failure

#### Automated

- [x] 4.1 Review and save suite passes in jsdom — 0de346f
- [x] 4.2 Full suite passes with no unhandled error or act warning — 0de346f
- [x] 4.3 G4 pin failed for the right reason before it.fails — 0de346f
- [x] 4.4 Lint passes — 0de346f
- [x] 4.5 Stryker survivors in cardErrors, buildCommand and save triaged — 0de346f

#### Manual

- [x] 4.6 Owner confirmed the test list covers risk #3 scenarios — 0de346f

### Phase 5: Cookbook and test-plan sync

#### Automated

- [x] 5.1 Every §6.1 and §6.2 run command runs green as written
- [x] 5.2 The edited §2 row #1 cell carries no file anchors
- [x] 5.3 Prettier check passes on the edited markdown

#### Manual

- [x] 5.4 Owner reviewed the test-plan and AGENTS.md diffs

### Phase 6: Release

#### Automated

- [ ] 6.1 CI green on the PR
- [ ] 6.2 Workers Builds green on the merge commit

#### Manual

- [ ] 6.3 Pre-merge production probe recorded in the PR
- [ ] 6.4 Q-6 Decision written in #6, roadmap and DAW-10 before the merge
- [ ] 6.5 Known-gap issues #40–#44 updated after the push
- [ ] 6.6 Post-deploy probe returns 404 and the home page serves 10xCards
- [ ] 6.7 Owner signs in on production and /generate renders
