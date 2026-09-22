# Deck Data Contract (F-01) Implementation Plan

## Overview

Create the app's first database table, `public.flashcards`, owned row-by-row by exactly one account. The table carries per-operation Row Level Security policies, a committed two-account isolation test, and generated TypeScript types that S-01 through S-06 build on. No user-visible change. Roadmap item F-01, GitHub issue #7.

## Current State Analysis

- **No data layer exists.** There is no `supabase/migrations/` directory, no `src/types.ts` and no generated database types (roadmap § Baseline, confirmed 2026-09-22). The cloud project `xjykknkrkmtcdqvyirtt` has zero migrations (`context/changes/deployment/deployment-plan.md:43`).
- **The CLI is logged in but not linked.** `npx supabase projects list` returns the project with `"linked": false`. `supabase/.temp/linked-project.json` exists, but the CLI reads `.temp/project-ref`, which does not. `supabase/config.toml:5` still says `project_id = "10x-astro-starter"`. `deployment-plan.md:150` defers both fixes to "before the first migration", which is this change.
- **There is no dev database separate from production.** `.dev.vars` points at the cloud project, and so does the deployed Worker. Docker 29.7.2 is installed but no containers are running.
- **The Supabase client is untyped.** `src/lib/supabase.ts:9` calls `createServerClient(...)` with no `Database` generic. `src/middleware.ts` uses it only for `auth.getUser()`.
- **There is no test framework** (Open Roadmap Question 6).
- **Lint is strict.** `eslint.config.js` applies `strictTypeChecked` and `eslint-plugin-prettier` to every file not in `.gitignore`, so generated files must be Prettier-formatted. CI (`.github/workflows/ci.yml`) runs `astro sync`, lint and build with no Supabase access, so generated types must be committed.

## Desired End State

- `public.flashcards` exists **locally and in the cloud** with an identical schema.
- RLS is enabled with **8 policies**: `select`/`insert`/`update`/`delete` for each of `authenticated` (owner-only) and `anon` (deny). No policy uses `for all`.
- `npx supabase test db` passes a committed pgTAP suite proving that user B cannot read, update, delete or forge user A's cards, anon gets nothing, the content constraints hold, and deleting an account cascades to its cards.
- `src/db/database.types.ts` is generated and committed. `src/types.ts` exports flashcard DTOs. `createClient` returns a client typed with `Database`.
- `npm run lint` and `npm run build` pass.

### Key Discoveries:

- `AGENTS.md` Hard rules require RLS on every new table, a separate policy per operation, and separate policies for `anon` and `authenticated`, never `for all`. DTO fields use `snake_case`.
- Migration naming is `supabase/migrations/YYYYMMDDHHmmss_short_description.sql` (`AGENTS.md` § Key conventions). `npx supabase migration new create_flashcards` produces exactly that.
- `supabase test db` runs `supabase/tests/*.sql` with pgTAP against the local stack, each file inside a transaction that is rolled back.
- The global `~/.claude/CLAUDE.md` rule treats `supabase db reset` as destructive, even locally. Iterate with `npx supabase migration up`, which only applies pending migrations, and ask the owner before any reset.
- `deployment-plan.md` risk "Rollback reverts code but not Supabase migrations" says: keep migrations additive and never pair one with a code deploy. This migration is purely additive and no deployed code reads the table yet.

## What We're NOT Doing

- **No CRUD service or API routes.** `src/lib/services/flashcards.ts` and endpoints arrive in S-01 with their first user (owner decision).
- **No card-origin column** (`ai` / `manual`). It is deferred to S-03, pending PRD Open Question 3 (owner decision).
- **No scheduling or review state columns.** They belong to S-05.
- **No `updated_at` column or `moddatetime` trigger.** Card editing arrives in S-04, which adds them as an additive migration if it needs them (plan review F5).
- **No JS test framework** (Vitest etc.). Isolation is proven with pgTAP only.
- **The pgTAP suite does not run against the cloud database**, so no test users are created in production. Cloud parity is proven by `supabase db diff --linked` (schema, constraints and policies) instead.
- **No change to `.dev.vars`.** The app keeps talking to the cloud project; the local stack serves migrations and tests only.
- **No `supabase db reset` without explicit owner confirmation.**

