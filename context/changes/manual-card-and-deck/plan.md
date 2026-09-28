# Manual Card and Deck (S-01) Implementation Plan

## Overview

A signed-in user can write a flashcard by hand (front + back), save it, and see it at the top of a paginated "My deck" list on a new `/deck` page. Saving goes through a JSON endpoint, `POST /api/flashcards`, which S-03 will reuse for bulk-saving AI proposals. The list is rendered on the server. This is the first slice that crosses every layer (database, service, API route, page, React island), and it adds the first JS test framework. Roadmap item S-01; PRD FR-008, FR-009, NFR durability, NFR data isolation.

## Current State Analysis

- **Store is done (F-01).** `public.flashcards` has per-operation RLS for `authenticated` and `anon`, and `user_id` defaults to `auth.uid()`. The CHECK constraints are non-blank after `btrim`, `front` ≤ 200 and `back` ≤ 500 (`supabase/migrations/20260922190157_create_flashcards.sql:15-16`). `supabase/tests/flashcards_rls.test.sql` proves two-account isolation. **No migration is needed in this slice.**
- **Types are done.** `FlashcardDto` and `CreateFlashcardCommand` (`front`, `back`, no `user_id`) live in `src/types.ts:6-9`. `createClient` is typed with `Database` (`src/lib/supabase.ts:10`).
- **Missing:** `src/lib/services/`, any flashcard route, any deck UI, and any JS test framework (`package.json` has no `test` script).
- **Existing patterns:**
  - The auth routes (`src/pages/api/auth/signin.ts`) use form POST, redirect, and `?error=`. They predate the closed error vocabulary in AGENTS.md and are **not** the pattern for new JSON routes.
  - The React form idiom is `SignInForm.tsx` with `FormField`, `ServerError` and `SubmitButton` from `src/components/auth/`, plus client-side validation and `noValidate`.
  - Protected pages are guarded by `PROTECTED_ROUTES` in `src/middleware.ts:4`, which is prefix-matched. A protected **page** redirects to `/auth/signin`. An API route must return 401 itself, so it must **not** be added to `PROTECTED_ROUTES`.
  - The middleware already sets `Cache-Control: private, no-store` on every response (`src/middleware.ts:37-39`). The new page and route inherit it.

## Desired End State

- `/deck` (protected) shows a "New flashcard" form above the user's cards, newest first, 50 per page, with Newer/Older links driven by `?page=N`.
- Saving a valid card lands the user on `/deck` page 1 with the new card at the top. An invalid card shows the error next to the field, and the typed text is kept.
- `POST /api/flashcards` returns `201` + `FlashcardDto`, or one of `401 unauthorized`, `400 invalid_json`, `400 validation_failed`, `500 server_error`, all in one error shape.
- A second account never sees the first account's cards. Cards survive sign-out and a different browser.
- `npm test` (Vitest) runs in CI next to lint and build.

### Key Discoveries:

- Supabase's API caps any single response at `max_rows = 1000` (`supabase/config.toml`, Supabase docs via Context7). An unpaginated list would silently drop card 1001, so pagination is required, not cosmetic.
- Pagination uses `.select("*", { count: "exact" }).order(...).range(from, to)` from supabase-js. `range` is inclusive on both ends.
- Vitest integrates through `getViteConfig()` from `astro/config` (Astro docs via Context7, `with-vitest` starter).
- Astro Actions were considered and **rejected**. Their errors use `ActionError` codes (`BAD_REQUEST`, …), which would bypass the closed error vocabulary in AGENTS.md. S-03 needs the same JSON contract.

## What We're NOT Doing

- Editing and deleting cards (S-04). No `PATCH` or `DELETE` routes.
- A `GET /api/flashcards` endpoint. The page reads through the service on the server.
- Search, filtering or sorting controls (PRD Non-Goals).
- A card-origin column (`manual` / `ai`), which is deferred to S-03 (F-01 decision).
- Any migration or RLS change.
- Browser E2E tests (Playwright).
- Migrating the auth routes to the JSON error vocabulary.
- Mobile layout work (PRD Non-Goals). The page just must not break at narrow widths.

## Implementation Approach

