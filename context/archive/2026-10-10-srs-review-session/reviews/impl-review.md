<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-05 Review Session (FSRS)

- **Plan**: context/changes/srs-review-session/plan.md
- **Scope**: Full plan (Phases 1–4 of 4), range `f1da1d8..e388b45`
- **Date**: 2026-10-11
- **Verdict**: NEEDS ATTENTION. The only defect is in the tests; the rest are observations. All of it is outside the shipped runtime.
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Checks re-run 2026-10-11:
- **pgTAP:** `npx supabase test db` → **FAIL, 133/134** (see F1).
- **Lint:** `npm run lint` is clean.
- **Unit tests:** `npm test` passes 292/292.
- **Build:** `npm run build` passes.
- **Types:** `npm run db:types` produces no diff.
- **Phase 4 production checks** (dry run, `db diff --linked`, `db dump --linked`) passed earlier on 2026-10-11 and were not re-run, to avoid extra production connections.

Confirmed end to end: every Desired End State bullet is delivered. In particular:
- the `next_review_card` shape matches across the SQL, the service's zod schema, the DTO types, `isNextReviewResponse` and the island;
- `scheduleReview` returns exactly the keys `record_review` requires;
- one server clock serves each request;
- `ts-fsrs` is server-only (the client `ReviewSession` chunk is 6.2 KB with no FSRS code);
- cross-user isolation holds in both functions;
- the hard rules are met: `prerender`, `apiError`, snake_case, `{code, message}` logs.

## Findings

### F1 — pgTAP cascade check counts every review_logs row in the database

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/review_logs_rls.test.sql:583-587
- **Detail**:
  - The assertion "refused calls by B and anon wrote no log rows" runs as `postgres` after `reset role;`, so RLS does not apply. It runs `select count(*) from public.review_logs` and expects `1`.
  - On a local stack holding any other data, the test fails. Today: `have: 96, want: 1`, because the Phase 3 manual tests left 95 rows.
  - The suite passed in Phase 1 only because the database was empty.
  - CI does not run pgTAP, so the failure stays hidden until someone runs it locally.
  - The other unscoped counts in the suite run under a test user's role, where RLS limits them to fixtures created inside the test transaction. They are not affected.
- **Fix**: Scope the count to the test's own users, e.g. `where user_id in (<A>, <B>)` using the ids the file already creates, so the result depends only on fixtures.
- **Decision**: FIXED — count limited to the file's users A and B; `npx supabase test db` PASS 134/134 on a stack with 95 foreign rows

### F2 — Plan text contradicts itself on Retry and undersells the batch end

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/srs-review-session/plan.md:109; Desired End State; Phase 3 manual list
- **Detail**:
  - Line 109 (Phase 2 addendum) says "The island recomputes `day_end` and retries", which reads as automatic. The Phase 3 addendum says "The retry is manual", and the code agrees with it.
  - "After 20 distinct cards the session offers Done" leaves out that under `learning_only` the cards just graded into learning keep coming through tier 4 (learn ahead, ≤ 20 min) until they graduate. "Done" appears only after that.
  - The code matches the SQL and the batch contract. Only the wording is off; this is what tripped the 2026-10-11 re-test.
- **Fix**: Reword line 109 to "the user retries with the same `review_id`", and add one sentence on learn-ahead before "Done" to the Phase 3 addendum.
- **Decision**: FIXED — plan.md: Phase 2 addendum now says the user retries manually; Phase 3 addendum gained a "Batch end" bullet on learn-ahead before Done

### F3 — New cards from one AI generation are queued in random order

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010142352_srs_review_session.sql (tier-3 `order by`); 20261006211722_review_and_save_proposals.sql:165
- **Detail**:
  - `save_generation` inserts the whole batch in one statement, so every card gets the same `created_at`. `now()` returns the transaction start time.
  - Tier 3 orders by `created_at, id`, and `id` is `gen_random_uuid()`. The generated order is therefore lost within a batch.
  - The pgTAP fixtures use distinct timestamps, so no test sees this.
- **Fix**: Queue a follow-up: a stable per-row tiebreaker (an ordinal or `clock_timestamp()` at insert) in a later change. Nothing to do in S-05.
- **Decision**: FIXED (queued) — follow-up added to follow-ups/review-fixes.md

### F4 — Island comment "nothing was saved" is wrong for one replay path

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/review/ReviewSession.tsx (the `not_found` branch of `grade()`)
- **Detail**:
  1. A grade is saved, but the next-card lookup fails (500, network or stale `day_end`).
  2. The card is then deleted in another tab. The cascade removes the saved log row.
  3. Retry → `not_found`.

  The comment says nothing was saved. In fact the grade was saved and then removed together with the card. The card is also not added to `gradedRef`, so the batch counter is off by one. No harm to data.
- **Fix**: Reword the comment to "deleted in another tab (any saved grade went with it) or never ours: skip it".
- **Decision**: FIXED — comment reworded (cascade path named); the off-by-one in the batch counter on that path is accepted

### F5 — Scaling gaps: tier query does not range-scan, review_logs has no quota

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010142352_srs_review_session.sql:37, :248-285; src/pages/api/reviews/index.ts
- **Detail**:
  - **The index helps only with `user_id`.** Neither query in `next_review_card` has a plain predicate on `due`: they filter on a CASE and on an OR. `flashcards_user_id_due_idx` therefore serves only the RLS filter on `user_id`, and each call scans the user's whole deck twice. That is fine at MVP deck sizes. This was reasoned from the SQL; `EXPLAIN` was not run.
  - **Nothing caps a user's own `review_logs`.** Any signed-in user can append rows without limit, through the API or a direct insert. The growth stays within their own data.
- **Fix**: Queue a follow-up:
  - add the redundant bound `and f.due < greatest(p_day_end, p_now + interval '20 minutes')` when decks grow;
  - add log quotas in a future rate-limit slice.
- **Decision**: FIXED (queued) — follow-up added to follow-ups/review-fixes.md

### F6 — Accepted SQL edge cases: review-id existence oracle, rare deadlock

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261010142352_srs_review_session.sql (`record_review`)
- **Detail**:
  - **Existence oracle.** A replay with a review id that is held by another account raises `22023 'review id unavailable'`. The caller learns that the UUID exists somewhere. No owner and no data are revealed, and the ids are random browser-minted UUIDs that are never shared, so this is practically unexploitable.
  - **Rare deadlock.** `record_review` locks the card, then the log, then `auth.users` (FK key-share). Deleting an account takes the opposite order. If the two overlap, Postgres aborts one of them: either a retryable 500 or a retried deletion.
  - Every other lock ordering checked (two tabs grading, delete during a grade, PATCH during a grade) is consistent.
- **Fix**: Accept both. Mention the deadlock if account deletion is ever implemented.
- **Decision**: ACCEPTED — owner accepts both: the existence oracle is practically unexploitable (random, unshared UUIDs), and the deadlock is detected by Postgres and retryable
