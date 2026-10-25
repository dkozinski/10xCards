# Home Page Implementation Plan

## Overview

Replace the starter template's landing screen at `/` with a 10xCards home page. Guests see what the app does and how to get in. Signed-in users see a welcome and the three entry points into the loop: generate, review and deck. Remove the leftover `/dashboard` page and the template's default page title along the way.

## Current State Analysis

Found on 2026-10-25: after signing in, the owner lands on a page titled "10x Astro Starter". It shows the template's own blurb ("A production-ready starter with authentication…") and three template feature cards (Authentication Ready, Modern Stack, Developer Experience). Guests see the same page.

- `src/pages/index.astro` renders only `src/components/Welcome.astro`, which holds the hero, the cards and the S-06 `accountDeleted` notice (`Welcome.astro:4-6`, shown only to a guest on `/?deleted=1`).
- Sign-in, sign-up and sign-out all redirect to `/` (`src/pages/api/auth/signin.ts:22`, `signup.ts:32`, `signout.ts:11`). After signing in, `/` is therefore the first screen a user sees.
- `src/pages/dashboard.astro` is the template's example protected page from the scaffold commit `c9b156d`. S-05 (`cc9c842`) added a "Start review" button to it. No PRD requirement (FR-001…FR-012) asks for a dashboard.
- The following places still refer to the dashboard:
  - `src/components/Topbar.astro:22` (a "Dashboard" link);
  - `src/middleware.ts:4` (`PROTECTED_ROUTES`);
  - `AGENTS.md:97` ("Protected page example");
  - `README.md:147` (the Auth routes table).
- `src/layouts/Layout.astro` sets the default `title = "10x Astro Starter"`. `index.astro` passes no title.
- No `.astro` page in the repo has tests. All tests cover `src/lib/` and API routes.

## Desired End State

- A guest on `/` sees:
  - the heading "10xCards";
  - a one-sentence description of the loop;
  - Sign in and Sign up buttons;
  - three cards describing the loop steps.

  No template text remains.
- A signed-in user on `/` sees:
  - "Welcome, <email>";
  - the line "Paste text and generate flashcards — AI will propose cards for your deck.";
  - a primary "Generate with AI" button to `/generate`, plus "Start review" to `/review` and "My deck" to `/deck`.
- `/dashboard` no longer exists (404). The Topbar shows "Home" → `/` in place of "Dashboard".
- The browser tab title for pages without their own title is "10xCards".
- The account-deleted notice behaves exactly as today.

### Key Discoveries:

- `accountDeleted` is computed in `Welcome.astro:6` and requires `!Astro.locals.user`. It must survive the rewrite unchanged.
- The visual language to reuse lives in the current `Welcome.astro`: the `bg-cosmic` background, orbs, star field, gradient heading, the purple primary and outlined secondary buttons, and the `border-white/10 bg-white/5` cards.
- `src/pages/` has no custom 404 page. A removed route gets Astro's default 404, which still passes through the middleware.

## What We're NOT Doing

- **Post-auth redirects** (they stay on `/`), the auth pages, the API and the database.
- **The rest of the README**: its title, intro and Getting Started still describe the template; that is a separate change. Only the `/dashboard` row changes.
- **`context/foundation/roadmap.md`**: its Baseline mentions `dashboard` as a historical snapshot and stays as is.
- **Deck statistics or due-card counts** on the home page.
- **A Polish UI, a logo, the favicon or a visual redesign.**
- **Automated tests for `.astro` pages**: none exist in the repo; this change is checked by hand.

## Implementation Approach

`Welcome.astro` branches on `Astro.locals.user` and renders one of two views inside the existing background and `Topbar`. Everything else is deletion or a one-line text change.

## Phase 1: Home page and template cleanup (local)

### Overview

Rewrite the landing content, delete the dashboard and its references, fix the default title, then check it locally.

### Changes Required:

#### 1. Landing content

**File**: `src/components/Welcome.astro`

**Intent**: Replace the template hero and cards with a guest view and a signed-in view. Keep the background, the `Topbar` and the `accountDeleted` notice.

**Contract**:
- **Guest view**:
  - h1 `10xCards`;
  - subtitle "Paste your notes, get AI-drafted flashcards, keep the ones worth keeping, and review them on a schedule.";
  - the Sign in → `/auth/signin` and Sign up → `/auth/signup` buttons (current styles);
  - three cards replacing the template cards: "Paste text" (AI drafts flashcards from your own notes), "Keep the good ones" (you edit or reject every proposal before it lands in your deck), "Review on schedule" (spaced repetition shows each card when it is due).
- **Signed-in view**:
  - heading "Welcome, {user.email}" (the email may be long: it must wrap rather than overflow on a phone);
  - the line "Paste text and generate flashcards — AI will propose cards for your deck.";
  - "Generate with AI" → `/generate` (primary style);
  - "Start review" → `/review` and "My deck" → `/deck` (secondary style);
  - no feature cards.
- `accountDeleted` keeps its current condition and markup.

#### 2. Remove the dashboard

**Files**: `src/pages/dashboard.astro` (delete), `src/components/Topbar.astro`, `src/middleware.ts`

