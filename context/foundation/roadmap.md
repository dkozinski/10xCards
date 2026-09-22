---
project: "10xCards"
version: 1
status: draft
created: 2026-09-17
updated: 2026-09-22
prd_version: 1
main_goal: low-complexity
top_blocker: skills
milestone_id: mvp-paste-to-review-loop
milestone_seq: 1
milestone_status: open
---

# Roadmap: 10xCards

> Derived from `context/foundation/prd.md` (v1) + `context/foundation/tech-stack.md` + an auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: Paste-to-review loop** — Status: open

- **Intent:** Prove the whole loop the product is built around — a user pastes text, gets AI-drafted flashcards, keeps the ones worth keeping, and reviews them on a schedule — on a deck that only its owner can read.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001 through FR-012 (all twelve are `must-have`), US-01, US-02, and the seven Non-Functional Requirements. Nothing in the PRD is out of this milestone's scope; the `## Parked` section below holds only what the PRD itself declares a Non-Goal.
- **Working constraint (context, not schedule):** solo, after-hours, roughly two hours a day, on a web stack the author is learning as they go. This is why slices are cut small and why unfamiliar technology is introduced one piece at a time — it is not a delivery estimate.

## Vision recap

Professionals preparing for certifications know spaced repetition works, but writing flashcards by hand costs more evening energy than they have, so they never start. The bottleneck is not the review algorithm — it is the path from raw text to a finished deck. 10xCards removes that path: paste text, get drafted cards, keep the good ones, start reviewing.

The product wedge — the one trait that, if removed, makes this indistinguishable from a generic AI chat tool — is that cards are both drafted from the learner's own pasted text **and** gated by a human before anything lands in the deck. Neither half is optional: drafting alone is a chatbot, gating alone is Anki.

## North star

**S-03: The user reviews AI proposals — rejecting and editing freely — and saves the rest into their deck** — this is the slice that turns a generated list into a deck the learner actually owns, so it is the one that settles the central bet rather than a piece of it.

> The central bet of this product, stated plainly: that drafting cards from pasted text and then letting a human throw out the bad ones is faster and less tiring than writing cards by hand. Everything else in the roadmap is only worth building if that holds.
>
> "North star" here means the smallest end-to-end flow whose successful delivery would settle that bet — placed as early as its prerequisites allow, because every other slice depends on the answer. The riskiest assumption (the single belief most likely to be wrong, and most expensive to be wrong about) is not in S-03 but in its prerequisite S-02: that a long-running AI request can return genuinely good flashcards on this runtime at all. S-02 is therefore sequenced to start as early as possible, in parallel with the deck work, so that a wrong answer surfaces while there is still room to respond to it.

## At a glance

| ID    | Change ID                  | Outcome (user can …)                                             | Prerequisites | PRD refs                                                              | Status   |
| ----- | -------------------------- | ---------------------------------------------------------------- | ------------- | --------------------------------------------------------------------- | -------- |
| F-01  | deck-data-contract         | (foundation) a per-user flashcard store exists and is owner-only  | —             | § Access Control, NFR data isolation, NFR durability; enables FR-008–FR-011 | in-progress |
| S-01  | manual-card-and-deck       | write a flashcard by hand and see it in their own deck            | F-01          | FR-008, FR-009, NFR durability, NFR data isolation                    | proposed |
| S-02  | ai-proposals-from-text     | paste text and see AI-drafted flashcard proposals on screen       | —             | US-01, FR-004, NFR responsiveness, NFR no source-text persistence     | ready    |
| S-03  | review-and-save-proposals  | reject and edit proposals, then save the rest into their deck     | S-01, S-02    | US-01, FR-005, FR-006, FR-007, NFR consent before save                | blocked  |
| S-04  | edit-and-delete-cards      | edit and delete a card already saved in their deck                | S-01          | FR-010, FR-011                                                        | proposed |
| S-05  | srs-review-session         | run a review session that schedules and remembers their progress  | S-01          | US-02, FR-012, NFR session reliability, NFR durability                | proposed |
| S-06  | account-and-data-deletion  | delete their account together with every trace of their data      | S-01, S-05    | FR-003, FR-001, FR-002                                                | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                    | Chain                        | Note                                                                                 |
| ------ | ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| A      | Deck and data ownership  | `F-01` → `S-01` → `S-04`     | The low-complexity spine: smallest end-to-end path through an unfamiliar stack first. |
| B      | AI drafting              | `S-02` → `S-03`              | `S-02` needs nothing and can start immediately; `S-03` joins Stream A at `S-01`.      |
| C      | Review loop and closure  | `S-05` → `S-06`              | Joins Stream A at `S-01`; `S-06` waits for `S-05` so "all data" includes review state. |

