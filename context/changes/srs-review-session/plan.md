# S-05 Review Session (FSRS) Implementation Plan

## Overview

Let a signed-in user run a spaced-repetition review session on their deck: see a card, reveal the answer, grade it (Again / Hard / Good / Easy), and have the grade and the card's next due date saved **before** the next card appears. Scheduling uses FSRS through `ts-fsrs` (off-the-shelf, FR-012). Progress lives in Postgres, so it survives logout and a change of device (NFR durability). A session never shows a deleted card or another user's card (NFR session reliability).

Closes #12 (S-05) and #4 (PRD OQ4 — grade history on edit: **keep**).

## Current State Analysis

From `context/changes/srs-review-session/research.md`:

- `flashcards` has no scheduling state at all. Earlier slices deferred it to S-05 on purpose.
- Two precedents fit this slice:
  - additive columns with a default and a named CHECK (S-03 `source`);
  - an append-only, owner-scoped table with `select, insert` grants plus `false` deny policies (S-03 `generations`).
- The template for an atomic, idempotent write is `public.save_generation` (`supabase/migrations/20261006211722_review_and_save_proposals.sql:104-180`): `security invoker`, a client-minted uuid as the idempotency key, and `on conflict do nothing`.
- Routes follow one shape (`src/pages/api/flashcards/[id].ts`); errors come from a closed vocabulary (`src/lib/api-errors.ts`). There is **no GET API route yet**.
- The UI is pessimistic: controls are disabled while a request is in flight, and the UI advances only on a 2xx.
- Vitest runs in CI. pgTAP runs locally only.
- `ts-fsrs@5.4.2` passes gates G1–G6 on static inspection: zero dependencies, no Node built-ins, 13 KB gzip. It must still be exercised on a deployed preview (`context/foundation/infrastructure.md:306`).

## Desired End State

- `/review` is a protected page, linked from the Topbar.
- It shows one of three things:
  - "Your deck is empty — add cards" when the user has no cards;
  - "Nothing to review today" when nothing is due;
  - the session itself.
- In a session:
  - each card shows its front, then "Show answer", then four grade buttons;
  - a grade is persisted by `POST /api/reviews`, and the next card is the one that request returns;
  - a failed request keeps the card on screen with a retry that reuses the same `review_id`;
  - after 20 distinct cards the session offers "Done — N more waiting. Continue?";
  - cards graded Again/Hard (learning steps of minutes) come back in the same session.
- A grade on a card deleted in another tab returns `not_found`. The UI says so and moves to the next card.
- Editing a card's text leaves its schedule and history untouched.
- Deleting a card deletes its review log rows (cascade).
- Verify with:
  - pgTAP: `npx supabase test db`;
  - Vitest: `npm test`;
  - the manual steps in Testing Strategy;
  - a deployed-preview run, which proves `ts-fsrs` runs on workerd.

### Key Discoveries:

- `save_generation` claims the id first and writes only if the claim succeeded (`20261006211722_review_and_save_proposals.sql:143-163`). `record_review` copies this exactly.
- **FK checks bypass RLS.** A plain `user_id = auth.uid()` insert policy on `review_logs` would let user B insert a log row pointing at A's card id: the FK check sees A's row even though RLS hides it. The insert policy must also require that the card is visible to the caller.
- Referential actions (`on delete cascade`) run as the table owner, not as the caller. Deleting a card therefore removes its logs even though `authenticated` holds no DELETE on `review_logs`.
- PATCH strips unknown keys (`src/pages/api/flashcards/[id].ts:33-34`), and `updateFlashcard` writes only `front, back` (`src/lib/services/flashcards.ts:35`). "Keep the schedule on edit" is today's behaviour; S-05 only pins it with a test.
- `createFlashcard` and `save_generation` insert without the new columns. The column defaults ("new, due now") cover every card created through any path, past or future.
- `ts-fsrs` `Card.elapsed_days` is deprecated (removed in 6.0). It is not persisted; the mapper supplies `0`.
- Workers Builds turns every push to a non-`main` branch into a version preview URL (`context/foundation/infrastructure.md:256-263`). Previews use the **production** Supabase project, so the migration must be on production before the preview can run `/review`.
- `.dev.vars` points at production. Local manual tests require swapping to the local stack first (backup, then sha check).

