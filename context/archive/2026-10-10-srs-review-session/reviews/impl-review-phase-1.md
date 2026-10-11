<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-05 Review Session (FSRS)

- **Plan**: context/changes/srs-review-session/plan.md
- **Scope**: Phase 1 of 4 (uncommitted working tree on `feat/srs-review-session`)
- **Date**: 2026-10-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Evidence Summary

- **Automated checks, re-run during this review — all pass:**
  - migration applied locally;
  - `npx supabase test db`: 125/125;
  - `npm run lint`: clean;
  - `npm test`: 166/166;
  - `npm run db:types`: regenerates to an identical diff.
- **Manual checks:** 1.5 (mutation check) was executed by the agent and the owner has not confirmed it yet; 1.6 (migration review) is pending.
- **Security sweep found no cross-user path:**
  - the FK bypass is closed by the `exists` clause, and the mutation check proves the test catches its removal;
  - `on conflict` against an invisible row results in `22023 review id unavailable`;
  - `for update` locks only the caller's own rows (SELECT + UPDATE RLS);
  - the cascades run as the table owner;
  - anon has no EXECUTE and no table privileges.
- **Plan drift:** every contract item matches, except the declared sequencing change in `record_review`. That change was necessary: under the plan's order the insert's RLS WITH CHECK runs before both ON CONFLICT and the FK, so a foreign or missing card would have raised `42501` instead of `P0002`.

## Findings

### F1 — A reused review id on a different card is reported as a successful replay

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010142352_srs_review_session.sql:186-193
- **Detail**:
  - The replay branch checks only that `p_review_id` exists. A call that reuses an own review id with a *different* `p_flashcard_id` returns `false`, and the route will answer 200 with the next card. The grade on the second card is silently dropped.
  - Only a client bug (the `review_id` not re-minted per card) can trigger this. But it fails silently, against the PRD promise "never loses progress".
- **Fix**: In the replay branch, read `flashcard_id` of the existing log row and raise `22023 'review id belongs to another card'` when it differs from `p_flashcard_id`. Add one pgTAP assertion for it.
- **Decision**: FIXED — replay branch compares flashcard_id and raises 22023 on mismatch; 2 pgTAP assertions added (plan 58); local function replaced via create or replace

### F2 — next_review_card silently degrades on null or inverted parameters

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010142352_srs_review_session.sql:229-266
- **Detail**:
  - A null `p_day_end` drops tiers 2 and 3 and undercounts `due_count`.
  - A null `p_now` drops tiers 1 and 4.
  - A null `p_learning_only` behaves like `true`.
  - `p_day_end <= p_now` hides overdue review cards.
  - In every case the result is a quietly wrong queue (e.g. "nothing to review" while cards are due) instead of an error. The planned route bounds `day_end`, but the function is also callable directly through PostgREST, and a route bug would show up only as a wrong screen.
- **Fix**: Convert to plpgsql (stable, invoker, `search_path = ''`) with a guard: any null parameter, or `p_day_end <= p_now`, raises `22023`. Add pgTAP assertions for null and inverted `p_day_end`.
- **Decision**: FIXED — plpgsql guard raises 22023 on null params or p_day_end <= p_now; 3 pgTAP assertions added (plan 61); local function replaced via create or replace

### F3 — Plan does not yet describe the implemented record_review contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/srs-review-session/plan.md (Critical Implementation Details → "State sequencing in record_review")
- **Detail**:
  - The plan still describes the order "insert log, then update, then P0002 if 0 rows". The implementation instead locks first (`for update`) and raises P0002 before the insert.
  - The plan also does not mention three error behaviours that Phase 2's service and route must map:
    - a review id held by another account raises `22023 review id unavailable`;
    - present-but-malformed values do not raise 22023: they raise `23502`, `22P02`, `22007` or `23514`;
    - NaN and Infinity pass the CHECKs.
  - Phase 2 will be implemented against the plan, so these gaps would carry into the error mapping.
- **Fix**: Add a dated addendum to "Critical Implementation Details" covering:
  - the lock-first order;
  - `P0002` → `not_found`;
  - all other SQLSTATEs → `server_error` (the payload is built by the Worker, so a bad value is our bug, not user input).
- **Decision**: FIXED — dated addendum added under Critical Implementation Details (lock-first order, 22023 cases, SQLSTATE mapping for Phase 2)

