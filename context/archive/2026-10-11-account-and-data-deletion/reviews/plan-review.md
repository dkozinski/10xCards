<!-- PLAN-REVIEW-REPORT -->
# Plan Review: S-06 Account and Data Deletion

- **Plan**: context/changes/account-and-data-deletion/plan.md
- **Mode**: Deep
- **Date**: 2026-10-11
- **Verdict**: SOUND. All findings were fixed in the plan.
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

- **Paths:** 8/8 exist.
- **Symbols:** 5/5 found (`PROTECTED_ROUTES`, `readBody`, `deploy:rollback`, `db:types`, `Topbar` reading `Astro.locals.user`).
- **Brief and plan:** consistent.
- **Progress and phases:** consistent, 30/30 items.

## Claims verified in code

Checked against astro 6.4.8, @astrojs/cloudflare 13.7.0 and auth-js 2.105.3.

- **Cookies set via `context.cookies` reach a manually built `new Response(null, {status: 204})`.**
  - `astro-middleware.js:39-46` (`attachCookiesToResponse`) attaches them.
  - The Cloudflare adapter serialises them: `@astrojs/cloudflare/dist/utils/handler.js:58-69`.
- **`signOut()` ignores 401, 403 and 404, then clears the session** (`GoTrueClient.js:3186-3200`). A network error returns before the clearing step. The plan already treats a sign-out failure as non-fatal.
- **Supabase default privileges grant EXECUTE on new `public` functions to anon, authenticated and service_role.** The explicit revokes in the plan are required.
- **`supabase db dump --linked --schema auth` keeps GRANT statements.** This was inferred from the CLI's embedded dump script, not from a real run.

## Findings

### F1: The Phase 3 error-path test would not reach the error it targets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW (quick decision; the fix is obvious and narrowly scoped)
- **Dimension**: Blind Spots
- **Location**: Phase 3, Manual Verification (Progress 3.8)
- **Detail**: Stopping the local DB also stops GoTrue. `getUser()` then fails and the route returns 401, so the "not deleted, try again" message is never shown.
- **Fix**: Force a `server_error` by revoking EXECUTE from `authenticated` in Studio, then restore the grant and re-run pgTAP.
- **Decision**: FIXED

### F2: The pgTAP assertion for role "public" would error

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW (quick decision; the fix is obvious and narrowly scoped)
- **Dimension**: Plan Completeness
- **Location**: Phase 1, pgTAP test
- **Detail**: PUBLIC is not a role in `pg_roles`, and no existing test asserts PUBLIC.
- **Fix**: Keep `function_privs_are` for anon, authenticated and service_role. Assert PUBLIC separately with `aclexplode(proacl)` and `grantee = 0`.
- **Decision**: FIXED

### F3: The CSRF rationale named the wrong mechanism

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW (quick decision; the fix is obvious and narrowly scoped)
- **Dimension**: Blind Spots
- **Location**: Key Discoveries
- **Detail**: The route does not enforce a Content-Type, so "JSON needs a preflight" is not the guard. The real guard is that `DELETE` is never a simple CORS method, and HTML forms cannot send it.
- **Fix**: Reword the bullet.
- **Decision**: FIXED

### F4: `locals.user.email` is `string | undefined`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW (quick decision; the fix is obvious and narrowly scoped)
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details; Phase 2 route
- **Detail**: The plan did not say what happens when the user has no email.
- **Fix**: Narrow the value with `email ?? ""`, which gives `validation_failed`. That is acceptable because every account in this app has an email.
- **Decision**: FIXED