## Baseline

What's already in place in the codebase as of `2026-09-17` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6 + React 19 islands + Tailwind 4; shadcn/ui configured (`components.json`) but only `src/components/ui/button.tsx` exists. Pages: `index`, `dashboard`, `auth/{signin,signup,confirm-email}`. No flashcard UI of any kind.
- **Backend / API:** partial — Astro SSR (`output: "server"`, Cloudflare adapter) with three auth routes under `src/pages/api/auth/`. No flashcard or generation endpoints. **AI/LLM integration: absent** — no OpenRouter/OpenAI/Anthropic reference anywhere in `src/` or `package.json`.
- **Data:** absent — `supabase/migrations/` holds no SQL, there are no generated database types, and `src/types.ts` does not exist. Supabase is wired for authentication only.
- **Auth:** present for the MVP's entry path — Supabase SSR cookie sessions (`src/lib/supabase.ts`), `src/middleware.ts` resolving the user and guarding `["/dashboard"]`. Registration (FR-001) and login (FR-002) are **already satisfied** and are not re-built by any slice. Account deletion (FR-003) is absent and is covered by S-06.
- **Deploy / infra:** present — Cloudflare Workers (worker `10xcards`), GitHub Actions running lint + build on `main`, deploys through Cloudflare Workers Builds, with a `deploy:preview` → `deploy:promote` version flow. No separate staging environment; none is required by the PRD.
- **Observability:** partial — Cloudflare's built-in observability is enabled in `wrangler.jsonc`. No error tracking, no logging helper, no health endpoint, and **no test framework or test files at all**.

## Foundations

### F-01: Deck data contract

- **Outcome:** (foundation) a flashcard store exists that belongs to exactly one account, with per-operation access rules and typed shapes the rest of the app can build on — no user-visible change.
- **Change ID:** deck-data-contract
- **PRD refs:** § Access Control, NFR data isolation, NFR durability; enables FR-008–FR-011
- **Unlocks:** S-01, S-03, S-04, S-05, S-06. Also establishes the verification path for the data-isolation NFR: after this lands, "a second account cannot read the first account's cards" is a claim that can actually be checked, which no later slice can honestly assert without it.
- **Prerequisites:** —
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Deliberately scoped to the deck itself — one owned store, its access rules, and its types. Scheduling state arrives in S-05 and generation bookkeeping (if any) in S-03, so neither is pre-built here. Sequenced first because every deck slice reads and writes through it and because retrofitting per-operation access rules onto an existing store is far more error-prone than writing them once, up front. The named risk is the opposite failure: letting this grow into "the data layer" — if its outcome stops being checkable by one two-account read test, it has overrun.
- **Status:** in-progress

## Slices

### S-01: Write a flashcard by hand

- **Outcome:** The user can write a flashcard themselves and see it in their own deck, which survives logging out and coming back on another machine.
- **Change ID:** manual-card-and-deck
- **PRD refs:** FR-008, FR-009, NFR durability, NFR data isolation
- **Prerequisites:** F-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the smallest slice that crosses every layer at once — store, access rules, server route, and screen — which is exactly why it goes first under a low-complexity goal: it teaches the whole stack on material that carries no product risk. Sequenced before the AI work so that when generated proposals arrive in S-03 there is already a proven place to put them. The risk of skipping it is that the first write to the database happens inside the hardest slice, where a data-ownership bug would be indistinguishable from a generation bug. PRD § Non-Goals excludes search and filtering, so browsing is a plain list.
- **Status:** proposed

### S-02: See AI proposals drafted from pasted text

- **Outcome:** The user can paste source text, ask for flashcards, watch visible progress while the request runs, and see the drafted proposals on screen.
- **Change ID:** ai-proposals-from-text
- **PRD refs:** US-01, FR-004, NFR responsiveness, NFR no source-text persistence
- **Prerequisites:** —
- **Parallel with:** F-01, S-01
- **Blockers:** —
- **Unknowns:**
  - Is there an upper character limit on pasted text, and what happens above it? (PRD Open Question 1) — Owner: user. Block: no.
- **Risk:** This slice carries the milestone's real technical risk and has no prerequisites, so it can start on day one alongside the deck work — deliberately not deferred to the end, where discovering that a ~20-second request cannot be held open on this runtime would be unrecoverable. `tech-stack.md` already flags the shape of the problem. Nothing is written to the deck here, so the PRD's consent guardrail is untouched and the "no persistence of source text" requirement is easiest to honour while there is no store to leak into. The cost of stopping at proposals-on-screen is that the slice is not yet useful on its own; the gain is that generation quality becomes observable before any save path depends on it.
- **Status:** ready

