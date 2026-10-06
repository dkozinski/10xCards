# Review and Save Proposals (S-03) Implementation Plan

## Overview

Turn S-02's read-only proposal list into a review step:

- The user rejects, restores and edits proposals.
- One deliberate click either saves the kept cards into their deck ("Save N cards") or records that everything was rejected ("Discard all").
- Either way, one atomic database call writes the kept cards (tagged `ai` / `ai_edited`) and one `generations` row of counts, which makes the PRD's two 75% metrics computable.

This is the milestone's north star (roadmap S-03, issue #10). It closes FR-005, FR-006, FR-007 and the "consent before save" NFR.

## Current State Analysis

- **UI**: `src/components/generate/GenerateProposals.tsx`
  - Proposals are a bare `{front, back}[]` keyed by array index (L232-234).
  - No id, no status, no save path; just a "Preview only" note (L229).
  - Re-generating wipes the list (L68).
- **No generation identity**: `/api/proposals` never touches the database and drops its `meta` (`src/pages/api/proposals/index.ts:93-94`).
- **Write path is single-card**: `POST /api/flashcards` → `createFlashcard` (`src/lib/services/flashcards.ts:14-22`). It cannot write two tables in one transaction.
- **Schema**: `flashcards` has no `source` column. There are no functions, triggers or enums anywhere (`src/db/database.types.ts:34-42`).
  - The F-01 review flagged that the first RPC path makes privileges load-bearing (`context/archive/2026-09-22-deck-data-contract/reviews/impl-review.md:37`).
- **Patterns to copy**:
  - per-op/per-role RLS plus a final-state grants migration (`supabase/migrations/20260923181722_flashcards_tighten_grants.sql`)
  - pgTAP suite (`supabase/tests/flashcards_rls.test.sql`)
  - route branch order and content-free DB error logging (`src/pages/api/flashcards/index.ts`)
  - bounded body reader (`src/pages/api/proposals/index.ts:12-47`)
  - island pattern (`src/components/deck/NewFlashcardForm.tsx`)
- **Tests**: Vitest (node environment, no component tests) and pgTAP (local only, not in CI).

## Desired End State

On `/generate`, after proposals appear:

- **Each card can be rejected or restored, edited or reverted.**
  - A rejected card is visibly struck through.
  - A card whose trimmed text differs from the original shows an "Edited" badge.
- **The action button is always enabled.**
  - "Save N cards" (primary style) when N > 0 kept cards.
  - "Discard all" (secondary style) when N = 0.
  - Both call `POST /api/generations`.
- **Save** writes N cards (`source` = `ai` or `ai_edited`) and one `generations` row, all-or-nothing, then navigates to `/deck`.
- **Discard all** writes only the `generations` row (`rejected = generated`), clears the list and keeps the source text in the field.
- **Retrying a save is harmless.** A repeated request with the same `generation_id` writes nothing new and returns the original result.
- **While a list awaits a decision:**
  - "Generate" is disabled with a hint.
  - Leaving the page triggers the browser's native "unsaved changes" prompt.
- **Isolation**: another account cannot read or replay a generation, and `anon` cannot execute the function.

Verify with `npx supabase test db`, `npm test`, `npm run lint`, `npm run build`, the manual steps below, and a production smoke check after merge.

### Key Discoveries:

- PostgREST runs each RPC call in one transaction: atomicity comes for free from a single function (Context7: Supabase troubleshooting; recorded in `research.md` § External Research).
- Functions are executable by every role by default; `revoke … from public, anon` + explicit `grant` are required (Supabase "Function privileges").
- `security invoker` keeps the existing RLS policies in force inside the function; `set search_path = ''` + schema-qualified names (Supabase function template).
- Never raise SQLSTATE `40001` in the function — PostgREST retries it.
- `z.flattenError` loses array paths (`src/lib/api-errors.ts:15-17` is a flat record), so per-card errors need dotted keys.
- `CardField` is private with hard-coded DOM ids (`src/components/deck/NewFlashcardForm.tsx:10,28-66`) — must be exported and id-prefixed to render up to 20 editors.
- Bulk-inserted cards share `created_at` (transaction time); `/deck` breaks ties by `id`, so their order within one save is arbitrary.

