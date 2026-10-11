# Review follow-ups — srs-review-session

Items accepted during implementation review that belong outside this slice.

## Extract a shared `logFailure` helper (from impl-review-phase-2, F4)

- **Why:** the privacy rule "API routes log only `{code, message}`, never a PostgrestError's `details` (which can quote card text)" is hand-written in five places. A future copy that logs the whole error would leak card text to the Worker logs.
- **Where:** `src/pages/api/flashcards/[id].ts` (function), `src/pages/api/reviews/index.ts` (function), inline in `src/pages/api/flashcards/index.ts`, `src/pages/api/generations/index.ts`, `src/pages/api/reviews/next.ts`.
- **What:** one `src/lib/log-failure.ts` exporting `logFailure(operation, error)`, used by every route; one unit test that a `details` field never reaches `console.error`.
- **Scope:** a separate refactor change, because it touches S-01..S-04 routes; behaviour stays identical, and the existing route tests that assert `{code, message}` keep passing.

## Keep the generation order of AI cards in the review queue (from impl-review full, F3)

- **Why:** `save_generation` inserts a whole batch in one statement, so every card gets the same `created_at` (`now()` is the transaction start). Tier 3 of `next_review_card` orders new cards by `created_at, id`, and `id` is `gen_random_uuid()`, so within one generation the cards come up in random order instead of the order the AI produced them.
- **Where:** `supabase/migrations/20261006211722_review_and_save_proposals.sql` (`save_generation` insert); `supabase/migrations/20261010142352_srs_review_session.sql` (tier-3 `order by`).
- **What:** a stable per-row tiebreaker set at insert. Candidates: an ordinal from `with ordinality` in `save_generation`, or `clock_timestamp()` as the column default. Tier 3 should then sort by it after `created_at`. Add a pgTAP case with a shared `created_at`.
- **Scope:** a separate change with its own forward migration. S-05 behaviour is correct, only the order inside one generation is lost.

## Scale the review queue and cap review_logs growth (from impl-review full, F5)

- **Why:** both queries in `next_review_card` filter through a `CASE` (tiers) and an `OR` (`due_count`), with no plain predicate on `due`. `flashcards_user_id_due_idx` therefore serves only the RLS `user_id` filter, and every call scans the user's whole deck twice. This was reasoned from the SQL; `EXPLAIN` was not run. Separately, a signed-in user can append `review_logs` rows without limit, through the API or a direct insert. The growth stays within their own data.
- **Where:** `supabase/migrations/20261010142352_srs_review_session.sql` (`next_review_card`); `src/pages/api/reviews/index.ts`.
- **What:**
  - When decks grow, add a redundant bound `and f.due < greatest(p_day_end, p_now + interval '20 minutes')` to both queries, so they become an index range scan. Confirm with `EXPLAIN ANALYZE` on a large seeded deck.
  - Add per-user write quotas in a future rate-limit slice.
- **Scope:** not needed at MVP deck sizes; revisit with real usage data.
