---
date: 2026-10-11T12:30:00+00:00
researcher: Claude (Opus 5.5) for Dawid Kozinski
git_commit: c057a4f17fae814403d4e6002f5794f5a36775cb
branch: feat/account-and-data-deletion
repository: dkozinski/10xCards
topic: "S-06: what the codebase already gives account-and-data deletion, and what it lacks"
tags: [research, codebase, supabase, auth, rls, account-deletion, s-06]
status: complete
last_updated: 2026-10-11
last_updated_by: Claude (Opus 5.5)
---

# Research: S-06 account and data deletion

**Date**: 2026-10-11
**Researcher**: Claude (Opus 5.5) for Dawid Kozinski
**Git Commit**: c057a4f (main after PR #32)
**Branch**: feat/account-and-data-deletion
**Repository**: dkozinski/10xCards

## Research Question

S-06 (roadmap `context/foundation/roadmap.md:160-171`, GitHub #13, Linear DAW-17) says: "The user can delete their account and, with it, every flashcard, every pasted text, and the whole review history — irreversibly and verifiably."

This research covers four things:
- What the data layer, auth flow, API conventions and UI already give us.
- What has to be built.
- Which decisions are open: Q-5, and how the server is allowed to delete an auth user.

External evidence comes from Context7 (`/supabase/supabase`). exa.ai was disconnected this session.

## Summary

- **The data side is already solved by the schema.** All three user tables have `user_id … references auth.users(id) on delete cascade`: `flashcards`, `generations` and `review_logs`. No FK restricts deletion. Pasted text is never stored. Deleting the one `auth.users` row therefore removes everything. pgTAP already proves the cascade for each table separately.
- **What is missing is a way to delete the auth user from a request.** The Worker holds only the publishable key (`SUPABASE_KEY`). There is no admin client and no `security definer` function. There are two routes:
  - **(A)** Admin API `auth.admin.deleteUser()`, which needs a new `service_role`/`sb_secret_` secret on the Worker. That key bypasses RLS everywhere (risk E8).
  - **(B)** A `security definer` SQL function `public.delete_my_account()` that runs `delete from auth.users where id = auth.uid()`, called by RPC with the user's own session. It needs no new secret, but it is the repo's first definer function and writes into a Supabase-managed schema.
- **Session teardown:** the middleware uses `getUser()`, which validates against the Auth server, so a deleted user is treated as signed out on the very next request. The stale `sb-*` cookies still need clearing. An already-issued access token stays valid until `exp` (`jwt_expiry = 3600`). That token cannot recreate data, because every insert would violate the `user_id` FK.
- **UI:** there is no account or settings page. There is also no dialog component, only `button`, `skeleton` and `textarea`. The S-04 inline "confirm" mode in `DeckCard.tsx` is the house pattern for destructive confirmation. Q-5 (how the irreversible delete is confirmed) is still open.
- **Process constraints:** `foundation/infrastructure.md:286-288` requires a human decision for "setting any secret, applying a Supabase migration… and anything touching the account-deletion path (FR-003)".

## Detailed Findings

### 1. Data layer: what a deleted auth user takes with it

| Table | Created at | `user_id` FK | Other FKs |
|---|---|---|---|
| `public.flashcards` | `supabase/migrations/20260922190157_create_flashcards.sql:6` | `auth.users(id) on delete cascade` (:10) | — |
| `public.generations` | `supabase/migrations/20261006211722_review_and_save_proposals.sql:23` | same (:26) | none to `flashcards` (:17-19, by design: `archive/2026-10-05-review-and-save-proposals/plan.md:67`) |
| `public.review_logs` | `supabase/migrations/20261010142352_srs_review_session.sql:41` | same (:44) | `flashcard_id → flashcards on delete cascade` (:46) |

- There is no restrict or no-action FK and no trigger on `auth.users`. Storage is enabled (`supabase/config.toml:109-110`), but no bucket exists or is referenced. Supabase cascades its own `auth.identities`, `auth.sessions` and `auth.refresh_tokens`.
- **Pasted text is never persisted.** It lives only in React state (`archive/2026-09-29-ai-proposals-from-text/plan.md:10-11, :82`). The "every pasted text" clause of FR-003 holds trivially. Workers Logs, kept 24 h on Free (E28), cannot be purged, so no new log line may carry personal data.
- **Referential actions run as the table owner** (`srs_review_session.sql:74`, `archive/2026-10-10-srs-review-session/plan.md:49`). The cascade works even though `authenticated` has no DELETE on `generations` and `review_logs`.
- **A user session cannot delete everything with plain DELETEs.**
  - `generations` has no DELETE grant and a `generations_delete_deny` policy (`review_and_save_proposals.sql:45-47, :71`).
  - `review_logs` behaves the same (`srs_review_session.sql:75-77, :107`).
  - Only deleting the `auth.users` row, which cascades as the owner, covers all three tables.
- **Known deadlock** (`archive/2026-10-10-srs-review-session/reviews/impl-review.md:117-120`, F6). `record_review` locks card, then log, then `auth.users` (FK key-share). Account deletion takes the opposite order. Postgres detects it and the transaction can be retried. That review accepted it with "mention the deadlock if account deletion is ever implemented".

### 2. Existing SQL function pattern

All three RPCs share one shape:
- `security invoker`, `set search_path = ''`, fully qualified names.
- `revoke execute … from public, anon`, then `grant … to authenticated, service_role`.

| Function | Defined at | Grants |
|---|---|---|
| `save_generation` | `review_and_save_proposals.sql:104-171` | :179-180 |
| `record_review` | `srs_review_session.sql:140-220` | :225-226 |
| `next_review_card` | `srs_review_session.sql:239-288` | :293-294 |

- There is **no `security definer` function yet**. Under invoker rights, `authenticated` has no privilege on `auth.users`, so route (B) needs `security definer`.
- Supabase's guidance for definer functions (Context7, `guides/database/functions.mdx`):
  - set `search_path = ''`;
  - check ownership in the body (`where id = auth.uid()`);
  - revoke execute from `public` and `anon`;
  - "any role can call it by default, including anon".
- `service_role` EXECUTE on these functions is useless for user actions, because `auth.uid()` is NULL without a user JWT (`archive/2026-10-05-review-and-save-proposals/reviews/impl-review-phase-1.md:103`).

### 3. Supabase clients and secrets

- **Single factory:** `src/lib/supabase.ts:6-25`, which is `createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, …)` with cookie get and set. It returns `null` when env is missing. Every server call site uses it.
- **The key is publishable** (`sb_publishable_`; `changes/deployment/deployment-plan.md:131, :1202`). **There is no admin client and no service-role usage anywhere in `src/`.** No doc mentions `SUPABASE_SERVICE_ROLE_KEY`, `auth.admin` or `deleteUser`.
- **Env schema:** `astro.config.mjs:22-28` declares three server secrets, `SUPABASE_URL`, `SUPABASE_KEY` and `OPENROUTER_API_KEY`. `checkOrigin: true` (:21) is the CSRF guard for cookie-auth POSTs. `src/lib/config-status.ts:1-28` shows a banner for missing vars.
- **Cloudflare secrets** are set with `npx wrangler secret put <NAME> --name 10xcards` (`deployment-plan.md:620-622, :656-658`).
  - Each `put` deploys a new version by itself.
  - Secrets are write-only and are not reverted by rollback (E17, `infrastructure.md:268-284`).
  - `wrangler.jsonc` has no `vars`. Check 12 in `deployment-plan.md:1200` ("exactly two secrets") is already stale, because there are three.
- **E8** (`deployment-plan.md:1095-1097`): "`sb_secret_` / `service_role` bypass RLS entirely". That is "catastrophic the day the first [table] lands" if used as the general key (`:131-132`).

### 4. Auth flow and what happens after deletion

- **Middleware** (`src/middleware.ts:4-21`):
  - `PROTECTED_ROUTES = ["/dashboard", "/deck", "/generate", "/review"]`.
  - It calls `supabase.auth.getUser()` on every request and sets `locals.user`. A missing user on a protected prefix redirects to `/auth/signin`.
  - Responses default to `Cache-Control: private, no-store` (:39-41).
- **Signout** (`src/pages/api/auth/signout.ts:4-12`): a form POST that calls `supabase.auth.signOut()`, ignores the error, and redirects to `/`. Cookies are cleared through the factory's `setAll`.
- **After the auth row is gone:**
  - `getUser()` fails, so `locals.user = null`. Protected pages redirect, and there is no loop because `/auth/signin` is unprotected.
  - The `sb-*` cookies stay until something clears them. The delete route should end with a sign-out that clears cookies.
  - `signOut()` defaults to `scope: 'global'`, which calls the Auth server. `{ scope: 'local' }` only ends the current session (Context7, `guides/auth/signout.mdx`).
  - Whether `signOut()` still clears local cookies when the server returns 401/404 for an already-deleted user must be verified in the plan or implementation (open question 3).
- **Access-token window** (Context7, `guides/auth/managing-user-data.mdx`):
  - Deleting the user cascades to `auth.sessions` and invalidates refresh tokens.
  - An issued access token "stays valid until its `exp`" (`jwt_expiry = 3600`, `supabase/config.toml:158`).
  - In this app the window is harmless:
    - our routes go through `getUser()`;
    - direct PostgREST reads find no rows;
    - any insert fails the `user_id` FK, so no orphan rows can appear.

### 5. API route conventions to follow

- Reference routes:
  - `src/pages/api/flashcards/[id].ts:87-111` (DELETE: auth → id → client → service → 204 / `not_found` / `server_error`)
  - `src/pages/api/reviews/index.ts:10-80`
- Every route has:
  - `export const prerender = false`;
  - `if (!context.locals.user) return apiError("unauthorized", …)` before `createClient`, which the tests assert;
  - `if (!supabase) return apiError("server_error", "Supabase is not configured")`.
- **Errors** go only through `apiError()` (`src/lib/api-errors.ts:4-39`): `validation_failed` 400, `invalid_json` 400, `unauthorized` 401, `not_found` 404, `server_error` 500, `generation_failed` 502. No new code is needed for deletion.
- **Logging:** a local `logFailure(operation, error)` logs `{code, message}` only (`[id].ts:25-31`, `reviews/index.ts:15-21`). A shared `src/lib/log-failure.ts` is a pending follow-up (`archive/2026-10-10-srs-review-session/follow-ups/review-fixes.md`). S-06 would add a sixth copy unless that lands first.
- **Services** take the request-scoped RLS client and never filter by `user_id` (`src/lib/services/flashcards.ts:5-8, :52-57`).
- **Auth routes** use form POST and redirect (`signout.ts`, `signin.ts:6-22`). JSON routes are called from islands with `fetch`.

### 6. UI

- **There is no account or settings page.** `src/pages/` has `index`, `dashboard`, `deck`, `generate`, `review`, `auth/*` and `api/*`. `/dashboard` (`src/pages/dashboard.astro:1-33`) is a stub with a sign-out form at :23-30.
- **The signed-in nav** is `src/components/Topbar.astro:57-79`: email, then Generate, Review, My deck, Dashboard links, then the sign-out form (:74-78). It is used on Welcome, review, generate and deck, but **not** on dashboard.
- **House pattern for destructive confirmation (S-04):** `src/components/deck/DeckCard.tsx`.
  - Inline `Mode = "view" | "editing" | "confirmDelete"` (:17).
  - A destructive "Confirm delete" button plus Cancel (:244-271), with focus moved to Cancel (:47-54).
  - `send()` uses a 30 s `AbortSignal.timeout`, then `window.location.assign` (:66-111).
  - It has no dialog and no `window.confirm`.
- **Installed shadcn components:** `button`, `skeleton`, `textarea` (`src/components/ui/`). There is no `AlertDialog`, `Dialog` or `Input`, and the only Radix dependency is `@radix-ui/react-slot`.

### 7. Tests

- **pgTAP** (`supabase/tests/*_rls.test.sql`, run with `npx supabase test db`):
  - Each file is `begin; plan(N); … finish(); rollback;`.
  - Users are seeded into `auth.users` with fixed UUIDs (`review_logs_rls.test.sql:19-21`).
  - Impersonation uses `set local role authenticated; set local request.jwt.claims = '{"sub":…}'`.
  - Other tools in use: `function_privs_are` / `table_privs_are`, and `throws_ok(…,'42501')`.
- **Existing cascade checks** are per table, one at a time:
  - `flashcards_rls.test.sql:257-262`
  - `generations_rls.test.sql:333-338`
  - `review_logs_rls.test.sql:630-635`
  - No single test deletes one user and asserts zero rows in all three tables while user B stays intact.
- **Vitest** (`vitest.config.ts`, `src/**/*.test.ts`) uses `vi.mock("@/lib/supabase")` with a chainable stub (`src/pages/api/flashcards/[id].test.ts:8, :27-57, :157-212`). It includes an assertion that `details` never reaches `console.error`.
- **Generated types:** `src/db/database.types.ts`, regenerated with `npm run db:types` (`package.json:14`, local stack, public schema). A new `public.delete_my_account()` would appear under `Functions`.

## Code References

- `supabase/migrations/20260922190157_create_flashcards.sql:10` — `flashcards.user_id` cascade
- `supabase/migrations/20261006211722_review_and_save_proposals.sql:26, :45-47, :71` — `generations` cascade, grants, delete-deny
- `supabase/migrations/20261010142352_srs_review_session.sql:44-46, :74-77, :107, :140-226` — `review_logs` cascades, grants, `record_review`
- `supabase/tests/review_logs_rls.test.sql:19-21, :628-635` — fixture users; account-delete cascade check
- `supabase/config.toml:158` — `jwt_expiry = 3600`
- `src/lib/supabase.ts:6-25` — the only Supabase client factory (publishable key)
- `astro.config.mjs:21-28` — `checkOrigin`, env schema
- `src/middleware.ts:4-21` — `PROTECTED_ROUTES`, `getUser()`
- `src/pages/api/auth/signout.ts:4-12` — sign-out sequence
- `src/pages/api/flashcards/[id].ts:25-31, :87-111` — `logFailure`, DELETE route shape
- `src/lib/api-errors.ts:4-39` — error vocabulary
- `src/components/Topbar.astro:57-79` — signed-in nav
- `src/components/deck/DeckCard.tsx:17, :47-54, :66-111, :244-271` — inline confirm pattern
- `src/pages/api/flashcards/[id].test.ts:8, :27-57, :157-212` — route test pattern

## Architecture Insights

- **"The DB guarantees FR-003" was a deliberate choice from F-01 onwards** (`archive/2026-09-22-deck-data-contract/plan-brief.md:23`), and S-03 and S-05 kept it. As a result, S-06 does not delete data table by table. It deletes exactly one row, the auth user, and the cascade does the rest. This also means a table added later is covered automatically, as long as it follows the `user_id … on delete cascade` rule.
- **The real design decision is who holds the power to delete an auth user.**
  - **(A) Admin API with a service-role secret.** This is Supabase's documented path (`auth.admin.deleteUser`, "requires a service_role key… only on a server"). It adds the first RLS-bypassing credential to the Worker (E8). The danger is that a bug in any route that reaches for the admin client could read or write any user's data. Containing that needs a separate factory used by exactly one route. It also means a new `envField`, a `wrangler secret put`, a `.dev.vars` entry, and a rotation story.
  - **(B) `security definer` function scoped to `auth.uid()`.** The power stays in the database and is limited to "delete yourself". No new secret, no Worker-side admin client. It follows the existing RPC pattern plus the definer hardening rules. The open risks are:
    - whether the function owner (`postgres` on hosted Supabase) still has DELETE on `auth.users`. The local pgTAP runs prove it locally, but production must be confirmed (open question 1);
    - deleting directly in SQL skips anything GoTrue does in `deleteUser` beyond the row delete (open question 2).
- **The definer function would be a new trust boundary** and needs pgTAP:
  - `function_privs_are`: anon cannot execute it;
  - user A deletes only A, and B's rows are intact;
  - a call with no JWT (`auth.uid()` null) deletes nothing and raises.

## Historical Context (from prior changes)

- `context/archive/2026-09-22-deck-data-contract/plan-brief.md:23` — "FR-003 ("all data goes") is guaranteed by the DB, so S-06 cannot miss the cards."
- `context/archive/2026-10-05-review-and-save-proposals/plan.md:67, :119, :205` — no `generation_id` FK; the `user_id` cascade covers S-06; cascade test.
- `context/archive/2026-10-10-srs-review-session/plan-brief.md:28`, `plan.md:49, :145-146` — log cascades chosen "so S-06 stays simple"; referential actions run as owner.
- `context/archive/2026-10-10-srs-review-session/reviews/impl-review.md:117-120` — F6 deadlock between `record_review` and account deletion, accepted.
- `context/archive/2026-10-10-srs-review-session/follow-ups/review-fixes.md` — the shared `logFailure` helper is still pending.
- `context/changes/deployment/deployment-plan.md:131-132, :620-622, :1095-1097` — publishable-key rule, `wrangler secret put`, E8.
- `context/foundation/infrastructure.md:268-288` — secrets are write-only and not versioned; the human approval list explicitly includes the FR-003 path.
- `context/foundation/roadmap.md:75, :170` — FR-001 and FR-002 already exist; S-06 only closes the lifecycle and does not rebuild auth.

## Related Research

- `context/archive/2026-09-22-deck-data-contract/research.md`
- `context/archive/2026-10-05-review-and-save-proposals/research.md`
- `context/archive/2026-10-10-srs-review-session/research.md`

## Open Questions

1. **Route (A) or (B)?** This is an owner decision because it touches secrets and FR-003 (`infrastructure.md:286-288`). For (B), first prove that the migration owner can `delete from auth.users` on hosted Supabase. A `supabase db push --dry-run` does not prove it; it needs a real call.
2. **(B) only:** does `auth.admin.deleteUser` do anything beyond the row delete that we would skip, such as the audit log or soft-delete identities? Check GoTrue docs during planning.
3. **Cookie teardown after deletion:** does `signOut()` (global or `{scope:'local'}`) clear the `sb-*` cookies when the user no longer exists? If not, the route must clear them explicitly. Verify in implementation with a test.
4. **Q-5 (#5, DAW-9), the confirmation UX.** Options range from the S-04 inline two-step confirm, to typing a confirmation word or the account email, to re-entering the password, which is the strongest proof of intent but needs a new form and a sign-in call. The decision also fixes where the control lives: a new `/account` page linked from `Topbar`, or the dashboard.
5. **Where the user lands afterwards:** `/` with a one-time "account deleted" message, or a dedicated page. Any page must be unprotected and must not depend on the deleted session.
6. **Should the shared `logFailure` refactor land first** so that S-06 does not add a sixth copy? Or should S-06 adopt the helper itself?
7. **The F6 deadlock:** should the delete path retry once on SQLSTATE `40P01`, or surface `server_error` and let the user retry? The window is tiny, because a user deleting their own account while grading in another tab is unlikely.
8. **Doc drift to fix while touching deployment:**
   - `deployment-plan.md:1200` ("exactly two secrets"): there are three, or four with (A).
   - `roadmap.md:196` Q-6 wording ("no test framework at all").
