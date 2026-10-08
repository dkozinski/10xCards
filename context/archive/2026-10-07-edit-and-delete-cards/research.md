---
date: 2026-10-07T21:46:52+02:00
researcher: Claude (Opus 5.5)
git_commit: 73efeb4b9e5fc3b65daeb7afafc2b8da6259c964
branch: feat/edit-and-delete-cards
repository: dkozinski/10xCards
topic: "S-04 edit-and-delete-cards — what exists for editing (FR-010) and deleting (FR-011) a saved flashcard"
tags: [research, codebase, flashcards, deck, rls, api-routes, s-04]
status: complete
last_updated: 2026-10-07
last_updated_by: Claude (Opus 5.5)
---

# Research: S-04 edit-and-delete-cards

**Date**: 2026-10-07T21:46:52+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: 73efeb4 (main after PR #27)
**Branch**: feat/edit-and-delete-cards
**Repository**: dkozinski/10xCards

## Research Question

Roadmap S-04 (issue #11): *"The user can correct the wording of a card already in their deck, or remove it for good."* PRD FR-010 (edit a saved flashcard) and FR-011 (delete a saved flashcard). What does the codebase already provide at the database, service, API and UI layers? Which conventions bind a new mutating endpoint, and which decisions are still open?

## Summary

- **Database: ready, no migration strictly required.** `authenticated` has `UPDATE` and `DELETE` on `flashcards`. Owner-only `flashcards_update_own` (USING + WITH CHECK) and `flashcards_delete_own` policies exist, plus anon deny policies. No other table references `flashcards`, so a delete has no cascade or restrict effects.
- **Missing:** an `updated_at` column. F-01 explicitly deferred it to S-04 "if it needs them".
- **Application: nothing exists yet.**
  - No update/delete service function.
  - No `PATCH`/`DELETE` route.
  - No dynamic `[id].ts` route anywhere.
  - No per-card actions on `/deck`.
  - The card list is static Astro markup.
  - `UpdateFlashcardCommand` is already defined in `src/types.ts:16` but unused.
- **Reusable pieces:**
  - `createFlashcardSchema` (front/back rules).
  - `CardField` (textarea with counter and error wiring).
  - The inline-edit state pattern from `ProposalReview`.
  - The `readBody` size-capped reader.
  - The route-test stub pattern.
- **Open decisions for the plan:**
  1. **Error code for a missing or foreign card.** There is no `not_found` in the closed error vocabulary.
  2. **`source` after editing a saved `ai` card.** Should it flip to `ai_edited`?
  3. **Is `updated_at` needed?**
  4. **Delete confirmation UI.** No dialog component is installed.

## Detailed Findings

### Database layer

Current shape of `public.flashcards`:

| Column | Definition | Source |
| --- | --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` | `20260922190157_create_flashcards.sql:7` |
| `user_id` | `uuid not null default auth.uid() references auth.users (id) on delete cascade` | `…create_flashcards.sql:10` |
| `front` | `text not null`, check `char_length(btrim(front)) >= 1 and char_length(front) <= 200` | `…create_flashcards.sql:11,14` |
| `back` | `text not null`, check `1..500` (same form) | `…create_flashcards.sql:12,15` |
| `created_at` | `timestamptz not null default now()` | `…create_flashcards.sql:13` |
| `source` | `text not null default 'manual'`, check `in ('manual','ai','ai_edited')` | `20261006211722_review_and_save_proposals.sql:17-19` |

- **Index:** `flashcards_user_id_idx` (`…create_flashcards.sql:20`).
- **No `updated_at`, no triggers.**
- **Grants (end state):**
  - `authenticated` and `service_role` have exactly `SELECT, INSERT, UPDATE, DELETE` (`20260923181722_flashcards_tighten_grants.sql:8-11`).
  - `anon` has nothing (`20260922194808_flashcards_explicit_grants.sql:8`).
  - There are no column-level grants, so UPDATE covers every column, `source` included.
- **RLS:**
  - `flashcards_update_own`: `using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)` (`…create_flashcards.sql:44-48`). WITH CHECK stops an owner from handing a card to another account.
  - `flashcards_delete_own`: `using ((select auth.uid()) = user_id)` (`…create_flashcards.sql:50-53`).
  - Anon deny policies cover all four operations (`…create_flashcards.sql:59-78`).
- **What RLS denial looks like to the caller:**
  - An update or delete on a foreign or missing id matches **0 rows with no error** (F-01 `plan.md:55`). Telling "not found / not yours" apart requires checking the affected rows, e.g. `.select()` after the mutation; `.single()` then yields `PGRST116`.
  - An update violating WITH CHECK raises `42501`.
- **No FKs into `flashcards`.** `generations` stores counts only and its FK goes to `auth.users` (`…review_and_save_proposals.sql:23-36`). Deleting or editing a card leaves the recorded generation counts unchanged. That is intended: S-03 `plan-brief.md:46` says "Counts are records, not user data to edit".
- **Generated types:** `src/db/database.types.ts:23-30` makes every Update field optional (`source?`, `user_id?`, `id?`, `created_at?`). `source` is typed `string`, not the union.

### pgTAP coverage (local only, not in CI)

`supabase/tests/flashcards_rls.test.sql` (`plan(21)`) already covers:

- Policy count and shape (:30-50).
- Privileges per role (:52-68).
- Cross-user update and delete as user B, verified from user A's side (:99-100, :116-126).
- Owner cannot change `user_id` (`throws_ok … 42501`, :128-134).
- CHECK constraints, on INSERT only (:138-162).
- Account-delete cascade (:190-196).

**Gaps relevant to S-04:**

- No positive test that an owner's UPDATE of front/back succeeds, or that an owner's DELETE succeeds.
- No CHECK-constraint tests on UPDATE.
- No anon UPDATE/DELETE assertion (only SELECT/INSERT, :171-184).
- B's mutations are not shown to affect 0 rows from B's side.

### Service layer — `src/lib/services/flashcards.ts`

- The header comment (:5-8) says this is the only module that touches `flashcards`. It uses the request-scoped client, so RLS applies, and it never sends or filters by `user_id`.
- `createFlashcard(supabase, cmd)` (:15-23) runs `insert({front, back}).select().single()` and throws the raw PostgrestError.
- `listFlashcards(supabase, {from, to})` (:25-45) runs `select("*", {count:"exact"})`, ordered `created_at desc, id desc`, with `.range()`. On `PGRST103` it falls back to a count-only query.
- **No update or delete function.**
- **Convention:** the service throws raw errors. Routes catch them, log only `{code, message}` (never `details`, which may quote card text), and return a fixed code.

### API layer

- All routes are POST-only and all export `prerender = false`:
  - `api/flashcards/index.ts:8,10`
  - `api/generations/index.ts:10,17`
  - `api/proposals/index.ts:10,17`
  - `api/auth/*`
- **No dynamic route segment exists anywhere** (`find src -name '[*'` is empty). S-04 would introduce the first one, e.g. `src/pages/api/flashcards/[id].ts` exporting `PATCH` and `DELETE`, read through `context.params.id`.
- **`POST /api/flashcards`** (`api/flashcards/index.ts`), branch order:
  1. `locals.user` → `unauthorized` (:11-13).
  2. `createClient` null → `server_error` (:15-18).
  3. `request.json()` → `invalid_json` (:20-25). This route still uses the uncapped `request.json()`, not `readBody`.
  4. zod → `validation_failed` with `z.flattenError(...).fieldErrors` (:27-32).
  5. Service → 201 (:34-37).
  6. Database error → logged `{code, message}`, returns `server_error` (:38-45).
- **`readBody(request, maxBytes)`** (`src/lib/read-body.ts:5`) returns `{text} | "too_large" | "unreadable"`. It is used by generations (64 KB) and proposals (128 KB). This is the hardened pattern; for the history see S-02 `reviews/plan-review.md:80-87`.
- **Error vocabulary** (`src/lib/api-errors.ts:4-13`):
  - `validation_failed` 400
  - `invalid_json` 400
  - `unauthorized` 401
  - `server_error` 500
  - `generation_failed` 502
  - **No `not_found`.** AGENTS.md says the vocabulary is closed; a new code is a deliberate edit to `api-errors.ts` and AGENTS.md, never inline.
- **Auth:**
  - `src/middleware.ts:4` protects `/dashboard`, `/deck` and `/generate` by redirect.
  - `/api/*` is not on that list. Routes check `context.locals.user` themselves.
  - Every response gets `Cache-Control: private, no-store` (:39-41).
- **CSRF:** a JSON body forces a CORS preflight, which the Worker never answers, and cookies are SameSite=Lax (S-01 `reviews/impl-review-phase-2.md:30`). This holds for PATCH/DELETE carrying JSON.
  - Unverified assumption: a body-less `DELETE` also triggers a preflight, because DELETE is not a CORS "simple" method. The plan should confirm this rather than assume it.

### Validation — `src/lib/validation/flashcard.ts`

- Limits: `FRONT_MAX = 200`, `BACK_MAX = 500` (:9-10). These match the DB CHECKs.
- `cardText(label, max)` (:18-25) does three things:
  - trims, then enforces the max length;
  - requires a visible character (rejects whitespace-only and zero-width-only text, `/[^\s\p{Cf}]/u`);
  - requires storable text (no NUL, `isWellFormed()`).
- `createFlashcardSchema = z.object({front, back})` (:27-30).
  - Shared by the browser and the server: `NewFlashcardForm.tsx:21`, `ProposalReview.tsx:97,115`, `generation.ts:38`, `api/flashcards/index.ts:27`.
  - z.object strips unknown keys. S-03 relies on this so that an update path sends only front/back (S-03 `reviews/impl-review-phase-1.md:54-56`).
- There is no update schema. The `z.uuid()` id pattern already exists at `generation.ts:36`.
- `proposalSource(original, current)` (`generation.ts:47-53`) returns `ai` or `ai_edited` by comparing trimmed text.

### UI layer

- **`/deck`** (`src/pages/deck.astro`):
  - Loads data server-side with `listFlashcards`, page size 50 (`src/lib/pagination.ts:1`).
  - Renders each card as a plain Astro `<li>` showing `front` and `back` only (:73-82).
  - The only React island is `<NewFlashcardForm client:load />` (:50).
  - **No per-card actions.** Adding edit/delete means rendering each card, or the list, as a React island that receives a `FlashcardDto`.
- **Refresh pattern:** after a mutation, components call `window.location.assign("/deck")` (`NewFlashcardForm.tsx:38`, `ProposalReview.tsx:167`). That re-runs the server render, which keeps pagination and the total count correct.
- **`CardField`** (`src/components/deck/CardField.tsx:11-24`) is a controlled textarea with a trimmed-length counter and `aria-invalid`/`aria-describedby` wiring. Its id is free-form, so several editors can share a page.
- **`NewFlashcardForm`** (`src/components/deck/NewFlashcardForm.tsx`) shows the client-side flow:
  - validate in the browser, then `fetch`;
  - map the error: `validation_failed` → field errors, `unauthorized` → "session expired", anything else → generic message (:41-52);
  - `ServerError` alert;
  - spinner while saving.
- **`ProposalReview`** (`src/components/generate/ProposalReview.tsx`) has the inline-edit pattern:
  - per-item state `{editing, errors, …}` (:26-34);
  - `finishEditing` validates before closing (:96-103);
  - `revert` restores the original (:105-107);
  - small icon buttons with `aria-label`s (`ITEM_BUTTON`, :24; lucide `Pencil`, `Check`, `Undo2`, `Trash2`);
  - `AbortSignal.timeout(30_000)` on fetch (:147).
- **shadcn/ui installed:** `button` (it has a `destructive` variant), `skeleton`, `textarea`.
  - **No dialog or alert-dialog,** and no `@radix-ui/react-dialog` in `package.json`.
- **Hooks:** `useUnsavedChangesGuard(active)` (`src/components/hooks/useUnsavedChangesGuard.ts:7`) and `useElapsedSeconds`.

### Tests

- Vitest runs in the node environment and picks up `src/**/*.test.ts` (`vitest.config.ts`). There are no component tests; UI is verified manually.
- **Route test pattern** (`src/pages/api/flashcards/index.test.ts`, `generations/index.test.ts`):
  - `vi.mock("@/lib/supabase")`, because the real module imports `astro:env/server`.
  - `stubClient()` returns a fake `from().insert().select().single()` chain.
  - The handler is called as `POST({request, locals, cookies: {}} as unknown as APIContext)`. A `[id].ts` route adds `params: {id}`.
  - Assertions cover: 401 before `createClient`; exact fieldErrors; trimmed values with no `user_id` in the insert payload; database error hidden behind `server_error`; no secret in logs.
- **Service test** (`src/lib/services/flashcards.test.ts:14-30`) uses a thenable fake query builder and asserts call arguments.
- **Review-enforced testing rules** from archived reviews:
  - Every new test must fail against a deliberate mutation (S-03 `plan.md:334`; S-02 `reviews/impl-review-phase-2.md:58-66`).
  - Stubs must assert call arguments (S-01 `reviews/impl-review-phase-2.md:36-41`).
  - Route tests must prove the order of branches.

## Code References

- `supabase/migrations/20260922190157_create_flashcards.sql:44-53` — owner update/delete policies
- `supabase/migrations/20260923181722_flashcards_tighten_grants.sql:8-11` — final grants
- `supabase/migrations/20261006211722_review_and_save_proposals.sql:11-19` — `source` column and its "self-reported" limitation note
- `supabase/tests/flashcards_rls.test.sql:99-134` — existing cross-user update/delete tests
- `src/lib/services/flashcards.ts:5-52` — service (create and list only)
- `src/pages/api/flashcards/index.ts:8-45` — the POST route to mirror
- `src/lib/api-errors.ts:4-30` — closed error vocabulary
- `src/lib/read-body.ts:5` — capped body reader
- `src/lib/validation/flashcard.ts:9-30` — card schema
- `src/types.ts:16` — `UpdateFlashcardCommand` (unused)
- `src/pages/deck.astro:50,73-82` — deck island and the static card list
- `src/components/deck/CardField.tsx:11-24`, `src/components/generate/ProposalReview.tsx:26-34,96-107,220-256` — reusable edit UI
- `src/middleware.ts:4,39-41` — protected routes, no-store

## Architecture Insights

- **One module owns the table.** All `flashcards` access goes through `src/lib/services/flashcards.ts`. Update and delete belong there, using the request client so RLS stays the enforcement point and `user_id` is never sent.
- **RLS is the authorization model, so "not yours" and "doesn't exist" look the same** (0 rows). That is a feature: no information leaks about other users' ids. A single response for both cases is the natural fit.
- **Schemas are shared between browser and server.** The edit form and the PATCH route should both parse with the same schema (likely `createFlashcardSchema`, if PATCH always sends both fields).
- **Server render is the source of truth for the list.** The existing pattern reloads `/deck` after a mutation instead of patching client state, which keeps the count and pagination honest at the cost of a full reload.
- **The trust model for `source` is "self-reported".** The owner can already rewrite `source` via a direct API call (`…review_and_save_proposals.sql:11-16`). The app's guarantee is only that its own code never writes `source` outside `save_generation`. S-04's update must keep sending front/back only.

## Historical Context (from prior changes)

- `context/archive/2026-09-22-deck-data-contract/plan.md:37` — `updated_at` and the `moddatetime` trigger were deferred to S-04 "as an additive migration if it needs them" (plan-review F5, `reviews/plan-review.md:74-82`).
- `context/archive/2026-09-22-deck-data-contract/reviews/impl-review.md:96-98` — column-level `grant update (front, back)` was considered and skipped: "S-01/S-04 define which fields the API accepts."
- `context/archive/2026-09-22-deck-data-contract/plan.md:174` — `UpdateFlashcardCommand` was defined up front for S-04.
- `context/archive/2026-09-28-manual-card-and-deck/plan.md:35` — "No `PATCH` or `DELETE` routes" (deferred to S-04). `plan-brief.md:21,41` — `/deck` was made a separate page to leave room for S-03 and S-04.
- `context/archive/2026-10-05-review-and-save-proposals/reviews/impl-review-phase-1.md:40-61` (F1):
  - The fix chosen was to document that `source` is self-reported rather than freeze it. A column grant would have been a trap for future columns such as S-05's scheduling state.
  - "Blind spot: S-04's update path must keep sending only front/back" (:56).
- `context/foundation/prd.md:185` — Q-3 decision: "any edit **before save** makes it `ai_edited`". The history says nothing about edits after save.
- `context/foundation/prd.md:57-58,184-185` — how the metrics are computed:
  - Deck share = (`ai` + `ai_edited`) / all cards, read from `flashcards.source`.
  - Clean acceptance = `ai` / generated, read from the immutable `generations` counts.
  - So editing after save can affect deck share only if S-04 relabels `source`. Deleting a card always changes deck share.
- `context/foundation/prd.md:129,186`, `roadmap.md:142-143`:
  - OQ4 (edit vs grade history) does not block S-04. There is no grade history until S-05, which resolves the question.
  - Deleting a card is S-04's only touchpoint with the review-reliability guardrail ("the session never shows a deleted flashcard", `prd.md:93`).
- **Release pattern:**
  - With a migration (S-03 `plan.md:454-505`): migration dry-run → owner go-ahead → `db push` → parity checks → merge → smoke check.
  - Without one (S-01 `plan.md:261`): merge → smoke check, rollback by reverting the merge.
  - Put `Closes #11` in the PR body.
- **Local verification:** `.dev.vars` points at production Supabase. Manual tests need a swap to the local stack with a backup (S-03 `research.md:126`, `plan-brief.md:85,92`).

## Related Research

- `context/archive/2026-10-05-review-and-save-proposals/research.md` — route branch order, `readBody`, the `source` column
- `context/archive/2026-09-28-manual-card-and-deck/research.md` — the deck page and the POST route origins
- `context/archive/2026-09-22-deck-data-contract/research.md` — RLS and grants design

## Open Questions

For `/10x-plan`:

1. **Missing or foreign card → which response?** Options:
   - Add `not_found` (404) to the closed vocabulary (edit `api-errors.ts` and AGENTS.md together).
   - Reuse an existing code. None fits semantically.

   RLS makes "missing" and "not yours" indistinguishable, which argues for one response covering both.
2. **Editing a saved `ai` card: flip `source` to `ai_edited`?** Q-3 only covered edits before save.
   - Flipping keeps the deck-share metric meaning "AI cards the user had to fix".
   - Not flipping keeps the update path strictly front/back, as the S-03 review asked.
   - Either way, `generations` counts stay immutable.
   - **Product decision for the owner.**
3. **Is `updated_at` needed now?** Nothing reads it in S-04. S-05 might use "content changed since last review" when it resolves OQ4. F-01 deferred it to S-04 "if it needs them". Adding it now means an additive migration and the full migration release path; skipping it keeps S-04 code-only.
4. **Delete confirmation UX:**
   - add shadcn `alert-dialog` (new Radix dependency);
   - `window.confirm`;
   - or an inline two-step button ("Delete" → "Confirm delete").

   Hard delete is irreversible, so some confirmation is expected.
5. **PATCH semantics.** Should the body always carry both `front` and `back` (reuse `createFlashcardSchema` as is), or should partial updates be allowed? `UpdateFlashcardCommand` has both fields optional. A full replacement is simpler and matches the edit form.
6. **Harden `POST /api/flashcards` with `readBody` while touching the same folder?** Optional scope creep. The new `[id].ts` should use `readBody` regardless.
7. **pgTAP additions:**
   - owner UPDATE and DELETE succeed;
   - CHECK constraints hold on UPDATE;
   - anon UPDATE/DELETE is denied;
   - B's mutations affect 0 rows.

   These close the gaps listed above, cheaply.