## What We're NOT Doing

- **No change to `/api/proposals` or the generation service.** The `generations` row is created at save time, and S-02 stays DB-free (owner decision, research OQ-1).
- **No `dropped_count`.** "Generated" means the number of proposals the user was shown (owner decision).
- **No record of abandoned generations.** If the tab is closed despite the warning, nothing is written.
- **No `flashcards.generation_id` FK.** It is not needed by any metric, and the `user_id` cascade covers S-06.
- **No editing or deleting of saved cards.** That is S-04.
- **No dashboard or query for the 75% metrics.** The data becomes computable; reporting is out of scope.
- **No server-side verification of `ai` vs `ai_edited`.** The client asserts it, because the server never sees the originals, and the metrics only concern the caller's own data.
- **No DB-level freeze of `source` or the counts.** The owner keeps table-wide UPDATE on `flashcards` and INSERT on `generations` (the function is `security invoker`), so a direct API call can relabel or invent their own rows. Accepted: the metrics are self-reported, and column-level grants would become a trap for every future user-editable column (impl-review phase 1, F1).
- **No preserved order of cards within one save.** They come back in arbitrary order within the batch.
- **No component-test infrastructure** (jsdom or testing-library). UI behaviour is verified manually, as in S-01 and S-02.
- **No new API error code.** The existing vocabulary covers every outcome.

## Implementation Approach

Database first, then backend, then UI:

- Each layer is verified against the one below it before the next layer starts.
- The schema change is additive (a new table, a new column with a default, a new function), so it is safe for the code already running in production.
- It goes to production in Phase 4, just before merge, because previews and production share the same Supabase project.
- The owner approves that push explicitly.

## Critical Implementation Details

- **Idempotency ordering inside the function.** Claim the generation id first (`insert … on conflict (id) do nothing`), and insert cards only if the claim succeeded.
  - On a replay, the existing row is read back through RLS.
  - If no row is visible, the id belongs to someone else: raise and insert nothing.
  - Two concurrent identical requests serialize on the primary-key index, so the second one becomes a replay.
- **Save-success navigation vs `beforeunload`.** Disarm the unload guard before calling `window.location.assign("/deck")`, or the user gets a "Leave site?" prompt after a successful save.
- **The client keeps the same `generation_id` across retries.** It is minted once when proposals arrive, never per click. A new id per click would defeat idempotency.
  - The idempotency key protects one specific payload, so after an ambiguous failure the list is frozen and the retry resends the identical command (Phase 3 §2).

## Phase 1: Database (local only)

### Overview