The work is built bottom-up, so each layer is tested before the next one uses it. Phase 1 builds the pure, framework-free pieces: validation, errors, pagination maths, and the test harness. Phase 2 adds the database-touching service and the route, with tests against a stubbed Supabase client. Phase 3 is the UI, verified by hand across two accounts.

Isolation is **not** re-implemented in application code. The service never filters by `user_id` and never sends one. RLS scopes every query to the caller, and the column default fills `user_id` on insert. Adding an app-side filter would suggest the app is the security boundary, and it is not.

## Critical Implementation Details

- **Trim before validate, store trimmed.** The DB checks `char_length(btrim(front)) >= 1` but `char_length(front) <= 200` on the raw value. The zod schema trims first and then applies 1–200 / 1–500, and the trimmed value is what gets inserted. This way the app and the DB agree on every input, including `"   "` (rejected) and 200 characters with surrounding spaces (accepted as ≤ 200 after trim).
- **Vitest and the Cloudflare adapter.** `getViteConfig()` loads `astro.config.mjs`, including `@astrojs/cloudflare`. If the adapter breaks the Vitest run, fall back to a plain `vitest.config.ts` with the `@` alias. Tests never import `astro:env/server` directly: route tests `vi.mock("@/lib/supabase")`, so the virtual module is never resolved.
- **Page clamping.** A missing, non-numeric or `< 1` `?page` means page 1. A page beyond the last redirects to the last page, or to page 1 when the deck is empty. That way a stale "Older" link never shows an empty list that looks like lost data.

## Phase 1: Test harness, validation and error vocabulary

### Overview

Add Vitest plus the pure modules the route and page depend on, each covered by unit tests.

### Changes Required:

#### 1. Vitest setup

**File**: `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`

**Intent**: Give the repo its first JS test runner and make CI run it before merge.

**Contract**: The `vitest` dev dependency, a `"test": "vitest run"` script, and `vitest.config.ts` via `getViteConfig()` (see Critical Implementation Details for the fallback). Tests live next to their subject as `*.test.ts`. `ci.yml` gets `- run: npm test` after lint. Its `branches: [main]` filter is already correct (lessons.md rule checked).

#### 2. Flashcard input schema

**File**: `src/lib/validation/flashcard.ts`

**Intent**: A single validation rule for a new card, shared by the route (authoritative) and the island (early feedback), mirroring the DB CHECKs.

**Contract**: It exports `createFlashcardSchema` (zod object `{ front, back }`, each `trim()` and then `min(1)`, with `max(200)` and `max(500)` respectively) and the limits `FRONT_MAX = 200` and `BACK_MAX = 500`. The parsed output type is assignable to `CreateFlashcardCommand`. The module is safe to import in the browser (no server imports).

#### 3. API error vocabulary

**File**: `src/lib/api-errors.ts`, `AGENTS.md`

**Intent**: One place that owns the closed error vocabulary and the response shape, so no route invents a code inline.

**Contract**:
- `type ApiErrorCode = "validation_failed" | "invalid_json" | "unauthorized" | "server_error"`.
- `apiError(code, message, details?)` returns a `Response` with JSON body `{ error: { code, message, details? } }` and the status fixed by the code: 400, 400, 401 and 500 respectively.
- For `validation_failed`, `details` is `{ fieldErrors: Partial<Record<"front" | "back", string[]>> }`.
- AGENTS.md's hard rule gains `server_error` (500, unexpected server/database failure) and a pointer to this module.

#### 4. Pagination helper

**File**: `src/lib/pagination.ts`

**Intent**: Pure page maths, testable without a database.

**Contract**: `PAGE_SIZE = 50`. `parsePage(raw: string | null): number` returns ≥ 1 and falls back to 1. `pageWindow(page, total)` returns `{ from, to, lastPage, hasNewer, hasOlder }`, where `from`/`to` are the inclusive `range()` bounds and `lastPage` is at least 1.

### Success Criteria:

#### Automated Verification:

