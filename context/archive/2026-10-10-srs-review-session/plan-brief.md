# S-05 Review Session (FSRS) — Plan Brief

> Full plan: `context/changes/srs-review-session/plan.md`
> Research: `context/changes/srs-review-session/research.md`

## What & Why

The user can start a review session on their deck, grade each card, and have the schedule and the progress remembered, including across logout and devices (US-02, FR-012). The PRD makes two absolute promises: a grade is saved before the next card appears, and a session never shows a deleted card or another user's card. This plan delivers both, with automated proof where the repo can give it.

## Starting Point

`flashcards` holds no scheduling state, because every earlier slice deferred it here. The repo already has an atomic, idempotent RPC pattern (`save_generation`), an append-only owner table pattern (`generations`), a pessimistic UI style and Vitest/pgTAP harnesses. There is no GET API route yet.

## Desired End State

`/review` (protected, linked from the Topbar) shows one card at a time: front, then "Show answer", then Again / Hard / Good / Easy. Each grade is persisted before the next card loads. A missed card comes back in the same session. After 20 cards the user can stop or continue. Empty deck and "nothing due today" have clear states. Progress shows up on any device.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Algorithm / library | FSRS via `ts-fsrs` (defaults) | Off-the-shelf, beats SM-2 on prediction, zero deps, statically workerd-clean | Research |
| Where state lives | 9 columns on `flashcards` with "new, due now" defaults | No join, no backfill logic; owner self-write is the accepted `source` precedent | Plan |
| "Due today" | Before the browser's local midnight (learning cards use exact time) | "Today's cards" means what the user expects; avoids the morning "nothing due" trap | Plan |
| Session size | Batches of 20 distinct cards + "Continue" | Short, finishable sessions without daily-limit bookkeeping | Plan |
| Again / Hard | Short-term steps on; returns in-session, 20-min learn-ahead when nothing else is due | Missed cards get re-drilled before the session ends | Plan |
| Queue model | Fetch-next: each grade response carries the next card | A card deleted elsewhere is never presented | Plan |
| Log on card delete | `on delete cascade` | No orphans; consistent with "deleted without a trace"; S-06 stays simple | Plan |
| Edit vs history (OQ4) | Keep the schedule and the log | Typo fixes must not erase weeks of learning | Plan |
| Two tabs, same card | Last write wins (both grades logged) | Rare and benign; no new error code | Plan |
| Write atomicity | `record_review` RPC, client-minted `review_id`, replay = no-op | Retries are always safe, so progress is never double-counted or lost | Research |

## Scope

**In scope:**

- migration (FSRS columns, `review_logs`, `record_review`, `next_review_card`) + pgTAP tests;
- `ts-fsrs`, `src/lib/srs.ts`, `reviews` service, `GET /api/reviews/next`, `POST /api/reviews`, with Vitest tests;
- `/review` page + `ReviewSession` island, Topbar and dashboard links, protected route;
- release with the production migration, preview workerd check, smoke test.

**Out of scope:**

- the FSRS optimiser and custom parameters;
- a daily new-card limit and a rollover hour;
- optimistic concurrency and a `conflict` code;
- resetting the schedule on edit;
- interval previews on the buttons, keyboard shortcuts;
- statistics, undo, a persisted session entity.

## Architecture / Approach

```
review.astro (SSR: card count only)
  └─ ReviewSession island ──GET /api/reviews/next?day_end──▶ next_review_card() ─┐
        │                                                                          │ RLS
        └──POST /api/reviews {review_id, flashcard_id, rating}                     ▼
              → read card FSRS state → ts-fsrs (Worker) → record_review()     flashcards
                (log insert ON CONFLICT DO NOTHING + card update, one tx)      review_logs
              → next_review_card() → { next, due_count }
```

The schedule is computed in the Worker. The write and the card choice happen in Postgres, under the caller's RLS.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data layer (local) | Migration, pgTAP proof of isolation, replay, cascade and tiers; types | FK checks bypass RLS: the insert policy must check card ownership |
| 2. Scheduling and API | `ts-fsrs` wrapper, service, two routes, Vitest | Row ↔ FSRS mapping errors (state enum, deprecated `elapsed_days`) |
| 3. Review UI | `/review` session with retry, batch, empty states, a11y | Learning cards wrongly falling under the day cutoff |
| 4. Release | Prod migration → preview workerd check → merge → smoke | `ts-fsrs` failing on real workerd (fallback: SM-2, no dependency) |

**Prerequisites:** local Supabase stack running (Docker); `.dev.vars` swapped to local for manual tests; owner available for the `db push` go-ahead.
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- `ts-fsrs` is only statically verified for workerd. If the preview shows `[unenv]` errors, the fallback is an SM-2 implementation, which needs a replan of `srs.ts` and the columns.
- Scheduling values are self-reported: the owner can write their own FSRS columns via PostgREST. This is accepted, as for `source`; it affects own data only.
- `day_end` is trusted from the client within `(now, now+48h]`. A wrong clock only shifts the user's own queue.
- pgTAP (the tier logic and the isolation proofs) runs locally, not in CI.

## Success Criteria (Summary)

- A user grades cards, reloads or switches device, and continues exactly where the schedule says, with no grade lost or duplicated.
- No deleted card and no other user's card ever appears in a session. pgTAP proves it at the DB layer, and a manual two-tab and two-account run confirms it.
- `ts-fsrs` runs on the deployed Worker with no runtime errors.