Add `flashcards.source`, the `generations` table and the `save_generation` function with their privileges, prove them with pgTAP on the local stack, and regenerate types. Nothing leaves this machine.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_review_and_save_proposals.sql` (one file; timestamp at creation)

**Intent**: Add the three schema objects in one migration. Write the **final** grant state directly; do not repeat F-01's three-migration grant history.

**Contract**:

- **`public.flashcards.source`**: `text not null default 'manual'` with `check (source in ('manual','ai','ai_edited'))`.
  - Existing rows become `manual`.
  - `createFlashcard` keeps working unchanged.
- **`public.generations`**:

  | Column | Definition |
  |---|---|
  | `id` | `uuid primary key` (client-supplied, no default) |
  | `user_id` | `uuid not null default auth.uid() references auth.users(id) on delete cascade` |
  | `generated_count` | `int not null check (generated_count between 1 and 20)` |
  | `accepted_unedited_count` | `int not null check (>= 0)` |
  | `accepted_edited_count` | `int not null check (>= 0)` |
  | `rejected_count` | `int not null check (>= 0)` |
  | `created_at` | `timestamptz not null default now()` |

  - Table check: `accepted_unedited_count + accepted_edited_count + rejected_count = generated_count`.
  - Index on `user_id`.
  - Table comment: "per-generation counts only, never text".
- **RLS** on `generations`, with 8 policies (one per operation per role, AGENTS.md hard rule):
  - `authenticated` select and insert: `(select auth.uid()) = user_id`.
  - `authenticated` update and delete: `using (false)` (records are immutable).
  - `anon`: all four deny.
- **Grants**:
  - `revoke all on public.generations from anon, authenticated, service_role`.
  - `grant select, insert … to authenticated`.
  - `grant select, insert, update, delete … to service_role`.
- **Function** `public.save_generation(p_generation_id uuid, p_generated_count int, p_cards jsonb) returns int`, which returns the saved-card count.
  - `language plpgsql security invoker set search_path = ''`.
  - It validates that `p_cards` is an array whose every element's `source` is `ai` or `ai_edited`; otherwise it raises with `errcode = '22023'`.
  - Count bounds are left to the table CHECKs (`23514`).
  - Content is not re-validated: the function's guarantees are the DB constraints, and content validation is zod's job in the route. A missing `front`/`back` key gives NULL and raises `23502` (not `23514`), and the `btrim` CHECK only strips spaces, so a tab-only front passes the DB.
- **Function grants**:
  - `revoke execute … from public, anon`.
  - `grant execute … to authenticated, service_role`.

The function body is non-obvious (claim-then-insert ordering, replay read-back), so it is sketched here:

```sql
-- inside save_generation
select count(*) filter (where c->>'source' = 'ai'),
       count(*) filter (where c->>'source' = 'ai_edited'),
       count(*)
  into v_unedited, v_edited, v_total
  from jsonb_array_elements(p_cards) as c;
if v_unedited + v_edited <> v_total then
  raise exception 'invalid card source' using errcode = '22023';
end if;

insert into public.generations (id, generated_count, accepted_unedited_count, accepted_edited_count, rejected_count)
values (p_generation_id, p_generated_count, v_unedited, v_edited, p_generated_count - v_total)
on conflict (id) do nothing;

if not found then  -- replay: return the first result, write nothing
  select accepted_unedited_count + accepted_edited_count into v_saved
    from public.generations where id = p_generation_id;   -- RLS: own rows only
  if not found then
    raise exception 'generation id unavailable' using errcode = '22023';
  end if;
  return v_saved;
end if;