- `npm test` passes: schema accepts 1/200 and 1/500 characters, rejects 0, 201 and 501 characters and whitespace-only, and trims surrounding spaces
- `npm test` passes: `apiError` emits the right status and body for each of the four codes
- `npm test` passes: `pageWindow` for total 0, 50 and 51 (51 gives lastPage 2, page 2 from 50 to 99), and `parsePage` for `null`, `"0"`, `"-3"`, `"abc"`, `"2"`
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- CI on the PR shows the new test step running and green

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Flashcard service and `POST /api/flashcards`

### Overview

Add the database-touching layer and the JSON endpoint S-03 will reuse.

### Changes Required:

#### 1. Flashcard service

**File**: `src/lib/services/flashcards.ts`

**Intent**: The only module that queries `flashcards`. It takes the request-scoped client, so RLS applies to the caller.

**Contract**:
- `createFlashcard(supabase: SupabaseClient<Database>, cmd: CreateFlashcardCommand): Promise<FlashcardDto>` inserts `{ front, back }` only, returns the inserted row (`.select().single()`), and throws on DB error.
- `listFlashcards(supabase, { from, to }): Promise<{ items: FlashcardDto[]; total: number }>` orders by `created_at desc` and then `id desc` (a deterministic tiebreak), and uses `count: "exact"`.
- Neither function adds a `user_id` filter or value. DTOs stay snake_case.

#### 2. Create route

**File**: `src/pages/api/flashcards/index.ts`

**Intent**: The JSON entry point for creating a card.

**Contract**: `export const prerender = false` and `POST` only, evaluated in this order:
1. No `context.locals.user` gives `unauthorized`.
2. `createClient` returns null gives `server_error`.
3. A body that is not valid JSON gives `invalid_json`.
4. `createFlashcardSchema.safeParse` fails gives `validation_failed` with field errors.
5. Otherwise `createFlashcard` runs and the route returns `201` with the `FlashcardDto` JSON.
6. A service throw is logged with `console.error` and gives `server_error`, without leaking the DB message.

#### 3. Route tests

**File**: `src/pages/api/flashcards/index.test.ts`

**Intent**: Lock in the status/code contract for every branch.

**Contract**: `vi.mock("@/lib/supabase")` returns a stub client. The test calls `POST` with a minimal context (`request`, `locals.user`, `cookies`). It covers each branch in the list above, and it asserts that the insert payload has no `user_id` and has trimmed values.

### Success Criteria:

#### Automated Verification:

- `npm test` passes, including all six route branches
- `npm run lint` passes
- `npm run build` passes
- `npx supabase test db` still passes (RLS suite untouched)

#### Manual Verification:

- Against the local stack (`npm run dev`), `curl` with a session cookie creates a row visible in Supabase Studio under the signed-in user's id. Without a cookie it returns 401 `unauthorized`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: `/deck` page, form island and navigation

### Overview

The user-facing slice: write a card, see it in the deck.

### Changes Required:

#### 1. Deck page

**File**: `src/pages/deck.astro`

**Intent**: A server-rendered deck with the form island on top.

**Contract**: The page reads `?page` via `parsePage`, calls `listFlashcards` with the `pageWindow` bounds, and redirects when the page is out of range (see Critical Implementation Details). It renders each card's front and back in full (no truncation), a "Page N of M" line with Newer/Older links, and an empty state when the deck has no cards. It uses `Layout` and `Topbar` and follows the visual style of `dashboard.astro`. `<NewFlashcardForm client:load />`.

#### 2. New-flashcard island

**File**: `src/components/deck/NewFlashcardForm.tsx`

**Intent**: Collect front/back, validate early, submit as JSON, and show errors without losing input.

**Contract**:
- Two textareas with character counters (`FRONT_MAX` / `BACK_MAX`). Client-side validation uses `createFlashcardSchema`.
- The island submits with `fetch` to `POST /api/flashcards` (JSON), and disables the button while the request is pending.
- On `201` it runs `window.location.assign("/deck")`.
- On `validation_failed` it maps `details.fieldErrors` onto the fields.
- On any other error, or a network failure, it shows a message via `ServerError`.
- Inputs are cleared only on success. It reuses `ServerError`, and `FormField` only if it fits a textarea; otherwise the island gets a local textarea field that matches its styling.

#### 3. Navigation and protection