## Implementation Approach

Local first, then cloud. The local Docker stack is a disposable copy of Supabase where the migration and policies can be wrong without consequence. The cloud push happens once, in the last phase, behind a manual gate.

Isolation lives in the database, not in Astro code. The browser holds the publishable key, so anyone can call Supabase's REST API directly; only RLS stands between that call and another user's rows.

Types are generated from the schema, never hand-copied, so a schema change without regeneration shows up as a type diff.

## Critical Implementation Details

- **Ordering in Phase 1:** fix `config.toml` `project_id` **before** the first `npx supabase start`. The id names the Docker containers and volumes, and changing it afterwards orphans them.
- **Update policy needs both clauses.** `using` (which rows you may target) *and* `with check` (what the row may look like afterwards). With `using` alone, a user can move their own card to another account by changing `user_id`.
- **RLS denial looks different per operation.** A blocked `select`/`update`/`delete` affects **0 rows** and raises no error. A blocked `insert`, or an `update` whose new row fails `with check`, **raises** SQLSTATE `42501`. Tests must assert each form accordingly (row counts / unchanged data vs `throws_ok`).

## Phase 1: Local stack, migration and isolation test

### Overview

Stand up the local Supabase stack, write the `flashcards` migration, and prove isolation with a committed pgTAP suite. Everything stays on this machine.

### Changes Required:

#### 1. Supabase project id

**File**: `supabase/config.toml`

**Intent**: Replace the starter leftover so local containers are named after this project.

**Contract**: `project_id = "10xcards"` (line 5). Nothing else changes.

#### 2. Flashcards migration

**File**: `supabase/migrations/<timestamp>_create_flashcards.sql` (created via `npx supabase migration new create_flashcards`)

**Intent**: Create the owner-scoped card store with its constraints, index, timestamp trigger and 8 RLS policies.

**Contract**:
- Table `public.flashcards`:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`
  - `front text not null`, with check `char_length(btrim(front)) >= 1 and char_length(front) <= 200`
  - `back text not null`, with check `char_length(btrim(back)) >= 1 and char_length(back) <= 500`
  - `created_at timestamptz not null default now()`
- Index on `user_id`.
- `alter table public.flashcards enable row level security`.
- Policies for `authenticated`, each comparing `(select auth.uid()) = user_id`:
  - `select`: `using`
  - `insert`: `with check`
  - `update`: `using` + `with check`
  - `delete`: `using`
- Policies for `anon`: one per operation with `using (false)` / `with check (false)`.
- Short SQL comments explaining why each anon policy exists (explicit deny, per `AGENTS.md`).

#### 3. Isolation test suite

**File**: `supabase/tests/flashcards_rls.test.sql`

**Intent**: Encode F-01's done condition, "a second account cannot read the first account's cards", plus the forge, anon, constraint and cascade cases, as a repeatable test.

**Contract**: pgTAP (`create extension if not exists pgtap with schema extensions`), wrapped in `begin; select plan(N); … select * from finish(); rollback;`. Two users are seeded into `auth.users` as `postgres`. Assertions:
- RLS is enabled on `public.flashcards`, it has exactly 8 policies, and none has `cmd = 'ALL'`.
- As A: insert succeeds and A sees 1 row.
- As B: `select` of A's cards returns 0 rows.
- As B: `update` of A's card changes nothing (A's `front` is unchanged when re-read as A).
- As B: `delete` of A's card removes nothing (the row still exists).
- As B: `insert` with `user_id` = A throws `42501`.
- As A: `update` of own card setting `user_id` = B throws `42501`.
- As anon: `select` returns 0 rows and `insert` throws `42501`.
- As A, inserting their own card: a blank `front` (`'   '`) throws `23514`, and a 201-character `front` throws `23514`. These must run as the owner; as anon or with a foreign `user_id`, RLS rejects the row first with `42501` and the CHECK is never reached.
- As `postgres`: deleting A from `auth.users` leaves 0 cards with A's `user_id`.

User impersonation is the non-obvious part:

```sql
set local role authenticated;
set local request.jwt.claims = '{"sub":"<uuid-A>","role":"authenticated"}';
-- … assertions as A …
reset role;  -- back to postgres before switching user
```

### Success Criteria:

#### Automated Verification:

- Local stack starts: `npx supabase start`
- Migration applies on the local stack: `npx supabase migration up` (or applied automatically by a fresh `start`) with no errors
- Isolation suite passes: `npx supabase test db`
- Lint passes: `npm run lint`

#### Manual Verification:

- In local Studio (`http://127.0.0.1:54323`), `flashcards` shows "RLS enabled" and 8 policies with readable names
- The owner has read the migration and can say in one sentence what each policy allows

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Generated types and typed client

