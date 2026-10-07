# Review and Save Proposals (S-03) — Plan Brief

> Full plan: `context/changes/review-and-save-proposals/plan.md`
> Research: `context/changes/review-and-save-proposals/research.md`

## What & Why

S-02 shows AI-drafted flashcards but cannot keep any of them. S-03 lets the user:

- reject the bad proposals,
- fix the almost-good ones,
- save the rest into their deck in one deliberate click.

The same click records how many were kept as-is, kept after edits, or rejected, so the PRD's two "75%" success metrics become computable. This is the milestone's north star: it settles whether drafting from pasted text plus a human gate beats writing cards by hand.

## Starting Point

- The `/generate` island renders a read-only list of up to 20 `{front, back}` proposals: no ids, no save path, "Preview only".
- Cards can only be written one at a time through `POST /api/flashcards`.
- The database has one table, `flashcards`, with no notion of where a card came from, and no Postgres functions at all.

## Desired End State

- **Each proposal** can be rejected or restored, and edited or reverted. An "Edited" badge appears when its trimmed text really changed.
- **One always-enabled button**:
  - "Save N cards" saves the kept cards (tagged `ai` or `ai_edited`) and goes to `/deck`.
  - "Discard all" (at 0 kept) records an all-rejected generation and stays on `/generate` with the text intact.
- **Atomic, idempotent writes**: both paths write one `generations` count row together with the cards, all-or-nothing, and a retry never duplicates anything.
- **No silent loss**: Generate is locked and leaving the page warns while a decision is pending.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Record rejections | `generations` table, counts only | Makes "75% accepted unedited" computable without storing text | Owner (#2) |
| Edited proposals | `flashcards.source` = `manual`/`ai`/`ai_edited` | Edited cards still count as AI deck share, not as clean acceptance | Owner (#3) |
| Who writes `generations` | The save call, not the generate call | Keeps S-02 DB-free; abandoned generations leave no row | Owner |
| Zero kept cards | Allowed; button becomes "Discard all", same endpoint | All-rejected generations are AI failures the metric must see | Owner |
| "Edited" means | Trimmed text differs from the original at save time | Measures real content change, not keystrokes | Plan |
| Double submit / lost response | Client-minted `generation_id` as the primary key, `on conflict do nothing` | Retry is safe; no duplicate cards or counts | Plan |
| After success | Save → `/deck`; Discard → reset on `/generate` | Each path ends where the user wants to be next | Plan |
| Re-generate while pending | Blocked until Save/Discard | Every shown generation lands in the metrics; no lost edits | Plan |
| "Generated" means | Proposals shown to the user | The metric is about what a human judged; S-02 is unchanged | Plan |
| Leaving with a pending list | Native `beforeunload` prompt | Cheap protection for edits and metrics | Plan |
| Atomicity mechanism | One `security invoker` Postgres function via `rpc()` | PostgREST runs an RPC in one transaction; RLS still applies | Research (Context7) |
| `generations` mutability | Owner can select and insert; update and delete are denied | Counts are records, not user data to edit | Plan |

## Scope

**In scope:**
- Migration: `flashcards.source`, `generations`, `save_generation`, privileges.
- pgTAP suite for the new objects.
- `POST /api/generations` with validation and per-card errors.
- Review UI: the list, the dynamic button, the generate lock, the unload guard.
- Production migration and smoke check.

**Out of scope:**
- Any change to `/api/proposals`, and a `dropped_count`.
- A metrics dashboard.
- Editing or deleting saved cards (S-04).
- Card order within a batch.
- Component-test infrastructure.
- Server-side proof of edits.

## Architecture / Approach

```
island (review state, generation_id)
  → POST /api/generations   (auth → bounded body → zod → service)
  → supabase.rpc("save_generation")   (request-scoped client, RLS on)
  → one transaction: claim generations row by id → insert cards with source
```

On a replay, the function finds the claimed id and returns the first result without writing anything.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Database (local) | Schema + function + privileges, proven by pgTAP; types | First RPC in the repo: EXECUTE grants and RLS inside the function |
| 2. Backend | `POST /api/generations`, shared `readBody`, schema, `proposalSource`, dotted field errors | Per-card error mapping; branch order and no-leak logging |
| 3. UI | Review list, Save/Discard, lock, unload guard | Many local states (reject, edit, errors, pending) in one island with no component tests |
| 4. Release | PR, production migration with go-ahead, merge, smoke check | Merging before the migration would break saves in production |

**Prerequisites:** S-01 and S-02 done (yes), local Supabase via Docker, two local test accounts, and the `.dev.vars` swap to the local stack for manual tests.
**Estimated effort:** about 3–4 evening sessions, one per phase. Phase 3 is the largest.

## Open Risks & Assumptions

- **Client-asserted counts.** `generated_count` and `ai`/`ai_edited` come from the browser. The DB enforces their consistency, not their truth. This is acceptable for self-reported metrics.
- **`on conflict do nothing` under RLS** is expected to need only the insert policy. The pgTAP replay and cross-account tests prove it before any code depends on it.
- **The previews share production Supabase**, so they cannot exercise saving until Phase 4's push. Manual testing happens on the local stack.

## Success Criteria (Summary)

- From pasted text to a reviewed, saved deck in one flow; saved cards appear on `/deck` with the correct origin.
- Every reviewed generation (saved or discarded) leaves exactly one correct count row, and retries never duplicate.
- Another account or an anonymous caller can neither see nor write anyone's generations.