insert into public.flashcards (front, back, source)
select c->>'front', c->>'back', c->>'source' from jsonb_array_elements(p_cards) as c;
return v_total;
```

#### 2. pgTAP suite

**File**: `supabase/tests/generations_rls.test.sql` (new)

**Intent**: Prove the access rules, the privileges, atomicity and idempotency against the real schema. Mirror `flashcards_rls.test.sql`: one rolled-back transaction, impersonation via `set local role` + `request.jwt.claims`.

**Contract**: assertions, at minimum:

- **Structure**
  - RLS is enabled on `generations`.
  - It has exactly 8 policies, none `FOR ALL`.
  - `bag_eq` over the role × cmd matrix.
- **Privileges**
  - `table_privs_are` on `generations`: authenticated = SELECT, INSERT; service_role = CRUD; anon = none.
  - `function_privs_are` on `save_generation(uuid, integer, jsonb)`: authenticated and service_role have EXECUTE; anon has none.
- **`flashcards.source`**
  - Defaults to `manual` on a plain insert.
  - `'bogus'` is rejected with `23514`.
- **As user A**
  - **Happy path**: 5 generated, cards 2×`ai` + 1×`ai_edited` → returns 3, A sees 3 cards with the right sources, and a generations row 2/1/2.
  - **Zero cards**: 4 generated with `'[]'` → returns 0, row 0/0/4, no cards.
  - **Replay** of the happy-path id → returns 3, and the card and generation counts are unchanged.
  - **Atomicity**: a payload with one explicit blank `front` (`"   "`, key present) → `throws_ok` `23514`, and zero rows in both tables for that id.
  - **Bounds**: more cards than `generated_count` → `23514`; `generated_count` 21 → `23514`; a card with `source` `manual` → `22023`.
- **As user B**
  - B sees none of A's generations.
  - B replaying A's id → `22023`, and no cards are written for B.
- **anon**: executing the function → `42501`.
- **Cascade**: deleting user A deletes A's generations.

#### 3. Generated types and DTOs

**File**: `src/db/database.types.ts` (regenerated via `npm run db:types`, never hand-edited), `src/types.ts`

**Intent**: Expose the new column, table and function to TypeScript. Add the S-03 DTOs as snake_case aliases.

**Contract** in `src/types.ts`:

- `FlashcardSource = "manual" | "ai" | "ai_edited"`.
- `SaveGenerationCommand = { generation_id: string; generated_count: number; cards: { front: string; back: string; source: "ai" | "ai_edited" }[] }`.
- `SaveGenerationResponseDto = { saved_count: number }`.
- Update the `FlashcardProposalDto` comment. A proposal is still `{front, back}`; S-03 adds `source` at save time.
- `CreateFlashcardCommand` stays `Pick<…, "front" | "back">`, so manual cards default to `manual`.

### Success Criteria:

#### Automated Verification:

- Migration applies on the local stack: `npx supabase migration up`
- pgTAP passes, old and new suites: `npx supabase test db`
- Types regenerate and contain `generations` and `save_generation`: `npm run db:types && grep -q save_generation src/db/database.types.ts`
- Existing tests, lint and build still pass: `npm test && npm run lint && npm run build`

#### Manual Verification:

- In local Studio (`http://127.0.0.1:54323`), `generations` shows RLS enabled with 8 policies, and `save_generation` exists.
- Running `select public.save_generation(...)` in the Studio SQL editor (as postgres) raises the expected errors; `auth.uid()` is null there, so the `user_id` NOT NULL rejects the insert. This confirms nothing works without a session.

**Implementation Note**: After automated verification passes, pause for the owner's confirmation before Phase 2.

---

## Phase 2: Backend — validation, service, route

### Overview

Add `POST /api/generations`, which validates the payload, calls the function, and maps outcomes to the closed error vocabulary. Every piece is covered by Vitest.

### Changes Required:

#### 1. Shared bounded body reader

**File**: `src/lib/read-body.ts` (new, moved from `src/pages/api/proposals/index.ts:12-47`); `src/pages/api/proposals/index.ts` imports it

**Intent**: Both cookie-authenticated JSON routes that accept user text read their body with the same streamed cap. This is a pure move; behaviour is unchanged.

**Contract**: `readBody(request, maxBytes): Promise<{ text: string } | "too_large" | "unreadable">`. The existing `api/proposals` tests stay green unmodified. Add a direct unit test file `src/lib/read-body.test.ts` covering Content-Length over the cap, a streamed body over the cap with no Content-Length, and a normal body.

#### 2. Validation and edit detection

**File**: `src/lib/validation/generation.ts` (+ tests in `generation.test.ts`)

**Intent**: Define the save payload schema next to `MAX_PROPOSALS`, plus the pure rule that decides `ai` vs `ai_edited`. The file stays browser-safe, so the island uses the same rule.

**Contract**:

- `saveGenerationSchema`: `generation_id` is a uuid; `generated_count` is an int between 1 and `MAX_PROPOSALS`.
  - `cards` is an array, max `MAX_PROPOSALS`, **may be empty**.
  - Each card is `createFlashcardSchema` extended with `source: z.enum(["ai","ai_edited"])`.
  - A refinement requires `cards.length <= generated_count`.
