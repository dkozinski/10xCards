# AI Proposals from Pasted Text (S-02) Implementation Plan

## Overview

A signed-in user opens `/generate`, pastes 500–20,000 characters of source text and clicks
"Generate". While a synchronous `POST /api/proposals` runs (~20 s typical), the page shows
live progress: elapsed seconds, time-based stage messages and skeleton cards. It then shows up
to 20 AI-drafted flashcard proposals (front/back). The server calls OpenRouter with plain
`fetch`, strict JSON-schema output and zero-data-retention routing, and validates every card
with the same rules the deck uses. Nothing is written to the database, and the source text is
never logged or stored.

This slice settles the milestone's riskiest assumption (roadmap S-02): that a ~20 s AI call
returns usable flashcards on Cloudflare Workers.

## Current State Analysis

- There is no AI integration anywhere (`package.json`, `src/`).
- There is no generation page, endpoint or service.
- The S-01 vertical pattern exists and is the template:
  - route: `src/pages/api/flashcards/index.ts:8-45`
  - service: `src/lib/services/flashcards.ts`
  - shared schema: `src/lib/validation/flashcard.ts`
  - island: `src/components/deck/NewFlashcardForm.tsx`
  - colocated Vitest tests
- The error vocabulary is closed (`src/lib/api-errors.ts:4`) and has no code for an upstream or AI failure.
- The only env secrets are `SUPABASE_URL` and `SUPABASE_KEY` (`astro.config.mjs:21-26`). Both are `secret` + `optional`, and runtime-resolved (research F1).
- Workers Logs keeps 100% of `console.*` output (`wrangler.jsonc:55-57`), so anything logged is persisted.
- The project is on Workers Free. The Paid gate is tied to this PR (`context/changes/deployment/deployment-plan.md:67-69`).

Full evidence: `context/changes/ai-proposals-from-text/research.md`.

## Desired End State

- `/generate` is a protected page linked from the Topbar.
- It takes 500–20,000 characters, and out-of-range input gets an inline error before any network call.
- After "Generate":
  - within 200 ms the button disables and the progress block appears
  - every second the elapsed counter ticks and the stage message changes over time
  - a list of 1–20 proposals appears, each with front and back, all valid under `createFlashcardSchema`
- AI failure (timeout, upstream error, no valid cards) shows a `generation_failed` message with a retry button, and the pasted text stays in the textarea.
- The OpenRouter request always carries `provider.zdr = true`, `data_collection = "deny"` and `require_parameters = true`. No log line contains source text, prompt or model output.
- It works on a Workers Builds preview URL with a real OpenRouter call, and after merge on production.

**Verification:** `npm test`, `npm run lint` and `npm run build` pass. The manual checks in Phases 2–4 pass, including a log inspection on the preview.

### Key Discoveries:

- Route branch order and `{code, message}`-only logging: `src/pages/api/flashcards/index.ts:11-45`.
- `createFlashcardSchema` is browser-safe. It trims, caps at 200/500, requires a visible character and rejects NUL and lone surrogates (`src/lib/validation/flashcard.ts:9-30`). Validating proposals with it guarantees S-03 can save them unchanged.
- `z.toJSONSchema()` (zod 4, installed) emits `additionalProperties: false` for objects, which is what OpenRouter strict mode needs (research L2). Refinements cannot be represented, so the JSON Schema comes from a plain shape, and `createFlashcardSchema` runs afterwards.
- OpenRouter can return **HTTP 200 with an `error` body and no `choices`**, so always check the body (research §5).
- `astro:env` validates secrets only at runtime (research F1), so a new `optional` secret needs no CI or Workers Builds variable.
- `.dev.vars` shadows `.env`. The local key goes in `.dev.vars` (research §2).
- `security.checkOrigin: true`, so manual `curl` POSTs need an `Origin` header.

## What We're NOT Doing

- Saving, editing or rejecting proposals, and any DB write. That is S-03, and `POST /api/flashcards` stays untouched.
- Recording generation metadata or rejection counts (S-03 Q-2/Q-3).
- Streaming or SSE, job + polling, and Cloudflare AI Gateway (research §4, L7).
- Abort-on-disconnect: no `enable_request_signal` flag. It gives no billing benefit for non-streaming calls (research F2).
- A server-side automatic retry. The user retries from the UI.
- Per-user rate limiting. The OpenRouter key's credit `limit` is the only, global safety cap. One account generating in a loop can exhaust the monthly budget for everyone, and they then get `generation_failed` (402 upstream). This is accepted for an MVP with a handful of users; revisit before opening sign-ups widely.
- Any LLM SDK or tokenizer dependency (research L1, L5).
- Changing `compatibility_date` or `compatibility_flags`.
- Subscribing to Workers Paid unconditionally. That is decided by measurement in Phase 4.
- Fixing the stale `npx wrangler deploy` line or the CI-secrets line in `AGENTS.md` (deployment Phase 7).

