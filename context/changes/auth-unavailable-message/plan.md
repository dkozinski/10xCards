# Auth Unavailable Message Implementation Plan

## Overview

When Supabase Auth is unreachable or failing, the sign-in, sign-up and email-confirm pages show a bare `{}` (or a raw server string) instead of a message a user can act on. This change shows "The service is temporarily unavailable. Please try again later." for those failures and logs the original error to the Worker logs. It informs the user only; it does not prevent the outage itself.

## Current State Analysis

Found on 2026-10-25: production sign-in failed after ~2 weeks without use. The free-tier Supabase project had been paused for inactivity (`supabase projects list` showed `COMING_UP` → `RESTORING` → `ACTIVE_HEALTHY`). During the outage the Worker answered normally, but a failed sign-in redirected to `/auth/signin?error=%7B%7D`. After the restore, the same probe returned `?error=Invalid%20login%20credentials`.

Why `{}`: `@supabase/auth-js` v2.105.3 `dist/module/lib/fetch.js:22-30`. A response with a status in `NETWORK_ERROR_CODES` (`502, 503, 504, 520–524, 530`) is thrown as `AuthRetryableFetchError(_getErrorMessage(response))`. A `Response` has no `msg`/`message`/`error` field, so `_getErrorMessage` falls back to `JSON.stringify(response)` → `"{}"`. The other failure shapes have their own messages:
- a non-JSON body → `AuthUnknownError` with the `SyntaxError` text (`fetch.js:37`);
- a network failure → `AuthRetryableFetchError` with status `0` (`fetch.js:26`, `:112`);
- a JSON 5xx → `AuthApiError` with the server's text, e.g. "Database error saving new user" (`fetch.js:72`).

Every auth route forwards `error.message` verbatim into `?error=`, which `ServerError` renders:
- `src/pages/api/auth/signin.ts:18`
- `src/pages/api/auth/signup.ts:24`
- `src/pages/auth/confirm.ts:54`, `:63` (via `signinWithError`)

`signout.ts` ignores the error and shows nothing.

An uncommitted draft on branch `fix/auth-unavailable-message` already adds `src/lib/auth-errors.ts` (+ test) and routes the four call sites through it. It covers retryable/unknown only, says "try again in a moment", and has no route test. Phase 1 brings it in line with this plan.

## Desired End State

- A sign-in, sign-up or confirm attempt that fails with any of the following shows "The service is temporarily unavailable. Please try again later." on the auth page:
  - `AuthRetryableFetchError`;
  - `AuthUnknownError`;
  - an `AuthApiError` with status ≥ 500.
- Every other auth error (4xx: wrong credentials, existing user, weak password, expired OTP) shows exactly the text it shows today.
- Each replaced error writes one `console.error` line with the error's `name`, `status` and `message`, and no email, password or token.
- Successful flows and redirect targets are byte-for-byte unchanged.

### Key Discoveries:

- Error classification source: `node_modules/@supabase/auth-js/dist/module/lib/fetch.js:5-37, :72` (v2.105.3).
- `isAuthRetryableFetchError` and the error classes are re-exported by `@supabase/supabase-js`. There is no `isAuthUnknownError` guard, so match on `error.name === "AuthUnknownError"`.
- Logging convention: `console.error` preceded by `// eslint-disable-next-line no-console` (`src/pages/api/account/index.ts:18-19`).
- Route test pattern: `vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }))`, with the handler called using a hand-built context (`src/pages/api/flashcards/[id].test.ts:8, :44-52`). The real module imports `astro:env/server`, which does not exist under vitest.
- UI copy is English (`"Supabase is not configured"`, `signin.ts:13`).

## What We're NOT Doing

