# Auth Unavailable Message — Plan Brief

> Full plan: `context/changes/auth-unavailable-message/plan.md`

## What & Why

When Supabase Auth is down, the sign-in, sign-up and confirm pages show a bare `{}`. This happened on 2026-10-25 because the free-tier project was paused after a week of inactivity. Users get no clue whether they typed something wrong or the service is down. This change replaces such failures with "The service is temporarily unavailable. Please try again later." It informs; it does not prevent the outage.

## Starting Point

All three auth routes forward `error.message` from `@supabase/auth-js` into `?error=`. For gateway statuses 502–530, auth-js builds that message as `JSON.stringify(response)`, which is `{}`. An uncommitted draft helper already exists on `fix/auth-unavailable-message`.

## Desired End State

Outage-class auth failures show one clear message and leave a log line in the Worker logs. Ordinary errors (wrong password, existing user, weak password, expired link) and every success path behave exactly as today.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Auth routes only; middleware untouched | Delivers the reported fix without touching the every-request path. | Plan |
| What counts as "unavailable" | Retryable fetch error, unknown error, or any `AuthApiError` ≥ 500 | Users never see internal server text; the rule keys on class and status, not wording. | Plan |
| Message | "…Please try again later." (not "in a moment") | A paused project does not wake by itself, so "in a moment" over-promises. | Plan |
| Tests | Helper unit tests + `POST /api/auth/signin` route test | Proves the route really uses the helper, following the `flashcards/[id].test.ts` pattern. | Plan |
| Release proof | Local 503-stub check + production regression probe | The outage cannot be triggered on production on demand; a 503 stub hits the exact branch that produced `{}`. | Plan |

## Scope

**In scope:** `src/lib/auth-errors.ts` + test; `signin.ts`, `signup.ts`, `confirm.ts` call sites; `signin.test.ts`.

**Out of scope:** middleware messaging during an outage; keeping Supabase awake; `signout.ts`; non-auth API routes; i18n.

## Architecture / Approach

One pure helper, `authErrorMessage(error)`, decides between the server's message and the unavailable message, and logs only the replaced ones. The four existing `error.message` sites call it. There is no new state, route or dependency.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Helper and auth routes (local) | Classified messages, tests, local outage proof | `.dev.vars` points at production; the swap must not leak values |
| 2. Release | PR, merge (= production deploy), regression probe | Merge deploys immediately; rollback is code-only and cheap |

**Prerequisites:** the owner's go-ahead for the `.dev.vars` swap.
**Estimated effort:** one short session.

## Open Risks & Assumptions

- Assumes auth-js keeps the `AuthRetryableFetchError` / `AuthUnknownError` names; the unit tests pin this against the installed version.
- A genuine config bug returning a 5xx would also read as "unavailable"; the Worker log line keeps it diagnosable.

## Success Criteria (Summary)

- During an outage the auth pages say the service is unavailable instead of `{}`.
- Wrong-password and similar errors read exactly as before.
- Production sign-in works after the merge.
