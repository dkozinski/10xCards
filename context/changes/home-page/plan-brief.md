# Home Page — Plan Brief

> Full plan: `context/changes/home-page/plan.md`

## What & Why

`/` still shows the starter template's landing page ("10x Astro Starter", a template blurb, and cards about the tech stack). Guests see it on the first visit, and every signed-in user sees it after sign-in, sign-up and sign-out. This change replaces it with a 10xCards home page that explains the product to guests and gives signed-in users a clear starting point. It closes M-1's user-facing gaps before the milestone is closed.

## Starting Point

`index.astro` renders `Welcome.astro`, which holds the template hero and cards and the S-06 account-deleted notice. A separate `/dashboard` page, also from the template, is linked from the Topbar and protected in the middleware; no PRD requirement asks for it.

## Desired End State

- **Guests** see "10xCards", one sentence on the loop, Sign in / Sign up, and three cards for the loop steps.
- **Signed-in users** see "Welcome, <email>" and buttons for Generate with AI, Start review and My deck.
- **`/dashboard` is gone.** The Topbar's "Dashboard" link becomes "Home".
- **The default tab title is "10xCards".**

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Signed-in `/` | Welcome + three entry buttons | Matches the course reference and gives a clear start after sign-in. |
| Guest `/` | Same visual style, 10xCards copy | A small copy change; the look already works. |
| `/dashboard` | Delete page, link, middleware entry and docs | Not in the PRD; the home page takes over its role. |
| UI language | English | The rest of the UI is English. |
| README | Only the `/dashboard` row | Keeps this change focused; a README rewrite is separate. |
| Tests | No new tests; lint, build and the suite, plus a manual check | The repo has no `.astro` page tests; the change is copy and links. |
| Manual check | `npm run dev` against production Supabase, view only | The home page writes nothing, and `.dev.vars` stays untouched. |

## Scope

**In scope:**
- `Welcome.astro`;
- deleting `dashboard.astro`;
- the `Topbar` link and the `PROTECTED_ROUTES` entry;
- the `Layout` default title;
- one line each in `AGENTS.md` and `README.md`.

**Out of scope:**
- auth redirects, the API and the database;
- the rest of the README;
- the roadmap Baseline;
- deck stats on the home page;
- a Polish UI, logo or redesign.

## Architecture / Approach

`Welcome.astro` branches on `Astro.locals.user`, which the middleware already sets, and renders the guest or signed-in view inside the existing background and Topbar. Everything else is deletion or a one-line text edit.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Home page and template cleanup (local) | Both views, dashboard removed, local check | Breaking the S-06 account-deleted notice; it is checked explicitly |
| 2. Release | PR, merge (= deploy), production check | Merge deploys immediately; rollback is code-only and cheap |

**Prerequisites:** none.
**Estimated effort:** one short session.

## Open Risks & Assumptions

- A bookmark to `/dashboard` will 404. The owner is the only user.
- The local check signs in to production Supabase, view only: no writes and no AI calls.

## Success Criteria (Summary)

- Nobody sees "10x Astro Starter" anywhere in the app.
- After sign-in, the user knows where to start: Generate, Review or Deck.
- The account-deleted notice still appears for a guest after account deletion.
