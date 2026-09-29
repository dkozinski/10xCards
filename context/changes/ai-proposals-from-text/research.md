---
date: 2026-09-29T12:45:40+02:00
researcher: Claude (Opus 5.5) for Dawid Kozinski
git_commit: 32df951c81b753d47d382c106afc05b8860343ca
branch: main
repository: dkozinski/10xCards
topic: "S-02 ai-proposals-from-text — how to draft flashcard proposals from pasted text via OpenRouter on Cloudflare Workers"
tags: [research, codebase, external, openrouter, cloudflare-workers, astro, api-route, react-island, privacy]
status: complete
last_updated: 2026-09-29
last_updated_by: Claude (Opus 5.5)
last_updated_note: "Added follow-up: library options for S-02 checked against tech-stack.md (npm, Context7, Exa)"
---

# Research: S-02 `ai-proposals-from-text`

**Date**: 2026-09-29T12:45:40+02:00
**Researcher**: Claude (Opus 5.5) for Dawid Kozinski
**Git Commit**: `32df951`
**Branch**: main
**Repository**: dkozinski/10xCards
**Permalink base**: `https://github.com/dkozinski/10xCards/blob/32df951c81b753d47d382c106afc05b8860343ca/`

## Research Question

Roadmap slice S-02 (`context/foundation/roadmap.md:108-119`, GitHub #8, Linear DAW-12):
the user pastes source text, asks for flashcards, **sees continuous progress** while the
request runs, and sees the AI-drafted proposals on screen. Nothing is saved. PRD refs:
US-01, FR-004, NFR responsiveness (`prd.md:140`), NFR no source-text persistence (`prd.md:142`).

The research answers two questions:

- **Internal:** what does the codebase already give us — route/service/island pattern, env and secrets, logging, tests?
- **External:** can a ~20 s call be held open on Workers, and how should OpenRouter be called (client, structured output, privacy, model)?

## Summary

> [!IMPORTANT]
> **The slice's main risk is resolved on paper.** Current Cloudflare docs say an HTTP-triggered Worker has **no wall-clock limit** while the client stays connected, and **waiting on `fetch()` does not count as CPU time**. A synchronous ~20 s request/response is allowed. The real ceiling is the CDN's **~100–125 s "524" idle timeout**, which applies only if no bytes are sent. Confirming this on a deployed preview is still an explicit plan step, because `astro dev` enforces no limits.

1. **Pattern to copy exists and is small.**
   - `POST /api/flashcards` runs checks in a fixed order: auth, then client/config, then JSON, then zod, then the service in try/catch, with every error going through `apiError()`.
   - A shared, browser-safe zod schema lives in `src/lib/validation/`.
   - A throwing service lives in `src/lib/services/`.
   - The React island uses local `useState` plus a manual `fetch`, and shows errors through `ServerError`.
   - Tests are Vitest, colocated with the code, and mock `@/lib/supabase`.
2. **Recommended transport: a plain synchronous POST,** with the progress indicator driven by the client and a server-side abort timeout. Heartbeat-SSE is the fallback if a spinner isn't enough. Job + polling is rejected because it needs storage, which conflicts with the no-persistence NFR, and a Queue or Durable Object.
3. **Recommended OpenRouter client: plain `fetch` plus zod, no SDK.** It adds no dependencies, so the unenv / `child_process` risk (E15) disappears. The request uses `response_format: json_schema` (strict), and the output is still validated with zod because strict mode is best-effort on some endpoints.
4. **Privacy (the NFR) has three layers, and we own only one:**
   - our Worker must never `console.*` the text (Workers Logs has observability on at 100% sampling)
   - OpenRouter per request: `provider: { zdr: true, data_collection: "deny", require_parameters: true }`
   - OpenRouter account: I/O logging OFF, ZDR enforced
5. **Gaps the plan must close:**
   - The closed error vocabulary has **no code for an upstream/LLM failure or timeout**.
   - There is no text-length limit (PRD Open Question 1, owner: user).
   - There is no proposal count.
   - No model has been chosen.
   - The **Workers Paid gate** is recorded as "the PR that adds the AI proposals route", which is this slice, and it is still untaken.

## Detailed Findings

### 1. Existing end-to-end pattern (S-01) to copy

**API route**, `src/pages/api/flashcards/index.ts`:

- `export const prerender = false` (:8); `export const POST: APIRoute` (:10).
- Fixed branch order:
  1. `!locals.user` → `apiError("unauthorized")` (:11-13). The route checks this itself; API routes are **not** in `PROTECTED_ROUTES`.
  2. `createClient()` null → `server_error` (:15-18).
  3. `request.json()` throws → `invalid_json` (:20-25).
  4. `safeParse` fails → `validation_failed` with `details.fieldErrors` from `z.flattenError` (:27-32).
  5. Service call on `parsed.data` (never the raw body, :34-45).
- Success returns the bare DTO with no envelope: `Response.json(card, { status: 201 })`.
- Failure logs **only** `{ code, message }` (:39-43) with `eslint-disable-next-line no-console`, then returns `server_error`.
- S-02 needs no Supabase client for its own work. It still needs `locals.user` for the 401.

**Error vocabulary**, `src/lib/api-errors.ts`:

- `ApiErrorCode = "validation_failed" | "invalid_json" | "unauthorized" | "server_error"`, mapped to 400/400/401/500.
- Shape: `{ error: { code, message, details? } }`, where `details` is `{ fieldErrors: Partial<Record<string, string[]>> }`.
- F5 of the S-01 phase-1 review widened `fieldErrors` explicitly so that S-02's source text would fit (`context/archive/2026-09-28-manual-card-and-deck/reviews/impl-review-phase-1.md:66-74`).
- **No code exists for an upstream/LLM failure, a timeout, or rate limiting.** Adding one is a central change to `api-errors.ts` + `AGENTS.md` (AGENTS.md hard rule: "never invent a new code inline").

**Validation**, `src/lib/validation/flashcard.ts`:

- Browser-safe and shared by island and route (:7).
- `FRONT_MAX = 200`, `BACK_MAX = 500` (:9-10).
- `cardText()` (:18-25) trims, applies max, requires a visible char (rejects zero-width-only / `\p{Cf}`), and requires `isWellFormed()` (rejects NUL and lone surrogates).
- The DB CHECKs match: `supabase/migrations/20260922190157_create_flashcards.sql:14-15`.
- F-01 made this explicit: "The 200/500 limits constrain the AI prompt in S-02" (`context/archive/2026-09-22-deck-data-contract/plan-brief.md:65`).
- **LLM output can contain exactly the edge cases the schema rejects**, so proposals should be run through the same `cardText` rules. S-03 will save them through `createFlashcardSchema` anyway.

**Service**, `src/lib/services/flashcards.ts`:

- The client is passed as the first argument; errors are **thrown** (`if (error) throw error`), and the caller maps them.
- A new `src/lib/services/<generation>.ts` would follow the same "throw, route maps" contract.

**Types**, `src/types.ts`: DTOs are aliases over generated DB types, in snake_case. A proposal is not a DB row, so it needs its own type (e.g. `FlashcardProposalDto { front; back }`).

**Page and island:**

- `src/pages/deck.astro` provides Layout → `bg-cosmic` → `<Topbar />` → glass `section` cards (:41-53). The island is mounted with `<NewFlashcardForm client:load />` (:50) and no props.
- `src/components/deck/NewFlashcardForm.tsx`:
  - `useState` for values, errors, `serverError` and `pending` (:69-73)
  - client-side `safeParse` before fetch
  - a three-way error branch on `ApiErrorBody.error.code`
  - a CSS spinner in the button (:145-161)
  - `CardField` textarea with a length counter (:28-66)
- `src/components/auth/ServerError.tsx` renders a `role="alert"` box.
- **Nothing like a progress bar or elapsed timer exists.** `src/components/hooks/` does not exist.
- shadcn/ui has only `button.tsx`. A progress UI would be a new component (`npx shadcn@latest add progress`) or a plain Tailwind element.

**Routing and navigation:**

- `src/middleware.ts:4` sets `PROTECTED_ROUTES = ["/dashboard", "/deck"]`. A new page (e.g. `/generate`) must be added to it.
- The middleware sets `Cache-Control: private, no-store` on every response (:39-41), so the proposals JSON is never cached at the edge.
- Navigation lives in `src/components/Topbar.astro:12-24`, in the signed-in link group.

**Tests:**

- Vitest `^5.0.2`, files `src/**/*.test.ts`, no workerd in tests (`vitest.config.ts:4-7`).
- The route test pattern is in `src/pages/api/flashcards/index.test.ts`: `vi.mock("@/lib/supabase")`, a stub client, and `POST({request, locals, cookies} as unknown as APIContext)`, with one case per branch.
- For S-02, the OpenRouter call must be stubbed, either by mocking the service module or `globalThis.fetch`.
  - Recurring reviewer complaint: **stubs that ignore what they receive prove nothing** (`impl-review-phase-2.md:34-52`).
  - The stub should therefore assert the outgoing request: model, `provider.zdr`, `response_format`, and the absence of any logging.
- CI runs lint, `npm test` and build (`.github/workflows/ci.yml:21`). There is no e2e runner.

### 2. Env, secrets and local dev

- `astro.config.mjs:21-26` declares `SUPABASE_URL` and `SUPABASE_KEY` as `envField.string({ context: "server", access: "secret", optional: true })`, read via `astro:env/server` (`src/lib/supabase.ts:3`).
- `OPENROUTER_API_KEY` should use the **same shape**:
  - With `secret` + `optional`, it resolves at runtime, so **CI and Workers Builds need no build variable** (`deployment-plan.md:405-408, 906-909`; `.github/workflows/ci.yml:22-25`).
  - A missing key must then map to `server_error`, the same way `createClient()` returns `null`.
  - It may also deserve a line in the missing-config banner (`src/lib/config-status.ts`).
- Nothing in `src/` imports `cloudflare:workers`. Keep it that way (infrastructure.md risk: vendor lock-in).
- **Production:**
  - `npx wrangler secret put OPENROUTER_API_KEY --name 10xcards` (`deployment-plan.md:616-622`) creates and deploys a new version by itself. It needs human approval (`infrastructure.md:286`).
  - Secrets are Worker-scoped, so **preview versions share the production key** (`deployment-plan.md:775-779`).
- **Local:**
  - Wrangler loads `.dev.vars` and ignores `.env` whenever `.dev.vars` exists (`node_modules/wrangler/wrangler-dist/cli.js:176647-176700`), so the key goes into `.dev.vars` (gitignored, `.gitignore:55`) and `.dev.vars.example` gets the new name.
  - Every manual dev test makes a **real, billed OpenRouter call**.
  - `.dev.vars` points at production Supabase. S-02 only reads auth, so this matters less than in S-01.
- `wrangler.jsonc`:
  - `compatibility_date: 2026-05-08`, `nodejs_compat`, `observability.enabled: true` (:55-57)
  - no `head_sampling_rate`, so 100% of logs are kept
  - no `vars`, no `limits`
- CSRF: `security.checkOrigin: true` (`astro.config.mjs:20`). Manual `curl` POSTs need an `Origin` header.
- No HTTP or LLM client is in `package.json`. zod is `^4.4.3`.

### 3. Privacy: "leaves no trace in storage" (`prd.md:142`)

Three layers are involved:

- **Our Worker.**
  - Workers Logs keeps anything passed to `console.*`: 24 h on Free (E28, `deployment-plan.md:1080-1085`), longer on Paid.
  - Precedent: S-01 review F4 caught a full `PostgrestError` leaking card text into logs. The fix was "log `{code, message}` only" (`impl-review-phase-2.md:64-72`).
  - For S-02 this means never logging the input, the prompt, the raw OpenRouter body, or OpenRouter's `error.metadata` (it can echo input).
  - Invocation logs record request metadata, not bodies. This is general Workers behaviour, not verified here.
- **OpenRouter** ([data-collection](https://openrouter.ai/docs/guides/privacy/data-collection.md)):
  - Prompts are not stored by default: "Any prompt retention on OpenRouter is always opt-in".
  - Metadata (token counts, latency) is always stored.
  - A small anonymous sample goes to categorization by a ZDR model.
  - The risk is the account toggle "Private Input & Output Logging": if enabled, data is kept for at least 3 months ([I/O logging](https://openrouter.ai/docs/guides/features/input-output-logging.md)).
- **Upstream provider** ([provider-selection](https://openrouter.ai/docs/guides/routing/provider-selection.md), [ZDR](https://openrouter.ai/docs/guides/features/zdr.md)):
  - `provider.zdr: true` routes only to endpoints that "will not store your data for any period of time". **This is the flag that matches the NFR.**
  - `data_collection: "deny"` only excludes providers that train or collect.
  - ZDR can also be enforced account-wide or per key with a guardrail, as defence in depth.
  - The ZDR guarantee does not cover plugins, so leave Response Healing off.
- **Wording differs across documents:**
  - `prd.md:142` says "no trace in storage"
  - `ref.md:101` says "operator-accessible storage"
  - `shape-notes.en.md:174` says "not kept in any storage"
  - No document addresses logs or third-party retention. The plan should state which interpretation it proves.

### 4. Holding a ~20 s request on Workers (external)

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (updated 2026-07-28) unless noted.

- **Duration:** "There is no hard limit on duration for HTTP-triggered Workers. As long as the client remains connected…"
- **CPU:** "Waiting on network requests (such as `fetch()`…) does not count toward CPU time." Paid gives 30 s by default, Free 10 ms.
- **The 524 ceiling:**
  - The CDN front end times out after about 100–125 s if no response bytes are sent. The documented value moved between versions ([524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)), and a Cloudflare staffer confirmed it applies to Workers.
  - Streaming any bytes avoids it.
- **Client disconnect:**
  - When the client leaves, in-flight work "may be canceled". `ctx.waitUntil` extends that by only 30 s.
  - Detecting a disconnect (`request.signal`) needs the **`enable_request_signal`** compatibility flag, which is off at our date.
  - A non-streaming OpenRouter call **keeps billing even when aborted**. Only streaming calls to supported providers stop billing on abort ([streaming](https://openrouter.ai/docs/api_reference/streaming.md)).
- **Design options:**
  - **(a) Synchronous POST.**
    - Simplest; fully allowed.
    - The progress signal is client-side only: an indeterminate or time-based indicator.
    - The <200 ms acknowledgement is met by the island (instant disabled button and indicator), not by the server.
  - **(b) Heartbeat-SSE.**
    - Send keep-alive/progress events, then one final event carrying the validated JSON.
    - Real liveness; immune to 524.
    - Costs: errors must travel in-band after the 200, plus a known **dev-only buffering bug** — Miniflare/vite-plugin gzips streamed responses ([workers-sdk#8004](https://github.com/cloudflare/workers-sdk/issues/8004), still open; workaround `Content-Encoding: identity`).
    - Astro endpoint streaming is expected to work (it's a standard `Response`) but is not documented, so it would need a spike.
  - **(c) Job + polling.**
    - Needs storage for the job and its result, which contradicts `prd.md:142`, and a Queue or Durable Object, since `waitUntil` covers only 30 s.
    - Rejected.
- **Timeouts:**
  - `AbortSignal.timeout(ms)` works in production workerd. It also covers reading the response body.
  - It keeps the context alive for the full timeout ([workerd#4936](https://github.com/cloudflare/workerd/issues/4936)), so `AbortController` + `setTimeout`/`clearTimeout` is the cleaner option.
  - The two external agents suggested 30 s and 90 s respectively. Whatever the plan picks for synchronous mode must stay below the 524 ceiling. A value around 60 s gives ~3× the PRD's typical 20 s.

### 5. OpenRouter integration (external)

**Agent-readable docs:** `openrouter.ai/llms.txt`, `/docs/llms.txt`, `/llms-full.txt` and a `.md` suffix on every page. That's a good quality signal.

**Client options**, checked against npm tarballs:

| Option | Verdict |
|---|---|
| **plain `fetch` + zod** | **Recommended.** Zero dependencies, no unenv exposure, and the same wire format the docs show ([structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs.md)) |
| `@openrouter/sdk` 1.4.2 | Clean runtime, but Workers is not listed in RUNTIMES.md, and the docs show two different call shapes (API churn) |
| `openai` 7.23 + `baseURL` | 20 MB, lazy `child_process`/`fs` code paths; adds nothing, since `provider` fields would be untyped extras anyway |
| `ai` + `@openrouter/ai-sdk-provider` | Heavier; history of Workers issues ([vercel/ai#8386](https://github.com/vercel/ai/issues/8386)) |

**Structured output:**

- `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`.
- Support is **per endpoint**. Without `provider.require_parameters: true`, the parameter "is ignored" when unsupported. With it, OpenRouter returns 503 if no endpoint qualifies.
- Strict is best-effort on some endpoints, so zod validation stays mandatory.
- Wrap the array in an object (`{ cards: [...] }`), because several strict modes require an object at the root.

**Errors:**

- Shape: `{ error: { code, message, metadata? } }`.
- Pre-flight statuses: 400, 401, 402 (credits / key limit), 403, 408, 429, 502, 503.
- **A 200 can still carry `error` and no `choices`** once the provider has accepted the request, so always check the body.
- `finish_reason: "length"` with empty content means reasoning consumed `max_tokens`.

**Cost control:**

- Always set `max_tokens`: it bounds cost and the in-flight hold.
- Set a per-key credit `limit` with a reset period.
- `usage.cost` comes back on every response.

**Model candidates** (live `/api/v1/models` and `/endpoints/zdr` on 2026-09-29; USD per 1M tokens in/out):

| Model | Price | ZDR + structured output | Notes |
|---|---|---|---|
| `google/gemini-3.1-flash-lite` | 0.25 / 1.50 | Vertex global/eu/us | GA since 2026-05; minimal reasoning by default; no stream-abort billing stop |
| `mistralai/mistral-small-2603` | 0.15 / 0.60 | mistral zdr/eu/us | Reasoning off by default; EU endpoint |
| `openai/gpt-6-luna` | 0.10 / 0.50 | Azure only | **Released 2026-09-22**, unproven; set low reasoning |
| `deepseek/deepseek-v4-flash` | 0.14 / 0.28 | Mixed; some ZDR hosts lack structured output | High reasoning only, so slower; uptime 95–99.9% |

- Latency was not measured (the feed's fields are `null`), so a smoke call is needed.
- Prices change, so re-check them at plan time.
- The `models: [...]` fallback list can chain two candidates.

**Attribution headers** (optional, not privacy-related): `HTTP-Referer`, `X-OpenRouter-Title`, and `X-OpenRouter-App-Visibility: hidden`. Visibility has to be set on the very first request.

## Code References

Permalinks use the base above plus the path.

- `src/pages/api/flashcards/index.ts:8-45` — route template: prerender, branch order, `{code,message}`-only logging
- `src/lib/api-errors.ts:1-26` — closed error vocabulary; the place a new upstream-failure code would go
- `src/lib/validation/flashcard.ts:3-27` — `FRONT_MAX`/`BACK_MAX`, `cardText()` rules that proposals must satisfy
- `supabase/migrations/20260922190157_create_flashcards.sql:14-15` — DB length CHECKs (200/500)
- `src/lib/services/flashcards.ts:9-49` — service contract (client as first arg, throw on error)
- `src/types.ts` — DTO/command aliases; where a proposal DTO goes
- `src/components/deck/NewFlashcardForm.tsx:28-161` — island pattern: state, client-side validation, error branches, spinner
- `src/components/auth/ServerError.tsx` — `role="alert"` error box
- `src/pages/deck.astro:41-53` — page shell (Layout, Topbar, glass sections, `client:load`)
- `src/middleware.ts:4,20-21,39-41` — `PROTECTED_ROUTES`, redirect, `Cache-Control: private, no-store`
- `src/components/Topbar.astro:12-24` — signed-in nav links
- `astro.config.mjs:16-26` — adapter, `checkOrigin`, `env.schema`
- `wrangler.jsonc:55-57` — observability enabled (100% sampling)
- `src/pages/api/flashcards/index.test.ts:6-91` — route test pattern
- `vitest.config.ts:4-7` — why tests don't boot workerd

## Architecture Insights

- **One vertical path per slice:**
  - a shared zod schema (`src/lib/validation/`)
  - a service that throws (`src/lib/services/`)
  - a thin route that maps errors to the closed vocabulary
  - an Astro page with a single `client:load` island
  - colocated Vitest tests
- S-02 fits this with one new service (`generateProposals(text, opts)` doing `fetch` to OpenRouter) and no Supabase use beyond the auth check.
- **The route owns the privacy boundary.** The only safe logs are an error code/class plus non-content metadata such as status, latency and token counts. This extends S-01's `{code, message}` rule.
- **Validate at both edges of the LLM:**
  - the input on the way in (length and `isWellFormed`)
  - the model's output on the way out (the `{cards:[{front,back}]}` schema, then per-card `cardText` limits)
  - Decide in the plan whether invalid cards are dropped or fail the request.
- **Keep S-03 open without deciding it:** return the proposals in model order. S-03 can generate client-side keys and keep the original text if it needs to detect edits (Q-2 and Q-3 are S-03 decisions, `roadmap.md:130-132`).
- **Runtime constraints favour zero-dependency code.** A `fetch`-based client sidesteps the unenv failure mode, which appears only at runtime (`infrastructure.md:190-195`).

## Historical Context (from prior changes)

- **Error vocabulary and route order:** `context/archive/2026-09-28-manual-card-and-deck/plan.md:86-90, 143-150`.
- **Astro Actions** were rejected because `ActionError` bypasses the vocabulary (`.../plan-brief.md:24`).
- **Request body size was unbounded**, and that was accepted for S-01's small JSON. The review suggested a `Content-Length` > 16 KB guard, which is far more relevant for pasted text (`.../reviews/impl-review-phase-2.md:74-91`, F5).
- **Workers Paid gate:** "Paid ($5/mo) fires on sustained cpuTime > 6 ms … **or the PR that adds the AI proposals route**" (`context/changes/deployment/deployment-plan.md:67-69`).
  - It is still untaken (:1004, :1216).
  - The CPU baseline has a median of 5 ms and a max of 31 ms, and the doc notes "the proposals screen is very likely the moment Free stops being viable" (:591-609).
- **Stale guidance to override:**
  - `tech-stack.md:36-38` and `bootstrap-verification/verification.md:54` say "stream or poll, don't hold a synchronous connection".
  - `infrastructure.md:43-46` and current Cloudflare docs contradict this.
  - The plan should record why synchronous is acceptable.
- **Recurring review findings to expect:**
  - vacuous checks and stubs
  - inputs that turn a 400 into a 500
  - user text leaking into logs
  - reliance on implicit framework defaults
  - silent failures disguised as empty or OK results
  - scope creep
- **Progress tracking:** `## Progress` with `- [x] N.M — <sha>` entries, a `## Deviations` section, and `reviews/impl-review-phase-N.md` files. The PR must say `Closes #8` (`tasks-github.md:140-143`).
- **Open governance gaps:**
  - `main` has no branch protection, so every merge is an unreviewed production release (`deployment-plan.md:934-944`).
  - `AGENTS.md:112` still says `npx wrangler deploy` (Phase 7 pending).

## Related Research

- `context/foundation/infrastructure.md`: platform choice, risk register (E13 CPU, E15 unenv, E28 logs retention).
- `context/changes/deployment/deployment-plan.md`: secrets procedure and the Paid gate.
- `context/archive/2026-09-22-deck-data-contract/plan.md`, `plan-brief.md`: card field limits.
- `context/archive/2026-09-28-manual-card-and-deck/plan.md` and `reviews/`: the pattern and review history.
- No earlier `research.md` exists in `context/`.

## Open Questions

Decisions for the owner or `/10x-plan`:

1. **Pasted-text limit.** PRD Open Question 1, issue #1, owner: user, non-blocking. It sets the zod `max`, a `Content-Length` guard, and `max_tokens` / cost.
2. **Proposal count and card limits.**
   - A fixed count, or "up to N, scaled to the text"? The docs only hint at 20–30.
   - The prompt must target `front ≤ 200` and `back ≤ 500`.
   - If the model violates a limit: drop the offending card, or fail the request?
3. **Transport.** Synchronous POST with a client-side indicator (recommended), or heartbeat-SSE? This depends on whether an indeterminate or time-based indicator counts as the PRD's "continuous visible progress".
4. **New error code(s).**
   - Upstream/LLM failure and timeout: does it get its own code (e.g. `generation_failed`, 502/504), or map to `server_error`?
   - Either choice is a vocabulary change or a conscious reuse, recorded in `AGENTS.md`.
   - Similar question for text over the limit: `validation_failed` fits.
5. **Model and fallback chain.**
   - Start with `google/gemini-3.1-flash-lite` → `mistralai/mistral-small-2603`?
   - Measure latency and quality with a smoke call on real text (Polish and English).
6. **Workers Paid.** This PR is the recorded trigger. Subscribe before merge, or measure cpuTime on the preview first? It's a billing change, so the owner decides.
7. **OpenRouter account setup** (owner, outside the repo):
   - create the key with a credit `limit`
   - I/O logging OFF
   - ZDR enforced
   - `wrangler secret put OPENROUTER_API_KEY`
8. **Client disconnect.**
   - Enable `enable_request_signal` so a closed tab aborts the upstream call? That is a compatibility-flag change and needs a preview test.
   - In non-streaming mode it does not stop OpenRouter billing anyway.
9. **Unverified, needs a spike on a preview URL:**
   - a real ~20 s call end to end on a deployed Worker
   - cpuTime of the proposals render
   - whether Astro's `context.request.signal` is the live workerd signal
   - (if SSE) that the adapter does not buffer the stream

## Follow-up Research 2026-09-29T13:30+02:00

Run by the main session directly with **Context7** (`/withastro/docs`, `/llmstxt/developers_cloudflare_workers_llms-full_txt`) and **Exa** (search + fetch). It closes several items the first pass marked "unverified". The first pass's OpenRouter agent had used Exa only once and Context7 not at all.

### F1. `astro:env` — how a new `OPENROUTER_API_KEY` secret behaves (Context7, `/withastro/docs`)

- Configuration reference, `env.validateSecrets` (default `false`, since v5.0.0):
  - "By default, only public variables are validated on the server when starting the dev server or a build, and **private variables are validated at runtime only**."
  - `validateSecrets: true` adds a start-time check.
- **Consequence:**
  - Declaring the key as `envField.string({ context: "server", access: "secret" })`, even without `optional: true`, does **not** break `npm run build` in CI or Workers Builds, because the check happens at runtime.
  - A missing non-optional secret fails when it is accessed.
  - Keeping `optional: true`, as for the Supabase keys, lets the route map a missing key to `server_error` deterministically. That is the more consistent choice.
- `getSecret(key)` exists in `astro:env/server` for keys outside the schema. We don't need it.
- On Cloudflare, the adapter wires `getSecret` to the request-scoped Worker `env` (`setGetEnv((key) => env[key])`, adapter reference). This confirms that `wrangler secret put` values reach `astro:env/server` with no `cloudflare:workers` import.

### F2. Detecting a closed tab (`request.signal`) — Context7 + Exa + adapter source

- Cloudflare (Context7, compatibility-flags page):
  - `enable_request_signal` makes `request.signal` fire when the client disconnects.
  - A separate flag, `request_signal_passthrough`, forwards the incoming signal to subrequest `fetch()` calls.
  - Neither is on at our `compatibility_date`.
- `@astrojs/cloudflare` 13.7.0 passes **the original workerd `Request`** to Astro (`node_modules/@astrojs/cloudflare/dist/utils/handler.js:58`: `app.render(request, {...})`, no `new Request`). Production should therefore expose the live signal once the flag is on.
  - Not verified: whether Astro core or our middleware re-creates the request before the endpoint. This still needs a preview spike.
- **`astro dev` never fires it.** [withastro/astro#17120](https://github.com/withastro/astro/issues/17120): "in the dev server, `ctx.request.signal` never fires the `abort` event". The fix PR [#17133](https://github.com/withastro/astro/pull/17133) was merged (commit `fa6428a`) after our `astro ^6.3.1`, so the installed version is unknown.
  - Any abort-on-disconnect behaviour **cannot be tested locally**; it needs a preview URL.
- **Net for the plan:** the benefit is small. A non-streaming OpenRouter call bills in full even when aborted (first pass, §4), and Google endpoints do not stop billing even when streaming. Treat abort-on-disconnect as optional.

### F3. Streaming from an Astro endpoint on Workers (Exa)

- Workers streams a `Response` whose body is a `ReadableStream` ([Streams](https://developers.cloudflare.com/workers/runtime-apis/streams/)): "Any data provided through the `ReadableStream` will be streamed to the client as it becomes available."
- I found **no report** of an Astro API endpoint on the Cloudflare adapter buffering a streamed `Response`. The known Astro 6 + `nodejs_compat` failure is different: Astro misdetects Node and emits AsyncIterable bodies, rendered as `[object Object]` ([MetaBureau, 2026-03-23](https://metabureau.com.au/blog/astro-deployment-mystery-nodejs-compat); [ArgoBox, 2026-02-20](https://argobox.com/journal/2026-02-20-object-object-the-three-headed-hydra/)).
  - The fixes are `disable_nodejs_process_v2`, a newer adapter, or a Response patch.
  - This hits page rendering, and our production pages render fine today. It is still something to watch **if the plan ever bumps `compatibility_date`** (already a risk-register row).
- The dev-only gzip buffering bug (workers-sdk#8004, first pass) remains the main streaming caveat.
- **Net:** SSE stays a viable fallback but needs a preview spike. It does not change the recommendation for a synchronous POST.

### F4. Model latency — does ~20 s hold? (Exa: OpenRouter model pages, ModelIndex, Evalry)

- `google/gemini-3.1-flash-lite` on [OpenRouter](https://openrouter.ai/google/gemini-3.1-flash-lite), standard routing:
  - Google AI Studio: **0.65 s latency / 70 tps**
  - Google Vertex: **0.79 s / 68 tps**
  - Vertex regional endpoints: 0.75–1.63 s / 38–214 tps
  - [ModelIndex](https://modelindex.ai/models/google/gemini-3.1-flash-lite) gives a P50 of 0.61–0.63 s time to first token via OpenRouter (flex tiers).
- **Worked estimate:**
  - 20 cards × ~60–80 output tokens ≈ 1,200–1,600 tokens.
  - At ~70 tps that is **~17–23 s** plus under 1 s before the first token. This lands exactly on the PRD's "~20 s".
  - At the fast Vertex endpoint (214 tps) it is about 6–8 s.
  - The **Flex** tiers are half price but can reach 16 s TTFT and 5 tps. Avoid them (standard routing already excludes them).
- `mistralai/mistral-small-2603` (Mistral Small 4, released 2026-03-16, $0.15/$0.60):
  - The OpenRouter page lists Artificial Analysis scores: IFBench 32.8% non-reasoning vs 48.2% reasoning.
  - The fetched excerpt had no latency or throughput, so its speed is **still unmeasured**.
  - Weaker instruction-following without reasoning argues for it as a fallback only.
- **Net for the plan:**
  - The time budget depends mostly on **how many cards we ask for**, not on the round trip. Proposal count and `max_tokens` are therefore the real latency levers.
  - A `max_tokens` around 2,500 caps both cost and time (~35 s worst case at 70 tps), keeping even a slow run far below the ~100 s 524 ceiling.
  - Confirm on real Polish text with one smoke call before locking the model.

### Updated open questions

- Q9 (spike) narrows to three items:
  - a real call on a preview URL
  - cpuTime of the page
  - whether our middleware or Astro core preserves `request.signal`
- Adapter pass-through is now confirmed.
- New input for Q2 (proposal count): the count sets latency roughly linearly, at ~1 s per card at 70 tps.

## Follow-up Research 2026-09-29T14:15+02:00 — Library options for S-02

**Question (owner):** which libraries are available to implement S-02, and which are compatible with `context/foundation/tech-stack.md`?

**Compatibility gates derived from `tech-stack.md` + repo constraints:**

- **G1 — TypeScript + Zod at the boundaries.** "TypeScript with Zod schemas at the boundaries keeps the AI generation contract explicit" (`tech-stack.md:31-33`). zod `^4.4.3` is already installed.
- **G2 — Runs on workerd.**
  - `deployment_target: cloudflare-workers`.
  - No Node built-ins in reachable code (unenv throws only at runtime, E15).
  - Bundle cap: 3 MiB gzipped on Free, 10 MiB on Paid (`infrastructure.md:202`).
- **G3 — No background jobs, no realtime** (`has_background_jobs: false`, `has_realtime: false`).
- **G4 — Agent-friendly:** typed, conventional, popular, current docs (`tech-stack.md:27-29`).
- **G5 — Repo conventions** (AGENTS.md):
  - React islands, no Next.js directives
  - shadcn/ui "new-york"
  - errors only through `apiError()`
- **G6 — PRD no-persistence NFR:** nothing may store the source text (`prd.md:142`).

Evidence was gathered on 2026-09-29 from `npm view` (versions, deps, engines, unpacked size), `api.npmjs.org` weekly downloads, Context7 (`/websites/zod_dev`, `/websites/ai-sdk_dev`, `/shadcn-ui/ui`) and Exa (GitHub PRs/READMEs, Cloudflare docs).

### L1. Server-side LLM client (the core choice)

| Option | Version · weekly dl | Footprint | Gate check | Verdict |
|---|---|---|---|---|
| **Plain `fetch` + zod** | built-in | 0 deps, 0 KB | G1 ✅ G2 ✅ (native to workerd) G4 ✅ (OpenRouter docs show "TypeScript (fetch)" as first-class) | **Recommended.** ~60 lines of our own code: request builder, `body.error` check, zod parse. |
| `@openrouter/sdk` | 1.4.2 (published 2026-09-29) · 977k | 5.2 MB unpacked; dep only `zod ^3.25 \|\| ^4` | G1 ✅ G2 ⚠️ runtime code is clean, but Workers is absent from its RUNTIMES.md · G4 ⚠️ docs show two different call shapes | Acceptable second choice. A typed `provider: { zdr }` is its main gain. |
| `ai` (AI SDK v7) + `@openrouter/ai-sdk-provider` | ai 7.0.122 · 30.4M; provider 3.1.0 · 3.6M | ai 7.4 MB + provider 1.6 MB; pulls `@ai-sdk/gateway`, `provider`, `provider-utils`; **ESM-only, Node ≥ 22** (our 22.14 ✅) | G1 ✅ (`Output.object({ schema: z.object(...) })`, Context7) G2 ✅ in general (Cloudflare's own `workers-ai-provider@4` targets ai v7) · G4 ✅ popular, but **v7 migration is fresh** (OpenRouter provider PR #511, `workers-ai-provider@4.0.0`), so older tutorials show v5/v6 APIs | Viable if we later want streaming partial objects; it is overkill for one non-streaming call. History of a `process.env` → Vercel Gateway fallback on Workers ([vercel/ai#8386](https://github.com/vercel/ai/issues/8386)). |
| `ai` + `@ai-sdk/openai-compatible` | 3.0.59 · 9.5M | as above, minus the OpenRouter provider | Same as above, but OpenRouter-specific `provider.zdr` / `require_parameters` become untyped `providerOptions` | No advantage over the OpenRouter provider. |
| `openai` + `baseURL` | 7.23.0 · 44.9M | 19.9 MB; `child_process`/`fs` code paths (lazy); peers `ws`, `undici`, AWS smithy | G2 ⚠️ E15 exposure; OpenRouter fields untyped | **Reject.** |

### L2. Zod → JSON Schema for `response_format`

- **Zod 4 built-in `z.toJSONSchema(schema)`.** It is already installed, so there is no new dependency. From the Context7 zod.dev docs: "Zod object schemas default to setting `additionalProperties` to `false`", which is exactly what OpenRouter strict mode needs. It supports `target: "draft-07"` if a provider needs it.
  - Caveat: our `cardText()` refinements (`isWellFormed`, visible char) cannot be represented in JSON Schema. The generated schema should come from a plain `{front: string.max(200), back: string.max(500)}` shape. The full `cardText` rules then run on the parsed output.
- `zod-to-json-schema` 3.25.2 is redundant with zod 4. **Not needed.**

### L3. Streaming helpers (only if the plan picks heartbeat-SSE)

| Library | Version · weekly dl · size | Use | Notes |
|---|---|---|---|
| `eventsource-parser` | 4.1.1 · 83M · 93 KB, 0 deps, engines Node ≥ 22.12 | Parse OpenRouter's SSE on the server | Recommended by OpenRouter docs. Our `.nvmrc` pins 22.14 ✅. Web-standard stream, workerd-safe. |
| Native `fetch` + `response.body.getReader()` | built-in | Read our SSE/NDJSON in the island | Enough for "progress events + one final JSON event". |
| `@microsoft/fetch-event-source` | 2.0.1 · 4.2M · 60 KB | Browser SSE with POST | Old codebase (2.0.1). Unnecessary for a single final payload. |
| `@ai-sdk/react` `useObject` | 4.0.125 · 9.7M · 314 KB + `swr` + `ai` | Stream a zod-typed partial object into React | Couples the island to the AI SDK stream protocol. Only makes sense if L1 = AI SDK. |
| `partial-json` | 0.1.7 · 10.4M · 21 KB | Parse incomplete JSON while tokens stream | Last published 2024-05. Only needed for card-by-card rendering, which the S-02 outcome does not require. |

### L4. UI building blocks (shadcn/ui, G5)

Only `button.tsx` exists today. Install commands are from Context7 `/shadcn-ui/ui`:

- `npx shadcn@latest add textarea`: the paste box. No runtime deps.
- `npx shadcn@latest add progress`: wraps `@radix-ui/react-progress` 1.1.16 (30 KB; same Radix family as the installed `@radix-ui/react-slot`). It shows a determinate or time-based bar. For an indeterminate state, the existing Tailwind spinner pattern in `NewFlashcardForm.tsx:145-161` suffices.
- `npx shadcn@latest add skeleton`: placeholder cards while waiting. No deps.
- `npx shadcn@latest add sonner` (`sonner` 2.0.8, 60M/wk): toasts. shadcn's old `toast` is deprecated in favour of sonner. With Astro islands, `<Toaster />` must be rendered inside a React island, since there is no shared React root. **Not needed:** errors already use the inline `ServerError` (`role="alert"`) pattern.
- Icons: `lucide-react` (already installed).

### L5. Input-size limiting

- **Tokenizers are not compatible.** `js-tiktoken` 1.0.21 is 21.4 MB unpacked and `gpt-tokenizer` 4.0.0 is 25.9 MB, because both ship BPE rank tables. They risk the Workers bundle cap (G2), and they count **OpenAI** tokens, not Gemini or Mistral ones.
- **Use a zod character limit** (`z.string().max(N)`) plus a `Content-Length` guard. That's zero dependencies, and it is what PRD Open Question 1 asks for anyway ("character limit").

### L6. HTTP / retry helpers

- `ky` 2.1.0 and `p-retry` 8.0.1 are workerd-safe but unnecessary: one call, one `AbortController`, and at most one manual retry on zod failure.
- `ofetch` 1.5.1 depends on `node-fetch-native`. It is pointless on workerd. **Reject.**

### L7. Adjacent platform option: Cloudflare AI Gateway (not a library)

- It can sit in front of OpenRouter and offers retries, caching, analytics and rate limits.
- **It conflicts with G6 by default.** Logs "including the user prompt, model response" are "**enabled by default for each gateway**", and the auto-created default gateway has "Log collection: On" ([AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), [manage gateway](https://developers.cloudflare.com/ai-gateway/configuration/manage-gateway/)).
- Payload storage can be disabled per request with `cf-aig-collect-log-payload: false` (added 2026-03-17) or with `cf-aig-collect-log: false`.
- It adds a second place that could persist source text. **Out of scope for S-02.**

### Recommended stack for S-02 (evidence summary)

| Layer | Choice | New dependency? |
|---|---|---|
| LLM call | plain `fetch` to OpenRouter `/api/v1/chat/completions` | none |
| Contract | zod 4 schemas + `z.toJSONSchema()` for `response_format` | none |
| Input limit | zod `.max(N)` + `Content-Length` guard | none |
| UI | shadcn `textarea` (+ optionally `progress` / `skeleton`), existing spinner, `ServerError`, `lucide-react` | shadcn-generated files; `progress` adds `@radix-ui/react-progress` |
| Streaming (only if chosen) | `eventsource-parser` server-side, native `getReader()` client-side | `eventsource-parser` |

Result: **S-02 can ship with zero new runtime npm dependencies**, apart from optional shadcn components. That removes E15 (unenv) exposure entirely and keeps the bundle unchanged. The AI SDK stays the documented upgrade path if S-03 or later wants card-by-card streaming.