### F4 — Insert policy relies on an unqualified column in its subquery

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010142352_srs_review_session.sql:91
- **Detail**:
  - `f.id = flashcard_id` resolves to `review_logs.flashcard_id` only because `flashcards` has no column of that name.
  - If such a column were ever added, the ownership check would silently become `f.id = f.flashcard_id`.
  - The policy guards cross-user writes, so this reliance matters.
- **Fix**: Qualify it as `review_logs.flashcard_id`.
- **Decision**: FIXED — qualified as review_logs.flashcard_id; local policy altered. Note: Postgres binds the column at policy creation (the stored expression was already review_logs.flashcard_id), so the risk was limited to replaying the migration text on a changed schema

### F5 — pgTAP gaps: some orderings and negative paths are not distinguished

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/review_logs_rls.test.sql:25-28, 222-235, 314, 420, 517-541
- **Detail**:
  - **Tier 3:** the fixture new cards are older by both `created_at` and `due`. A bug ordering tier 3 by `due` would pass.
  - **Tier 4:** it only ever has one candidate.
  - **`due < p_day_end` on new cards:** no new card falls on or after `p_day_end`, so this bound is untested.
  - **Missing negative tests:**
    - an incomplete or non-object `p_log`;
    - a non-existent own card id (as opposed to a foreign one);
    - A's card re-read after B's refused call.
  - **Account-deletion test:** it cannot tell the direct `user_id` cascade from the cascade through the account's cards.
  - None of the existing assertions passes vacuously; these are gaps, not false positives.
- **Fix**: Adjust the fixtures and add the missing assertions:
  - a new card with a newer `created_at` but an older `due`;
  - a second learn-ahead candidate;
  - a new card due after `p_day_end`;
  - the missing negative paths listed above.
  - Bump `plan(n)` to match.
- **Decision**: FIXED — fixtures a2 (older due, newer created_at), a3 (new, due after day end), c0 (learn-ahead, lower id, later due); +4 assertions (non-object p_next, incomplete p_log, non-existent card → P0002, A's card unchanged after B's refused call); plan 65. Three rolled-back mutants (tier 3 by due, no day-end bound on new, tier 4 by id) each fail ≥1 assertion. Accepted gap: the account-deletion test still cannot separate the direct user_id cascade from the cascade through cards

### F6 — FlashcardDto, and so POST/PATCH /api/flashcards responses, now carry the FSRS fields

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/types.ts:6, src/lib/services/flashcards.ts:19, 37, 56
- **Detail**:
  - `FlashcardDto = Tables<"flashcards">`, and the create, update and list queries return whole rows.
  - As a result, the JSON of `POST /api/flashcards` and `PATCH /api/flashcards/[id]` now includes the nine scheduling fields.
  - It is the owner's own data, and `deck.astro:80` still passes only `{id, front, back}` into the island, so nothing new reaches the HTML. But the response contract widened without a decision, and the plan's "What We're NOT Doing" is silent on it.
- **Fix A ⭐ Recommended**: Accept, and record it in the plan addendum (F3).
  - Strength: matches the repo rule "DTOs are aliases over generated types, so they cannot drift from the schema" (`src/types.ts:3-4`); zero code change.
  - Tradeoff: API responses carry fields no client uses.
  - Confidence: HIGH — own data only; no consumer depends on the exact key set.
  - Blind spot: whether any existing Vitest test asserts the exact response keys (none failed).
- **Fix B**: Narrow `FlashcardDto` and the three selects to `id, user_id, front, back, created_at, source`.
  - Strength: response contracts stay exactly as they were before S-05.
  - Tradeoff: breaks the alias-over-generated-types convention, and every future column needs a manual decision.
  - Confidence: MED — touches S-01/S-04 code and tests outside this slice.
  - Blind spot: knock-on edits in the existing route tests.
- **Decision**: FIXED via Fix A — widening accepted and recorded in the plan addendum (Critical Implementation Details)

## Not raised as findings (noted)

- **Optimistic concurrency between two tabs:** read → compute → write is unprotected. This is the user's decision (last write wins), documented in the migration.
- **Redundant `flashcards_user_id_idx`:** it is now a prefix of `(user_id, due)`. Drop it in a later contract migration, not in this expand-only one.
- **`add column … default now()`:** it does not rewrite the table (stable fast default). Existing cards get the migration timestamp as `due`, which is harmless because tier 3 orders by `created_at`.
- **Explanatory comments from the generations template are missing:** the "executable by PUBLIC by default" note and the "`throws_ok` runs in a subtransaction" note. Cosmetic.