## What We're NOT Doing

- No FSRS optimiser (`@open-spaced-repetition/binding`), no custom parameters, and no retention setting in the UI. Defaults are used: `request_retention` 0.9, fuzz off, short-term steps on.
- No daily new-card limit. The batch of 20 is per session, and "Continue" can introduce more new cards.
- No local-day rollover hour (Anki's 4 a.m.). The day ends at local midnight.
- No optimistic concurrency between two tabs. Last write wins; both grades are logged.
- No schedule reset on edit, and no "reset progress" control.
- No next-interval preview on the grade buttons, and no keyboard shortcuts.
- No persisted "session" entity. Progress is the per-card schedule itself.
- No review statistics or history view.
- No undo of a grade.
- No change to the error vocabulary. No `conflict` code.
- No component (jsdom) tests. The UI is checked by hand, per existing norms.

## Implementation Approach

- **Schedule in the Worker, write in the DB.** The route reads the card's current FSRS state, computes the next state with `ts-fsrs`, and hands the computed values to `record_review`. That RPC appends the log row and updates the card in one transaction.
- **Choose in the DB.** `next_review_card` is a read-only `security invoker` SQL function. It applies the queue tiers in one query and returns the chosen card plus the due count, so each grade costs one RPC write and one RPC read.
- **Fetch-next.** The page server-renders only the deck size. The island fetches the first card with `GET /api/reviews/next`. Every successful `POST /api/reviews` returns the next card, so a card deleted elsewhere is never shown.
- **The browser defines "today".** The island sends `day_end`: the next local midnight as an ISO timestamp. The server checks only that it lies in `(now, now + 48h]`. There is no timezone arithmetic in the Worker.

## Critical Implementation Details

**Timing & lifecycle — retries are always safe.** The grade POST writes first and then looks up the next card. If anything fails after the write, the route returns `server_error` and the client retries with the **same** `review_id`. The replay writes nothing, and the next-card lookup runs again. Mint a new `review_id` only when a new card is displayed, never per request attempt.

**Queue tiers (`next_review_card`).** Let `p_now` be the request time and `p_day_end` the client's local midnight. The first non-empty tier wins:

1. learning or relearning cards with `due <= p_now`, oldest `due` first;
2. review cards with `due < p_day_end`, oldest `due` first;
3. new cards (`due < p_day_end`), oldest `created_at` first, ties by `id`;
4. learning or relearning cards with `due <= p_now + 20 min`, oldest `due` first ("learn ahead").

Learning cards must **not** fall under the day cutoff. Otherwise a card graded Again would come back instantly instead of after its minute step. With `p_learning_only = true`, only tiers 1 and 4 apply; the island sets this after the batch of 20. `due_count` counts the cards that satisfy tiers 1–3, regardless of the flag.

**State sequencing in `record_review`.** The order is:

1. insert the log row (`on conflict (id) do nothing`); if no row was inserted, return `false` (replay);
2. update the card's FSRS columns `where id = p_flashcard_id`;
3. if no row was updated (missing, or another user's card under RLS), raise errcode `P0002`, which rolls back the log insert.

The service maps `P0002` to `null`, and the route maps that to `not_found`.

**Addendum 2026-10-10 (impl review, Phase 1) — implemented `record_review` and error mapping.**
- The implemented order differs from the one above. `record_review` first locks the card with `select … for update`, and raises `P0002` if the card is not visible (missing, or another user's). Only then does it insert the log row (`on conflict (id) do nothing`) and update the card.
- Why the order changed: the insert policy's `with check` runs before both `on conflict` and the FK check. Under the original order, a missing or foreign card would have raised `42501` instead of `P0002`. The lock also makes a concurrent delete wait.
- On replay (the review id already exists for this caller), the call writes nothing. Two exceptions:
  - If that id belongs to another card, it raises `22023 'review id belongs to another card'`.
  - An id held by another account reads as missing under RLS and raises `22023 'review id unavailable'`.
- `next_review_card` raises `22023` when any parameter is null or `p_day_end <= p_now`.
- **Mapping in the service and route (Phase 2):**
  - `P0002` → `null` → `not_found`.
  - Any other SQLSTATE → `server_error`. This covers every `22023` above, plus `23502`, `22P02`, `22007` and `23514` from malformed `p_next`/`p_log` values.
  - The Worker builds every RPC argument itself and the route validates `day_end` before the call, so any of these errors is our bug, not user input.
- **`day_end` is bounded after the save (impl review phase 2, F1).** `POST /api/reviews` checks the shape of every field before writing, but checks the `(now, now + 48h]` bound of `day_end` only after the grade is saved: `day_end` feeds only the next-card lookup and must not cost the grade. A stale `day_end` therefore answers `400 validation_failed` (`fieldErrors.day_end`) *after* a successful write. The island recomputes `day_end` and retries with the same `review_id`, which replays and returns the next card.
- **Accepted widening:** `FlashcardDto` stays an alias over the generated row, so `POST /api/flashcards`, `PATCH /api/flashcards/[id]` and `listFlashcards` now also return the nine FSRS columns. That is the owner's own data. Islands keep receiving only `{id, front, back}` (`deck.astro:80`), so nothing new is serialized into the HTML.

---

## Phase 1: Data layer (local)

### Overview

One additive migration adds the FSRS state, the review log and two functions. pgTAP proves isolation, idempotency, cascade and tiering. The generated types and the DTOs are updated. Nothing leaves this machine.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_srs_review_session.sql`

**Intent**: Introduce scheduling state at the moment something uses it, additively, and safely for the code deployed before S-05. Write grants in their final state, following the S-03 lesson.

**Contract**:

- **`flashcards` columns.** Each column is `not null` with a default unless noted, so existing rows become "new, due now":
  - `due timestamptz default now()`
  - `stability double precision default 0`
  - `difficulty double precision default 0`
  - `scheduled_days int default 0`
  - `learning_steps int default 0`
  - `reps int default 0`
  - `lapses int default 0`
  - `state text default 'new'` with `flashcards_state_check in ('new','learning','review','relearning')`
  - `last_review timestamptz` (nullable)
  - Named CHECKs for non-negative counters.
  - Index `flashcards_user_id_due_idx (user_id, due)`.
  - A comment repeating the S-03 known limitation: the owner can write these columns directly; the app writes them only through `record_review`.
- **`review_logs` table:**
  - `id uuid primary key` (client-minted idempotency key)
  - `user_id uuid not null default auth.uid() references auth.users on delete cascade`
  - `flashcard_id uuid not null references public.flashcards on delete cascade`
  - `rating smallint` with CHECK 1–4
  - the pre-review snapshot from `ts-fsrs` `ReviewLog`: `state` (same CHECK), `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`
  - `reviewed_at timestamptz not null`, `created_at timestamptz default now()`
  - Indexes on `user_id` and `flashcard_id`.
  - Table comment: append-only, no card text.
- **Grants and RLS on `review_logs`**, mirroring `generations`:
  - `revoke all`; `select, insert` to `authenticated`; full CRUD to `service_role`.
  - Policies: `review_logs_select_own`, plus `review_logs_insert_own` with `with check ((select auth.uid()) = user_id and exists (select 1 from public.flashcards f where f.id = flashcard_id))`. The `flashcards` RLS inside the subquery is what makes "own card" true.
  - `false` deny policies for authenticated update/delete, and four anon deny policies.
- **`record_review(p_review_id uuid, p_flashcard_id uuid, p_rating smallint, p_reviewed_at timestamptz, p_next jsonb, p_log jsonb) returns boolean`:**
  - `plpgsql security invoker set search_path = ''`.
  - Sequencing as in Critical Implementation Details. Returns `true` when applied, `false` on replay.
  - A malformed or missing `jsonb` field raises `22023`.
  - `revoke execute … from public, anon`; grant to `authenticated, service_role`.
- **`next_review_card(p_now timestamptz, p_day_end timestamptz, p_learning_only boolean) returns jsonb`:**
  - `sql stable security invoker set search_path = ''`.
  - Returns `{ "card": {id, front, back, state} | null, "due_count": int }`, with tiers as in Critical Implementation Details.
  - Same execute grants as `record_review`.

#### 2. pgTAP tests

**File**: `supabase/tests/review_logs_rls.test.sql` (new), modelled on `generations_rls.test.sql`

**Intent**: Prove the guardrails at the layer that enforces them.

**Contract**: The test must cover:

- the role × command policy matrix (`bag_eq`), `table_privs_are` for `review_logs`, and `function_privs_are` for both functions;
- user B's direct insert of a log row for A's card fails, and so does B's `record_review` on A's card: `P0002`, no log row, A's card unchanged;
- a replay with the same `review_id` returns `false` and changes nothing, even with a different payload;
- deleting a card removes its log rows;
- existing cards read as `state = 'new'`;
- `next_review_card` with fixed timestamps:
  - each tier's ordering, and tier priority;
  - a learning card due in 5 min is not returned while a new card exists, but is returned (learn ahead) when nothing else is due;
  - a card due in 25 min is never returned;
  - `p_learning_only` skips new and review cards;
  - another user's due card is never returned or counted.

#### 3. Types and DTOs

**Files**: `src/db/database.types.ts` (regenerated with `npm run db:types`), `src/types.ts`

**Intent**: Keep DTOs as aliases over the generated types, in snake_case.

**Contract**: Add:

- `SrsState = "new" | "learning" | "review" | "relearning"`, mirroring the CHECK;
- `ReviewCardDto = Pick<FlashcardDto, "id" | "front" | "back"> & { state: SrsState }`;
- `NextReviewResponseDto { card: ReviewCardDto | null; due_count: number }`;
- `RecordReviewCommand { review_id: string; flashcard_id: string; rating: 1 | 2 | 3 | 4 }`.

### Success Criteria:

#### Automated Verification:

- Migration applies to the local stack: `npx supabase migration up` (local only; no reset needed)
- pgTAP passes, including the existing files: `npx supabase test db`
- Types regenerate with no manual edits: `npm run db:types`
- Lint and unit tests still pass: `npm run lint && npm test`

#### Manual Verification:

- Mutation check: temporarily dropping the `exists (…)` clause from `review_logs_insert_own` makes the cross-user insert test fail
- Migration reviewed by the owner (grants, policies, function bodies)

**Implementation Note**: After automated verification passes, pause for the owner's confirmation before Phase 2.

---

## Phase 2: Scheduling and API

### Overview

Add `ts-fsrs`, a pure scheduling module, a review service and two routes, all with Vitest coverage.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Use FSRS off the shelf (FR-012).

**Contract**: `ts-fsrs` pinned to an exact version: `5.4.2`, or a newer patch at least two weeks old, re-checked against G2 if newer.

#### 2. Scheduling module

**File**: `src/lib/srs.ts` (+ `src/lib/srs.test.ts`)

**Intent**: The only module that touches `ts-fsrs`. It translates between DB rows and FSRS objects, so the rest of the code never sees the library's types.

**Contract**:

- `scheduleReview(row, rating, now) → { next, log }`. Here `row` holds the nine FSRS columns; `next` holds the nine columns to write; `log` is the `review_logs` snapshot.
- One module-level `fsrs()` instance with library defaults.
- State mapping `new|learning|review|relearning` ↔ `State.New|Learning|Review|Relearning`.
- `elapsed_days` is fed as `0` and never returned.
- `Rating.Manual` is unreachable, because the input type is `1 | 2 | 3 | 4`.

#### 3. Review service

**File**: `src/lib/services/reviews.ts` (+ `reviews.test.ts`)

**Intent**: The only caller of `record_review` and `next_review_card`. It takes the request-scoped client and never sends `user_id`.

**Contract**:

- `nextReviewCard(supabase, { now, dayEnd, learningOnly }) → NextReviewResponseDto`. It throws on an RPC error or an unexpected shape.
- `recordReview(supabase, cmd, now) → "applied" | "replay" | null`:
  - reads the card's FSRS columns by id (`maybeSingle`); `null` means not found;
  - calls `scheduleReview`, then `record_review`;
  - maps `P0002` to `null`;
  - rethrows anything else.

#### 4. Routes

**Files**:

- `src/pages/api/reviews/next.ts` (GET) and `src/pages/api/reviews/index.ts` (POST)
- `next.test.ts` and `index.test.ts`, following the `vi.mock("@/lib/supabase")` + `stubClient()` pattern

**Intent**: The first GET API route, plus the grade write. Both follow the canonical shape of `[id].ts`.

**Contract**:

- Both routes: `export const prerender = false`, then:
  1. `locals.user` check → `unauthorized`;
  2. `createClient` (null → `server_error`);
  3. zod validation → `validation_failed`;
  4. service call in try/catch → `server_error`;
  5. `logFailure` logs `{code, message}` only.
- `day_end`: an ISO datetime strictly after `now` and at most `now + 48h`. `learning_only`: boolean, default `false`.
- `GET /api/reviews/next?day_end=…&learning_only=…` → `200 NextReviewResponseDto`.
- `POST /api/reviews`:
  - body `{ review_id: guid, flashcard_id: guid, rating: 1..4, day_end, learning_only }`, read through `readBody` with a 2 KiB cap (`invalid_json` on parse failure);
  - `recordReview` returning `null` → `not_found`;
  - otherwise `200 NextReviewResponseDto`, the same payload for "applied" and "replay".
- `now` is taken once per request and used for both scheduling and the next-card lookup.

#### 5. Edit keeps the schedule (OQ4)

**File**: `src/lib/services/flashcards.test.ts`

**Intent**: Pin the decision "edit keeps the schedule" so that a future change to the edit path cannot silently reset or overwrite FSRS state.

**Contract**: A test asserts that the `update` payload of `updateFlashcard` has exactly the keys `front` and `back`. Add it only if no existing test already asserts this.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes, and `ts-fsrs` ends up in the server bundle: `npm run build`
- `srs.test.ts` covers:
  - New + Again → `learning`, `due` = now + 1 min;
  - New + Good → `learning`, `due` = now + 10 min;
  - New + Easy → `review`, `due` ≥ now + 1 day;
  - Review + Again → `relearning`, `lapses` + 1;
  - the output never contains `elapsed_days`.
- Route tests cover:
  - 401;
  - `validation_failed` for rating 0 and 5, `day_end` in the past or beyond 48 h, and a malformed `review_id`;
  - `invalid_json`;
  - `not_found`;
  - `server_error` with no card text in the logged object;
  - 200 shape on apply and on replay.

#### Manual Verification:

- Mutation check: changing a tier boundary in `srs.ts` (e.g. swapping the state mapping), or removing the `not_found` branch, makes at least one test fail

**Implementation Note**: After automated verification passes, pause for the owner's confirmation before Phase 3.

---

## Phase 3: Review UI

### Overview

Add the `/review` page and the `ReviewSession` island, plus navigation. Check everything by hand against the local Supabase stack.

### Changes Required:

#### 1. Page

**File**: `src/pages/review.astro`

**Intent**: The server-rendered shell. Like `deck.astro`, it uses the request-scoped client and a `loadFailed` flag.

**Contract**:

- Load only the user's card count (`head: true` count).
- `0` cards → an inline "Your deck is empty" state with links to `/deck` and `/generate`; the island is not mounted.
- A load failure → the inline red box, as in `deck.astro`.
- Otherwise mount `<ReviewSession client:load />` with no card data in props.

#### 2. Island

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: A pessimistic session state machine. It advances only after a 2xx.

**Contract**:

- **States:** `loading → front → revealed → grading → front | batchDone | nothingDue | error`.
- **`day_end`:** computed from the current clock for every request as the next local midnight (`new Date(y, m, d + 1)`), so a session that runs past midnight keeps working. (Changed 2026-10-10 by impl review phase 2, F1; it was "computed on mount".)
- **`review_id`:** `crypto.randomUUID()` minted when a card is displayed and kept across retries of that card.
- **Requests:** inline `fetch` with `AbortSignal.timeout(30_000)`, as in `DeckCard`.
- **Batch:** a set of distinct graded card ids. At 20, requests switch to `learning_only=true`. When that returns no card, show "Done — {due_count} more waiting", with "Continue" (resets the set) and "Finish" (link to `/deck`).
- **Errors** (branch on `error.code`):
  - `not_found` → "This card no longer exists", then GET the next card;
  - `unauthorized` → "Your session expired — sign in again", with a link;
  - anything else, including a network failure or timeout → keep the card, show `ServerError`, and offer Retry (same `review_id`).
- **Controls:** "Show answer", then Again / Hard / Good / Easy (shadcn `button`), all disabled while grading.
- **Empty queue:** a `nothingDue` card ("Nothing to review today — come back tomorrow").
- **Accessibility:** an `sr-only aria-live="polite"` region announces the new card and the save result. Focus moves to "Show answer" on each new card, and to "Good" after reveal.

**Addendum 2026-10-11 (impl review, Phase 3) — what the island actually does:**
- **No `error` phase.** A retryable failure is a `failed` overlay on the current phase: the card stays on screen with `ServerError` and Retry. `unauthorized` is a terminal `expired` phase.
- **Messages follow the cause** (F1):
  - `validation_failed` → "Your device clock looks wrong". The island builds every field itself, so this can only be `day_end` out of the server's window. The retry is manual: with a skewed clock an automatic one would loop.
  - No API code (offline, timeout, proxy page) → "Check your connection".
  - Any other code → "Something went wrong on our side".
  - The live region repeats the same text.
- **A 2xx is trusted only in the expected shape** (`isNextReviewResponse`, F2). Any other body leads to Retry.
- **Announcements** read "Card N: {front}", so a card that comes back is announced again. The `not_found` notice is spoken together with the next card. On the end screens, focus moves to Continue or to the end message (F3).
- **Beyond the contract:**
  - `src/lib/review-session.ts` (`nextLocalMidnight`, `isNextReviewResponse`, `REVIEW_BATCH_SIZE`) and `countFlashcards`, both unit-tested.
  - A "{N} due today" line. It shows `due_count`, which leaves out learning cards that are not yet due; the owner accepted this on 2026-10-10.
  - Continue is hidden when `due_count` is 0.

#### 3. Navigation and protection

**Files**: `src/middleware.ts`, `src/components/Topbar.astro`, `src/pages/dashboard.astro`

**Intent**: Make the session reachable and guarded.

**Contract**:

- Add `"/review"` to `PROTECTED_ROUTES`.
- Add a "Review" link in the Topbar, before "My deck".
- Add a "Start review" link on the dashboard.

### Success Criteria:

#### Automated Verification:

- Lint, tests and build pass: `npm run lint && npm test && npm run build`
- Runs in local workerd: `npm run preview` serves `/review` without `[unenv]` errors in the console

#### Manual Verification:

(All on the **local** Supabase stack, after swapping `.dev.vars` with a backup and a sha check.)

- Grade a card, reload mid-session: the graded card does not come back (unless it is in learning), and the progress is kept
- Again on a new card → it reappears in the same session after other cards, or immediately when it is the only one left (learn ahead)
- Delete a queued card in a second tab → the session never shows it; if it is on screen when graded, the user sees "This card no longer exists" and the session moves on
- With the server stopped mid-grade → error and Retry; after a restart, Retry succeeds and the log has exactly one row for that grade
- 25 new cards → the batch ends at 20 with "5 more waiting"; Continue resumes
- An empty deck shows the empty-deck state; a deck with nothing due shows "Nothing to review today"
- Second account: sees none of the first account's cards in `/review`
- Edit a reviewed card's text on `/deck` → its `due`, `state` and log rows are unchanged
- Keyboard-only run: Tab and Enter work through reveal and grade; the screen reader announces the new card (2026-10-10: keyboard verified by the owner over 20+ cards; screen reader not tested, by the owner's decision. The `aria-live` region exists in code but no announcement was heard.)
- `.dev.vars` restored, and its sha matches the backup

**Implementation Note**: After automated verification passes, pause for the owner's manual confirmation before Phase 4.

---

## Phase 4: Release

### Overview

The migration goes to production first, because it is additive and safe for the deployed code. Then the branch preview proves `ts-fsrs` on real workerd, then the merge, then a production smoke check. Release sequence of S-03: `context/archive/2026-10-05-review-and-save-proposals/plan.md:454-505`.

### Changes Required:

#### 1. Production migration

**Intent**: Have the schema in place before any code that calls it runs. This step touches Supabase cloud; it is irreversible except by a forward migration, and harmless to the deployed code, which ignores the new columns and functions.

**Contract**:

1. `npx supabase db push --dry-run` lists exactly this one migration.
2. **Pause for the owner's explicit go-ahead.**
3. `npx supabase db push`.
4. Check parity:
   - `npx supabase db diff --linked --schema public` is empty;
   - `npx supabase db dump --linked` shows the `review_logs` grants and the EXECUTE privileges of both functions.

#### 2. Pull request and preview

**Intent**: One PR from `feat/srs-review-session`. Pushing the branch makes Workers Builds upload a version preview, which exercises `ts-fsrs` on real workerd (`infrastructure.md:306`). The preview reaches production Supabase: use the owner's account and throwaway cards only.

**Contract**:

- The PR body contains `Closes #12` and `Closes #4`, and states the release order (migration first, merge second).
- On the preview URL:
  - start a session, grade one card with each button;
  - the Workers logs show no `[unenv]` errors and no card text.

#### 3. Merge and smoke check

**Intent**: Merge after CI is green, then run the real flow once on production.

**Contract**:

- Review a few cards.
- Sign out, sign in in another browser, and check that the progress persisted (the graded cards are not due again).
- Check the `review_logs` rows in the dashboard.
- Rollback: `npm run deploy:rollback` (code only; the schema stays, being additive).

### Success Criteria:

#### Automated Verification:

- The dry run lists exactly one migration: `npx supabase db push --dry-run`
- Schema parity after the push: `npx supabase db diff --linked --schema public` (empty)
- CI green on the PR: `gh pr checks <n>`
- Workers Builds green on the merge commit

#### Manual Verification:

- Owner go-ahead given before `db push`
- The `db dump --linked` grants match the pgTAP expectations
- The preview session works with no `[unenv]` errors
- The production smoke check passes, including persistence across a device or browser change

---

## Testing Strategy

### Unit Tests (Vitest, CI):

- `srs.ts`: state transitions per rating, learning-step minutes, state mapping both ways, no `elapsed_days` in the output.
- `reviews.ts`: the RPC argument shape (no `user_id`), `P0002` → `null`, a missing card → `null`, an unexpected RPC shape throws.
- Routes: the full error vocabulary, the `day_end` bounds, the 200 shape on apply and on replay, and logs free of card text.
- `flashcards.ts`: the edit payload is exactly `{front, back}`.
- Every new test is mutation-checked so it cannot pass vacuously.

### Integration Tests (pgTAP, local):

- `review_logs` policy matrix and privileges; function privileges.
- Cross-user insert and grade both rejected; replay is a no-op; cascade on card delete.
- `next_review_card`: tiers, learn-ahead window, `learning_only`, isolation from other users.

### Manual Testing Steps:

1. On the local stack: the Phase 3 manual list (reload persistence, Again requeue, delete in another tab, retry after an outage, batch of 20, empty states, second account, edit keeps the schedule, keyboard and screen reader).
2. On the preview: one grade per button; no `[unenv]` errors.
3. On production: persistence across browsers.

## Performance Considerations

- One grade costs:
  - one select of the card's FSRS state;
  - one `record_review` write (log insert + card update);
  - one `next_review_card` read, served by `(user_id, due)` and the existing `user_id` index.
- `ts-fsrs` adds about 13 KB gzip to the server bundle and nothing to the client bundle (scheduling is server-only).

## Migration Notes

- Expand-only. Existing cards become `new`, due now; the code deployed before S-05 ignores the new columns and objects.
- Code rollback is safe with the schema left in place. A schema rollback would need a forward migration that drops the objects, which is not planned.

## References

- Research: `context/changes/srs-review-session/research.md`
- RPC template: `supabase/migrations/20261006211722_review_and_save_proposals.sql:104-180`
- Canonical route: `src/pages/api/flashcards/[id].ts`
- Server-loaded page: `src/pages/deck.astro:20-82`
- pgTAP template: `supabase/tests/generations_rls.test.sql`
- Release with migration: `context/archive/2026-10-05-review-and-save-proposals/plan.md:454-505`
- workerd risk: `context/foundation/infrastructure.md:306`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data layer (local)

#### Automated

- [x] 1.1 Migration applies to the local stack — c399748
- [x] 1.2 pgTAP passes, including existing files — c399748
- [x] 1.3 Types regenerate with no manual edits — c399748
- [x] 1.4 Lint and unit tests still pass — c399748

#### Manual

- [x] 1.5 Mutation check on `review_logs_insert_own` ownership clause — c399748
- [x] 1.6 Migration reviewed by the owner — c399748

### Phase 2: Scheduling and API

#### Automated

- [x] 2.1 Unit tests pass — e92bada
- [x] 2.2 Lint passes — e92bada
- [x] 2.3 Build passes with `ts-fsrs` bundled — e92bada
- [x] 2.4 `srs.test.ts` covers the transition cases — e92bada
- [x] 2.5 Route tests cover the error vocabulary and 200 shapes — e92bada

#### Manual

- [x] 2.6 Mutation check on scheduling and `not_found` branch — e92bada

### Phase 3: Review UI

#### Automated

- [x] 3.1 Lint, tests and build pass
- [x] 3.2 `npm run preview` serves `/review` without `[unenv]` errors

#### Manual

- [x] 3.3 Reload mid-session keeps progress
- [x] 3.4 Again requeues in the same session (learn ahead)
- [x] 3.5 Card deleted in another tab is never shown / handled as not_found
- [x] 3.6 Retry after outage writes exactly one log row
- [x] 3.7 Batch of 20 with Continue
- [x] 3.8 Empty-deck and nothing-due states
- [x] 3.9 Second account sees nothing of the first
- [x] 3.10 Edit keeps schedule and log
- [x] 3.11 Keyboard and screen-reader run
- [x] 3.12 `.dev.vars` restored and sha matches

### Phase 4: Release

#### Automated

- [ ] 4.1 Dry run lists exactly one migration
- [ ] 4.2 Schema parity after push
- [ ] 4.3 CI green on the PR
- [ ] 4.4 Workers Builds green on the merge commit

#### Manual

- [ ] 4.5 Owner go-ahead before `db push`
- [ ] 4.6 `db dump --linked` grants match pgTAP
- [ ] 4.7 Preview session works without `[unenv]` errors
- [ ] 4.8 Production smoke check incl. cross-browser persistence