## Implementation Approach

This is the S-01 bottom-up order: pure modules and the service first (unit-testable with a stubbed `fetch`), then the route (stubbed service), then the UI, and finally verification on a real Worker. A plain synchronous POST is deliberate, and it overrides `tech-stack.md:36-38` ("stream or poll"). Current Cloudflare docs state there is no duration limit for HTTP Workers, and awaited `fetch` costs no CPU (research §4). The ~100–125 s CDN idle ceiling is kept out of reach by a 60 s upstream timeout. The plan's Overview records this deviation, and the brief repeats it.

## Critical Implementation Details

- **Privacy boundary: what may be logged.**
  - Allowed: an error class (`timeout` / `upstream_http` / `upstream_body_error` / `invalid_output` / `no_valid_cards`), the upstream HTTP status, latency in ms, `usage` token counts, and the number of cards dropped.
  - Never allowed: request text, prompt, `choices[].message.content`, OpenRouter `error.message` or `error.metadata` (these can echo input), and zod issue messages about model output.
  - The route logs a single structured line on failure.
- **Timeout and `max_tokens` are coupled.** `max_tokens` ≈ 3,500 at ~70 tps caps generation at ~50 s. The `AbortController` timeout is 60 s, cleared on completion with `setTimeout`/`clearTimeout`, not `AbortSignal.timeout`, which pins the context alive (research §4). The timeout must stay well under the ~100 s CDN ceiling. If either value changes, re-check the other.
- **`finish_reason: "length"`** means output was truncated. The JSON will not parse, and that maps to `invalid_output` → `generation_failed`, not a partial result.
- **Island state:** the source text lives only in React state (no `localStorage`/`sessionStorage`), so the no-persistence NFR also holds in the browser. On error the textarea keeps the text. On success the text also stays, so the user can regenerate.

## Phase 1: Generation contract and service

### Overview

Everything below the route: input and output schemas, DTOs, the new error code, the secret declaration, and `generateProposals()` talking to OpenRouter. All of it is unit-tested with a stubbed `fetch` that inspects the outgoing request.

### Changes Required:

#### 1. Input and proposal schemas

**File**: `src/lib/validation/generation.ts` (new, browser-safe, no server imports)

**Intent**: One schema for the request body, shared by island and route. Plus the plain response shape sent to OpenRouter as JSON Schema.

**Contract**:
- `SOURCE_TEXT_MIN = 500`, `SOURCE_TEXT_MAX = 20_000`, `MAX_PROPOSALS = 20`.
- `generateProposalsSchema = z.object({ text })`, where `text` is trimmed with length 500–20,000 after trim. It rejects NUL and unpaired surrogates (`isWellFormed`) with a readable message.
- `modelOutputSchema = z.object({ cards: z.array(z.object({ front: z.string(), back: z.string() })).max(MAX_PROPOSALS) })`. This is the shape handed to `z.toJSONSchema()`. It is deliberately free of refinements, and `.max()` becomes `maxItems: 20`, so the model is told the cap and doesn't burn `max_tokens` on extra cards.
- Per-card validation reuses `createFlashcardSchema` from `src/lib/validation/flashcard.ts`. No copy of the rules.

#### 2. DTOs

**File**: `src/types.ts`

**Intent**: Types for a proposal and the endpoint's success body. They are not DB aliases, so they are declared explicitly with snake_case-compatible names.

**Contract**:
- `FlashcardProposalDto = CreateFlashcardCommand` (`{ front, back }`), so S-03 can save one directly.
- `GenerateProposalsCommand = { text: string }`.
- `ProposalsResponseDto = { proposals: FlashcardProposalDto[] }`.

#### 3. Error vocabulary

**File**: `src/lib/api-errors.ts`, `AGENTS.md` (Hard rules: API error codes)

**Intent**: Add `generation_failed` → **502**. It means "the AI dependency failed or produced nothing usable; retrying may help", as opposed to `server_error` (our bug or misconfiguration).

