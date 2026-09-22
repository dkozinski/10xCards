<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Deck Data Contract (F-01)

- **Plan**: context/changes/deck-data-contract/plan.md
- **Mode**: Deep
- **Date**: 2026-09-22
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | FAIL |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding
6/6 existing paths ✓, 4/4 new paths absent as expected ✓, 2/2 symbols ✓ (config.toml:5, supabase.ts:9), brief↔plan ✓, Progress↔Phase ✓ (16/16), baseline `npm run lint` ✓, `npx astro check` 0 errors ✓

## Findings

### F1 — Generated types file will fail `npm run lint`

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 — #1 Type generation script, criterion 2.4
- **Detail**: `stylisticTypeChecked` enables `@typescript-eslint/consistent-type-definitions: error`. The Supabase generator emits `export type Database = { … }`. Linting a sample of generator output gave `9:13 error Use an interface instead of a type`. ESLint ignores only `.gitignore` entries, and the file must be committed.
- **Fix**: Ignore `src/db/database.types.ts` in `eslint.config.js` and keep `prettier --write` in `db:types`.
- **Decision**: FIXED (Phase 2, change #5)

### F2 — Cloud-parity check is fragile and doesn't prove RLS

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 — criterion 3.3; What We're NOT Doing
- **Detail**: Types carry columns, not policies or CHECK constraints. Generated output also embeds the PostgREST version, which may differ between local and cloud, so the diff can fail on identical schemas.
- **Fix A ⭐ Recommended**: Replace 3.3 with `npx supabase db diff --linked --schema public`, expecting no changes.
  - Strength: Compares the schema, including policies and constraints, directly.
  - Tradeoff: Starts a temporary shadow DB in Docker.
  - Confidence: MED — policy diffing on CLI 2.111 is unverified.
  - Blind spot: Possible noise from Supabase-managed objects.
- **Fix B**: Keep the types diff with `grep -v PostgrestVersion`; policy parity = 3.2 + 3.4.
  - Strength: No new tooling; the claim matches what is checked.
  - Tradeoff: Policy parity rests on a dashboard eyeball.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (criterion 3.3 and Progress 3.3 retitled "Cloud schema matches migrations"; NOT Doing and brief updated)

### F3 — Criterion 2.2 "Regeneration is stable" passes vacuously

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — criterion 2.2
- **Detail**: `git diff --exit-code` on an untracked file shows nothing and exits 0.
- **Fix**: Compare `sha256sum` across two consecutive generations.
- **Decision**: FIXED

### F4 — Constraint tests don't name the role they run as

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — #3 Isolation test suite
- **Detail**: Run as anon or with a foreign `user_id`, RLS rejects the row first (42501) and the CHECK constraint (23514) is never reached.
- **Fix**: Run the constraint assertions as user A inserting their own card.
- **Decision**: FIXED

### F5 — `updated_at` + `moddatetime` trigger outside the agreed scope

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 — #2 Flashcards migration
- **Detail**: This was not an owner decision, and nothing in F-01 uses it; editing arrives in S-04. The roadmap names this exact growth risk.
- **Fix**: Move it to S-04 as an additive migration.
- **Decision**: FIXED (removed from the migration contract and the DTO check; added to What We're NOT Doing; brief updated)