### Overview

Generate TypeScript types from the local schema, expose flashcard DTOs, and type the Supabase client. Local only.

### Changes Required:

#### 1. Type generation script

**File**: `package.json`

**Intent**: One command regenerates types after any migration and keeps the output lint-clean.

**Contract**: New script `db:types`, which runs `supabase gen types typescript --local --schema public > src/db/database.types.ts` and then `prettier --write src/db/database.types.ts`.

#### 2. Generated types

**File**: `src/db/database.types.ts` (generated, committed)

**Intent**: The schema's source of truth on the TypeScript side. CI needs it committed because it has no database.

**Contract**: The output of `npm run db:types`. Never edited by hand.

#### 3. Flashcard DTOs

**File**: `src/types.ts` (new)

**Intent**: Stable names for the rest of the app, derived from generated types so they cannot drift.

**Contract**:
- `FlashcardDto` = row type of `flashcards`.
- `CreateFlashcardCommand` = `front` + `back` from the insert type (`user_id` comes from the `auth.uid()` default).
- `UpdateFlashcardCommand` = optional `front` / `back`.
- All `snake_case`, no mapping.

#### 4. Typed Supabase client

**File**: `src/lib/supabase.ts`

**Intent**: Queries in S-01 onward get compile-time checking of table and column names.

**Contract**: `createServerClient<Database>(...)`. The `createClient` signature is otherwise unchanged, and `src/middleware.ts` needs no edits.

#### 5. Exclude generated types from ESLint

**File**: `eslint.config.js`

**Intent**: The generator emits `export type Database = { … }`, which `stylisticTypeChecked`'s `@typescript-eslint/consistent-type-definitions` rejects (verified on a sample of generator output: `Use an interface instead of a type`). A generated file is never hand-edited, so it is not linted. It is still Prettier-formatted by `db:types`.

**Contract**: An ignores entry for `src/db/database.types.ts`, placed next to `includeIgnoreFile(gitignorePath)`. No rule changes.

### Success Criteria:

#### Automated Verification:

- Types regenerate cleanly: `npm run db:types`
- Regeneration is stable: the `sha256sum src/db/database.types.ts` output is identical before and after a second `npm run db:types`. `git diff` cannot be used here because the file is untracked until the phase commit.
- Type check passes: `npx astro check`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Hovering `FlashcardDto` in the editor shows `id`, `user_id`, `front`, `back`, `created_at`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Cloud rollout (manual gate)

### Overview

Link the CLI to the cloud project and push the migration. This is the only step that leaves the machine, and it is hard to reverse: undoing it takes a new migration.

### Changes Required:

#### 1. Link the CLI

**File**: `supabase/.temp/project-ref` (gitignored, written by the CLI)