- `proposalSource(original: FlashcardProposalDto, current: {front, back}): "ai" | "ai_edited"`. It compares **trimmed** front and back. Reverting to the original or changing only whitespace gives `ai` (owner decision).
- Tests:
  - an empty `cards` array is accepted
  - more cards than generated is rejected
  - `source: "manual"` is rejected
  - a non-uuid id is rejected
  - card text is trimmed
  - `proposalSource` covers trailing whitespace, revert-to-original, a real change in back only, and a real change in front only

#### 3. Field errors with array paths

**File**: `src/lib/validation/field-errors.ts` (new, + test)

**Intent**: Turn zod issues into `ValidationDetails.fieldErrors` keyed by dotted path (`cards.3.back`, `generated_count`), so a bulk payload can point at one card.

**Contract**:

- `fieldErrorsFromIssues(error: ZodError): Partial<Record<string, string[]>>`. Root-level issues go under `_root`.
- The result fits the existing `ValidationDetails` type, so `api-errors.ts` needs no change.

#### 4. Service

**File**: `src/lib/services/generations.ts` (new, + `generations.test.ts`); header comment of `src/lib/services/flashcards.ts`

**Intent**: The single place that calls `save_generation`, using the request-scoped client so RLS applies.

**Contract**:

- `saveGeneration(supabase, cmd: SaveGenerationCommand): Promise<SaveGenerationResponseDto>` calls `supabase.rpc("save_generation", { p_generation_id, p_generated_count, p_cards })` and throws the PostgrestError on `error`.
- A non-number `data` is treated as an error.
- Tests assert the exact function name **and** args (a review pitfall from S-01).
- Amend the `flashcards.ts` header: it is no longer "the only module that queries public.flashcards", because `save_generation` inserts cards too.

#### 5. Route

**File**: `src/pages/api/generations/index.ts` (new, + `index.test.ts`); comment in `astro.config.mjs:16-20`

**Intent**: Implement `POST /api/generations` with the established branch order and content-free logging. Add the route to the `checkOrigin` comment, because it also reads JSON without a Content-Type check.

**Contract**:

- `export const prerender = false`.
- Branch order:
  1. `locals.user` missing → `unauthorized`
  2. `createClient` returns null → `server_error`
  3. `readBody` (cap 64 KiB: 20 × 700 chars × 4 bytes plus JSON): `too_large` → `validation_failed` with `fieldErrors._root`; `unreadable` → `invalid_json`
  4. `JSON.parse` fails → `invalid_json`
  5. `saveGenerationSchema` fails → `validation_failed` with `fieldErrorsFromIssues`
  6. service throws → `server_error`, logging only `{code, message}`
