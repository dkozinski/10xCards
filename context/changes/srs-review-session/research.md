---
date: 2026-10-10T11:16:27+02:00
researcher: Claude (Opus 5.5)
git_commit: f1da1d8dc98c03f354f9288408b8c40709b3523d
branch: main
repository: dkozinski/10xCards
topic: "S-05 srs-review-session — what the codebase already provides for a persisted spaced-repetition review session (US-02, FR-012)"
tags: [research, codebase, srs, review-session, flashcards, rls, rpc, api-routes, testing, s-05]
status: complete
last_updated: 2026-10-10
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Added follow-up external research on scheduling algorithm and library (Open Question 1)"
---

# Research: S-05 srs-review-session

**Date**: 2026-10-10T11:16:27+02:00
**Researcher**: Claude (Opus 5.5)
**Git Commit**: f1da1d8dc98c03f354f9288408b8c40709b3523d
**Branch**: main
**Repository**: dkozinski/10xCards

Permalink base: `https://github.com/dkozinski/10xCards/blob/f1da1d8dc98c03f354f9288408b8c40709b3523d/`

## Research Question

What does the existing codebase provide — and what conventions must S-05 follow — to let a user start a review session on their deck, grade each card, and have schedule + progress persisted (US-02, FR-012, NFR session reliability, NFR durability)? Scope is **internal** only; the choice of scheduling algorithm/library is external research and is listed under Open Questions.

## Summary