- **Middleware.** During an outage, `src/middleware.ts:10-13` ignores the `getUser()` error and a signed-in user on a protected route is redirected to `/auth/signin` with no message. This is left as is. On that page, a sign-in attempt will show the new message.
- **Keeping Supabase awake** (cron keep-alive or paid plan). That is a separate change.
- **`signout.ts`**: it shows no error today.
- **Non-auth API routes**: they already return `server_error` through `apiError()`.
- **Retry logic or i18n.**

## Implementation Approach

One pure helper owns the decision "show the server's message, or the unavailable message". Each auth route calls it at its existing `error.message` site. The rule is keyed on error class and HTTP status, never on message text, so it does not depend on Supabase's wording.

## Phase 1: Helper and auth routes (local)

### Overview

Finish the draft against this plan, add the route test, and prove the outage path locally.

### Changes Required:

#### 1. Helper

**File**: `src/lib/auth-errors.ts`

**Intent**: Map an `AuthError` to the user-facing message and log the replaced ones.

**Contract**:
- Exports `AUTH_UNAVAILABLE_MESSAGE = "The service is temporarily unavailable. Please try again later."`.
- Exports `authErrorMessage(error: AuthError): string`. It returns `AUTH_UNAVAILABLE_MESSAGE` when any of these holds, and `error.message` otherwise:
  - `isAuthRetryableFetchError(error)`;
  - `error.name === "AuthUnknownError"`;
  - `(error.status ?? 0) >= 500`.
- On the unavailable branch it writes one `console.error("Supabase auth unavailable", { name, status, message })`.

#### 2. Call sites

**Files**: `src/pages/api/auth/signin.ts`, `src/pages/api/auth/signup.ts`, `src/pages/auth/confirm.ts`

**Intent**: Replace `error.message` with `authErrorMessage(error)` at the four sites listed above. Nothing else changes in these files.

#### 3. Tests

**Files**: `src/lib/auth-errors.test.ts`, `src/pages/api/auth/signin.test.ts` (new)

**Intent**:
- **Helper**: pin the classification boundary in both directions.
- **Route test**: prove the route actually uses the helper.

**Contract**:
- Helper cases:
  - `AuthApiError` 400 "Invalid login credentials" → passed through, nothing logged;
  - `AuthRetryableFetchError("{}", 503)` and `("{}", 0)` → unavailable;
  - `AuthUnknownError` → unavailable;
  - `AuthApiError` 500 "Database error saving new user" → unavailable;
  - the log line contains no email.
- Route cases for `POST /api/auth/signin` with a form body and `createClient` mocked:
  - `signInWithPassword` resolves with an `AuthRetryableFetchError` → `Location` is `/auth/signin?error=` + the encoded unavailable message;
  - an `AuthApiError` 400 → `Location` carries "Invalid login credentials";
  - no error → `Location: /`.
- No existing test covers a redirect or form route. The context stub provides:
  - `request`: a `POST` `Request` with a `FormData` body;
  - `cookies: {}`;
  - `redirect: (url) => new Response(null, { status: 302, headers: { Location: url } })`.

  The assertions therefore check the URL the handler passed to `redirect`.

#### 4. Local outage proof

**Intent**: See the message in a real browser on the exact branch that failed in production (a 503 → `AuthRetryableFetchError("{}", 503)`, `fetch.js:28-30`), without touching production or the local Supabase stack.

**Contract**: This follows the `.dev.vars` swap procedure; the file points at production.
1. Start a throwaway stub on `127.0.0.1:54399` that answers every request with `503`. It is a few lines of node, kept in the session scratchpad and not in the repo.
2. Get the owner's go-ahead for the swap, then back up `.dev.vars`.
3. Using `sed -i`, swap only `SUPABASE_URL` → `http://127.0.0.1:54399` and `SUPABASE_KEY` → any placeholder; the stub ignores it. Never print a value line.
4. Submit the sign-in form on `npm run dev` → the unavailable message is shown, and the dev server log has one `Supabase auth unavailable` line with status 503.
5. Restore with `cp -p` and `chmod 664`, confirm the sha256 matches the backup, then stop the stub.