- Success: `200 { saved_count }`. A replay also gets 200 with the original count.
- Tests:
  - 401 without calling `createClient`
  - null client → 500
  - oversized body → 400
  - bad JSON → `invalid_json`
  - per-card error key `cards.0.front`
  - the RPC receives parsed (trimmed) values
  - 200 shape
  - an RPC error → `server_error`, and a console spy proves no card text is logged (serialize with `util.inspect`)

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new suites: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`
- Each new test fails against a deliberate regression. Mutation-check at least: drop the trim in `proposalSource`, swap the branch order, log `details`.

#### Manual Verification:

- Against the local stack (`.dev.vars` swapped to local; see Testing Strategy), use `curl` with a signed-in session cookie:
  - a valid payload → 200 and rows in Studio
  - the same payload again → 200 with the same count and no new rows
  - a payload with a blank card → 400 with `cards.N.front`
  - no cookie → 401

**Implementation Note**: After automated verification passes, pause for the owner's confirmation before Phase 3.

---

## Phase 3: UI — review list and save

### Overview

Rebuild the proposals section of the island into the review list. Add the dynamic Save/Discard button, the generate lock and the unload guard.

### Changes Required:

#### 1. Shared card editor field

**File**: `src/components/deck/CardField.tsx` (new, extracted from `NewFlashcardForm.tsx:17-66`); `NewFlashcardForm.tsx` imports it

**Intent**: Reuse the trimmed counter, `aria-invalid` and error line for inline editing without DOM id collisions.

**Contract**: `CardField` takes `id: string` (free-form, e.g. `p-<itemId>-front`) and `name: "front" | "back"`. Everything else is unchanged. `NewFlashcardForm` behaves identically and keeps ids `front`/`back`.

#### 2. Review list component

**File**: `src/components/generate/ProposalReview.tsx` (new)

**Intent**: Own the review state and the save call for one generation. `GenerateProposals` mounts it when proposals arrive.

**Contract**:

- **Props**: `{ generationId: string; proposals: FlashcardProposalDto[]; onDiscarded: () => void }`.
- **Item view model**: `{ id, original, front, back, rejected, editing, errors }`, where `id` comes from `crypto.randomUUID()` and is used as the React key.
- **Per-item controls**:
  - Reject / Restore.
  - Edit / Done: Done validates with `createFlashcardSchema` and stays open on error.
  - Revert to original, shown only when the card is edited.
  - An "Edited" badge when `proposalSource(original, current) === "ai_edited"`.
  - A rejected item is dimmed, struck through and not validated.
- **Action button**: always enabled except while pending.
  - With kept N > 0: "Save N card(s)", primary purple.
  - With N = 0: "Discard all", secondary style (`border-white/20 bg-white/10`).
- **On click**:
  1. Validate every kept card, including cards still open for editing. If any fail, open those editors with their errors and stop.
  2. Build `SaveGenerationCommand`: `generated_count = proposals.length`, `cards` = kept cards with `source` from `proposalSource`.
  3. `fetch` `POST /api/generations` with a 30 s timeout.
- **Response handling**:
  - 200 with a numeric `saved_count`, and N > 0: disarm the unload guard, then `window.location.assign("/deck")`.
  - 200 with a numeric `saved_count`, and N = 0: call `onDiscarded()`.
  - `validation_failed`: map `cards.<i>.<field>` back to the i-th **kept** item and open its editor.
  - `unauthorized`: "Your session has expired…", not retryable.
  - Anything else (network error, timeout, 5xx, malformed 200): "Could not save. Please try again." with Try again. A retry is safe because the same `generationId` is resent.
  - The list state survives every error.
- **Frozen after an ambiguous failure** (network error, timeout, 5xx, malformed 200 — the server may have committed):
  - Keep the exact `SaveGenerationCommand` that was sent and set `frozen`. Every per-item control and the action button are disabled; only Try again is active, and it resends that same command.
  - Reason: a committed first attempt turns the retry into a replay that ignores the new payload, so any change made in between would be silently dropped (a re-rejected card still lands in the deck, or "Discard all" clears a list whose cards were already saved).
  - After the 200, branch on the **sent** command's `cards.length` (> 0 → `/deck`, 0 → `onDiscarded()`), not on the current kept count.
  - `validation_failed` and `unauthorized` are unambiguous (nothing was written), so they do not freeze the list.
- **Copy**: replace "Preview only…" with a one-line instruction, e.g. "Reject what you don't want, edit what's almost right, then save."
- The always-mounted sr-only region announces kept/total after each change.

#### 3. Unload guard hook

**File**: `src/components/hooks/useUnsavedChangesGuard.ts` (new)

**Intent**: Trigger the native "Leave site?" prompt while a review is pending.

**Contract**: `useUnsavedChangesGuard(active: boolean): { disarm(): void }`. It adds and removes a `beforeunload` listener that calls `preventDefault()`. `disarm()` removes it immediately; it is used right before the post-save navigation.

#### 4. Island wiring

**File**: `src/components/generate/GenerateProposals.tsx`

**Intent**: Hold the generation identity and lock re-generation while a review is pending.

**Contract**:

- When proposals arrive (L92-93), store `{ generationId: crypto.randomUUID(), proposals }` and render `<ProposalReview>` instead of the read-only list (L225-243).
- While a review is pending, the Generate button is `disabled` with the hint "Save or discard these proposals first." (`aria-describedby`). The source textarea stays editable.
- `onDiscarded` clears the review (back to `null`), keeps `text`, and announces "Proposals discarded" in the live region.
- The guard is active exactly while a review is mounted.

### Success Criteria:

#### Automated Verification:

- Tests, lint and build pass: `npm test && npm run lint && npm run build`
- `NewFlashcardForm` still renders ids `front`/`back`: `grep -n 'id="front"' src/components/deck/NewFlashcardForm.tsx`

#### Manual Verification:

All on the local stack via `npm run dev`:

- **Generate**: a 600+ character text gives a list. Reject 2 and edit 1 (with the badge), then "Save 3 cards" lands on `/deck`, where the three cards are shown. In Studio, the cards have `ai`/`ai_edited` and the generations row has the right counts.
- **Revert**: edit a card, then Revert, and the badge disappears and it saves as `ai`. A card with only trailing spaces added also saves as `ai`.
- **Discard all**: reject all, the button reads "Discard all" in secondary style, and a click clears the list, keeps the text and adds a generations row (0/0/N) with no cards.
- **Generate lock**: Generate is disabled with the hint while the list is shown, and enabled again after Discard.
- **Card validation**: clear a kept card's front, click Save, and the editor opens with the error and nothing is sent. A rejected invalid card does not block the save.
- **Unload guard**: with a list shown, closing the tab or clicking Topbar → Deck triggers the native prompt. After a successful save there is no prompt.
- **Lost response**: stop the dev server mid-save (or use the DevTools offline toggle). The list freezes with only Try again active. Retry after restoring, and confirm a single set of rows in Studio.
- `NewFlashcardForm` on `/deck` still works.

**Implementation Note**: After manual verification, pause for the owner's confirmation before Phase 4.

---

## Phase 4: Release

### Overview

Ship it:

1. PR with CI green.
2. Migration to production with the owner's go-ahead.
3. Merge, which deploys via Workers Builds.
4. Production smoke check.

### Changes Required:

#### 1. Pull request

**Intent**: One PR from `feat/review-and-save-proposals`, including the 2026-10-05 PRD/roadmap decision edits. CI runs lint, test and build.

**Contract**: The PR body links #10, #2 and #3. The release order is stated in the body: migration first, merge second.

#### 2. Production migration

**Intent**: Apply the additive migration to the production Supabase project before the code that calls it is deployed. This is the reverse of a rollback-unsafe pairing (`context/changes/deployment/deployment-plan.md:860-863`).

**Contract**:

1. `npx supabase db push --dry-run` lists exactly this one migration.
2. **Pause for explicit owner go-ahead.**
3. `npx supabase db push`.
4. Parity checks:
   - `npx supabase db diff --linked --schema public` is empty.
   - `npx supabase db dump --linked` shows the grants and the function's EXECUTE privileges, because migra ignores privileges.

This touches production (Supabase cloud). It is irreversible except by a new forward migration. It is safe for the currently deployed code, since the default is `manual` and the table and function are unused.

#### 3. Merge and smoke check

**Intent**: Merge after CI is green and the migration is in place, then exercise the real flow once on production.

**Contract**: After the Workers Builds deploy, use the owner's account on production:

- generate, reject one card, save
- check that the cards appear on `/deck`
- check that `generations` has one row with the right counts (Supabase dashboard)
- Discard all once
- check that the Workers logs contain no card text

### Success Criteria:

#### Automated Verification:

- CI green on the PR: `gh pr checks <n>`
- Dry run lists exactly one migration: `npx supabase db push --dry-run`
- Schema parity after the push: `npx supabase db diff --linked --schema public` (empty output)

#### Manual Verification:

- Owner go-ahead given before `db push`
- Production smoke check passes (save and discard), and the rows are visible in the dashboard
- The `db dump --linked` grants match the pgTAP expectations

---

## Testing Strategy

### Unit Tests (Vitest):

- `read-body.test.ts`: cap by header, cap by stream, normal body.
- `validation/generation.test.ts`:
  - save schema: empty cards, cards > generated, `manual` rejected, uuid, trim
  - `proposalSource`: whitespace, revert, real edit to front, real edit to back
- `validation/field-errors.test.ts`: nested array paths, root issues.
- `services/generations.test.ts`: exact RPC name and args, error propagation, non-numeric data.
- `api/generations/index.test.ts`: branch order, every error code, parsed values passed to the RPC, no content in logs.

### Integration Tests (pgTAP, local):

- `supabase/tests/generations_rls.test.sql`:
  - privileges and policies
  - happy path, zero cards, replay, atomic rollback, bounds
  - cross-account replay, anon, cascade
- The existing `flashcards_rls.test.sql` stays green, since the `source` default does not affect it.

### Manual Testing Steps:

1. Start the local stack: `npx supabase start`. Swap `.dev.vars` to the local URL and key, after backing it up and checking its sha; `.dev.vars*` stays gitignored. Restore it afterwards.
2. Run through the Phase 3 manual list end to end with two accounts. Confirm that account B never sees A's cards or generations in Studio's per-role view.
3. Run the lost-response retry check.

## Performance Considerations

- **Network**: one RPC per save (at most 20 rows plus 1 row in one transaction), so it is negligible.
- **Client CPU**: the island's work is local state over at most 20 items, well within the Workers CPU budget, since the island runs client-side.

## Migration Notes

- The migration is additive.
- Existing cards become `manual`, which is correct, because no AI card could be saved before S-03.
- There is no backfill.
- **Rollback**: a code rollback leaves the schema in place harmlessly. Removing the schema would need a new forward migration (not planned).

## References

- Research: `context/changes/review-and-save-proposals/research.md`
- Decisions: issues #2, #3; `context/foundation/prd.md` Open Questions 2–3; roadmap S-03
- Patterns: `src/pages/api/flashcards/index.ts`, `src/pages/api/proposals/index.ts:12-47`, `supabase/tests/flashcards_rls.test.sql`, `supabase/migrations/20260923181722_flashcards_tighten_grants.sql`, `src/components/deck/NewFlashcardForm.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database (local only)