**Intent**: The home page takes over the dashboard's role, so the page and every reference to it go.

**Contract**:
- `Topbar.astro`: the signed-in "Dashboard" link becomes "Home" → `/`, placed first in the link group, with the same classes.
- `middleware.ts`: `"/dashboard"` is removed from `PROTECTED_ROUTES`. The other entries and all middleware logic stay unchanged.

#### 3. Default title and docs

**Files**: `src/layouts/Layout.astro`, `AGENTS.md`, `README.md`

**Intent**: Remove the remaining template name and dashboard references.

**Contract**:
- `Layout.astro`: the default `title` is `"10xCards"`.
- `AGENTS.md:97`: "Protected page example" points to `src/pages/deck.astro`.
- `README.md:147`: the `/dashboard` row is deleted from the "Auth routes" table. No `/` row is added, because `/` is not an auth route. The sentence below the table already explains `PROTECTED_ROUTES`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Full suite passes: `npm test`
- Build passes: `npm run build`
- No template or dashboard references left in `src/`: `! grep -rnE "Astro Starter|production-ready starter|Authentication Ready|Modern Stack|Developer Experience|/dashboard" src` exits 0

#### Manual Verification:

- As a guest on `npm run dev`, `/` shows the 10xCards page and no template text; Sign in and Sign up open the auth forms; the tab title is "10xCards"
- Signed in, `/` shows "Welcome, <email>", and the three buttons open `/generate`, `/review` and `/deck` (without generating anything)
- Topbar "Home" leads to `/`, and `/dashboard` returns 404
- `/?deleted=1` shows the account-deleted notice as a guest and does not show it when signed in

**Implementation Note**: `npm run dev` uses `.dev.vars`, which points at production Supabase. The owner agreed to sign in with their own account and only view pages. No writes and no AI calls. After automated verification passes, pause for the owner to confirm the manual checks, then run `/10x-impl-review` before the phase commit.

---

## Phase 2: Release

### Overview

PR, CI, merge (merging to `main` deploys to production via Workers Builds), then the same check on production.

### Changes Required:

#### 1. Pull request

**Intent**: One PR from `feat/home-page`. The change does not trace to a roadmap item or issue, so the PR closes nothing.

**Contract**: The PR body states the problem (template landing page), the two views and the dashboard removal.

#### 2. Merge and production check

**Intent**: Prove that production serves the new page.

**Contract**:
- After the Workers Builds deploy, `curl -s https://10xcards.dkozinski.workers.dev/` contains `10xCards` and does not contain `Astro Starter`.
- `curl -s -o /dev/null -w '%{http_code}' https://10xcards.dkozinski.workers.dev/dashboard` returns `404`.
- The owner signs in on production and sees the signed-in view.
- Rollback: `npm run deploy:rollback` reverts code only. No data or schema is involved.

### Success Criteria:

#### Automated Verification:

- CI green on the PR: `gh pr checks <n>`
- Workers Builds green on the merge commit

#### Manual Verification:

- Production `/` serves the 10xCards page and `/dashboard` returns 404
- Owner sees the signed-in view on production

---

## Testing Strategy

### Unit Tests:

- None added. The change is markup and copy, and the repo has no `.astro` page tests. The existing suite guards the untouched API and lib code.

### Manual Testing Steps:

1. Guest view, auth buttons and tab title on local dev (Phase 1).
2. Signed-in view and its three links on local dev (Phase 1).
3. `/dashboard` 404 and the `/?deleted=1` notice behaviour (Phase 1).
4. The same on production after the merge (Phase 2).

## Performance Considerations

None. `Astro.locals.user` is already resolved by the middleware on every request.

## Migration Notes

No data or schema changes. Bookmarks to `/dashboard` will hit a 404; the only user is the owner.

## References

- Approved proposal: `/home/dawid/.claude/plans/hashed-herding-thacker.md`
- Account-deleted notice: `context/archive/2026-10-11-account-and-data-deletion/plan.md`
- Release pattern: `context/archive/2026-10-25-auth-unavailable-message/plan.md` Phase 2

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Home page and template cleanup (local)

#### Automated

- [x] 1.1 Lint passes — a952e38
- [x] 1.2 Full suite passes — a952e38
- [x] 1.3 Build passes — a952e38
- [x] 1.4 No template or dashboard references left in `src/` — a952e38

#### Manual

- [x] 1.5 Guest view on local dev shows the 10xCards page, working auth buttons and the "10xCards" tab title — a952e38
- [x] 1.6 Signed-in view shows "Welcome, <email>" and the three buttons open their pages — a952e38
- [x] 1.7 Topbar "Home" leads to `/` and `/dashboard` returns 404 — a952e38
- [x] 1.8 `/?deleted=1` notice shows for a guest only — a952e38

### Phase 2: Release

#### Automated

- [x] 2.1 CI green on the PR — 469a705
- [x] 2.2 Workers Builds green on the merge commit — 469a705

#### Manual

- [x] 2.3 Production `/` serves the 10xCards page and `/dashboard` returns 404 — 469a705
- [x] 2.4 Owner sees the signed-in view on production — 469a705