**File**: `src/middleware.ts`, `src/components/Topbar.astro`

**Intent**: Make `/deck` reachable and guarded.

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/deck"]`, and the Topbar gets a "My deck" link next to "Dashboard" for signed-in users.

### Success Criteria:

#### Automated Verification:

- `npm test` passes
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Signed out, opening `/deck` redirects to `/auth/signin`
- Account A saves a card: the page returns to `/deck` with the card at the top of page 1
- An empty front, whitespace only, or 201 characters shows a field error and the typed text stays in place
- 51 cards produce two pages, and Newer/Older links move between them. `?page=99` redirects to the last page
- Account B (second browser) sees an empty deck, not A's cards
- A signs out, signs in on a different browser, and all cards are still there
- After merge (Workers Builds deploys `main` to production), repeat the save and isolation check on the live URL

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- Schema boundaries: 0/1/200/201 for front, 0/1/500/501 for back, whitespace-only, trim behaviour
- `apiError` status and body per code
- Pagination: totals 0, 50, 51; `parsePage` garbage inputs

### Integration Tests:

- Route handler with a stubbed Supabase client, covering the six branches in Phase 2 order
- RLS isolation remains covered by the F-01 pgTAP suite (`npx supabase test db`)

### Manual Testing Steps:

1. Two accounts in two browsers, as listed in Phase 3 Manual Verification.
2. The durability check across sign-out and a second browser.
3. The production smoke check after merge.

## Performance Considerations

Each page load runs one query: 50 rows plus an exact count, on `flashcards_user_id_idx`. That is fine at MVP deck sizes. If `count: "exact"` becomes slow for very large decks, switch to `"estimated"` or cursor pagination. That is not needed now.

## Migration Notes

None. No schema change. Merging to `main` deploys to production through Workers Builds. Rolling back is `npm run deploy:rollback` or reverting the merge, and either is safe because no data shape changes.

## References

- F-01 plan: `context/archive/2026-09-22-deck-data-contract/plan.md`
- Roadmap: `context/foundation/roadmap.md` (S-01)
- Form idiom: `src/components/auth/SignInForm.tsx`
- Route idiom (`prerender`, `createClient`): `src/pages/api/auth/signin.ts`
- Astro testing guide (Vitest `getViteConfig`), Astro Actions guide: Context7 `/withastro/docs`
- supabase-js `range` / `count`, `max_rows`: Context7 `/supabase/supabase`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test harness, validation and error vocabulary

#### Automated

- [x] 1.1 `npm test` passes: schema boundaries and trimming — 906a352
- [x] 1.2 `npm test` passes: `apiError` per code — 906a352
- [x] 1.3 `npm test` passes: `pageWindow` and `parsePage` — 906a352
- [x] 1.4 `npm run lint` passes — 906a352
- [x] 1.5 `npm run build` passes — 906a352

#### Manual

- [x] 1.6 CI on the PR runs the new test step green — 906a352

### Phase 2: Flashcard service and `POST /api/flashcards`

#### Automated

- [x] 2.1 `npm test` passes, including all six route branches — 58985af
- [x] 2.2 `npm run lint` passes — 58985af
- [x] 2.3 `npm run build` passes — 58985af
- [x] 2.4 `npx supabase test db` still passes — 58985af

#### Manual

- [x] 2.5 Local `curl`: authenticated create visible in Studio; unauthenticated gives 401 — 58985af

### Phase 3: `/deck` page, form island and navigation

#### Automated

- [x] 3.1 `npm test` passes — ea9b453
- [x] 3.2 `npm run lint` passes — ea9b453
- [x] 3.3 `npm run build` passes — ea9b453

#### Manual

- [x] 3.4 Signed-out `/deck` redirects to sign-in — ea9b453
- [x] 3.5 Saved card appears at top of page 1 — ea9b453
- [x] 3.6 Invalid input shows field error and keeps text — ea9b453
- [x] 3.7 51 cards give two pages; out-of-range page redirects — ea9b453
- [x] 3.8 Second account sees none of the first account's cards — ea9b453
- [x] 3.9 Cards survive sign-out and a different browser — ea9b453
- [ ] 3.10 Production smoke check after merge
