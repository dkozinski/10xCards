# S-06 Account and Data Deletion Implementation Plan

## Overview

A signed-in user can delete their own account from a new `/account` page. To confirm, they type their account email. The server then deletes their `auth.users` row through a narrowly scoped `security definer` function. The existing `on delete cascade` foreign keys remove every flashcard, generation record and review log in the same statement. The user is signed out and lands on `/` with a one-time confirmation.

This closes FR-003, roadmap S-06 (GitHub #13, Linear DAW-17) and Q-5 (#5, DAW-9).

## Current State Analysis

Full evidence is in `context/changes/account-and-data-deletion/research.md`.

- **Data removal is already guaranteed by the schema.** The three user tables reference `auth.users(id) on delete cascade`:
  - `flashcards` (`20260922190157_create_flashcards.sql:10`)
  - `generations` (`20261006211722_review_and_save_proposals.sql:26`)
  - `review_logs` (`20261010142352_srs_review_session.sql:44`; also cascades from `flashcards` at :46)

  No FK restricts deletion. Pasted text is never stored.
- **Nothing can delete an auth user from a request today.**
  - The Worker holds only the publishable key (`src/lib/supabase.ts:10`).
  - There is no admin client and no `security definer` function.
  - `authenticated` cannot DELETE from `generations` or `review_logs` (`review_and_save_proposals.sql:45-47`, `srs_review_session.sql:75-77`). Only deleting the auth row, whose cascade runs as the table owner, reaches all three tables.
- **Privilege on `auth.users`.**
  - Verified on the local stack: the table is owned by `supabase_auth_admin`.
  - `postgres` is not a superuser but holds an explicit `DELETE` grant. A definer function owned by `postgres` can therefore delete the row.
  - Production must be confirmed the same way in Phase 4.
- **Session teardown.** `signOut()` in `@supabase/auth-js` 2.105.3 (`GoTrueClient.js:3192-3205`) ignores 401/403/404 from the Auth server ("user might not exist anymore"). It still removes the session, so the `sb-*` cookies are cleared through the factory's `setAll` (`src/lib/supabase.ts:18-22`).
- **No account page and no dialog component exist.** `src/components/ui/` has only `button`, `skeleton` and `textarea`. The house pattern for destructive confirmation is the inline mode in `src/components/deck/DeckCard.tsx:17, :244-271`.

## Desired End State

- `/account` (protected, linked from `Topbar`) shows the user's email and a "Danger zone" section.
  - It explains that the deletion is irreversible and lists what goes: flashcards, generation history, review history.
  - It has an email field and a destructive "Delete account" button that is enabled only when the field matches the account email (trimmed, case-insensitive).
- Submitting calls `DELETE /api/account` with `{ "confirm_email": "<typed>" }`. On 204 the browser goes to `/?deleted=1`. That page shows "Your account and all of its data were deleted." and the visitor is signed out.
- After deletion:
  - no row with that user's id remains in `auth.users`, `public.flashcards`, `public.generations` or `public.review_logs`;
  - another user's rows are untouched;
  - signing in with the old credentials fails.
- **Verification:**
  - pgTAP `supabase/tests/account_deletion.test.sql` passes.
  - Vitest route and helper tests pass.
  - The manual run on the local stack passes.
  - The production smoke test on a throwaway account passes, with a read-only count query showing zero rows.

### Key Discoveries:

- The cascade is an inherited design decision: "FR-003 … is guaranteed by the DB, so S-06 cannot miss the cards" (`context/archive/2026-09-22-deck-data-contract/plan-brief.md:23`).
- Every existing RPC uses the shape `security invoker`, `set search_path = ''`, `revoke … from public, anon` (`srs_review_session.sql:140-226`). The new function keeps that shape except for `security definer`, and grants execute **only** to `authenticated`. `service_role` has no `auth.uid()`, so for it the function does nothing (`archive/2026-10-05-review-and-save-proposals/reviews/impl-review-phase-1.md:103`).
- Supabase's definer rules (Context7, `guides/database/functions.mdx`) are: empty `search_path`, an ownership check in the body, and execute revoked from `public` and `anon`.
- Route shape to copy: `src/pages/api/flashcards/[id].ts:87-111` (auth check before `createClient`, `apiError`, local `logFailure` at :25-31). Body reading and zod validation follow `src/pages/api/reviews/index.ts:36-56`.
- `astro.config.mjs:21` `checkOrigin: true` guards form-encoded cross-site requests. The route does not need it: `DELETE` is never a simple CORS method, so a cross-site call always needs a preflight this app never answers, and an HTML form cannot send `DELETE` at all.
- F6 deadlock (`archive/2026-10-10-srs-review-session/reviews/impl-review.md:117-120`): `record_review` and account deletion lock in opposite order. Postgres aborts one with `40P01`. That surfaces as `server_error`, and the user can press Retry.

## What We're NOT Doing

- **No service-role key, no `auth.admin` client, no new Cloudflare secret** (owner decision: route B).
- **No password re-entry or email-link confirmation.** Q-5 is answered with typed-email confirmation.
- **No soft delete, grace period, undo or data export.** Deletion is immediate and irreversible, as FR-003 states.
- **No shared `logFailure` refactor.** The new route gets its own local copy. The follow-up in `archive/2026-10-10-srs-review-session/follow-ups/review-fixes.md` stays separate.
- **No automatic retry on `40P01`.** The user retries.
- **No purge of Workers Logs.** They are retained 24 h and cannot be deleted. Instead, the new code logs no personal data: no email, no user id.
- **No changes to sign-up or sign-in** (FR-001/FR-002 baseline, `roadmap.md:75`).
- **No `deployment-plan.md` doc-drift fixes** (the "exactly two secrets" check, the Q-6 wording). They are unrelated to this slice.

## Implementation Approach

The data side needs no change. The work is a single privileged primitive, "delete the caller", with the smallest possible blast radius, plus the UI around it.

- The primitive lives in the database, because the database can scope it to `auth.uid()` without any credential leaving Supabase.
- The route adds the intent check (typed email) and the session teardown.
- The UI adds friction proportional to irreversibility.

Phases go bottom-up: schema, API, UI, release. Each one is verifiable on its own.

## Critical Implementation Details

- **Order inside the route:** validate the body, then check the email, then call the RPC, then call `signOut({ scope: "local" })`, then return 204.
  - `signOut` must come **after** the RPC. The RPC needs the session's JWT for `auth.uid()`.
  - A sign-out failure after a successful delete must not turn into an error response, because the account is already gone. Log it and still return 204.
- **Email source of truth:** compare against `context.locals.user.email`. The middleware's `getUser()` validated it with the Auth server on this request. Never compare against anything the client sends besides the typed value.
- **`User.email` is optional** (`string | undefined` in auth-js). Narrow it with `email ?? ""`. A user without an email then always gets `validation_failed`. That is acceptable, because every account in this app signs up with email and password.
- **Release order:**
  - The migration reaches production before the code, as in S-03 and S-05.
  - Between `db push` and merge, a signed-in user could call `/rest/v1/rpc/delete_my_account` directly with their own JWT. That can delete only themselves, the same power the feature grants, so the window is acceptable.

## Phase 1: Data layer (local)

### Overview

Add the `delete_my_account()` primitive and prove with pgTAP that it deletes exactly the caller and everything they own, and that nobody else can misuse it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_account_deletion.sql` (new; timestamp at creation time)

**Intent**: Add the first `security definer` function in the repo. It deletes the calling user's `auth.users` row, and the cascades remove the rest.

**Contract**:

- `public.delete_my_account() returns boolean`, `language plpgsql`, `security definer`, `set search_path = ''`.
- The body raises `42501` when `auth.uid()` is null. Otherwise it runs `delete from auth.users where id = auth.uid()` and returns whether a row was deleted.
- `revoke execute … from public, anon, service_role`, then `grant execute … to authenticated`.
- A header comment states:
  - why this is definer: `authenticated` has no privilege on `auth.users`;
  - that the owner is `postgres`;
  - that the cascades from the three tables do the data removal;
  - the F6 deadlock note.

#### 2. pgTAP test

**File**: `supabase/tests/account_deletion.test.sql` (new)

**Intent**: Prove "no row owned by the deleted user remains" (the S-06 Done-when) and pin down the privileges of the new trust boundary.

**Contract**: The test follows the existing fixture style (`review_logs_rls.test.sql:19-21`, role switching via `set local role` and `request.jwt.claims`).

Fixtures:
- users A and B;
- each user has at least one flashcard, one `generations` row and one `review_logs` row;
- A's log row is inserted as `postgres`, with values valid for the table's checks.

Assertions:
- the function is `security definer` with `search_path=""` (from `pg_proc.prosecdef` / `proconfig`);
- `function_privs_are`: `authenticated` has EXECUTE; `anon` and `service_role` do not;
- PUBLIC holds no grant. PUBLIC is not a role in `pg_roles`, so `function_privs_are` cannot check it. Assert it with `is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.delete_my_account()'::regprocedure and a.grantee = 0), 0, …)`;
- `anon` calling it → `throws_ok … '42501'`;
- `authenticated` with claims lacking `sub` → `throws_ok … '42501'`, and the counts are unchanged;
- A calls it → returns `true`;
- afterwards, as `postgres`: 0 rows for A in `auth.users`, `flashcards`, `generations` and `review_logs`; B's counts are unchanged in all four.

#### 3. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Expose the new RPC to the typed client.

**Contract**: Regenerated with `npm run db:types`. No hand edits. `Functions.delete_my_account` appears with `Args: never` (or empty) and `Returns: boolean`.

### Success Criteria:

#### Automated Verification:

- The migration applies to the local stack: `npx supabase migration up` (or `npx supabase db reset` with the owner's go-ahead)
- pgTAP passes, including existing files: `npx supabase test db`
- Types regenerate with no manual edits: `npm run db:types` and `git diff --stat src/db/database.types.ts` shows only the new function
- Lint and unit tests still pass: `npm run lint && npm test`

#### Manual Verification:

- Mutation check: drop the `revoke … from anon` (or switch to `security invoker`). The matching pgTAP assertion fails. Revert.
- The owner has reviewed the migration (first definer function, writes into `auth`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Account deletion API

### Overview

Add the route that checks intent, calls the primitive and tears down the session.

### Changes Required:

#### 1. Email comparison helper

**File**: `src/lib/validation/account.ts` (new) and `src/lib/validation/account.test.ts` (new). It was first planned as `src/lib/account.ts` and moved by impl review phase 2, F2, because island-shared request schemas live in `src/lib/validation/`. The zod body schema `deleteAccountSchema` lives here too.

**Intent**: Define a single matching rule shared by the island (button enablement) and the route (authoritative check).

**Contract**:
- `emailsMatch(typed: string, accountEmail: string): boolean` compares after `trim()` and `toLowerCase()`.
- It returns `false` when either side is empty after the trim.
- Tests cover:
  - an exact match;
  - `" Dawid@Example.com "` against `"dawid@example.com"` → true;
  - a different address → false;
  - an empty typed value → false;
  - an empty account email → false.

#### 2. Service

**File**: `src/lib/services/account.ts` (new)

**Intent**: Wrap the RPC in the same style as the other services.

**Contract**:
- `deleteMyAccount(supabase): Promise<boolean>` calls `supabase.rpc("delete_my_account")`.
- It throws the `PostgrestError` on error and returns the boolean.

#### 3. Route

**File**: `src/pages/api/account/index.ts` (new) and `src/pages/api/account/index.test.ts` (new)

**Intent**: `DELETE /api/account` deletes the signed-in user's account after confirming the typed email, then clears the session cookies.

**Contract**:
- `export const prerender = false`.
- Request and response:
  - **Body:** `{ confirm_email: string }`, validated with zod (non-empty string, bounded length).
  - **Order:** see Critical Implementation Details.
  - **Success:** `204` with an empty body, plus the `Set-Cookie` headers from `signOut`.
- Error mapping, all through `apiError()`:

  | Situation | Code |
  |---|---|
  | no `locals.user` (checked before `createClient`) | `unauthorized` |
  | unreadable or unparseable body | `invalid_json` |
  | schema failure | `validation_failed` |
  | `emailsMatch` false | `validation_failed` with `fieldErrors.confirm_email` |
  | no client | `server_error` |
  | any RPC error, including `40P01` | `server_error`, logged `{code, message}` only |
  | RPC returns `false` (row already gone, e.g. a parallel tab) | treated as success: sign out, 204 |

- Local `logFailure` copy: no email or user id in logs.
- Tests follow `src/pages/api/flashcards/[id].test.ts`:
  - 401 never calls `createClient`;
  - `invalid_json`;
  - `validation_failed` (missing field, and mismatched email with `fieldErrors.confirm_email`);
  - 500 when the client is null;
  - 500 on an RPC error, with `details` never logged;
  - 204 calls `rpc` then `signOut({scope:"local"})`, in that order;
  - a `signOut` error still gives 204;
  - `rpc` returning `false` gives 204;
  - on a mismatch, `rpc` is never called.

### Success Criteria:

#### Automated Verification:

- Unit and route tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Mutation check: remove the `emailsMatch` guard. The "mismatch never calls rpc" test fails. Revert.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Account page and UI

### Overview

Give the user a place to delete the account, with friction proportional to irreversibility, and confirm the result.

### Changes Required:

#### 1. Account page

**File**: `src/pages/account.astro` (new)

**Intent**: A protected page with the same chrome as `/deck`. It shows the signed-in email and a "Danger zone" section that hosts the island.

**Contract**:
- It uses `Layout` and `Topbar` like `src/pages/deck.astro`.
- It passes only `email` (from `Astro.locals.user`) to the island as a prop.
- The copy names what is deleted (flashcards, generation history, review history) and states that it cannot be undone.

#### 2. Delete-account island

**File**: `src/components/account/DeleteAccount.tsx` (new)

**Intent**: The email-typed confirmation and the call to the route.

**Contract**:
- The input is labelled with the account email shown.
- The `variant="destructive"` button is disabled until `emailsMatch(value, email)` holds.
- While the request runs, the button shows a pending state and is disabled. The request is `fetch("/api/account", { method: "DELETE", … })` with `AbortSignal.timeout(30_000)`, as in `DeckCard.tsx:66-111`.
- Outcomes:
  - **204** → `window.location.assign("/?deleted=1")`.
  - **401** → `window.location.assign("/auth/signin")`.
  - **`validation_failed`** → inline message under the field.
  - **Anything else** → "Something went wrong on our side. Your account was not deleted. Try again." with the button usable again.
- An `aria-live` region repeats status messages.

#### 3. Navigation and protection

**Files**: `src/middleware.ts`, `src/components/Topbar.astro`

**Intent**: Make `/account` reachable and protected.

**Contract**:
- `"/account"` is added to `PROTECTED_ROUTES` (`src/middleware.ts:4`). The `/api/account` path is unaffected by the prefix rule.
- An "Account" link goes in the signed-in nav (`Topbar.astro:62-73`), before the sign-out form.

#### 4. Deleted confirmation on the landing page

**File**: `src/components/Welcome.astro` (or `src/pages/index.astro`)

**Intent**: Confirm the outcome after the redirect.

**Contract**:
- When `Astro.url.searchParams.get("deleted") === "1"` and there is no signed-in user, render a dismissible-free notice with `role="status"`: "Your account and all of its data were deleted."
- Nothing is rendered otherwise. Nothing is stored.

### Success Criteria:

#### Automated Verification:

- Lint, tests and build pass: `npm run lint && npm test && npm run build`
- `npm run preview` serves `/account` (redirects to sign-in when signed out) without `[unenv]` errors

#### Manual Verification:

Run on the **local** stack. `.dev.vars` points at production, so back it up, swap it, and restore it afterwards with a sha check.

- `/account` is reachable from `Topbar` and redirects when signed out
- The button stays disabled until the email matches; `" USER@x.test "` matches `user@x.test`
- User A with cards, a generation and a graded review deletes the account → lands on `/?deleted=1` with the notice, signed out (DevTools: the `DELETE /api/account` 204 carries expiring `sb-*` Set-Cookie headers; impl review phase 2, F4); `/deck` redirects to sign-in; signing in with A's credentials fails
- In Studio, as `postgres`: 0 rows for A in all four tables; user B's data is intact and B can still sign in and review
- Keyboard-only run: focus order, button state and announcements via the live region
- Error path: force a `server_error` in Studio, as `postgres`, with `revoke execute on function public.delete_my_account() from authenticated`. Stopping the DB would also stop Auth and yield 401 instead. The button shows the "not deleted, try again" message, the account survives, and the button can be pressed again. Restore with `grant execute … to authenticated` and re-run `npx supabase test db`
- `.dev.vars` is restored and its sha matches the backup

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Release

### Overview

Migration first, then the PR with the Q-5 decision recorded, then the merge and a production proof on a throwaway account. The release sequence follows `context/archive/2026-10-10-srs-review-session/plan.md:419-476`.

### Changes Required:

#### 1. Production migration

**Intent**: Have the function in production before the code that calls it.

This touches Supabase cloud. It can only be reversed by a forward migration that drops the function. It is harmless to the deployed code, which never calls the function.

**Contract**:
1. Confirm the privilege, read-only: `npx supabase db dump --linked --schema auth` shows `GRANT … DELETE … ON TABLE "auth"."users" TO "postgres"`. If it is missing, stop and re-plan; do not push.
2. `npx supabase db push --dry-run` lists exactly this one migration.
3. **Pause for the owner's explicit go-ahead**, then run `npx supabase db push`.
4. Parity:
   - `npx supabase db diff --linked --schema public` is empty;
   - `npx supabase db dump --linked` shows the `delete_my_account` EXECUTE grant to `authenticated` only and `SECURITY DEFINER`.

#### 2. Trackers before merge (lesson: "Merge slice PR = zamknięte issues…")

**Intent**: Record the Q-5 answer before `Closes #5` closes it with "Not yet decided".

**Contract**:
- #5 / DAW-9 body "Decision": typed-email confirmation on `/account`, with the reasons.
- PRD Open Question 5 is marked resolved.
- `roadmap.md` Q-5 is marked resolved.

#### 3. Pull request and preview

**Intent**: One PR from `feat/account-and-data-deletion`. The preview reaches production Supabase, so test only with a throwaway account.

**Contract**:
- The PR body has `Closes #13` and `Closes #5` and states the release order.
- On the preview:
  - sign up a throwaway account, add a card, delete the account → `/?deleted=1`;
  - Workers logs show no email or user id and no `[unenv]` errors.

#### 4. Merge and production proof

**Intent**: Merge after CI is green, then prove the Done-when "No row owned by the deleted user remains" on production.

**Contract**:
- On production, a fresh throwaway account: one manual card, one AI generation saved, one review graded. Note its user id from the dashboard (Authentication → Users). Then delete it through `/account`.
- Read-only check, with the owner's go-ahead for the connection: a `SELECT count(*)` per table for that id returns 0 in `auth.users`, `flashcards`, `generations` and `review_logs`. Use the dashboard SQL editor, or `supabase` CLI if available read-only.
- Sign-in with the deleted credentials fails.
- After the merge, follow the `tasks-github.md` Lifecycle in both trackers:
  - tick "Done when" on #13 and DAW-17;
  - #5 and DAW-9 → Done;
  - milestone M-1 has no open slices left, so note this for `/10x-roadmap`.
- Rollback: `npm run deploy:rollback` reverts code only. The function stays and is self-scoped.

### Success Criteria:

#### Automated Verification:

- The dry run lists exactly one migration: `npx supabase db push --dry-run`
- Schema parity after the push: `npx supabase db diff --linked --schema public` (empty)
- CI green on the PR: `gh pr checks <n>`
- Workers Builds green on the merge commit

#### Manual Verification:

- `auth.users` DELETE grant to `postgres` confirmed on production before the push
- Owner go-ahead given before `db push`
- Q-5 decision recorded in #5, DAW-9, the PRD and the roadmap before merge
- The preview deletion works with no personal data in the logs
- Production proof: 0 rows in all four tables for the throwaway account; its sign-in fails

---

## Testing Strategy

### Unit Tests:

- `emailsMatch`: normalization and empty values.
- Route: the whole error vocabulary, the call order (`rpc` before `signOut`), no RPC on a mismatch, `signOut` failure tolerated, `false` from the RPC treated as success, no `details` in logs.

### Integration Tests:

pgTAP `account_deletion.test.sql`:
- definer and `search_path` flags;
- execute privileges;
- anon and no-`sub` refusals;
- the full cascade for A with B intact.

### Manual Testing Steps:

1. Local two-account run: delete A, verify the counts in Studio, then check that B is unaffected.
2. Email matching with whitespace and case variants.
3. Keyboard and screen-reader pass on `/account`.
4. Production throwaway-account proof with read-only counts.

## Performance Considerations

None material. The cascade deletes one user's rows in one statement. At MVP deck sizes this is milliseconds.

## Migration Notes

- The migration is additive: one function and its grants. Existing data is untouched.
- Rollback is a forward migration `drop function public.delete_my_account()`.
- Code rollback alone leaves a self-scoped function, which is harmless.

## References

- Research: `context/changes/account-and-data-deletion/research.md`
- Cascade decision: `context/archive/2026-09-22-deck-data-contract/plan-brief.md:23`
- RPC pattern: `supabase/migrations/20261010142352_srs_review_session.sql:140-226`
- Route pattern: `src/pages/api/flashcards/[id].ts:25-31, :87-111`; tests `src/pages/api/flashcards/[id].test.ts:157-212`
- Confirm UI pattern: `src/components/deck/DeckCard.tsx:47-54, :66-111, :244-271`
- signOut behaviour: `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:3192-3205` (v2.105.3)
- Release pattern: `context/archive/2026-10-10-srs-review-session/plan.md:419-476`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer (local)

#### Automated

- [x] 1.1 Migration applies to the local stack — 10e4128
- [x] 1.2 pgTAP passes, including existing files — 10e4128
- [x] 1.3 Types regenerate with no manual edits — 10e4128
- [x] 1.4 Lint and unit tests still pass — 10e4128

#### Manual

- [x] 1.5 Mutation check on anon revoke / definer flag — 10e4128
- [x] 1.6 Migration reviewed by the owner — 10e4128

### Phase 2: Account deletion API

#### Automated

- [x] 2.1 Unit and route tests pass
- [x] 2.2 Lint passes
- [x] 2.3 Build passes

#### Manual

- [x] 2.4 Mutation check on the emailsMatch guard

### Phase 3: Account page and UI

#### Automated

- [ ] 3.1 Lint, tests and build pass
- [ ] 3.2 `npm run preview` serves `/account` without `[unenv]` errors

#### Manual

- [ ] 3.3 `/account` reachable from Topbar and protected
- [ ] 3.4 Button enabled only on matching email (trim, case-insensitive)
- [ ] 3.5 Deleting A lands on `/?deleted=1`, signed out, old credentials fail
- [ ] 3.6 Zero rows for A in all four tables; B intact
- [ ] 3.7 Keyboard and screen-reader run
- [ ] 3.8 Error path keeps the account and allows retry
- [ ] 3.9 `.dev.vars` restored and sha matches

### Phase 4: Release

#### Automated

- [ ] 4.1 Dry run lists exactly one migration
- [ ] 4.2 Schema parity after push
- [ ] 4.3 CI green on the PR
- [ ] 4.4 Workers Builds green on the merge commit

#### Manual

- [ ] 4.5 Production `auth.users` DELETE grant confirmed before push
- [ ] 4.6 Owner go-ahead before `db push`
- [ ] 4.7 Q-5 decision recorded before merge
- [ ] 4.8 Preview deletion works, no personal data in logs
- [ ] 4.9 Production proof: zero rows, sign-in fails