**Contract**: `ApiErrorCode` gains `"generation_failed"`, and `STATUS.generation_failed = 502`. The AGENTS.md bullet gets the new code and when to use it. `src/lib/api-errors.test.ts` gets a case.

#### 4. Secret declaration

**File**: `astro.config.mjs`, `.dev.vars.example`, `src/lib/config-status.ts`

**Intent**: Declare `OPENROUTER_API_KEY` like the Supabase keys, so builds never need it. Show the existing missing-config banner when it is absent.

**Contract**:
- `envField.string({ context: "server", access: "secret", optional: true })`.
- `.dev.vars.example` gets the name, with a comment that local calls are real and billed.
- `configStatuses` gets an "OpenRouter" entry with a Polish message in the existing style.
- After editing `env.schema`, run `npx astro sync`. The type-checked `npm run lint` reads the generated `.astro/env.d.ts`, which is gitignored; CI regenerates it (`ci.yml:19`), but a local checkout does not.

#### 5. Generation service

**File**: `src/lib/services/generation.ts` (new)

**Intent**: A single call to OpenRouter chat completions that returns validated proposals or throws a typed error the route can map. It does no logging of its own and never exposes content in error messages.

**Contract**:
- `generateProposals(apiKey: string, cmd: GenerateProposalsCommand, opts?: { fetchImpl?, timeoutMs? }): Promise<{ proposals: FlashcardProposalDto[]; meta: { dropped: number; latencyMs: number; usage?: {...} } }>`.
- `class GenerationError extends Error { kind: "timeout" | "upstream_http" | "upstream_body_error" | "invalid_output" | "no_valid_cards"; status?: number }`. The message is a fixed string per kind, never upstream text.
- Request: `POST https://openrouter.ai/api/v1/chat/completions` with:
  - `models: ["google/gemini-3.1-flash-lite", "mistralai/mistral-small-2603"]`
  - a system prompt: extract ≤ 20 atomic Q/A pairs worth remembering, front ≤ 200 and back ≤ 500 characters, same language as the source, no numbering or markdown
  - the user message = source text
  - `response_format: { type: "json_schema", json_schema: { name: "flashcards", strict: true, schema } }`, where `schema` is `z.toJSONSchema(modelOutputSchema)` **with the top-level `$schema` key removed**. zod 4 emits `"$schema": "https://json-schema.org/draft/2020-12/schema"` (verified locally), and some structured-output endpoints reject unknown schema keys.
  - `provider: { zdr: true, data_collection: "deny", require_parameters: true }`
  - `max_tokens: 3500`
  - headers `Authorization: Bearer`, `X-OpenRouter-Title: 10xCards`, `X-OpenRouter-App-Visibility: hidden`
- Timeout: `AbortController` + `setTimeout(60_000)`, cleared in `finally`. An abort becomes `timeout`.
- Result pipeline:
  1. non-2xx → `upstream_http` (with status)
  2. body has `error` or no `choices` → `upstream_body_error`
  3. `JSON.parse` of `content` or `modelOutputSchema` fails → `invalid_output`
  4. each card goes through `createFlashcardSchema.safeParse`; invalid cards are dropped and counted
  5. keep the first 20
  6. zero left → `no_valid_cards`
- Returned proposals are the **parsed** (trimmed) values.

#### 6. Service tests

**File**: `src/lib/services/generation.test.ts` (new)

**Intent**: Prove both what we send and how every upstream outcome maps. The stub must assert the outgoing request, per the recurring review finding on vacuous stubs.

**Contract**, cases:
- The request body has:
  - `provider.zdr === true`, `data_collection === "deny"`, `require_parameters === true`
  - `response_format.json_schema.strict === true`, with `additionalProperties: false` on the card object, `maxItems: 20` on `cards`, and **no `$schema` key**
  - `max_tokens` and the model list
  - the source text only in the user message
  - the auth header
- Happy path: trimmed proposals.
- Over-long, blank and NUL cards are dropped, and `dropped` is counted.
- More than 20 cards are capped at 20.
- All invalid → `no_valid_cards`.
- Non-JSON content, including truncation (`finish_reason: "length"`) → `invalid_output`.
- 200 with an `error` body → `upstream_body_error`.
- 429/502 → `upstream_http` with the status.
- A timeout, using fake timers and a never-resolving fetch, → `timeout`.
- No `GenerationError.message` contains the source text or upstream error text.

