# S-06 Account and Data Deletion — Plan Brief

> Full plan: `context/changes/account-and-data-deletion/plan.md`
> Research: `context/changes/account-and-data-deletion/research.md`

## What & Why

FR-003 promises that the user can delete their account together with all of their data. Users paste employer material, so an incomplete deletion is a trust failure, not a missing feature. S-06 is the last open slice of milestone M-1.

## Starting Point

The schema already does the hard part. `flashcards`, `generations` and `review_logs` all cascade from `auth.users`, and pasted text is never stored. What is missing is any way for a request to delete an auth user. The Worker holds only the publishable key. There is no account page and no Q-5 answer.

## Desired End State

A signed-in user opens `/account`, types their email and presses "Delete account". Their auth row and every row they own disappear in one statement. They are signed out and see "Your account and all of its data were deleted." on `/`. pgTAP proves the cascade locally. A throwaway-account run proves it on production.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| How data is removed | Delete the `auth.users` row; the existing cascades do the rest | It was designed for this in F-01, S-03 and S-05, and future tables inherit it | Research |
| Who may delete an auth user | `security definer` `public.delete_my_account()`, scoped to `auth.uid()`, executable by `authenticated` only | No RLS-bypassing secret on the edge (E8); power limited to "delete yourself" | Plan |
| Q-5 confirmation | Type the account email; trimmed, case-insensitive match; checked in the island and on the server | Deliberate friction without a new auth flow | Plan |
| Location | New protected `/account` page, linked from `Topbar` | A natural home for settings, away from daily screens | Plan |
| After deletion | `signOut({scope:"local"})` (tolerates the missing user), redirect to `/?deleted=1` notice | No new page; the landing page is public | Plan + Research |
| Logging | Local `logFailure` copy, no personal data | Keeps the S-01..S-05 routes untouched; Workers Logs cannot be purged | Plan |
| Deadlock F6 / RPC errors | `server_error`, the user retries | The window is tiny; a retry is safe | Plan |
| Production proof | Throwaway account plus a read-only count query | "Verifiably" needs evidence on the real database | Plan |

## Scope

**In scope:**
- the migration with the definer function and pgTAP;
- the `DELETE /api/account` route, service and email helper, with tests;
- the `/account` page and island, the `Topbar` link, middleware protection, and the landing notice;
- the release and the tracker sync, including recording the Q-5 decision.

**Out of scope:**
- a service-role/admin client or a new secret;
- password re-entry;
- soft delete, undo or export;
- the shared `logFailure` refactor;
- an automatic deadlock retry;
- Workers Logs purge;
- unrelated doc drift.

## Architecture / Approach

The flow, end to end:

1. Island: `DELETE /api/account {confirm_email}`.
2. Route checks: `locals.user` → zod → `emailsMatch(confirm_email, locals.user.email)`.
3. `supabase.rpc("delete_my_account")`, running with the user's JWT.
4. The definer function runs `delete from auth.users where id = auth.uid()`.
5. FK cascades remove `flashcards`, `generations` and `review_logs`.
6. `signOut({scope:"local"})` clears the cookies.
7. The route returns 204 and the island redirects to `/?deleted=1`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Data layer (local) | `delete_my_account()` + pgTAP (privileges, refusals, full cascade with B intact) + types | First definer function; grants must be exact |
| 2. Account deletion API | Route, service, `emailsMatch`, route tests | Order: the RPC must run before `signOut` |
| 3. Account page and UI | `/account`, island, nav, landing notice, local manual run | Must swap `.dev.vars` to local before testing deletion |
| 4. Release | Prod grant check → migration → Q-5 recorded → PR/preview → merge → prod proof | Production writes; owner go-ahead at each gate |

**Prerequisites:** S-05 merged (done); local Supabase running; owner available for Phase 4 gates.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes production grants `DELETE` on `auth.users` to `postgres`, as the local stack does. Phase 4 checks this read-only before pushing and stops if it is absent.
- Deleting directly in SQL skips anything GoTrue's admin delete does beyond the row and its FK cascades (`auth.sessions`, `auth.identities`, `auth.refresh_tokens`). This is acceptable for the MVP.
- An already-issued access token stays valid for up to one hour. It cannot recreate data: every insert fails the `user_id` FK.

## Success Criteria (Summary)

- A user deletes their account from `/account` and is signed out with a clear confirmation.
- No row with that user's id remains in any table, locally (pgTAP) and on production (throwaway proof). Other users are untouched.
- Q-5 is recorded and closed. S-06 is done, which completes the slices of M-1.