The local Supabase stack is not stopped or touched. Local only: nothing leaves the machine.

### Success Criteria:

#### Automated Verification:

- Unit and route tests pass: `npx vitest run src/lib/auth-errors.test.ts src/pages/api/auth/signin.test.ts`
- Full suite passes: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Local sign-in against a 503 stub shows "The service is temporarily unavailable. Please try again later."
- Dev server log shows one `Supabase auth unavailable` line (status 503) with no email
- `.dev.vars` restored, sha256 matches backup

**Implementation Note**: After automated verification passes, pause for the owner to confirm the manual checks, then run `/10x-impl-review` before the phase commit.

---

## Phase 2: Release

### Overview

PR, CI, merge (merge to `main` deploys to production via Workers Builds), then a production regression check. The outage path cannot be triggered on production on demand; Phase 1 proves it locally.

### Changes Required:

#### 1. Pull request

**Intent**: One PR from `fix/auth-unavailable-message`. This change does not trace to a roadmap item or issue, so the PR closes nothing.

**Contract**: The PR body states the cause (paused free-tier project → `{}`), the classification rule, and that middleware and keep-alive are out of scope.

#### 2. Merge and production check

**Intent**: Prove that the normal error path is unchanged in production.

**Contract**:
- After the Workers Builds deploy, a form POST to `https://10xcards.dkozinski.workers.dev/api/auth/signin` with a non-existent email (with an `Origin` header) → `302` with `Location: /auth/signin?error=Invalid%20login%20credentials`.
- The owner signs in with their real account successfully.
- Rollback: `npm run deploy:rollback` reverts code only. No data or schema is involved.

### Success Criteria:

#### Automated Verification:

- CI green on the PR: `gh pr checks <n>`
- Workers Builds green on the merge commit

#### Manual Verification:

- Production fake-account probe redirects with "Invalid login credentials"
- Owner signs in on production successfully

---

## Testing Strategy

### Unit Tests:

- Classification boundary: 4xx passes through; retryable (503, 0), unknown and 5xx `AuthApiError` are replaced.
- No email in the log payload.

### Integration Tests:

- `POST /api/auth/signin` redirect `Location` for the outage, wrong-credentials and success cases.

### Manual Testing Steps:

1. Local sign-in against a 503 stub shows the message (Phase 1).
2. Production fake-account probe still shows "Invalid login credentials" (Phase 2).
3. Owner's real sign-in on production (Phase 2).

## Performance Considerations

None. One extra function call on the error path only.

## Migration Notes

No data or schema changes.

## References

- Diagnosis: this change's session, 2026-10-25 (probe results under Current State Analysis)
- auth-js error mapping: `node_modules/@supabase/auth-js/dist/module/lib/fetch.js:5-37, :72` (v2.105.3)
- Logging pattern: `src/pages/api/account/index.ts:18-19`
- Route test pattern: `src/pages/api/flashcards/[id].test.ts:8, :44-52`
- Release pattern: `context/archive/2026-10-11-account-and-data-deletion/plan.md` Phase 4

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Helper and auth routes (local)

#### Automated

- [x] 1.1 Unit and route tests pass — 8e81712
- [x] 1.2 Full suite passes — 8e81712
- [x] 1.3 Lint passes — 8e81712
- [x] 1.4 Build passes — 8e81712

#### Manual

- [x] 1.5 Local sign-in against a 503 stub shows the unavailable message — 8e81712
- [x] 1.6 Dev server log shows one `Supabase auth unavailable` line (status 503) with no email — 8e81712
- [x] 1.7 `.dev.vars` restored, sha256 matches backup — 8e81712

### Phase 2: Release

#### Automated

- [ ] 2.1 CI green on the PR
- [ ] 2.2 Workers Builds green on the merge commit

#### Manual

- [ ] 2.3 Production fake-account probe redirects with "Invalid login credentials"
- [ ] 2.4 Owner signs in on production successfully
