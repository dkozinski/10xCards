# Deck Data Contract (F-01) — Plan Brief

> Full plan: `context/changes/deck-data-contract/plan.md`

## What & Why

Create the first database table, `public.flashcards`, where every row belongs to exactly one account and the database itself refuses cross-account access. Five later slices (S-01, S-03 to S-06) read and write through this table. Retrofitting access rules later is far riskier than writing them once, up front.

## Starting Point

Supabase is wired for auth only. There are no migrations locally or in the cloud, no types, and no test framework. The CLI is logged in but not linked to the cloud project. The only database is the production one.

## Desired End State

`flashcards` exists locally and in the cloud with identical schemas. It has 8 RLS policies: owner-only for `authenticated`, deny for `anon`. A committed pgTAP suite proves user B cannot read, change, delete or forge user A's cards. Generated TypeScript types and DTOs are committed, and the Supabase client is typed.

## Key Decisions Made

| Decision            | Choice                                      | Why (1 sentence)                                                                 |
| ------------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| Migration target    | Local Docker stack first, cloud last        | The cloud DB is production; mistakes in policies should happen somewhere disposable. |
| Isolation proof     | pgTAP via `npx supabase test db`            | Repeatable and committed, with no new JS test framework ahead of the first slice. |
| Account deletion    | `on delete cascade` to `auth.users`         | FR-003 ("all data goes") is guaranteed by the DB, so S-06 cannot miss the cards. |
| Scope               | Table + RLS + types only, no CRUD service   | Honours the roadmap risk "don't grow into the data layer"; S-01 writes the service. |
| Content limits      | Non-blank, front ≤ 200, back ≤ 500 (CHECK)  | Enforces atomic cards at the DB boundary; loosening later is a cheap migration.  |
| Card origin column  | Deferred to S-03                            | Its meaning depends on unanswered PRD Open Question 3.                           |
| Types               | Generated file + DTO aliases + typed client | Types cannot silently drift from the schema.                                     |

## Scope

**In scope:**
- `config.toml` project id fix and local stack
- `create_flashcards` migration (table, constraints, index, 8 policies)
- pgTAP isolation suite
- `db:types` script, `src/db/database.types.ts`, `src/types.ts`, typed `createClient`
- Link the CLI and push to the cloud

**Out of scope:**
- CRUD service and API routes (S-01)
- Card-origin column (S-03)
- Scheduling state (S-05)
- JS test framework
- Running tests against production
- Changing `.dev.vars`

## Architecture / Approach

Isolation is enforced by Postgres RLS, not by Astro code, because the publishable key in the browser can call Supabase's API directly. Every policy compares `(select auth.uid())` to `user_id`. The update policy checks both the targeted row and the resulting row, so ownership cannot be reassigned. Types flow one way, schema → generator → `database.types.ts` → DTOs in `src/types.ts`, and are regenerated after every migration.

## Phases at a Glance

| Phase                                   | What it delivers                                   | Key risk                                                          |
| --------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Local stack, migration, isolation test | Table + policies proven by pgTAP on this machine   | First Docker pull is large; pgTAP role-switching is unfamiliar    |
| 2. Generated types and typed client     | Committed types, DTOs, typed Supabase client        | Generated file must stay Prettier/lint-clean                      |
| 3. Cloud rollout (manual gate)          | Migration applied to production, parity proven     | Hard to reverse; needs DB password and explicit go-ahead          |

**Prerequisites:** Docker running; Supabase CLI logged in (confirmed); database password for `supabase link`.
**Estimated effort:** ~2–3 after-hours sessions across 3 phases.

## Open Risks & Assumptions

- Assumes `npx supabase start` works on this machine. Docker is installed, but the stack has never been started here.
- `supabase db reset` counts as destructive under the global rule. Iteration uses `migration up`, and any reset needs owner confirmation.
- The 200/500 limits constrain the AI prompt in S-02. If they prove too tight, loosening them is an additive migration.

## Success Criteria (Summary)

- `npx supabase test db` passes: a second account cannot read, change, delete or forge the first account's cards.
- `npx supabase migration list` shows the migration both locally and remotely, and `npx supabase db diff --linked --schema public` finds no differences.
- `npm run lint` and `npm run build` pass with the typed client.
