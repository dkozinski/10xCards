<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deck Data Contract (F-01)

- **Plan**: context/changes/deck-data-contract/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-09-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Success criteria re-run (2026-09-23, local only)

- `npx supabase test db` — PASS, 17/17
- `npm run lint` — PASS, 0 errors
- `npx astro check` — PASS, 0 errors / 0 warnings
- `npm run build` — not re-run (CI runs it on the PR)
- Phase 3 cloud checks (`migration list`, `db diff --linked`) — not re-run; evidence is commit 8a2bafd message only

## Findings

### F1 — Logged-in users can TRUNCATE the whole table

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922190157_create_flashcards.sql:22-25
- **Detail**: Local `information_schema.role_table_grants` shows `authenticated` and `service_role` with `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`. The `postgres` role's default privileges on `public` still add TRUNCATE/REFERENCES/TRIGGER to every new table; only the CRUD set stopped being automatic. RLS does not govern TRUNCATE, so one statement from any logged-in user would wipe every user's cards. Latent today (PostgREST exposes no TRUNCATE; `authenticated` cannot create functions in `public`), real with the first RPC or SQL path. The line 22 comment claims the opposite. The pgTAP suite asserts no privileges, which is why this went unnoticed.
- **Fix A ⭐ Recommended**: New migration now, before the PR — `revoke all on public.flashcards from authenticated, service_role;` then re-grant `select, insert, update, delete`; add `table_privs_are` assertions for `authenticated`, `service_role` and `anon`; push to cloud behind the usual dry-run gate.
  - Strength: Closes the gap before S-01 writes the first real data; the test locks it in.
  - Tradeoff: One more cloud push (manual gate like Phase 3).
  - Confidence: HIGH — confirmed on the local database.
  - Blind spot: Cloud grants not queried directly (most likely identical or broader).
- **Fix B**: Accept as risk, fix inside S-01.
  - Strength: F-01 closes faster.
  - Tradeoff: Table sits in prod with the gap; fix gets mixed into feature code.
  - Confidence: MED — depends on nobody adding an RPC first.
  - Blind spot: Easy to forget.
- **Decision**: FIXED via Fix A (local) — new migration `20260923181722_flashcards_tighten_grants.sql` (revoke all from authenticated, service_role; re-grant CRUD) + 3 `table_privs_are` assertions (suite 17 → 20). Red before (tests 4–5 failed on REFERENCES/TRIGGER/TRUNCATE), green after. Pushed to cloud 2026-09-23 after owner go-ahead: dry run listed only this migration; `migration list` shows all three on both sides; `db diff --linked` empty; `db dump --linked` shows authenticated and service_role with exactly SELECT, INSERT, DELETE, UPDATE and no grant for anon (migra's diff ignores privileges, hence the dump check).

### F2 — Plan does not record what actually happened in Phase 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence / Scope Discipline / Success Criteria
- **Location**: context/changes/deck-data-contract/plan.md:77,110,234,325
- **Detail**: The explicit-grants migration `20260922194808_flashcards_explicit_grants.sql` and the `grant ... to authenticated` line in the first migration are documented only in commit messages (551d901, 8a2bafd). Progress 3.1 "Dry run lists exactly one pending migration" is ticked although two migrations were pushed. The test expects `42501` for anon select (no privilege) where the plan says 0 rows. Line 77 still mentions a "timestamp trigger" that plan review F5 removed.
- **Fix**: Add a "Deviations" section to plan.md covering the grants and anon behaviour; correct line 77, line 110 and the 3.1 wording.
- **Decision**: FIXED — `## Deviations` added to plan.md (grants in all three migrations, anon behaviour, F1 fix); lines 77 and 110 corrected. Progress 3.1 title left unchanged per progress-format convention; Deviations explains it.

### F3 — Policy check counts only the total, not the role × operation split

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/flashcards_rls.test.sql:25-40
- **Detail**: The suite asserts 8 policies and none `ALL`; eight policies with the wrong role mix would still pass.
- **Fix**: Use `policies_are(...)` or a count grouped by `(roles, cmd)`.
- **Decision**: FIXED — `bag_eq` assertion: exactly one policy per (role, cmd) pair across anon/authenticated × SELECT/INSERT/UPDATE/DELETE; total-count assertion kept (catches multi-role policies). Suite 20 → 21, green.

### F4 — Whitespace-only check strips spaces only

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922190157_create_flashcards.sql (front/back CHECKs)
- **Detail**: `btrim(front)` removes only spaces, so a front consisting of tabs or newlines passes the "not blank" CHECK.
- **Fix**: Trim in zod (`.trim().min(1)`) when S-01 adds the API, or tighten the CHECK with a regexp.
- **Decision**: SKIPPED — handle at the API boundary in S-01 with zod `.trim().min(1)`; no extra migration now.

### F5 — `db:types` blanks the types file when the local stack is down

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: package.json:13
- **Detail**: Shell `>` truncates `src/db/database.types.ts` before `supabase gen` runs; on failure the file is left empty (git would show it).
- **Fix**: Generate into a temp file and `mv` on success.
- **Decision**: FIXED — `db:types` now writes `database.types.ts.tmp`, `mv`s on success, removes the temp file and exits 1 on failure. Happy path verified (sha256 identical before/after, no leftover temp); failure path not exercised (would require stopping the local stack).

### F6 — Owner can set their own `created_at` and `id`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922190157_create_flashcards.sql:25
- **Detail**: Table-wide INSERT/UPDATE grants let an owner backdate `created_at` or pick an `id`. No cross-user impact — policies pin `user_id`.
- **Fix**: Column-level `grant update (front, back)`, or skip.
- **Decision**: SKIPPED — no cross-user impact; S-01/S-04 define which fields the API accepts.
