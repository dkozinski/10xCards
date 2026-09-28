# Manual Card and Deck (S-01) — Plan Brief

> Full plan: `context/changes/manual-card-and-deck/plan.md`

## What & Why

A signed-in user writes a flashcard by hand and sees it in their own deck, which survives sign-out and a change of device (FR-008, FR-009). This is the smallest slice that crosses every layer: service, API route, page and island. It proves the whole stack before the AI slices need a place to save cards.

## Starting Point

F-01 delivered the `flashcards` table with owner-only RLS, a pgTAP isolation test, generated types and DTOs. The repo has no flashcard service, route or UI, and no JS test framework.

## Desired End State

`/deck` shows a "New flashcard" form above the user's cards, newest first, 50 per page. Saving puts the card at the top of page 1. Invalid input shows field errors and the typed text is kept. `POST /api/flashcards` speaks the closed error vocabulary. Vitest runs in CI.

## Key Decisions Made

| Decision        | Choice                                           | Why (1 sentence)                                                                       |
| --------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Where the deck lives | New protected page `/deck`                  | Keeps room for S-03/S-04 without turning the dashboard into the deck.                   |
| List order/size | Newest first (`created_at desc, id desc`), 50/page | New card is visible immediately; Supabase's 1000-row cap would silently drop cards otherwise. |
| Save mechanism  | React island + `fetch` JSON to `POST /api/flashcards` | Matches the AGENTS.md error vocabulary, keeps input on error, and S-03 reuses the endpoint. |
| Astro Actions   | Rejected                                         | `ActionError` codes bypass the closed error vocabulary.                                |
| Who renders the list | Astro on the server; island is the form only | One source of truth, no GET endpoint to maintain; costs a reload after save.           |
| 500 errors      | Add `server_error` to a central `api-errors` module + AGENTS.md | The vocabulary had no code for server failure; adding it centrally keeps it closed.    |
| Validation      | One zod schema, trim then 1–200 / 1–500, shared by route and island | Mirrors the DB CHECKs exactly, so app and DB never disagree.                          |
| Testing         | Vitest (schema, errors, pagination, route with stub client) + existing pgTAP | First app code gets a safety net later slices reuse; RLS stays proven in the DB.        |

## Scope

**In scope:**
- Vitest setup plus a CI step
- Validation schema, error module and pagination helper
- Flashcard service (`create`, `list`)
- `POST /api/flashcards`
- `/deck` page with a form island
- Topbar link and `/deck` in `PROTECTED_ROUTES`

**Out of scope:**
- Edit and delete (S-04)
- A GET API
- Search and filter
- A card-origin column (S-03)
- Any migration
- Playwright E2E
- Refactoring the auth routes
- Mobile layout

## Architecture / Approach

The browser island validates with the shared schema and POSTs JSON. The route checks the session, parses the body, validates, and calls the service with the request-scoped Supabase client. RLS and the `user_id` default scope the insert and the list to the caller, and the app never filters by `user_id` itself. `/deck.astro` calls the service directly with `range()` + `count: "exact"` and renders the list. After a successful save, the island navigates to `/deck`.

## Phases at a Glance

| Phase                                   | What it delivers                                  | Key risk                                                     |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| 1. Test harness, validation, error vocabulary | Vitest in CI, schema, `apiError`, page maths, unit tests | `getViteConfig()` may not like the Cloudflare adapter (fallback planned) |
| 2. Service and `POST /api/flashcards`  | Tested endpoint with 201/400/401/500 contract     | Stubbing the Supabase client faithfully enough               |
| 3. `/deck` page, island, navigation    | Working write-and-browse flow, verified with two accounts | Manual checks across two browsers, then production smoke check |

**Prerequisites:** F-01 done (it is), local Supabase stack running (`npx supabase start`), and two test accounts.
**Estimated effort:** about 3 after-hours sessions, one per phase.

## Open Risks & Assumptions

- Merging to `main` deploys straight to production through Workers Builds. Phase 3's production check happens after merge, not before.
- `count: "exact"` is fine at MVP deck sizes. It gets revisited only if decks grow very large.

## Success Criteria (Summary)

- A user writes a card and immediately sees it at the top of their deck. The card is still there after signing out and signing in elsewhere.
- A second account never sees the first account's cards.
- `npm test`, `npm run lint` and `npm run build` are green in CI.