- **No scheduling state exists anywhere.** `flashcards` has `id, user_id, front, back, created_at, source` — no due/interval/ease/stability, no `updated_at`, no triggers. Earlier slices deliberately deferred all of it to S-05 ("introduced at the moment something finally uses it").
- **Two precedents cover the shape S-05 needs:**
  - *Per-card mutable state* → columns added to `flashcards` with defaults + named CHECK (S-03's `source` column).
  - *Append-only history* → an owner-scoped table with `select, insert` grants only and `false` deny policies for update/delete (S-03's `generations`).
- **Atomic "record grade + update schedule" has a ready template:** the `save_generation` RPC — `plpgsql security invoker set search_path = ''`, one PostgREST call = one transaction, idempotency via a client-minted uuid PK and `on conflict do nothing`.
- **Server conventions are tight and uniform:** each route builds its own request-scoped Supabase client, checks `locals.user`, validates ids with `z.guid()` (malformed → `not_found`), reads bodies through `readBody`, validates with zod, and returns errors only via `apiError()`. There is **no GET API route yet** — lists are rendered server-side in `.astro` pages.
- **UI is pessimistic and server-rendered first:** islands disable controls while a request is in flight, show errors by branching on `error.code`, and only advance after a 2xx — exactly the US-02 rule "grade saved before the next card appears".
- **Testing exists (contrary to roadmap Open Question 6's wording):** Vitest unit tests (services with fake query builders, routes with mocked `@/lib/supabase`) run in CI; pgTAP RLS tests run locally only. OQ6 itself has no recorded decision (issue #6 open).
- **Infra constraints already recorded:** review state must live in Postgres (not Astro Sessions/KV), and any SRS library must be vetted for workerd (no Node built-ins, gates G1–G6) and checked on a deployed preview.

## Detailed Findings

### 1. Data layer — current schema

- `flashcards` created in `supabase/migrations/20260922190157_create_flashcards.sql:6-16`:
  - `user_id uuid not null default auth.uid() references auth.users (id) on delete cascade` (`:10`) — callers never send `user_id`.
  - CHECKs `flashcards_front_length` (1–200 trimmed) and `flashcards_back_length` (≤500) (`:14-15`); index `flashcards_user_id_idx` (`:20`).
  - No `updated_at`, no trigger, no function other than `save_generation`.
- `source text not null default 'manual'` + `flashcards_source_check in ('manual','ai','ai_edited')` added by `supabase/migrations/20261006211722_review_and_save_proposals.sql:17-19` — value sets are **text + named CHECK, not Postgres enums**, mirrored as a TS union in `src/types.ts:8-10`.
- `generations` (`20261006211722_review_and_save_proposals.sql:23-36`): client-minted uuid PK (idempotency key), counts only, immutable rows, `user_id` cascade to `auth.users`.
- Grep for `due|interval|ease|last_review|repetition|fsrs|stability` across migrations, types and `src/db/` → **nothing**.
- Ordering today: deck lists by `created_at desc, id desc` (`src/lib/services/flashcards.ts:57-58`).
- Deletion is a **hard delete** (`src/lib/services/flashcards.ts:45`); "nothing references `flashcards`, so a delete cascades nowhere" (S-04 plan) — S-05 is the first slice that would add a reference to `flashcards`.

### 2. Data layer — RLS, grants, RPC conventions

- **RLS split** (`create_flashcards.sql:27-78`): authenticated gets `flashcards_{select,insert,update,delete}_own` with `(select auth.uid()) = user_id` (update has both `using` and `with check`, `:42-48`); anon gets four `*_anon_deny` policies with `false`.
- **Grants** — the hard-won pattern:
  - `20260922194808_flashcards_explicit_grants.sql` — cloud auto-grants `anon`/`service_role`, local stack does not; made explicit.
  - `20260923181722_flashcards_tighten_grants.sql:1-11` — default privileges leak TRUNCATE/REFERENCES/TRIGGER and **RLS does not govern TRUNCATE**; revoke all, re-grant exactly CRUD.
  - S-03 rule: write the **final** grant state in the creating migration (`review_and_save_proposals.sql:6-7, 45-47`).
  - Column-level UPDATE grants were explicitly rejected as "a trap for future columns such as S-05's scheduling state" (`context/archive/2026-10-05-review-and-save-proposals/reviews/impl-review-phase-1.md:41-61`). Consequence: if scheduling lives in `flashcards` columns, the owner can technically write them directly via PostgREST (same accepted limitation as `source`).
- **RPC template** `public.save_generation` (`review_and_save_proposals.sql:104-180`):
  - `language plpgsql security invoker set search_path = ''` → caller's RLS applies, `user_id` defaults to `auth.uid()`.
  - Atomicity: "PostgREST runs one RPC call in one transaction" (`:99-100`).
  - Idempotency: `insert … on conflict (id) do nothing`; replay returns stored result, writes nothing (`:143-163`).
  - Validation raises `errcode '22023'`; CHECK failures surface as `23514`.
  - `revoke execute … from public, anon`; grant to `authenticated`, `service_role` (`:176-180`).
  - Called from `src/lib/services/generations.ts:12` via `supabase.rpc(...)`; non-number result throws (`:20`).
- **Generated types:** `src/db/database.types.ts` (`Tables`, `Functions.save_generation`), regenerated by `npm run db:types` (`package.json:14`) against the **local** stack. DTOs are aliases over generated types (`src/types.ts:3-6`).

### 3. API routes and services

- Route inventory (`src/pages/api/`): `flashcards/index.ts` (POST), `flashcards/[id].ts` (PATCH, DELETE), `generations/index.ts` (POST), `proposals/index.ts` (POST), `auth/*` (form POSTs with redirects). **No GET API route exists.**
- Canonical route shape — `src/pages/api/flashcards/[id].ts`:
  - `export const prerender = false` (`:9`).
  - Order: `locals.user` check → id via `z.guid()` (`:16`, malformed → `not_found`, `:40-43`) → `createClient(request.headers, cookies)` (null → `server_error`) → `readBody(request, 8 KiB)` (`:12, :50-58`) → `JSON.parse` (`invalid_json`) → zod `safeParse` → service in try/catch → `server_error`.
  - `logFailure(op, error)` logs only `{code, message}` (`:25-31`) — no card text in logs.
- `src/lib/api-errors.ts:4-22, :36` — closed vocabulary `validation_failed | invalid_json | unauthorized | not_found | server_error | generation_failed`; body `{ error: { code, message, details? } }`. A grade for a deleted/foreign card maps naturally onto `not_found`.
- `src/lib/services/flashcards.ts` — every function takes the request-scoped `SupabaseClient<Database>` first, never filters by `user_id` (RLS does), `if (error) throw error`. `updateFlashcard` returns `null` for missing/foreign (`:28-41`).
- **Edit hook point for OQ4:** the only edit write is `.update({ front: cmd.front, back: cmd.back })` at `src/lib/services/flashcards.ts:35`. A "reset scheduling on edit" policy would go there or in a DB trigger. PATCH's zod schema strips unknown keys (`[id].ts:33-34`), so clients cannot write scheduling fields through it.
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/deck", "/generate"]`; a `/review` page must be added. Middleware sets only `locals.user` (no `locals.supabase`) and `Cache-Control: private, no-store` on every response (`:39-41`).

### 4. UI patterns

- Pages: `Layout.astro` + `<Topbar />` inside `bg-cosmic … max-w-2xl` with glass section cards.
- `src/pages/deck.astro:20-39` is the template for a server-loaded list: `createClient(Astro.request.headers, Astro.cookies)` → service → `loadFailed` flag on error; empty state is an inline `<p>` (`:70`), load failure an inline red box (`:66-68`). Only minimal props are serialized into islands (`:78-82`).
- Islands use inline `fetch` with `AbortSignal.timeout(...)` (DeckCard 30 s), **pessimistic** updates (controls disabled + spinner), and branch on `body?.error?.code` with friendly messages (`not_found` → "This card no longer exists…"). Errors render via `src/components/auth/ServerError.tsx` (`role="alert"`). Live regions `sr-only aria-live="polite"` in the generate flow.
- Hooks: `useElapsedSeconds`, `useUnsavedChangesGuard` (`src/components/hooks/`).
- Nav: `src/components/Topbar.astro:13-21` — "Review" link slots alongside "My deck".
- shadcn installed: `button`, `skeleton`, `textarea` only.

### 5. Testing

- `vitest.config.ts` (plain, not `getViteConfig` — the workerd adapter breaks Vitest), `include: src/**/*.test.ts`; `npm test` runs in CI (`.github/workflows/ci.yml:21`), no DB in CI.
- Services tested with chainable `vi.fn` fake query builders (`src/lib/services/flashcards.test.ts`, `generations.test.ts`); routes tested with `vi.mock("@/lib/supabase")` and a `stubClient()` (`src/pages/api/flashcards/[id].test.ts:8, :27-57`).
- pgTAP: `supabase/tests/flashcards_rls.test.sql`, `generations_rls.test.sql` — impersonate users via role + JWT claims, `bag_eq` role×cmd policy matrix, `table_privs_are`, `function_privs_are`; run manually with `npx supabase test db`, **not in CI**.
- Agreed norms: node-env Vitest only (no jsdom/component tests, UI checked by hand); new tests must be mutation-checked so they cannot pass vacuously.

## Code References

- `supabase/migrations/20260922190157_create_flashcards.sql:6-78` — flashcards table, RLS split, anon deny
- `supabase/migrations/20260923181722_flashcards_tighten_grants.sql:1-11` — why grants are revoked-then-regranted
- `supabase/migrations/20261006211722_review_and_save_proposals.sql:17-19` — column + CHECK precedent (`source`)
- `supabase/migrations/20261006211722_review_and_save_proposals.sql:23-95` — append-only owner table precedent (`generations`)
- `supabase/migrations/20261006211722_review_and_save_proposals.sql:104-180` — atomic idempotent RPC template
- `src/lib/services/generations.ts:11-20` — calling an RPC from a service
- `src/lib/services/flashcards.ts:35` — edit write (OQ4 hook point)
- `src/lib/services/flashcards.ts:45-61` — hard delete; list ordering; PGRST103 handling
- `src/pages/api/flashcards/[id].ts:9-111` — canonical route (id, body, zod, errors, logging)
- `src/lib/api-errors.ts:4-36` — error vocabulary + `apiError()`
- `src/lib/read-body.ts:5-38` — bounded body reader
- `src/middleware.ts:4, :39-41` — protected routes, no-store header
- `src/pages/deck.astro:20-82` — server-loaded page + islands + empty/failure states
- `src/components/Topbar.astro:13-21` — nav links
- `src/types.ts:3-18` — DTO aliases, `FlashcardSource` union
- `vitest.config.ts`, `src/pages/api/flashcards/[id].test.ts:8-57` — test harness pattern
- `supabase/tests/flashcards_rls.test.sql` — pgTAP template

## Architecture Insights

- **RLS + request-scoped client is the authorization layer.** Services never pass or filter `user_id`; the guardrail "never show another user's card" is enforced by the database, and pgTAP is where it is proven.
- **Writes that must be all-or-nothing go through a `security invoker` RPC**, not multiple PostgREST calls. A grade write that both appends history and moves the card's due date fits this exactly, and the client-minted id makes a retried POST (timeout, double-click) harmless — directly serving "never loses progress" without double-counting.
- **Pessimistic UI is already the house style**, so "grade saved before next card" needs no new pattern: advance only on 2xx; on `not_found` (card deleted mid-session) skip with a message.
- **Additive (expand-only) migrations** are required because rollback reverts code only and previews hit production Supabase.
- **Server-render first:** the due queue can be loaded in `review.astro` like `deck.astro`, keeping the first GET out of the API layer (no GET route precedent to follow otherwise).

## Historical Context (from prior changes)

- `context/archive/2026-09-22-deck-data-contract/plan.md:36` — F-01 explicitly excluded scheduling/review columns.
- `context/archive/2026-10-07-edit-and-delete-cards/plan.md:45-47` — hard delete; no `updated_at` ("If S-05 needs it, S-05 adds it additively"); grade-history handling deferred to S-05.
- `context/archive/2026-10-07-edit-and-delete-cards/research.md:218, 226-227` — OQ4 deferral rationale.
- `context/archive/2026-10-05-review-and-save-proposals/plan.md:85-91, 107, 138-144` — RPC design, final-state grants rule.
- `context/archive/2026-10-05-review-and-save-proposals/reviews/impl-review-phase-1.md:41-61` — column-level UPDATE grant rejected, S-05 named.
- `context/archive/2026-09-28-manual-card-and-deck/plan.md:24-70` — Vitest introduction and rationale.
- `context/archive/2026-09-29-ai-proposals-from-text/research.md:426-440` — dependency gates G1–G6 for workerd (G2: no Node built-ins).
- `context/foundation/infrastructure.md:191-200, 305-306` — review state in Postgres, not KV; vet SRS libraries on a deployed preview.
- `context/archive/2026-10-05-review-and-save-proposals/plan.md:454-505` — manual migration push sequence (local up → `supabase test db` → `db push --dry-run` → owner OK → `db push` → parity diff + dump) before merge.
- Recurring review findings across S-01..S-04: grant gaps, vacuous tests, unbounded inputs, error logs leaking content, retry/idempotency UX, `.dev.vars.bak` left behind, a11y (live regions, focus).

## Related Research

- `context/archive/2026-10-07-edit-and-delete-cards/research.md`
- `context/archive/2026-10-05-review-and-save-proposals/research.md`
- `context/archive/2026-09-29-ai-proposals-from-text/research.md`

## Open Questions

1. **Scheduling algorithm and library (external research).** SM-2 vs FSRS (e.g. `ts-fsrs`) — what per-card state each needs, grade scale (2/4 buttons), and whether the library passes workerd gates G1–G6 (no Node built-ins, bundle size). Feeds `/10x-plan` via Context7/exa.
2. **Where scheduling state lives.** Columns on `flashcards` (simple read for the due queue; owner can self-write, like `source`) vs a separate `card_schedules` table (cleaner grants, extra join). Codebase supports both.
3. **Review log on card delete.** `flashcard_id … on delete cascade` drops history with the card (simplest, guarantees no dangling reference) vs `set null`/no FK (keeps aggregate history). S-06 needs the log to cascade from `auth.users` either way.
4. **OQ4 — edit vs grade history.** Hook point is `flashcards.ts:35` or a trigger; answer depends on (1).
5. **Session model.** Is a "session" a persisted entity (row with progress pointer) or simply "the current due queue", re-queried after each grade? The latter avoids extra state; "progress" is then the per-card schedule itself.
6. **Due-queue loading.** Server-rendered in `review.astro` (precedent) vs a first GET API route (no precedent); and queue size cap per session.
7. **Roadmap OQ6** — wording in `roadmap.md:196` is stale (Vitest + pgTAP exist); the open decision is whether the two guardrails get dedicated automated checks (pgTAP for RLS on new tables; Vitest for "advance only after 2xx").

## Follow-up Research 2026-10-10T13:20+02:00 — External: scheduling algorithm and library (Open Question 1)

**Question:** which off-the-shelf scheduler (FR-012) and which library, what per-card state it requires, and does it pass the workerd dependency gates G1–G6 (`context/archive/2026-09-29-ai-proposals-from-text/research.md:426-440`)?

**Sources:** Context7 `/open-spaced-repetition/ts-fsrs` (README, `_autodocs/types.md`, `api-reference/fsrs.md`, `configuration.md`); Exa — Expertium SRS benchmark (`expertium.github.io/Benchmark.html`), `open-spaced-repetition/fsrs-vs-sm17`, Yazu "Why FSRS means fewer reviews" (2025-10-01); `npm view` + `api.npmjs.org` (2026-10-10); static inspection of the `ts-fsrs@5.4.2` tarball (unpacked in the session scratchpad, nothing executed).

### E1. Algorithm: FSRS vs SM-2

| | SM-2 (1987, Anki legacy) | FSRS-6 (current) |
|---|---|---|
| Memory model | one `ease` factor + interval + repetition count | Difficulty, Stability, Retrievability per card |
| Retention target | implicit, no dial | explicit `request_retention` (default 0.9) |
| Grades | 0–5 (Anki variant: 4 buttons) | 4 buttons: Again, Hard, Good, Easy |
| Benchmark (Expertium, ~350 M reviews, 10k collections) | worse log loss than a constant "predict the average" baseline (0.616 vs 0.3945) | best among classical algorithms (log loss 0.3456); 99.6% superiority over Anki SM-2 |
| Personalisation | none | optional optimiser (needs ~1k reviews); default parameters used until then |
| Implementation | ~30 lines, could even live in plpgsql | library |

Caveats recorded by the benchmark authors themselves: SM-2 was not designed to predict probabilities, so "there is no way to have a truly fair, no caveats, comparison"; the benchmark measures prediction, not workload — the frequently quoted "20–30% fewer reviews" is not derived from it.

**Implication for 10xCards:** decks are small and new, so the optimiser is irrelevant for the MVP; FSRS with default parameters still beats SM-2 on prediction and gives an explicit retention dial. The PRD only requires "off-the-shelf" — both qualify.

### E2. Library: `ts-fsrs` against gates G1–G6

| Gate | Evidence | Result |
|---|---|---|
| G1 TypeScript | ships `dist/index.d.ts`; typed `Card`, `Grade`, `ReviewLog` | pass |
| G2 workerd | `dependencies`: none; ESM `exports["."].import = dist/index.mjs`; grep of `index.mjs` for `node:`/`fs`/`path`/`crypto`/`buffer`/`stream`/`process` imports → **zero**; the only `process.` hit is a JSDoc comment (line 1408); uses only `Date`/`Math` | pass on static check; **still to confirm on a deployed preview** per `infrastructure.md:306` |
| G2 bundle | `index.mjs` 61 245 B raw / 13 452 B gzip; package unpacked 706 KB (incl. maps, cjs, umd) | pass (cap 10 MiB) |
| G3 no background jobs | pure synchronous functions | pass |
| G4 agent-friendly | 185 331 downloads/week (vs `supermemo` 4 628); Context7 high reputation, 710 snippets; `_autodocs/` folder of agent-readable docs; MIT | pass |
| G5 repo conventions | server-side only, no UI coupling | pass |
| G6 no source-text persistence | not applicable (no text handled) | n/a |
| Version age | `5.4.2` published 2026-09-01 (> 2 weeks); `engines.node >= 20` (repo Node 22) | pass |

The optimiser (`@open-spaced-repetition/binding`, WASM) is a **separate** package and is not needed.

### E3. What FSRS requires the deck to persist (per card)

From `Card` in `_autodocs/types.md`:

- `due` (timestamptz), `stability` (float), `difficulty` (float), `scheduled_days` (int), `learning_steps` (int), `reps` (int), `lapses` (int), `state` (New / Learning / Review / Relearning), `last_review` (timestamptz, nullable).
- `elapsed_days` is **deprecated, removed in 6.0.0** — do not persist it.
- `createEmptyCard(now)` yields `{ due: now, stability: 0, difficulty: 0, …, state: New }` → every existing card can be backfilled as "new, due now" by column defaults; no data migration logic needed.

Per review (`ReviewLog`): `rating`, `state`, `due`, `stability`, `difficulty`, `scheduled_days`, `learning_steps`, `review` (timestamp) — enough for an append-only review log and for a future optimiser.

### E4. Behaviour that shapes the plan

- **Pure function.** `fsrs().next(card, now, grade) → { card, log }` depends only on its inputs. Computation happens in the Worker (TypeScript), not in Postgres — so the atomic RPC receives an already-computed next state. Consequence: as with `source`, an authenticated user calling PostgREST directly could write arbitrary schedule values for their own cards (self-reported, own-data-only; RLS still isolates users).
- **Fuzz is off by default** (`default_enable_fuzz = false`); when on, the seed is deterministic from `review_time + reps + difficulty*stability` (`DefaultInitSeedStrategy`). Either way a replayed grade with the same inputs yields the same result — compatible with the client-minted idempotency key pattern.
- **Short-term learning steps are on by default** (`enable_short_term = true`, `learning_steps ['1m','10m']`, `relearning_steps ['10m']`). A card graded Again/Hard while New comes back **minutes** later — inside the same session. Either the session re-queries "due ≤ now" and shows it again, or the plan sets `enable_short_term: false` so all intervals are whole days (simpler session, slightly less faithful scheduling). This is a real plan-time choice.
- **Concurrency / stale state.** Because the next state is computed from the card's *current* state, two tabs grading the same card could each compute from the same snapshot. Guard options: the RPC checks an expected `reps` / `last_review` value (optimistic concurrency) and returns a conflict, or it is accepted as last-write-wins. Error vocabulary has no `conflict` code today — adding one means touching `src/lib/api-errors.ts`.
- **Manual rating is rejected** (`Rating.Manual` → `FSRSValidationError`); the API's zod schema should accept only grades 1–4.

### E5. Bearing on the internal Open Questions

- **OQ1 (algorithm):** evidence favours FSRS via `ts-fsrs@5.4.2` — zero deps, 13 KB gzip, typed, agent-readable docs, statically workerd-clean. SM-2 remains a valid fallback with no dependency at all if the preview check fails.
- **OQ2 (where state lives):** nine FSRS fields with sane defaults fit as additive columns on `flashcards` (backfill = "new, due now"); a separate table would need a row created for every existing and future card.
- **OQ4 (edit vs history):** FSRS state describes the memory of a card, not its text; resetting on every edit would punish typo fixes. Plan-time choice remains (keep / reset / reset only on "major" edit), but nothing in the library forces a reset.
- **OQ5 (session model):** with short-term steps on, "session = re-query due cards after each grade" naturally handles same-session relearning; no persisted session entity is required by the library.