Plus `src/lib/validation/generation.test.ts`: 499/500 and 20,000/20,001 characters after trim; whitespace padding does not count; NUL and lone surrogate are rejected.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Production build passes without `OPENROUTER_API_KEY` set: `npm run build`

#### Manual Verification:

- `AGENTS.md` error-code rule lists `generation_failed` (502) with its meaning, and the diff was reviewed by the owner

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: `POST /api/proposals` endpoint

### Overview

A thin route in the S-01 shape that maps every outcome to the closed vocabulary. It logs only the allowed metadata. A first real, billed call confirms the model choice.

**Prerequisite (owner, before the first real call in this phase):** prepare the OpenRouter account so the defence-in-depth privacy layer and the cost cap are in place before any text leaves the machine:
- a dedicated key with a credit `limit` and a monthly reset
- Settings → Privacy: Input & Output Logging **off**, "use of inputs" **off**, ZDR enforced
- the key goes into `.dev.vars` (never committed)

This is the same key Phase 4 puts into the Worker.

### Changes Required:

#### 1. Route

**File**: `src/pages/api/proposals/index.ts` (new)

**Intent**: Authenticate, bound and validate the input, call the service, and map errors. No Supabase use beyond the middleware-provided `locals.user`.

**Contract**:
- `export const prerender = false`; `export const POST: APIRoute`.
- Branch order:
  1. no `locals.user` → `unauthorized`
  2. `OPENROUTER_API_KEY` missing → `server_error` ("AI generation is not configured")
  3. read the body with `request.text()`; length > 128 KiB → `validation_failed` with `fieldErrors.text`. The actual body is measured, not the `Content-Length` header, which a chunked request can omit.
  4. `JSON.parse` of that text throws → `invalid_json`
  5. `generateProposalsSchema` fails → `validation_failed` with `fieldErrors`
  6. `generateProposals(key, parsed.data)`
- Success: `200` with `ProposalsResponseDto`.
- `GenerationError` → `generation_failed` with a fixed user-facing message, logging one `console.error("generateProposals failed", { kind, status, latencyMs })`.
- Any other throw → `server_error`, logging `{ name }` only.
- On success, log exactly one `console.info("generateProposals ok", { count, dropped, latencyMs, usage })` with an `eslint-disable-next-line no-console`, as in S-01. It is the only production signal for cost and latency. No content, ever.

#### 2. Route tests

**File**: `src/pages/api/proposals/index.test.ts` (new)