**Intent**: Make `db push` target `xjykknkrkmtcdqvyirtt`.

**Contract**: The owner runs `! npx supabase link --project-ref xjykknkrkmtcdqvyirtt`, which prompts for the database password. Afterwards `npx supabase projects list` shows `"linked": true`.

#### 2. Push the migration

**File**: none (remote state)

**Intent**: Apply the single additive migration to production.

**Contract**:
- `npx supabase db push --dry-run` must list exactly one migration, `<timestamp>_create_flashcards.sql`.
- The owner confirms.
- Then `npx supabase db push`.

### Success Criteria:

#### Automated Verification:

- Dry run lists exactly one pending migration: `npx supabase db push --dry-run`
- Migration recorded on both sides: `npx supabase migration list` shows the timestamp in both the Local and Remote columns
- Cloud schema matches migrations: `npx supabase db diff --linked --schema public` reports no schema changes. This covers columns, constraints and policies, which a types diff cannot see. It starts a temporary shadow database in Docker.

#### Manual Verification:

- In the cloud dashboard Table Editor, `flashcards` shows "RLS enabled" and 8 policies
- The live app (`/`, sign-in, `/dashboard`) still works, since nothing reads the table yet

**Implementation Note**: Pause before `db push` for explicit owner go-ahead, and again after verification.

---

## Testing Strategy

### Unit Tests:

- None in JS. The contract is database-level and is covered by pgTAP.

### Integration Tests:

- `supabase/tests/flashcards_rls.test.sql` via `npx supabase test db`. It covers owner read, cross-user read/update/delete/forge, owner re-assign, anon deny, content constraints and cascade.

### Manual Testing Steps:

1. `npx supabase test db`: all assertions `ok`.
2. Open local Studio and inspect the policies on `flashcards`.
3. After Phase 3, compare the dashboard policies with local Studio.

## Performance Considerations

- The `user_id` index serves every owner-scoped query and policy check.
- Policies use `(select auth.uid())` rather than bare `auth.uid()`, so Postgres evaluates it once per statement instead of once per row (Supabase RLS performance guidance).

## Migration Notes

- Additive only: a new table with no data. No coupling to a code deploy, because no deployed code reads it.
- Rollback path: a new migration that drops the table. That is irreversible data loss once S-01 ships, and needs owner confirmation per the global rule.

## References

- Roadmap: `context/foundation/roadmap.md` § F-01
- Issue: dkozinski/10xCards#7 ("Done when" list)
- PRD: `context/foundation/prd.md` § Access Control, NFR data isolation, NFR durability
- Deployment constraints: `context/changes/deployment/deployment-plan.md` § P4, risk register
- Client to type: `src/lib/supabase.ts:9`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Local stack, migration and isolation test

#### Automated

- [x] 1.1 Local stack starts — 551d901
- [x] 1.2 Migration applies on the local stack — 551d901
- [x] 1.3 Isolation suite passes — 551d901
- [x] 1.4 Lint passes — 551d901

#### Manual

- [x] 1.5 Local Studio shows RLS enabled and 8 policies — 551d901
- [x] 1.6 Owner can explain each policy — 551d901

### Phase 2: Generated types and typed client

#### Automated

- [x] 2.1 Types regenerate cleanly
- [x] 2.2 Regeneration is stable
- [x] 2.3 Type check passes
- [x] 2.4 Lint passes
- [x] 2.5 Build passes

#### Manual

- [x] 2.6 FlashcardDto shows expected fields

### Phase 3: Cloud rollout (manual gate)

#### Automated

- [ ] 3.1 Dry run lists exactly one pending migration
- [ ] 3.2 Migration recorded on both sides
- [ ] 3.3 Cloud schema matches migrations

#### Manual

- [ ] 3.4 Cloud dashboard shows RLS enabled and 8 policies
- [ ] 3.5 Live app still works
