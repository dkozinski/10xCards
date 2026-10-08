# Edit and Delete Cards (S-04) Implementation Plan

## Overview

The user can correct the wording of a card already in their deck, or remove it for good, directly on `/deck` (roadmap S-04, issue #11, PRD FR-010 and FR-011). The database already allows both operations for the owner, so this is a code-only change: a service pair, the first dynamic API route, a per-card React island and a release without a migration.

## Current State Analysis

- **Database is ready** (research § Database layer):
  - `authenticated` holds `UPDATE` and `DELETE` on `flashcards` (`20260923181722_flashcards_tighten_grants.sql:10`).
  - `flashcards_update_own` has USING and WITH CHECK, and `flashcards_delete_own` exists (`20260922190157_create_flashcards.sql:44-53`).
  - Nothing references `flashcards`, so a delete cascades nowhere.
- **App layer has nothing for it**:
  - no update or delete function in `src/lib/services/flashcards.ts`;
  - no `PATCH`/`DELETE` route, and no dynamic route segment anywhere in `src/pages`;
  - `/deck` renders cards as static Astro markup (`src/pages/deck.astro:73-82`).
- **Under RLS, a missing card and a foreign card look the same:** the mutation affects 0 rows and raises no error.
- **The error vocabulary is closed** (`src/lib/api-errors.ts:4`) and has no `not_found`.

## Desired End State

- On `/deck`, each card has **Edit** and **Delete** actions.
  - **Edit** turns the card into the two existing `CardField` editors with **Save** / **Cancel**.
  - **Delete** turns into **Confirm delete** / **Cancel** on the same card.
  - A successful save or delete reloads `/deck`.
- `PATCH /api/flashcards/:id` replaces `front` and `back` and returns 200 with the updated card.
- `DELETE /api/flashcards/:id` returns 204.
- A missing card, a foreign card, or a malformed id returns `not_found` (404) on both methods.
- `source` is never touched by an edit.
- Verify with Vitest (route, service, error vocabulary), pgTAP (owner update/delete and CHECK on update), and a manual pass against the local stack, then a production smoke check.

### Key Discoveries:

- `createFlashcardSchema` (`src/lib/validation/flashcard.ts:27-30`) already encodes the front/back rules, runs in the browser and the server, and strips unknown keys. The S-03 review requires this update path to send only `front`/`back` (`context/archive/2026-10-05-review-and-save-proposals/reviews/impl-review-phase-1.md:56`).
- `readBody` (`src/lib/read-body.ts:5`) is the hardened body reader. Use it in the new route; the old `POST /api/flashcards` still uses `request.json()`.
- `ProposalReview.tsx:26-34,96-107,220-256` is the inline-edit pattern to mirror, including the `ITEM_BUTTON` style and the lucide icons.
- `NewFlashcardForm.tsx:41-52` is the client-side error mapping to mirror.
- `deck.astro:36-38` already redirects to the last page when a delete empties the current page.

## What We're NOT Doing

- **No `source` change on edit.** An `ai` card stays `ai` after a later edit. The Q-3 rule ("any edit makes it `ai_edited`") covers edits **before** save only. Decided 2026-10-07.
- **No `updated_at` column or trigger.** No migration in S-04. If S-05 needs it, S-05 adds it additively. Decided 2026-10-07.
- **No partial PATCH.** The body always carries both fields.
- **No undo or soft delete.** Delete is final; the two-step button is the confirmation.
- **No new UI dependency** (dialog or alert-dialog).
- **No grade-history handling (PRD OQ4).** There is no grade history before S-05.
- **No hardening of the existing `POST /api/flashcards`** (`request.json()` → `readBody`). It is out of scope; note it for a later cleanup.
- **No change to `generations` counts.** Editing or deleting a card leaves the recorded metrics as they were.

## Implementation Approach

1. Backend first, test-driven by the existing route-test pattern.
2. UI on top: one React island per card, replacing the static `<li>`.
3. Release without a migration, as S-01 did.

The authorization model stays RLS-only: the service uses the request-scoped client and never filters by `user_id`. "0 rows affected" becomes `not_found`.

## Critical Implementation Details

**Detecting "0 rows" without an error.**
- `update(...).eq("id", id).select().maybeSingle()` returns `data: null` when RLS hides the row or it does not exist. Use `maybeSingle()`, not `single()`, so a missing row is a value rather than a `PGRST116` error to remap.
- For delete, request the deleted id back (`.delete().eq("id", id).select("id")`) and treat an empty array as not found.

**Malformed ids must not reach Postgres.** A non-UUID id makes PostgREST fail with `22P02`, which would surface as `server_error`. Validate `params.id` with `z.uuid()` first and answer `not_found`, since such a card cannot exist.

## Phase 1: Backend — not_found, service, route

### Overview

Add the error code, the two service functions and `src/pages/api/flashcards/[id].ts` with `PATCH` and `DELETE`. Close the pgTAP gaps for owner update and delete.

### Changes Required:

#### 1. Error vocabulary

**Files**: `src/lib/api-errors.ts`, `src/lib/api-errors.test.ts`, `AGENTS.md`

**Intent**: Add `not_found` (404) as a deliberate extension of the closed vocabulary. It means "the addressed resource does not exist for this caller", covering both missing and foreign ids so nothing leaks about other users' data.

**Contract**:
- `ApiErrorCode` gains `"not_found"`, and `STATUS.not_found = 404`.
- The AGENTS.md hard rule lists `not_found` (404) with that meaning, in the same sentence style as the other codes.

#### 2. Service

**Files**: `src/lib/services/flashcards.ts`, `src/lib/services/flashcards.test.ts`, `src/types.ts`

**Intent**: Give the module that owns the table its update and delete operations. They return "not found" as a value and throw raw errors on anything else, the same as the existing functions.

**Contract**:
- `updateFlashcard(supabase, id: string, cmd: UpdateFlashcardCommand): Promise<FlashcardDto | null>` sends exactly `{ front, back }`.
- `deleteFlashcard(supabase, id: string): Promise<boolean>`: `true` when a row was deleted.
- `UpdateFlashcardCommand` in `src/types.ts:16` becomes required `front` and `back` (full replacement).
- Tests assert the exact `update` payload (no `source`, no `user_id`), the `eq("id", id)` filter, the null/false outcome for zero rows, and that errors are rethrown.

#### 3. Route

**Files**: `src/pages/api/flashcards/[id].ts` (new), `src/pages/api/flashcards/[id].test.ts` (new)

**Intent**: Expose both operations with the same branch order and error discipline as `src/pages/api/generations/index.ts`.

**Contract**:
- `export const prerender = false`.
- `PATCH`, branch order:
  1. no `locals.user` → `unauthorized`
  2. `params.id` not a UUID → `not_found`
  3. null client → `server_error`
  4. `readBody(request, 8 * 1024)`: `too_large` → `validation_failed` with `_root`; `unreadable` → `invalid_json`
  5. `JSON.parse` failure → `invalid_json`
  6. `createFlashcardSchema` failure → `validation_failed` with `z.flattenError(...).fieldErrors`
  7. service `null` → `not_found`
  8. otherwise 200 with the card
- `DELETE`, branch order:
  1. `unauthorized`
  2. malformed id → `not_found`
  3. null client → `server_error`
  4. service `false` → `not_found`
  5. otherwise 204 with an empty body
- Any thrown database error: log `{code, message}` only, then `server_error`.
- Tests use the existing `vi.mock("@/lib/supabase")` and stub pattern plus `params: { id }`. They cover every branch above, including:
  - 401 happens before `createClient` is called;
  - the update stub receives exactly the trimmed `{front, back}`, even when the body also carries `source` or `user_id`;
  - a database error message never appears in the response or the logs.

#### 4. pgTAP

**File**: `supabase/tests/flashcards_rls.test.sql`

**Intent**: Close the gaps research found: the owner's own update and delete are never asserted to succeed, and the CHECK constraints are never exercised on UPDATE.

**Contract**: New assertions (adjust `plan(n)`):
- As the owner, an UPDATE of front/back changes the row.
- An UPDATE to a blank front or a 201-character front is rejected with `23514`.
- As user B, an UPDATE and a DELETE on A's card affect 0 rows, checked from B's side (row count of the statement).
- As the owner, a DELETE removes the row.
- As anon, UPDATE and DELETE are rejected with `42501`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new route, service and vocabulary tests: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- pgTAP passes on the local stack, old and new assertions: `npx supabase test db`
- New tests are non-vacuous (mutation-checked):
  - drop the UUID guard → the malformed-id test fails;
  - send `source` in the update payload → the payload test fails;
  - swap `maybeSingle` for `single` → the not-found test fails.

#### Manual Verification:

- curl against the local stack (`.dev.vars` swapped to local with backup and sha check):
  - PATCH own card → 200;
  - PATCH with extra `source: "manual"` → 200 and `source` unchanged in Studio;
  - PATCH other user's card id → 404;
  - DELETE own card → 204, and a second DELETE → 404;
  - no cookie → 401.

**Implementation Note**: After automated verification passes, pause for the owner to confirm the manual checks before Phase 2.

---

## Phase 2: UI — per-card edit and delete on /deck

### Overview

Replace the static card `<li>` with a React island that renders the card and owns its edit and delete interaction.

### Changes Required:

#### 1. Deck card component

**File**: `src/components/deck/DeckCard.tsx` (new)

**Intent**: One island per card, with three modes. It mirrors `ProposalReview` for inline editing and `NewFlashcardForm` for the fetch and error mapping.

**Contract**:
- **Props:** `{ card: FlashcardDto }`.
- **Modes:**
  - `view`: front, back, and Edit/Delete buttons;
  - `editing`: two `CardField`s with ids `card-<id>-front` and `card-<id>-back`, plus Save/Cancel;
  - `confirmDelete`: Confirm delete (destructive variant) and Cancel.
- **Save:**
  - validates in the browser with `createFlashcardSchema`;
  - if nothing changed after trimming, closes the editor without a request;
  - otherwise sends `PATCH` with `AbortSignal.timeout(30_000)`.
- **Confirm delete:** sends `DELETE`.
- **Success** (200 or 204): `window.location.assign` to the current URL (keeps `?page=`).
- **Error mapping:**
  - `validation_failed` → field errors;
  - `not_found` → "This card no longer exists. Refresh the deck.";
  - `unauthorized` → "Your session has expired";
  - anything else or a network error → generic message in `ServerError`.
- **While a request is pending:** buttons are disabled and a spinner shows on the active button.
- **Unsaved-changes guard:** `useUnsavedChangesGuard` is active while editing with text that differs from the saved card.
- **Accessibility:** buttons carry `aria-label`s with the card's position, e.g. "Edit card 3".

#### 2. Deck page

**File**: `src/pages/deck.astro`

**Intent**: Render the list through the island and keep the server render as the source of truth for order, count and pagination.

**Contract**: The `<li>` at `:73-82` renders `<DeckCard client:load card={card} />`. Visual styling of the card stays the same.

### Success Criteria:

#### Automated Verification:

- Tests, lint and build pass: `npm test && npm run lint && npm run build`

#### Manual Verification:

On the local stack:

- Edit a card's front and back, then Save: the page reloads and shows the new text. `source` is unchanged in Studio.
- Cancel an edit: the original text is shown and no request is sent (Network tab).
- Save with no real change (whitespace only): the editor closes and no request is sent.
- Invalid edit (blank front, or back over 500 characters): field errors are shown and no request is sent.
- Delete, then Cancel: the card stays. Delete, then Confirm: the card disappears.
- Delete the only card on page 2: you land on page 1 with no empty page.
- Edit in tab A a card already deleted in tab B: "This card no longer exists" is shown.
- Leaving the page with a modified editor triggers the browser prompt. After Save, no prompt.
- `NewFlashcardForm` still creates cards.

**Implementation Note**: Pause for the owner's manual confirmation before Phase 3.

---

## Phase 3: Release

### Overview

There is no migration, so the release follows S-01: PR → CI → merge (Workers Builds deploys) → production smoke check.

### Changes Required:

#### 1. Pull request

**Intent**: One PR from `feat/edit-and-delete-cards`.

**Contract**:
- The PR body contains `Closes #11` and states that there is no migration.
- CI runs lint, test and build.

#### 2. Merge and smoke check

**Intent**: Merge after CI is green, then exercise the real flow once on production with the owner's account.

**Contract**:
- Edit one card, delete one card (both on throwaway cards).
- Check that `/deck` reflects both.
- Check that the Workers logs contain no card text.
- Rollback: `npm run deploy:rollback`, or revert the merge.

### Success Criteria:

#### Automated Verification:

- CI green on the PR: `gh pr checks <n>`
- Workers Builds green on the merge commit

#### Manual Verification:

- Production smoke check passes (edit and delete), and the logs are free of card text

---

## Testing Strategy

### Unit Tests (Vitest):

- **`api-errors`:** `not_found` maps to 404.
- **Service:** the exact update payload; the id filter; zero rows → `null` / `false`; errors rethrown.
- **Route, `PATCH`:** branch order; malformed id; body too large; invalid JSON; field errors; extra keys stripped; not found; 200 shape.
- **Route, `DELETE`:** 401; malformed id; not found; 204 with an empty body.
- **Both routes:** database error hidden, and no leak in the logs.

### Integration Tests (pgTAP, local):

- The owner can update and delete their own card.
- CHECK constraints hold on UPDATE.
- B's update and delete affect 0 rows.
- anon UPDATE and DELETE are denied.

### Manual Testing Steps:

1. Phase 1 curl matrix against the local stack.
2. Phase 2 UI matrix on `/deck` (local).
3. Phase 3 production smoke check.

## Performance Considerations

None of note: single-row operations by primary key, and one page reload per mutation.

## Migration Notes

There is no schema change. Rollback is a code revert only.

## References

- Research: `context/changes/edit-and-delete-cards/research.md`
- Route pattern: `src/pages/api/generations/index.ts`
- Inline edit pattern: `src/components/generate/ProposalReview.tsx:96-107,220-256`
- Client error mapping: `src/components/deck/NewFlashcardForm.tsx:41-52`
- RLS: `supabase/migrations/20260922190157_create_flashcards.sql:44-53`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — not_found, service, route

#### Automated

- [x] 1.1 Unit tests pass including new route, service and vocabulary tests — d57481f
- [x] 1.2 Lint passes — d57481f
- [x] 1.3 Build passes — d57481f
- [x] 1.4 pgTAP passes on the local stack — d57481f
- [x] 1.5 New tests are non-vacuous (mutation-checked) — d57481f

#### Manual

- [x] 1.6 curl against local stack: edit, extra source ignored, foreign 404, delete twice, no cookie — d57481f

### Phase 2: UI — per-card edit and delete on /deck

#### Automated

- [x] 2.1 Tests, lint and build pass — 8259b52

#### Manual

- [x] 2.2 Edit and save updates the card, source unchanged — 8259b52
- [x] 2.3 Cancel and no-op save send no request — 8259b52
- [x] 2.4 Invalid edit shows field errors without a request — 8259b52
- [x] 2.5 Two-step delete: cancel keeps, confirm removes — 8259b52
- [x] 2.6 Deleting the last card on a page lands on a non-empty page — 8259b52
- [x] 2.7 Editing a card deleted elsewhere shows "no longer exists" — 8259b52
- [x] 2.8 Unload guard prompts while a modified edit is open, not after save — 8259b52
- [x] 2.9 NewFlashcardForm still works — 8259b52

### Phase 3: Release

#### Automated

- [x] 3.1 CI green on the PR
- [x] 3.2 Workers Builds green on the merge commit

#### Manual

- [x] 3.3 Production smoke check (edit and delete), logs free of card text