### S-03: Review proposals and save the keepers

- **Outcome:** The user can scan the proposals, reject the bad ones, edit the almost-good ones, and save the rest into their deck in one deliberate action.
- **Change ID:** review-and-save-proposals
- **PRD refs:** US-01, FR-005, FR-006, FR-007, NFR consent before save
- **Prerequisites:** S-01, S-02
- **Parallel with:** S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Is the fact that a proposal was rejected recorded anywhere, in aggregate, so the PRD's "75% accepted without modification" criterion can actually be computed — given that rejected proposals never reach the deck? (PRD Open Question 2) — Owner: user. Block: yes.
  - Does a proposal that was edited and then saved still count toward "75% of the deck created with AI", and where is the line between AI-assisted and manual? (PRD Open Question 3) — Owner: user. Block: yes.
- **Risk:** Blocked on purpose. Both unknowns decide whether this slice writes one thing (the kept cards) or two (the kept cards plus a record of what was discarded), and that is a different shape of work, not a detail to settle mid-implementation. Answering them costs the owner minutes; discovering them after the slice is built costs a rewrite of its write path. The PRD's own success criteria cannot be evaluated at all if the answer is "nothing is recorded", so this is a product decision, not a technical one. Sequenced after S-01 and S-02 because it is the join point of both — it needs somewhere to save and something to save.
- **Status:** blocked

### S-04: Edit and delete saved cards

- **Outcome:** The user can correct the wording of a card already in their deck, or remove it for good.
- **Change ID:** edit-and-delete-cards
- **PRD refs:** FR-010, FR-011
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-05
- **Blockers:** —
- **Unknowns:**
  - When a saved card's text is edited, is its grade history kept or reset? (PRD Open Question 4) — Owner: downstream decision, tied to the scheduling algorithm chosen in S-05. Block: no.
- **Risk:** Small and self-contained, which is why it sits here rather than competing with S-03 for attention. The open question does not block it: until S-05 lands there is no grade history to preserve or reset, so this slice can ship its edit path and the question resurfaces — with an answer available — inside S-05. Deleting a card that a later review session might hold a reference to is the one place this slice touches the reliability guardrail, and it is the reason deletion is specified here rather than assumed.
- **Status:** proposed

### S-05: Run a review session

- **Outcome:** The user can start a session on their deck, grade each card, and have both the schedule and the progress remembered — including after logging out or switching machines.
- **Change ID:** srs-review-session
- **PRD refs:** US-02, FR-012, NFR session reliability, NFR durability
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:**
  - Which off-the-shelf scheduling algorithm, and what per-card state does it require the deck to carry? — Owner: downstream decision at plan time. Block: no.
  - Resolves PRD Open Question 4 (edit versus grade history) as a side effect of the algorithm choice — Owner: downstream. Block: no.
- **Risk:** The PRD makes two absolute promises about this slice — progress is never lost and a card belonging to someone else, or already deleted, is never shown — and the repository currently has no automated way to demonstrate either. That gap is the sharpest risk in the milestone, and it is why the deck's access rules are settled back in F-01 rather than here. This slice also extends the deck's shape with scheduling state, which is deliberate: that state is introduced at the moment something finally uses it, not earlier. A custom algorithm is explicitly a Non-Goal.
- **Status:** proposed

### S-06: Delete the account and everything in it