**Intent**: One case per branch, with `@/lib/services/generation` mocked and `vi.mock("astro:env/server", () => ({ OPENROUTER_API_KEY: ... }))`. The factory must export every name the route imports; vitest 5 throws on a missing export (a direct `astro:env` factory mock was verified to work in this repo's vitest setup). Also prove the ordering, e.g. an unauthenticated request with a bad body returns 401 and never calls the service.

**Contract**, cases:
- 401 (service not called)
- missing key → 500 `server_error`
- oversize body → 400, including a body sent **without** a `Content-Length` header
- invalid JSON → 400 `invalid_json`
- too short / too long → 400 `validation_failed` with `fieldErrors.text`
- success → 200 with the parsed text passed to the service
- each `GenerationError` kind → 502 `generation_failed`
- unexpected error → 500
- a `console.error` spy asserts no logged argument contains the source text

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- With `OPENROUTER_API_KEY` in `.dev.vars` (owner adds it; billed), `npm run dev` plus `curl` with a session cookie and `Origin` header on a ~3,000-character **Polish** text returns 200 with 1–20 proposals in Polish, in under 30 s. Record the latency and count in `## Deviations` or a note.
- The same for a ~3,000-character **English** text. Proposals are in English and read as sensible atomic Q/A pairs. This confirms `gemini-3.1-flash-lite`, or triggers a model change recorded in `## Deviations`.
- The same `curl` without a cookie → 401; with 400 characters → 400 `validation_failed`
- The dev-server terminal output contains no source text or model output
- OpenRouter account prepared before the first real call: key with credit limit, I/O logging off, use of inputs off, ZDR enforced

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: `/generate` page and island

### Overview

The user-facing screen: paste, generate, watch progress, see proposals, recover from errors.

### Changes Required:

#### 1. UI primitives

**File**: `src/components/ui/textarea.tsx`, `src/components/ui/skeleton.tsx` (via `npx shadcn@latest add textarea skeleton`)

**Intent**: Standard shadcn pieces for the paste box and placeholder cards. Neither adds a runtime dependency (research L4).

**Contract**: Generated files are committed as produced. They are only restyled through `className` at the call site.

#### 2. Island

**File**: `src/components/generate/GenerateProposals.tsx` (new)

**Intent**: Follow the `NewFlashcardForm` pattern: local `useState`, client-side `safeParse` before fetch, manual `fetch`, and `ServerError` for errors. Add a progress block and a read-only proposals list.

**Contract**:
- Textarea with a live trimmed-length counter "N / 20 000" and min/max hints.
- Inline field error from client or server `validation_failed`.
- On submit, synchronously set `pending`: the button is disabled with a spinner, and the progress block shows. This is the <200 ms acknowledgement.
- Progress block (`aria-live="polite"`):
  - elapsed seconds, updated every second
  - stage message by elapsed time: 0 s "Czytam tekst…", 5 s "Wybieram najważniejsze pojęcia…", 12 s "Układam pytania i odpowiedzi…", 25 s "Jeszcze chwila…"
  - 3 skeleton cards
- The interval is cleared on completion and on unmount.
- Success: "Propozycje (N)" plus a list of cards showing front and back (`whitespace-pre-wrap break-words`, as in `deck.astro`). A note says that saving comes in the next step. There is no save UI.
- Errors:
  - `generation_failed`: message plus a "Spróbuj ponownie" button that resubmits the same text
  - `unauthorized`: session-expired message
  - otherwise a generic message
  - network error: "Brak połączenia…"
  - The text always stays in the textarea.
- No `localStorage` or `sessionStorage`.

#### 3. Page, route guard and nav

**File**: `src/pages/generate.astro` (new), `src/middleware.ts`, `src/components/Topbar.astro`

**Intent**: The page shell copies `deck.astro` (Layout → `bg-cosmic` → Topbar → glass section) and mounts `<GenerateProposals client:load />`. `/generate` is protected. The signed-in Topbar gets a "Generuj z AI" link.

**Contract**: `PROTECTED_ROUTES = ["/dashboard", "/deck", "/generate"]`, and the link is added to the signed-in group at `Topbar.astro:12-24`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes (incl. jsx-a11y): `npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- Signed out, `/generate` redirects to sign-in. Signed in, the Topbar link opens it.
- 499 characters (after trimming) shows an inline error with no network request (DevTools Network is empty). 20,001 characters behaves the same.
- A valid paste disables the button immediately. The counter ticks every second, the stage text changes, and the skeletons show. The proposals list then appears with its count.
- Simulate a failure (e.g. a temporarily invalid key in `.dev.vars`): the `generation_failed` message and retry button appear, the text is intact, and retry works after restoring the key.
- A reload during a request leaves no text in `localStorage`/`sessionStorage` (DevTools → Application).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Preview verification and release

### Overview

This proves the slice on a real Worker (the milestone's risk), decides Workers Paid from measurement, and ships.

### Changes Required:

#### 1. Worker secret (owner action, outside the repo)

**Intent**: Deliver the already-restricted key (account prepared in the Phase 2 prerequisite) to the Worker.

**Contract**:
- Re-check that the Phase 2 account settings are still in place (logging off, ZDR, credit limit).
- `npx wrangler secret put OPENROUTER_API_KEY --name 10xcards` (owner approval).
  - Note: this deploys a new **production** version of the current `main` code with the secret. That is harmless, since the old code never reads it.
  - Previews share the secret (research §2).

#### 2. Preview run and measurements

**Intent**: Push the branch so Workers Builds produces a version preview URL, then exercise it for real.

**Contract**:
- Record in `## Deviations` or a notes block of this plan:
  - latency of 3 real generations (PL/EN)
  - the `cpuTime` of `/generate` and `/api/proposals` from Workers Logs / `wrangler tail`
  - whether any log entry contains source text or model output (expected: none)
- **Workers Paid rule (owner decision recorded):** if the **median** `cpuTime` of the measured requests (page + API, at least the 3 generations) is > 6 ms, or **any** Error 1102 appears, the owner subscribes to Paid **before merge**. Otherwise merge on Free, and the existing deployment-plan gate stays open.

#### 3. PR and release

**Intent**: Normal flow. Merge to `main` = production deploy (Workers Builds).

**Contract**:
- The PR body includes `Closes #8` and the plan's Progress state.
- Roadmap/GitHub/Linear mirrors are updated per `tasks-github.md:124-143`.

### Success Criteria:

#### Automated Verification:

- CI green on the PR (lint, test, build): `gh pr checks`
- Secret present: `npx wrangler secret list --name 10xcards` shows `OPENROUTER_API_KEY`

#### Manual Verification:

- On the preview URL, 3 real generations (≥ 1 Polish, ≥ 1 English, one near 20,000 characters) return proposals, each under 60 s, with no 524 or 1102
- `cpuTime` recorded and the Workers Paid decision taken and written down per the rule above
- `wrangler tail` / Workers Logs for those requests show no source text, prompt or model output
- OpenRouter activity shows the requests with a ZDR provider, and account logging is off
- After merge, a production smoke test (one generation on the production URL) succeeds

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Input schema boundaries (499/500, 20,000/20,001 after trim, NUL, lone surrogate).
- Service:
  - the outgoing request contract (privacy flags, strict schema, model list, `max_tokens`)
  - every `GenerationError` kind
  - dropping and capping cards
  - no content in error messages
- Route: every branch, the branch order (401 before body parsing), and no content in logs.
- `apiError("generation_failed")` → 502.

### Integration Tests:

- None automated; there is no e2e runner (S-01 decision). The real integration is the Phase 2 local `curl` and the Phase 4 preview run.

### Manual Testing Steps:

1. Local curl, PL and EN (Phase 2).
2. Browser flow: validation, progress, success, failure, retry, no web storage (Phase 3).
3. Preview: latency, cpuTime, logs clean, ZDR visible (Phase 4).
4. Production smoke after merge.

## Performance Considerations

- Latency is set by output length: ~1 s per card at ~70 tps (research F4). Twenty cards take ~20 s, and `max_tokens` 3,500 caps the worst case at ~50 s. The 60 s timeout stays under the ~100 s CDN ceiling.
- CPU: waiting on `fetch` is free. The JSON parse plus zod on ≤ 20 cards is small, but the island page render is the known hotspot (deployment-plan baseline). Phase 4 measures it.
- Cost: ~6k input + ~1.5k output tokens per call is about $0.004 on flash-lite. The key's credit limit bounds abuse.

## Migration Notes

- No database migration.
- New secret `OPENROUTER_API_KEY`: it is optional, so rollback to a pre-S-02 version is safe (the old code ignores it). A rollback does not remove the secret; that is expected.

## References

- Research: `context/changes/ai-proposals-from-text/research.md`
- Pattern: `src/pages/api/flashcards/index.ts:8-45`, `src/components/deck/NewFlashcardForm.tsx`
- Card rules: `src/lib/validation/flashcard.ts:9-30`
- Paid gate: `context/changes/deployment/deployment-plan.md:67-69`
- Roadmap: `context/foundation/roadmap.md` S-02; GitHub #8; Linear DAW-12

## Deviations

Recorded from `reviews/impl-review-phase-1.md` (F4); phase blocks above are left as planned.

- **Phase 1 §5, step 3: model output is parsed with a loose `rawOutputSchema` (`{ cards: unknown[] }`), not `modelOutputSchema`.** As planned, `.max(20)` and the strict card shape would reject the whole response when the model returns 21 cards or one malformed card, which makes "drop invalid cards" and "cap at 20" unreachable. `modelOutputSchema` is still what the model is sent as JSON Schema; per-card rules stay in `createFlashcardSchema`.
- **Phase 1 §5: `meta.dropped` counts invalid cards plus cards cut by the 20 cap**, not only invalid ones. It is the number the model returned minus the number proposed, which is the useful figure for the success log line.
- **Phase 1 §5: three error mappings the plan did not list.**
  - A network failure without an abort → `upstream_http` with **no `status`**. The Phase 2 route and its log line must accept `status` being undefined.
  - A non-JSON 200 body → `upstream_body_error`.
  - `finish_reason: "error"` → `upstream_body_error`, and `content: null` → `invalid_output` (added by impl-review F3).

- **Phase 2 §1, branch 3: the body is read by a bounded `readBody()` helper, not `request.text()`** (impl-review-phase-2 F1).
  - It rejects on a declared `Content-Length` over 128 KiB before reading anything.
  - Otherwise it streams, counts bytes and cancels past the cap.
  - Reason: `text()` would buffer up to the platform's 100 MB limit before any check, which exceeds the isolate's memory and CPU.
  - A body stream that fails mid-upload → `invalid_json` ("Request body could not be read") instead of Astro's generic 500.
- **Phase 2 §1: the unexpected-error log line is `{ name, latencyMs }`**, not `{ name }` only. Latency is inside the allowed-metadata list (impl-review-phase-2 F4).

### Phase 2 measurements (local `npm run dev`, real OpenRouter calls, 2026-09-29)

| Call | Text | Status | Time (browser) | Proposals |
|---|---|---|---|---|
| 1 | ~3,000 chars, Polish | 200 | **32.5 s** | 8 |
| 2 | ~3,000 chars, English | 200 | 3.5 s | 9, English |
| 3 | same Polish text, repeated | 200 | 4.5 s | 8, Polish, on-topic |

- Server-side `latencyMs` from the `generateProposals ok` log lines was **3,382 / 2,911 / 4,001 ms** for calls 1–3. Usage was ~800 prompt / ~540 completion tokens, and cost ~$0.001 per call, with `dropped: 0` on all three.
- So the first call's 32.5 s was **not** OpenRouter: ~29 s were spent outside `generateProposals`. That is consistent with the Vite dev server compiling the new route module and its imports on the first request, and it has no production equivalent. Phase 4 re-measures on the deployed Worker to confirm.
- Quality: the Polish run had partial overlap (L1/L3 difference, then L1 and L3 separately). Acceptable for drafts; S-03's reject step is where it gets handled. No prompt change now.
- The model is confirmed: `google/gemini-3.1-flash-lite` handles Polish and English.
- Criterion 2.4 (< 30 s) is marked passed on the repeat call. The first-call outlier is recorded here instead of being hidden.

### Phase 3

- **Phase 3 §1: the shadcn files are not committed exactly as produced.** The current shadcn CLI generated `import { cn } from "cn"` and installed the new `cn` npm package (shadcn's own clsx + tailwind-merge replacement), ignoring the `utils: "@/lib/utils"` alias in `components.json`. The package was uninstalled and both files import `cn` from `@/lib/utils`, so there is still no new dependency (research L4) and one `cn` in the repo. The files were also run through Prettier to match the repo style. Re-check the imports after any future `npx shadcn add`.
- **Phase 3 §2: the `aria-live` region is a separate, always-mounted `sr-only` paragraph, not the progress block** (impl-review-phase-3 F4). It carries the stage message while pending and "Generated N proposals" on success; the visible progress line, with its per-second counter, is `aria-hidden`. Screen readers skip a live region inserted together with its text, and a counter changing every second would be announced continuously.
- **Phase 3 §2: the elapsed-seconds timer is a hook** (`src/components/hooks/useElapsedSeconds.ts`), per the AGENTS.md convention. It measures from a start timestamp, so a throttled background tab shows real time.
- **Phase 3 §2–3: the page, island and Topbar link are in English, not Polish** (owner decision, impl-review-phase-3 F2, Fix B). The rest of the app is English, and the field errors come verbatim from the shared English schema, so the Polish strings the plan specified (stage messages, "Spróbuj ponownie", "Brak połączenia…", "Generuj z AI") produced a mixed-language page. Stages are now "Reading your text…" / "Picking out the key concepts…" / "Writing questions and answers…" / "Almost there…"; the counter reads "N / 20,000"; the link is "Generate with AI".

### Phase 4

- **Phase 4 §2: `cpuTime` (4.4) and the log inspection (4.5) are measured on production right after merge, not on the preview** (owner decision, 2026-10-01). Cloudflare records no logs for preview or version URLs: no `wrangler tail`, Workers Logs or Logpush ([docs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)). This was confirmed locally: production requests reached `wrangler tail`, preview requests did not, with or without `--version-id`. The preview still carries 4.3 (real generations, no 524/1102 visible in the browser) and 4.6 (OpenRouter activity). The Workers Paid rule is unchanged, but it fires after merge: median `cpuTime` > 6 ms or any 1102 → subscribe to Paid at once, or `wrangler rollback` (code only; the secret stays and is harmless, E17).

### Phase 4 measurements (preview URL, real OpenRouter calls, 2026-10-01)

| Call | Text | Time (browser) | Proposals | Errors |
|---|---|---|---|---|
| 1 | ~3,000 chars, Polish | 3.78 s | 10 | none |
| 2 | ~3,000 chars, English | 3.38 s | 8 | none |
| 3 | ~20,000 chars | 5.39 s | 14 | none |

- All three are far under the 60 s budget, with no 524 or 1102. `cpuTime` cannot be read on a preview (see Phase 4 deviation); it is measured on production after merge.
- OpenRouter Logs: provider **Google Vertex** on every call, no prompt or output preview available, account prompt/output logging off. Cost $0.0009–0.003 per call; model-side generation under 1 s at 190–245 tok/s, so the rest of the browser time is network plus the Worker.

### Phase 4 measurements (production, after merge of PR #22, 2026-10-01)

Version `cf7b6060`, `wrangler tail`. The tail lost its connection for a few seconds and missed the third generation; the owner chose not to repeat it, since it could not change the outcome.

| Request | `cpuTime` | `wallTime` |
|---|---|---|
| `GET /generate` | 11 ms | 52 ms |
| `POST /api/proposals` (10 cards) | 22 ms | 3,409 ms |
| `POST /api/proposals` (~20,000 chars, 14 cards) | 9 ms | 5,140 ms |

- **Workers Paid decision: subscribed** (owner, 2026-10-01). Median `cpuTime` of the measured page + API requests is **11 ms**, above the 6 ms rule; a third generation at 0 ms would still leave the median at 10 ms. No 1102, but several requests (also `/auth/signin` at 26 ms) exceeded Free's 10 ms and passed only on Free's tolerance. This closes the deployment-plan Paid gate.
- **Logs (4.5):** the only `/api/proposals` log lines are `generateProposals ok {count, dropped, latencyMs, usage}`. No source text, prompt or model output.
- **Smoke test (4.7):** both measured production generations returned 200 with proposals.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Generation contract and service

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — b143b75
- [x] 1.2 Lint passes: `npm run lint` — b143b75
- [x] 1.3 Production build passes without `OPENROUTER_API_KEY` set: `npm run build` — b143b75

#### Manual

- [x] 1.4 `AGENTS.md` error-code rule lists `generation_failed` (502) with its meaning, and the diff was reviewed by the owner — b143b75

### Phase 2: `POST /api/proposals` endpoint

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 5eb5023
- [x] 2.2 Lint passes: `npm run lint` — 5eb5023
- [x] 2.3 Build passes: `npm run build` — 5eb5023

#### Manual

- [x] 2.4 Local curl on ~3,000-char Polish text returns 1–20 Polish proposals in < 30 s (latency and count recorded) — 5eb5023
- [x] 2.5 Local curl on ~3,000-char English text returns sensible English proposals (model confirmed or change recorded) — 5eb5023
- [x] 2.6 Curl without cookie → 401; with 400 chars → 400 `validation_failed` — 5eb5023
- [x] 2.7 Dev-server output contains no source text or model output — 5eb5023
- [x] 2.8 OpenRouter account prepared before the first real call (credit limit, I/O logging off, use of inputs off, ZDR enforced) — 5eb5023

### Phase 3: `/generate` page and island

#### Automated

- [x] 3.1 Unit tests pass: `npm test` — 65aac9e
- [x] 3.2 Lint passes (incl. jsx-a11y): `npm run lint` — 65aac9e
- [x] 3.3 Build passes: `npm run build` — 65aac9e

#### Manual

- [x] 3.4 Signed-out redirect; Topbar link opens `/generate` when signed in — 65aac9e
- [x] 3.5 499 / 20,001 chars show inline error with no network request — 65aac9e
- [x] 3.6 Immediate disable, ticking counter, changing stages, skeletons, then proposals with count — 65aac9e
- [x] 3.7 Simulated failure shows `generation_failed` + retry, text intact, retry works — 65aac9e
- [x] 3.8 No source text in `localStorage`/`sessionStorage` — 65aac9e

### Phase 4: Preview verification and release

#### Automated

- [x] 4.1 CI green on the PR: `gh pr checks` — 27f17f5
- [x] 4.2 Secret present: `npx wrangler secret list --name 10xcards` shows `OPENROUTER_API_KEY` — 27f17f5

#### Manual

- [x] 4.3 Preview: 3 real generations (PL, EN, ~20,000 chars) succeed under 60 s, no 524/1102 — 27f17f5
- [x] 4.4 cpuTime recorded and Workers Paid decision taken and written down — 27f17f5
- [x] 4.5 Worker logs for those requests contain no source text, prompt or model output — 27f17f5
- [x] 4.6 OpenRouter activity shows ZDR provider; account logging off — 27f17f5
- [x] 4.7 Production smoke test after merge succeeds — 27f17f5
