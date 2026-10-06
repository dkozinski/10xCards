---
date: 2026-10-05T22:06:24+02:00
researcher: Claude (Opus 5.5) for Dawid Kozinski
git_commit: 73d7a15ccd91cfd5d0fb96e5904be9f5479fc26e
branch: feat/review-and-save-proposals
repository: dkozinski/10xCards
topic: "S-03 review-and-save-proposals: reject/edit AI proposals and save the rest atomically with a generations record"
tags: [research, codebase, generate, flashcards, supabase, rls, rpc, migrations]
status: complete
last_updated: 2026-10-05
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Owner resolved Open Questions 1 and 2 (2026-10-05)"
---

# Research: S-03 review-and-save-proposals

**Date**: 2026-10-05T22:06:24+02:00
**Researcher**: Claude (Opus 5.5) for Dawid Kozinski
**Git Commit**: 73d7a15 (branch not pushed — local references, no permalinks)
**Branch**: feat/review-and-save-proposals
**Repository**: dkozinski/10xCards

## Research Question

How do we let the user reject and edit AI proposals from S-02 and save the rest into their deck in one action, given the owner's decisions of 2026-10-05:

- **Q-2 (#2):** a new `generations` table stores per-generation **counts only** — generated / saved unedited / saved after edit / rejected. No source text, no rejected card content.
- **Q-3 (#3):** `flashcards.source` = `manual` | `ai` | `ai_edited`; any edit before save → `ai_edited`.
- The cards and the generations row must be written **atomically**.

What does the codebase already provide, and what must be built?

## Summary

- **The UI is a read-only list today.** `GenerateProposals.tsx` holds proposals as a bare `{front, back}[]` keyed by array index, with no id, no status, no save path. S-03 turns it into a review list: per-item id, original snapshot (to detect edits), kept/rejected status, inline editing, one Save button.
- **Every proposal is already a valid card.** The generation service re-validates each card with `createFlashcardSchema` and caps at 20, so unedited proposals can be inserted as-is. Edited ones go through the same schema on client and server.
- **Nothing identifies a generation.** `/api/proposals` never touches the database and drops its `meta`. The save step must carry the generated count itself (or S-02's route must start writing — see Open Questions).
- **Atomicity needs the repo's first Postgres function.** No `.rpc(` or `create function` exists anywhere. External docs confirm that PostgREST runs each RPC call in **one transaction**, so a single function inserting both the cards and the generations row is all-or-nothing. That function is also the "first RPC path" the F-01 impl review warned about, so its privileges must be explicit.
- **All the surrounding patterns exist and should be copied:** per-op/per-role RLS plus final-state grants in one migration, a pgTAP suite as template, route branch order, `readBody` with a bounded body, content-free logging, the `NewFlashcardForm` island pattern, `db:types` regeneration.
- **Deploy order matters.** Migrations are pushed by hand and rollback reverts code only. The migration must be additive (`source` defaults to `manual`) and reach production **before** the code that calls the function is merged.

## Detailed Findings

### 1. S-02 proposals UI — `src/components/generate/GenerateProposals.tsx`

- **State** (L51-56): `text`, `fieldError`, `requestError {message, retryable}`, `proposals: FlashcardProposalDto[] | null`, `pending`, `elapsed` via `useElapsedSeconds`. No reducer, no per-proposal state.
- **List keyed by index** (L232-234). The comment justifies it with "no id, never reordered". S-03 invalidates that: removing or editing items would attach edit state to the wrong card. Assign a client id (e.g. `crypto.randomUUID()`) when `setProposals` runs (L93). The S-02 research already anticipated this (`archive/2026-09-29-ai-proposals-from-text/research.md:288`).
- **Request lifecycle** `generate()` (L58-108):
  - client `safeParse` → `fetch("/api/proposals")` with `AbortSignal.timeout(75_000)` → response handling.
  - Error mapping (L92-106): `validation_failed` → field error; `generation_failed` or timeout → retryable; `unauthorized` → not retryable; anything else → generic message.
- **Re-generate wipes the list** (`setProposals(null)`, L68). In S-03 that would silently discard unsaved edits.
- **Read-only render** (L225-243): heading "Proposals (N)" plus the note "Preview only — saving proposals to your deck comes in the next step." (L229). This is the only S-03 placeholder; there are no stubs or TODOs.
- **sr-only live region** (L203-205) announces the count and must follow rejections.
- **Mount:** `src/pages/generate.astro:19` `client:load`. `/generate` is in `PROTECTED_ROUTES` (`src/middleware.ts:4`).

### 2. S-02 endpoint and service

- `src/pages/api/proposals/index.ts`:
  - `prerender = false` (L9).
  - Branch order: auth → `OPENROUTER_API_KEY` → `readBody` (128 KiB streamed cap, L12-47) → `JSON.parse` → zod → service.
  - Returns `{ proposals }` (L93-94). `meta` (dropped, latency, usage) is logged only, content-free.
  - **Does not create a Supabase client.**
- `src/lib/validation/generation.ts:5-7`: `SOURCE_TEXT_MIN=500`, `SOURCE_TEXT_MAX=20_000`, `MAX_PROPOSALS=20`.
- `src/lib/services/generation.ts:205-210`: invalid cards are dropped, the rest capped at 20. Zero cards → `no_valid_cards`.
- Source text lives only in React state, the request body and the upstream call. Tests assert it is never logged (`src/pages/api/proposals/index.test.ts:227`, `src/lib/services/generation.test.ts:299`).

### 3. S-01 write path

- `src/pages/api/flashcards/index.ts`: POST only.
  - Branch order: `locals.user` → `createClient` (null → `server_error`) → `request.json()` → `createFlashcardSchema` → `createFlashcard(parsed.data)`.
  - Responds 201 with a bare `FlashcardDto`.
  - On DB error it logs `{code, message}` only, because PostgrestError details can quote card text (L38-45).
  - It uses `request.json()` with no body cap. S-02's `readBody` is the hardened pattern.
- `src/lib/services/flashcards.ts`: `type Client = SupabaseClient<Database>` (L9). Its header (L5-7) says it is "the only module that queries public.flashcards", uses the request-scoped client so RLS applies, and never sends `user_id`.
  - `createFlashcard` (L14-22) is a single insert.
  - `listFlashcards` (L24-44) orders `created_at desc, id desc`. Bulk-inserted cards share `created_at`, so `id` decides their order.
- `src/lib/validation/flashcard.ts`:
  - `FRONT_MAX=200`, `BACK_MAX=500`.
  - `cardText()` trims, then checks max, visible-character and storable (L18-25).
  - Browser-safe; stricter than the DB CHECKs, never looser.
- `NewFlashcardForm.tsx`:
  - `CardField` (L17-66) is the template for inline editing: trimmed counter, `aria-invalid`, error line.
  - It is **not exported** and has fixed DOM ids `front`/`back` (L10, L29). Up to 20 editors would collide, so it needs an id prefix.
  - `firstErrors()` (L13-15).
  - On success: `window.location.assign("/deck")`.
- The S-01 plan expected S-03 to reuse `POST /api/flashcards` for bulk save (`archive/2026-09-28-manual-card-and-deck/plan.md:5,122`). The later atomic two-table decision supersedes that: a single-card endpoint cannot write the generations row in the same transaction.

### 4. Database, RLS, grants

- `supabase/migrations/20260922190157_create_flashcards.sql`:
  - `user_id default auth.uid() … on delete cascade`.
  - CHECKs: front 1-200, back 1-500 (L14-15).
  - 8 policies: `authenticated` `*_own` with `(select auth.uid()) = user_id`; `anon` `*_anon_deny` with `false`.
- `…194808_flashcards_explicit_grants.sql`: the cloud auto-granted `anon`/`service_role` while local did not. This migration revokes `anon`.
- `…181722_flashcards_tighten_grants.sql`: default privileges also gave TRUNCATE/REFERENCES/TRIGGER, and **RLS does not govern TRUNCATE**. The fix revokes all, then re-grants CRUD to `authenticated` and `service_role`.
  - **Implication:** write the final grant state for `generations` in its own creating migration (revoke all from `anon`, `authenticated`, `service_role`, then grant explicitly).
- **No functions, triggers or enums exist** (`src/db/database.types.ts:34-42`: all `never`). `archive/2026-09-22-deck-data-contract/reviews/impl-review.md:37` says the TRUNCATE hole was latent until "the first RPC or SQL path". S-03 creates that path.
- `supabase/tests/flashcards_rls.test.sql` is the pgTAP template:
  - RLS on, exact policy count, `bag_eq` role×cmd matrix, `table_privs_are` for three roles.
  - Impersonation via `set local role authenticated; set local request.jwt.claims`.
  - Expected SQLSTATEs: insert denied `42501`, CHECK `23514`.
- **Types:** `npm run db:types` → `src/db/database.types.ts` (from the **local** stack) → aliases in `src/types.ts`. A function appears under `Functions` with `Args`/`Returns`. Adding `source` to the table changes `TablesInsert<"flashcards">`; `CreateFlashcardCommand` is a `Pick`, so it stays `{front, back}`.

### 5. Errors, middleware, CSRF

- `src/lib/api-errors.ts:4`: `validation_failed | invalid_json | unauthorized | server_error | generation_failed`. `ValidationDetails = { fieldErrors: Partial<Record<string, string[]>> }` (L15-17).
  - **Gap:** a flat `fieldErrors` record cannot address "card 3, back". `z.flattenError` loses array paths. The bulk endpoint needs a decision (e.g. dotted keys `cards.3.back`, which still fit the record type).
- `src/middleware.ts`: API routes are not guarded and each checks `locals.user`. `Cache-Control: private, no-store` is set on every response.
- `astro.config.mjs:21`: `security.checkOrigin: true`. Its comment lists the routes that depend on it, and the new route should be added there.

### 6. Testing

- Vitest (`npm test`, CI `.github/workflows/ci.yml:21`), node environment, `src/**/*.test.ts`. There is **no component or jsdom infrastructure**, so island behaviour is verified manually.
- Route tests mock `@/lib/supabase` and call `POST({request, locals, cookies} as APIContext)`. They assert branch order, e.g. `createClient` is not called on 401 (`src/pages/api/flashcards/index.test.ts`).
- An RPC wrapper stub: `{ rpc: vi.fn(() => Promise.resolve({data, error})) }`. Assert the function name **and** args (review pitfall: stubs must assert call options).
- pgTAP (`npx supabase test db`) is the only real-DB test. It runs locally and is not in CI.
- Tests are checked to be non-vacuous by mutation (`archive/2026-09-29-ai-proposals-from-text/reviews/impl-review-phase-2.md:5`).

### 7. Migration and deploy practice

- Order: local first with `npx supabase migration up`, then `npx supabase test db`.
- Then cloud: `npx supabase db push --dry-run`, owner go-ahead, `db push`, then parity checks with `db diff --linked --schema public` plus `db dump --linked` (migra ignores privileges). Source: `archive/2026-09-22-deck-data-contract/plan.md:223-251`, `reviews/impl-review.md:48`.
- `supabase db reset` is destructive and needs owner confirmation (global rule).
- Rollback reverts code only (`changes/deployment/deployment-plan.md:860-863`). Migrations stay additive for one release.
- Previews run against **production** Supabase, and merge to `main` deploys production. **The migration must be in production before the PR is merged** (and before any preview exercises the save).
- `.dev.vars` points at production. Manual checks follow the S-01 precedent: swap to the local stack, with a backup and `.dev.vars*` gitignored.

## External Research (Context7)

| Question | Finding | Source |
|---|---|---|
| Is an RPC call atomic? | PostgREST wraps each RPC function call in a single Postgres transaction. An exception anywhere rolls back every insert in the function. | Supabase docs, troubleshooting "high CPU and infinite transaction retries… custom error codes in RPC functions" (`/supabase/supabase`) |
| Who can call a function by default? | **Any role**, including `anon`. Restrict with `revoke execute on function … from public, anon;` then `grant execute … to authenticated;`. | Supabase guides, database functions → "Function privileges" |
| Invoker vs definer | `security invoker` runs as the caller, so the existing RLS policies apply inside the function. `security definer` bypasses them and needs `set search_path = ''` plus schema-qualified names. The Supabase prompt template uses `security invoker set search_path = ''`. | Supabase guides, database functions; `examples/prompts/database-functions.md` |
| Error surface | PostgREST maps SQLSTATE to HTTP (e.g. `23505` → 409, `42501` → 401/403). `PTxyz` sets the status directly. Our route does not forward these; it maps any `{error}` from `rpc()` to our closed vocabulary (`server_error`). | PostgREST v14 docs, references/errors |
| Avoid | Do not `raise` SQLSTATE `40001` in the function: PostgREST treats it as transient and retries. | Same Supabase troubleshooting page |

**Implication (recommendation for the plan, not yet a decision):**

- One `security invoker`, `set search_path = ''` function, e.g. `public.save_generation(cards jsonb, generated_count int)`.
- It inserts the cards (`source` per card) and one `generations` row whose saved counts are **computed from the cards inside the function**, with `rejected = generated − saved` and a guard `saved ≤ generated ≤ 20`.
- `revoke … from public, anon`; `grant execute … to authenticated, service_role`.
- Tests: pgTAP `function_privs_are` plus a rollback test (one invalid card → zero rows in both tables).

## Code References

- `src/components/generate/GenerateProposals.tsx:51-56` — island state
- `src/components/generate/GenerateProposals.tsx:58-108` — `generate()` lifecycle and error mapping
- `src/components/generate/GenerateProposals.tsx:68` — re-generate wipes proposals
- `src/components/generate/GenerateProposals.tsx:225-243` — read-only list, index keys, "Preview only" note
- `src/pages/api/proposals/index.ts:12-47` — `readBody` (128 KiB streamed cap)
- `src/pages/api/proposals/index.ts:93-94` — `{ proposals }` response, `meta` dropped
- `src/lib/validation/generation.ts:5-7` — `MAX_PROPOSALS = 20`
- `src/lib/validation/flashcard.ts:18-30` — `cardText()`, `createFlashcardSchema`
- `src/lib/services/flashcards.ts:5-22` — single-module rule, `createFlashcard`
- `src/pages/api/flashcards/index.ts:8-45` — route branch order, content-free DB error logging
- `src/components/deck/NewFlashcardForm.tsx:10-66` — `firstErrors`, private `CardField`, fixed ids
- `src/lib/api-errors.ts:4,15-17,27-30` — vocabulary, `ValidationDetails`, `apiError`
- `src/types.ts:6-23` — DTO aliases, `FlashcardProposalDto = CreateFlashcardCommand`
- `src/db/database.types.ts:34-42` — no Functions/Enums yet
- `supabase/migrations/20260922190157_create_flashcards.sql` — table, CHECKs, 8 policies
- `supabase/migrations/20260923181722_flashcards_tighten_grants.sql` — final grant pattern
- `supabase/tests/flashcards_rls.test.sql` — pgTAP template
- `astro.config.mjs:21` — `checkOrigin: true`
- `src/middleware.ts:4` — `PROTECTED_ROUTES`

## Architecture Insights

- **Thin route, typed service, DB as last line of defence:** zod (stricter) → service (request-scoped client, RLS) → CHECK constraints.
- **Closed error vocabulary:** a bulk save fits existing codes (`validation_failed`, `invalid_json`, `unauthorized`, `server_error`). No new code is needed.
- **Defence in depth on data access:** privileges (layer 1) plus per-op/per-role RLS (layer 2), both asserted in pgTAP. A function adds a third surface (`EXECUTE`), which needs the same treatment.
- **Privacy by construction:** no storage of source text, no web storage, content-free logs. The `generations` table must hold only integers, timestamps and `user_id`.
- **Islands are self-contained:** `useState`, client-side `safeParse`, manual `fetch`, `ServerError`, full navigation on success.

## Historical Context (from prior changes)

- `context/archive/2026-09-22-deck-data-contract/plan.md:35` — the origin column was deferred to S-03 pending PRD OQ-3 (now resolved).
- `context/archive/2026-09-22-deck-data-contract/reviews/impl-review.md:37` — TRUNCATE risk "real with the first RPC or SQL path".
- `context/archive/2026-09-22-deck-data-contract/plan.md:293-296` — three migrations for one table's grants; anon denied by privilege (42501).
- `context/archive/2026-09-28-manual-card-and-deck/plan.md:31` — Astro Actions rejected because they bypass the error vocabulary; S-03 keeps the JSON contract.
- `context/archive/2026-09-28-manual-card-and-deck/reviews/impl-review-phase-1.md:36-53` — unstorable input must be 400, not 500; routes insert parsed output.
- `context/archive/2026-09-28-manual-card-and-deck/reviews/impl-review-phase-2.md:138-146` — never log PostgrestError details.
- `context/archive/2026-09-29-ai-proposals-from-text/plan.md:59-60` — S-02 explicitly left saving, editing, rejecting and rejection counts to S-03.
- `context/archive/2026-09-29-ai-proposals-from-text/plan.md:472` — overlapping Polish cards: "S-03's reject step is where it gets handled".
- `context/archive/2026-09-29-ai-proposals-from-text/reviews/impl-review-phase-3.md:25-37` — defensive response parsing; a malformed 200 must not unmount the island. This is critical now that the island holds unsaved edits.
- `context/archive/2026-09-29-ai-proposals-from-text/reviews/impl-review-phase-3.md:112-120` — `.dev.vars.bak` with live keys appeared twice; `.dev.vars*` is now gitignored.

## Related Research

- `context/archive/2026-09-29-ai-proposals-from-text/research.md` — S-02 generation research (proposal shape, client-side keys for S-03).

## Open Questions

For `/10x-plan` to resolve. The owner decides where marked.

1. **Who creates the `generations` row?**
   - **(a) The save function** (recommended). The client sends `generated_count`. This is simple and keeps S-02 DB-free, but the count is client-asserted.
   - **(b) `/api/proposals`** creates the row at generation time and returns `generation_id`. The count is then server-trusted, but it adds a DB write to S-02's path.
   - A generation the user abandons without saving: in (a) it leaves no row; in (b) it leaves a row with no saves, which is arguably more honest for the metric.
   - **Owner decision** (it changes what the metric counts).
   - **Resolved 2026-10-05 (owner): (a).** The save function creates the row; `generated_count` comes from the client and is guarded (`saved ≤ generated ≤ 20`). S-02's route stays DB-free. Abandoned generations (never saved or discarded) leave no row.
2. **Zero kept cards.** Can the user "save" with everything rejected, recording a generation of all rejections, or is Save disabled at 0? This affects whether all-rejected generations are ever counted.
   - **Resolved 2026-10-05 (owner): saving with 0 kept cards is allowed and required**, because it records the rejections, i.e. the AI's failure.
     - The button is **always enabled** and its label is dynamic: "Save N cards" when N > 0, "Discard all" (secondary style) when N = 0.
     - Whatever the label, a click calls **the same endpoint/function**. With 0 cards it writes only the `generations` row (`saved = 0`, `rejected = generated`).
     - The function and the zod schema must therefore accept an empty `cards` array.
3. **`flashcards.generation_id` FK:** is it worth adding for traceability? It is not required by the decisions. `user_id` cascade already covers S-06 deletion.
4. **Per-card validation error shape** inside the flat `fieldErrors` record, e.g. dotted keys `cards.<i>.front`.
5. **Re-generate with unsaved edits:** confirm, block, or allow the discard?
6. **`source` storage:** a `text` + CHECK constraint (consistent with the repo, which has no enums) or a Postgres enum.
7. **Manual verification setup:** the `.dev.vars` swap procedure to the local stack, written into the plan explicitly.