- **Outcome:** The user can delete their account and, with it, every flashcard, every pasted text, and the whole review history — irreversibly and verifiably.
- **Change ID:** account-and-data-deletion
- **PRD refs:** FR-003, FR-001, FR-002
- **Prerequisites:** S-01, S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - How is an irreversible deletion confirmed to the user? (PRD Open Question 5) — Owner: downstream decision. Block: no.
- **Risk:** FR-001 and FR-002 are listed above because this slice closes out the account lifecycle they open, **not** because registration or login get rebuilt — the `## Baseline` section records both as already working, and no slice in this milestone touches them. Sequenced last for a specific reason, not by neglect: FR-003 promises that *all* of the user's data goes, and review history only exists once S-05 has created it. Building deletion earlier would produce a promise that quietly stops being true the moment scheduling state is added. The PRD grounds this requirement in the user pasting employer material, so an incomplete deletion is a trust failure rather than a missing feature — which is also why it is a `must-have` despite sitting off the main learning path.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Issue | Change ID                  | Suggested issue title                                        | Ready for `/10x-plan` | Notes |
| ---------- | ----- | -------------------------- | ------------------------------------------------------------ | --------------------- | ----- |
| F-01       | #7    | `deck-data-contract`       | Establish the owner-scoped flashcard store and its types      | yes                   | Highest fan-out: unlocks five items |
| S-01       | #9    | `manual-card-and-deck`     | Write a flashcard by hand and see it in your deck             | no                    | Waits on F-01 |
| S-02       | #8    | `ai-proposals-from-text`   | Draft flashcard proposals from pasted text                    | yes                   | No prerequisites; can run in parallel with F-01 |
| S-03       | #10   | `review-and-save-proposals`| Reject, edit, and save AI proposals into the deck             | no                    | Blocked on PRD Open Questions 2 and 3 |
| S-04       | #11   | `edit-and-delete-cards`    | Edit and delete cards already saved in the deck               | no                    | Waits on S-01 |
| S-05       | #12   | `srs-review-session`       | Run a scheduled review session over the deck                  | no                    | Waits on S-01; picks the scheduling algorithm |
| S-06       | #13   | `account-and-data-deletion`| Delete the account and all of its data                        | no                    | Waits on S-01 and S-05 |

This table is the clean handoff to Jira/Linear or any MCP-backed backlog. It should be compact enough to copy into issues, but it must not duplicate the detailed roadmap body.

**Backlog:** migrated to GitHub Issues on 2026-09-19 — milestone `M-1: Paste-to-review loop` in `dkozinski/10xCards`. Open Roadmap Questions 1–6 are issues #1–#6 (`[Q-n]`); prerequisites are recorded as native "blocked by" links.

## Open Roadmap Questions

1. **Is there an upper character limit on pasted text submitted for generation, and what happens above it?** — Owner: user (PRD Open Question 1). Block: S-02, non-blocking — a default can be chosen at plan time.
2. **Is the fact of a rejection recorded in aggregate, so the "75% accepted without modification" criterion can be computed at all?** — Owner: user (PRD Open Question 2). Block: S-03, blocking.
3. **Does an edited-then-saved proposal still count toward "75% of the deck created with AI", and where is the threshold between AI-assisted and manual?** — Owner: user (PRD Open Question 3). Block: S-03, blocking.
4. **When a saved flashcard is edited, is its grade history preserved or reset?** — Owner: downstream, tied to the algorithm chosen in S-05 (PRD Open Question 4). Block: S-04 and S-05, non-blocking.
5. **How is the irreversible account deletion confirmed to the user?** — Owner: downstream (PRD Open Question 5). Block: S-06, non-blocking.
6. **Do the two guardrail promises get automated checks, and if so, starting where?** — Owner: user. Block: roadmap-wide, non-blocking. The PRD states two absolutes — no card reaches the deck without an explicit save, and a review session never loses progress or shows a card that is not the user's — while the repository has no test framework at all. Neither promise is realistically demonstrable by hand at S-05. This is recorded as a question rather than a foundation because introducing unfamiliar test tooling ahead of the first working slice cuts against this milestone's sequencing goal; the decision belongs to the owner, not to the roadmap.

## Parked

- **A custom, advanced spaced-repetition algorithm** — Why parked: PRD § Non-Goals; FR-012 commits to an off-the-shelf scheduler, and building an SRS is a separate project.
- **File import (PDF, DOCX, and similar)** — Why parked: PRD § Non-Goals; FR-004 takes pasted text only.
- **Sharing and team decks** — Why parked: PRD § Non-Goals; accounts are fully isolated, which also keeps multi-tenancy out of the data contract in F-01.
- **Integrations with external educational platforms** — Why parked: PRD § Non-Goals.
- **A native mobile app, and mobile responsiveness generally** — Why parked: PRD § Non-Goals; the browser coverage NFR targets desktop only.
- **Search and filtering inside the deck** — Why parked: PRD § Non-Goals; FR-009 is a plain list in the first version.
- **Full WCAG-AA accessibility compliance** — Why parked: PRD § Non-Goals; no formal accessibility goal for this milestone.
- **Password reset** — Why parked: absent from the baseline and absent from the PRD — no functional requirement asks for it. Recorded here so its absence is a decision on the record rather than an oversight; it is not a `must-have` and does not enter this milestone.

## Milestone History

(Append-only. Carried forward verbatim into each successor milestone's roadmap; empty on the very first milestone.)

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived.)