#### Automated

- [x] 1.1 Migration applies on the local stack
- [x] 1.2 pgTAP passes, old and new suites
- [x] 1.3 Types regenerate and contain generations and save_generation
- [x] 1.4 Existing tests, lint and build still pass

#### Manual

- [x] 1.5 Studio shows RLS + 8 policies on generations and the function exists
- [x] 1.6 Function call without a session is rejected

### Phase 2: Backend — validation, service, route

#### Automated

- [ ] 2.1 Unit tests pass including new suites
- [ ] 2.2 Lint passes
- [ ] 2.3 Build passes
- [ ] 2.4 New tests are non-vacuous (mutation-checked)

#### Manual

- [ ] 2.5 curl against local stack: save, replay, invalid card, no cookie

### Phase 3: UI — review list and save

#### Automated

- [ ] 3.1 Tests, lint and build pass
- [ ] 3.2 NewFlashcardForm still renders ids front/back

#### Manual

- [ ] 3.3 Reject/edit/save lands on /deck with correct sources and counts
- [ ] 3.4 Revert and whitespace-only edits save as ai
- [ ] 3.5 Discard all records 0/0/N, clears list, keeps text
- [ ] 3.6 Generate is locked while a review is pending
- [ ] 3.7 Invalid kept card blocks save; rejected invalid card does not
- [ ] 3.8 Unload guard prompts while pending, not after save
- [ ] 3.9 Lost-response retry writes a single set of rows
- [ ] 3.10 NewFlashcardForm still works

### Phase 4: Release

#### Automated

- [ ] 4.1 CI green on the PR
- [ ] 4.2 Dry run lists exactly one migration
- [ ] 4.3 Schema parity after push

#### Manual

- [ ] 4.4 Owner go-ahead before db push
- [ ] 4.5 Production smoke check (save and discard)
- [ ] 4.6 db dump grants match pgTAP expectations
