# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-26

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/`
(excluding generated database types, build output, `context/`).
24 commits in the 30 days before 2026-10-26.

Test-base profile at plan time: **meaningful** — Vitest configured, 23
`*.test.ts` files across `src/lib`, `src/lib/services`, `src/lib/validation`
and `src/pages/api`, all mocking the database; 4 pgTAP files under
`supabase/tests`, run locally only. No component tests, no e2e runner.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                                                               | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The AI provider returns a malformed, truncated, empty or late response and the generate screen breaks: the spinner never clears, the pasted text is lost, retry needs a page reload — or the server reports success and shows garbage cards                           | High   | High       | interview Q1, Q3, Q4; roadmap S-02 (riskiest assumption); hot-spot dirs `src/pages/api` (22 file-changes/30d), `src/components/generate` (5)     |
| 2   | A grade in a review session is lost or does not persist the new FSRS schedule: progress disappears, the same card keeps coming back, or the session shows a deleted card or another user's card                                                                       | High   | Medium     | PRD Guardrails (review reliability), US-02 AC; interview Q1 (top fear); roadmap Q-6; hot-spot dir `src/lib/services` (18)                        |
| 3   | Saving reviewed proposals diverges from what the user approved: a rejected card lands in the deck, an edited card is saved in its pre-edit version, a double click creates duplicates, or the card's AI/edited/manual origin is mislabelled and skews the 75% metrics | High   | Medium     | PRD Guardrails (consent before save), FR-005–FR-007, Open Questions 2–3; interview Q1, Q3; roadmap Q-6                                           |
| 4   | (abuse) Account isolation breaks: user B reads or changes A's cards, generations or review history by supplying A's ids, or a new migration loosens row-level access and nothing notices because the database tests run only by hand                                  | High   | Medium     | PRD NFR data isolation, § Access Control; AGENTS.md RLS hard rule; CI runs no database tests; interview Q4 (all backend tests mock the database) |
| 5   | Deck management corrupts state: an edit writes the wrong fields or resets the card's schedule, a delete removes the wrong card, or the deck list after a failed request shows something the database does not hold                                                    | Medium | Medium     | interview Q3; PRD FR-009–FR-011, Open Question 4; hot-spot dirs `src/components/deck` (9), `src/lib/services` (18)                               |
| 6   | (abuse) Account deletion leaves cards, review history or generation records behind, touches another account's data, or the server skips re-checking the typed email                                                                                                   | High   | Low        | PRD FR-003, Open Question 5; roadmap S-06 ("an incomplete deletion is a trust failure")                                                          |
| 7   | (abuse) Pasted employer material persists or leaks — into a table, a log line or an error body — or the 20 000-character cap is bypassed server-side                                                                                                                  | Medium | Low        | PRD NFR no persistence of source text; roadmap Open Question 1 (20 000 chars → `validation_failed`)                                              |

Interview Q2 reported no production incidents so far; likelihood leans on
churn and on the "review fixes" commit every M-1 slice needed before merge.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                   | Must challenge                                                  | Context `/10x-research` must ground                                                                                                     | Likely cheapest layer                                                          | Anti-pattern to avoid                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| #1   | For each bad-response class, the API answers `generation_failed` (502) instead of a success with an empty or partial list, and the screen keeps the pasted text, re-enables the action and lets the user retry without reload | "A 200 with zero cards means the text had nothing worth a card" | How upstream responses are classified; what the generate island holds in state across a failed request; timeout behaviour on the Worker | unit (bad-response fixtures at the provider boundary) + component test (jsdom) | Fixtures shaped by reading the current parser instead of by real provider failure modes (oracle problem) |
| #2   | After grading and reloading, the card carries a new due date, exactly one review log exists, a replayed grade changes nothing, and a deleted or foreign card is never served next                                             | "The grade endpoint returned 200, so the schedule was written"  | The grade and next-card database functions on a real Postgres; replay and ordering guarantees                                           | integration against local Supabase                                             | Asserting on a mocked RPC result — the test then checks its own mock                                     |
| #3   | The deck receives exactly the approved set, in post-edit wording, with the correct origin label; a second submit adds nothing; a failed save writes nothing                                                                   | "Input validation passed, so the persisted rows are right"      | Atomicity of the save; replay protection; where the origin label is decided                                                             | integration (real database) + component test (double submit, edit-then-save)   | Happy path with a single unedited card                                                                   |
| #4   | For every table and database function, B gets `not_found` or zero rows on A's resources and anon gets nothing — checked on every change that touches the data layer                                                           | "Signed in means allowed"                                       | Full table × operation × role matrix including definer functions; which checks already exist                                            | pgTAP (exists) run as a local pre-merge gate                                   | A matrix that skips definer functions or new tables                                                      |
| #5   | An edit changes only front and back and leaves the schedule; after any failed request the deck list matches the database                                                                                                      | "A 200 from the edit means the screen shows the truth"          | Optimistic updates and error handling in the deck island                                                                                | component test + existing route/service unit tests                             | Asserting appearance instead of state                                                                    |
| #6   | After deleting A, every per-user count for A is zero and B is untouched; a mismatched email never reaches the delete                                                                                                          | "Signed out means deleted"                                      | The full list of per-user tables, including ones added later                                                                            | pgTAP (exists) + route unit test                                               | A hard-coded table list that silently goes stale                                                         |
| #7   | The submitted text appears in no table, log line or error body; 20 001 characters is refused with 400                                                                                                                         | "We don't store it, so we don't log it"                         | Every path where upstream errors are logged or echoed                                                                                   | unit (partly exists)                                                           | A "log does not contain X" assertion where X is not the text actually submitted                          |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                                       | Goal (one line)                                                                                                         | Risks covered           | Test types                                                       | Status        | Change folder                                   |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------- | ------------- | ----------------------------------------------- |
| 1   | Generate and save screens under failure          | Prove a bad AI response or failed save never loses the pasted text, locks the screen, fakes success or duplicates cards | #1, #3                  | unit (bad-response fixtures) + component (React, jsdom)          | change opened | context/changes/testing-generate-save-failures/ |
| 2   | Guardrails on a real database                    | Prove grading, saving and isolation hold on a real local Postgres, not only on mocks; run locally, not in CI            | #2, #3, #4, #6          | integration (local Supabase) + pgTAP                             | not started   | —                                               |
| 3   | Deck management and privacy                      | Prove deck edits and deletes match the database after errors and pasted text leaks nowhere                              | #5, #7                  | component (reuse Phase 1 pattern) + unit                         | not started   | —                                               |
| 4   | Critical-path smoke and generation-quality check | Prove the paste → save → review loop works in a browser, and a prompt or model change does not lower card quality       | #1, #2, #3 (end to end) | e2e (one flow, local) + AI-native LLM-as-judge on a fixed corpus | not started   | —                                               |

Ordering: Phase 1 first because #1 is the only High × High risk and runs
in Vitest without a database. Phase 2 answers interview Q4 (mocked
database) and roadmap Q-6 (guardrail checks). Phase 4 keeps the most
expensive layers last and minimal (interview Q5).

## 4. Stack

| Layer                            | Tool                                                        | Version          | Notes                                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                             | Vitest                                                      | ^5.0.2           | Plain config, not Astro's; anything importing `astro:*` is mocked                                                                                                                               |
| component                        | none yet — see Phase 1                                      | —                | Candidate: Testing Library + jsdom under Vitest                                                                                                                                                 |
| integration (database)           | Supabase CLI local stack + pgTAP                            | supabase ^2.23.4 | 4 suites exist; local only by owner decision (2026-10-26)                                                                                                                                       |
| integration (service on real DB) | none yet — see Phase 2                                      | —                | Real local Postgres, no mocked client                                                                                                                                                           |
| e2e                              | none yet — see Phase 4                                      | —                | Candidate: Playwright, one flow, local stack                                                                                                                                                    |
| AI-native: generation quality    | LLM-as-judge over a fixed text corpus — checked: 2026-10-26 | n/a              | Run only when the prompt, model list or output schema changes. **When NOT to use:** on every commit, or to check response shape — Zod and Phase 1 fixtures already catch that deterministically |

**Stack grounding tools (current session):**

- Docs: Context7 — available; not queried at plan time, versions taken from `package.json`; per-phase research should use it for Testing Library, Playwright and Supabase CLI setup; checked: 2026-10-26
- Search: Exa — available; not used; checked: 2026-10-26
- Runtime/browser: none — no Playwright MCP in this session; checked: 2026-10-26
- Provider/platform: GitHub (`gh`) and Linear MCP — CI status checks only; no Supabase or Cloudflare MCP; checked: 2026-10-26

## 5. Quality Gates

| Gate                         | Where                                                                                    | Required?                                      | Catches                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| lint (type-aware ESLint)     | local (lint-staged) + CI                                                                 | required (wired)                               | syntactic / type drift                                    |
| unit                         | local + CI (`npm test`)                                                                  | required (wired)                               | logic and error-vocabulary regressions                    |
| component tests              | local + CI (`npm test`)                                                                  | required after §3 Phase 1                      | broken screen state after errors                          |
| database integration + pgTAP | local, before merging any change that touches migrations, database functions or services | required after §3 Phase 2 — local only, not CI | isolation, atomic save, persisted grades on real Postgres |
| e2e critical flow            | local, before merging changes to generate, save or review                                | required after §3 Phase 4                      | broken paste → save → review wiring                       |
| generation-quality check     | local, on prompt / model / schema change                                                 | required after §3 Phase 4                      | drop in card quality                                      |
| production smoke             | manual, after merge (Workers Builds deploys)                                             | existing practice                              | environment-specific failures                             |

Residual risk accepted: database and e2e gates are not enforced by CI, so
a skipped local run is invisible. Revisit if a regression of #2–#4 reaches
production.

## 6. Cookbook Patterns

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (bad-response fixtures at the AI provider boundary). Existing tests under `src/lib/**/*.test.ts` remain the interim reference.

### 6.2 Adding a component test

- TBD — see §3 Phase 1 for the generate/save failure-state pattern (text preserved, action re-enabled, no double submit).

### 6.3 Adding a database integration test

- TBD — see §3 Phase 2 for the real-database pattern (persisted grade, atomic save, two-account isolation).

### 6.4 Adding a test for a new API endpoint

- TBD — see §3 Phase 2. Interim: route tests under `src/pages/api/**` cover branch order and the error vocabulary; a new table also needs a pgTAP isolation suite.

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4 (single paste → save → review flow).

### 6.6 Per-rollout-phase notes

(Appended after each phase lands.)

## 7. What We Deliberately Don't Test

- **Look and feel** — no visual snapshots, pixel diffs or multimodal visual review. Re-evaluate if a layout regression reaches users. (Source: interview Q5.)
- **Configuration** — `astro.config`, `wrangler`, `tsconfig`, lint config. The build and deploy already fail loudly. (Source: interview Q5.)
- **Infrastructure beyond the minimum** — no new CI jobs, no CI database, no hosted test services. (Source: interview Q5.)
- **Third-party internals** — shadcn/ui primitives and the FSRS math; test our mapping to them, not them.
- **Static pages and non-goals** — home page, top bar, mobile, accessibility compliance (PRD Non-Goals), load testing.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-26
- Stack versions last verified: 2026-10-26
- AI-native tool references last verified: 2026-10-26

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
