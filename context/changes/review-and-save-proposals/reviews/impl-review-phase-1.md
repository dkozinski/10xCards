<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Review and Save Proposals (S-03)

- **Plan**: context/changes/review-and-save-proposals/plan.md
- **Scope**: Phase 1 of 4 (uncommitted working tree)
- **Date**: 2026-10-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence

- **Drift check**: every Phase 1 contract item MATCHes. There is no DRIFT and nothing is MISSING.
  - EXTRAs, all benign and stricter than the plan:
    - a null/non-array guard on `p_cards`;
    - a function comment;
    - `with check (false)` on the update denies;
    - 4 extra tests: non-array payload, owner update/delete → 42501, anon read → 42501.
- **Verified correct**:
  - **Function hardening**: `search_path = ''`, all relations schema-qualified, built-ins resolve to pg_catalog.
  - **Privileges**: the EXECUTE revoke also covers PUBLIC; `revoke all` removes the TRUNCATE/REFERENCES/TRIGGER defaults.
  - **Claim-then-insert**: `FOUND` semantics after `on conflict do nothing` behave as intended.
  - **Cross-user conflict**: silent (RLS checks the existing row only for DO UPDATE), and the read-back raises 22023.
  - **Concurrency**: under READ COMMITTED a duplicate becomes a replay; a rollback lets the second call insert.
  - **pgTAP count**: `plan(36)` is correct.
- **Automated**: `npx supabase test db` 57/57; `npm test` 112/112; lint ✓; build ✓; types contain `save_generation`.
- **Manual**: the owner confirmed 1.5 (8 policies, function `Security: Invoker`) and 1.6 (23502 on `user_id` without a session) with pasted Studio output.

## Findings

### F1 — `source` and the counts can be rewritten outside save_generation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261006211722_review_and_save_proposals.sql:13-15, 42 (with flashcards grants from 20260923181722)
- **Detail**: `authenticated` keeps table-wide UPDATE on `flashcards`, so an owner can PATCH `source` (e.g. `manual` → `ai`) directly through PostgREST. Two direct inserts also skip the function, and they must stay possible because the function is `security invoker`:
  - into `generations` with arbitrary counts;
  - into `flashcards` with `source = 'ai'`.

  This only skews the caller's own metrics, which the plan already declares client-asserted. Still, `source` is not frozen after save.
- **Fix A ⭐ Recommended**: Document it as a known limitation, in the plan's "What We're NOT Doing" and in a migration comment.
  - Strength: Matches the plan's stated stance (self-reported metrics). No change to F-01's grants or test suite.
  - Tradeoff: `source` stays mutable. The app has no path that writes it (zod strips unknown keys before update), but the DB does not enforce that.
  - Confidence: HIGH — the direct-insert bypass exists regardless; only `security definer` would close it, at a higher cost.
  - Blind spot: S-04's update path must keep sending only front/back.
- **Fix B**: Narrow UPDATE to columns: `revoke update on flashcards from authenticated; grant update (front, back) on flashcards to authenticated;`, plus a pgTAP 42501 test for `set source`.
  - Strength: The DB freezes `source` after insert.
  - Tradeoff: Breaks F-01's `table_privs_are` expectation, which then has to change. Every future user-updatable column (S-05 scheduling state) must be added to the column grant, an easy step to forget.
  - Confidence: MEDIUM — column grants work with PostgREST, but they add a maintenance trap.
  - Blind spot: S-05's column design is unknown.
- **Decision**: FIXED via Fix A — limitation documented in plan.md "What We're NOT Doing" and the migration's source comment.

### F2 — No test forges `generations.user_id`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/generations_rls.test.sql
- **Detail**: All inserts go through `save_generation`, which always uses the `auth.uid()` default. If `generations_insert_own` were weakened to `with check (true)`, all 36 tests would still pass. `flashcards_rls.test.sql` covers this "forge" case for its own table.
- **Fix**: As A, `throws_ok` a direct insert into `generations` with B's `user_id` → 42501; bump to `plan(37)`.
- **Decision**: FIXED — forge test added (A inserts a generation owned by B → 42501); mutation-checked against `with check (true)`.

### F3 — `throws_ok` checks only SQLSTATE for the function's own errors

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/generations_rls.test.sql (manual-source, non-array and B-replay cases)
- **Detail**: All three function-raised errors share 22023. For example, "B replaying A's id" would still pass if the function raised "invalid card source" instead.
- **Fix**: Pass the expected message (`'generation id unavailable'`, `'invalid card source'`, `'p_cards must be a json array'`) in those three `throws_ok` calls.
- **Decision**: FIXED — expected messages added to the three function-raised 22023 throws_ok calls.

### F4 — `p_cards` length is unbounded on a direct RPC call

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261006211722_review_and_save_proposals.sql:112-120
- **Detail**: The route caps the body at 64 KiB, but a signed-in user can call `/rest/v1/rpc/save_generation` directly. The whole array is then aggregated before the `generated_count ≤ 20` CHECK rejects it, so only PostgREST's own limits bound it.
- **Fix**: Add an early `if jsonb_array_length(p_cards) > 20 then raise … 22023` and a pgTAP case.
- **Decision**: FIXED — `jsonb_array_length(p_cards) > 20` guard ('too many cards', 22023) plus a 21-card pgTAP case; function replaced on the local stack via create or replace.

### F5 — Three behaviours are undocumented in the migration

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261006211722_review_and_save_proposals.sql:57-66, 130-134, 164
- **Detail**: None of these is explained in the file, unlike the flashcards migration, which explains its anon deny policies.
  - A replay ignores the payload, including a different valid one.
  - The authenticated update/delete deny policies sit behind the missing privileges; they exist for the per-operation rule and as defence in depth.
  - `service_role` EXECUTE cannot actually save, because `auth.uid()` is NULL without a user JWT.
- **Fix**: Add one comment line for each.
- **Decision**: FIXED — three comment lines added (replay ignores payload; deny policies as second layer; service_role cannot save).
