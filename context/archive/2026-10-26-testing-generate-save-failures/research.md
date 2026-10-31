---
date: 2026-10-26T21:16:51+01:00
researcher: Claude (Opus 5.5) for Dawid Kozinski
git_commit: 90550e741751d5b3744ae2d4d0fa81277a269a62
branch: main
repository: dkozinski/10xCards
topic: "Test-plan §3 Phase 1 — generate and save screens under failure (risks #1, #3)"
tags: [research, codebase, testing, generate, proposals, generations, openrouter, react-islands, vitest]
status: complete
last_updated: 2026-10-26
last_updated_by: Claude (Opus 5.5)
---

# Research: Generate and save screens under failure (test-plan Phase 1)

**Date**: 2026-10-26T21:16:51+01:00
**Researcher**: Claude (Opus 5.5) for Dawid Kozinski
**Git Commit**: 90550e741751d5b3744ae2d4d0fa81277a269a62
**Branch**: main
**Repository**: dkozinski/10xCards

Permalink base for every `path:line` below:
`https://github.com/dkozinski/10xCards/blob/90550e741751d5b3744ae2d4d0fa81277a269a62/<path>#L<line>`

## Research Question

Ground §3 Phase 1 of `context/foundation/test-plan.md` against the current code:

- **Risk #1**: the AI provider returns a malformed, truncated, empty or late response.
  - The generate screen breaks: the spinner never clears, the pasted text is lost, or a retry needs a reload.
  - Or the server reports success and shows garbage cards.
- **Risk #3**: the save diverges from what the user approved.
  - A rejected card lands in the deck.
  - An edited card is saved in its pre-edit wording.
  - A double click creates duplicates.
  - The origin label is wrong.

The research had to cover four things, taken from the Risk Response Guidance in the test plan:

- how upstream responses are classified;
- what the generate island keeps in state across a failed request;
- timeout behaviour on the Worker;
- save atomicity, replay protection, and where the origin label is decided.

It also had to establish what a first component-test setup needs.

## Summary

### Overall

The defences are deliberate and mostly sound, but no automated test checks them at the screen level.

- **Server classification is mapped and largely tested.** All kinds go to `generation_failed`, except config failures, which go to `server_error`. The tests use parser-shaped fixtures, though, not real OpenRouter bodies.
- **Client state was hardened in earlier review rounds.** That covers the frozen-retry design, the closure guards and the client timeouts. The archive records it as "verified manually".
- **There are zero component tests and the infrastructure is missing.** Archived plans excluded it on purpose.

### Real gaps found (risk #1)

| #   | Gap                                                                                                                                    | Effect                                                                                | Likelihood                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| G1  | `finish_reason` `content_filter` or `length` is not rejected when the content still parses                                             | 200 with a partial list from a cut-off or filtered completion                         | Low to medium                                                           |
| G2  | A choice-level `error` object is never checked (OpenRouter documents `choices[].error`)                                                | 200 from a failed choice, if its content parses                                       | Low                                                                     |
| G3  | The client does not validate proposal items. `[null]` or an item without `front` throws during render, and there is no error boundary  | The island unmounts and **the pasted text is lost**                                   | Low: needs a body that the server's zod would not produce, e.g. a proxy |
| G4  | The client assumes `error.details.fieldErrors` exists on `validation_failed`                                                           | Unhandled rejection after `pending=true`, so **the spinner sticks** (both components) | Low: our `apiError` always sends it; only a foreign body triggers it    |
| G5  | Every upstream 403 maps to `upstream_config` and then 500 "misconfigured". OpenRouter also uses 403 for moderation of the user's input | A content-dependent failure is reported as non-retryable "our bug"                    | Low to medium                                                           |

### A conflict with the test plan's wording

> [!IMPORTANT]
> The test plan's §2 protection for risk #1 says "502 instead of a success with an **empty or partial** list". The code returns **200 with a partial list** on purpose, when some model cards fail per-card validation or exceed 20. This was an owner decision in the archived `ai-proposals-from-text` plan-brief: "drop invalid cards; zero valid → error".
>
> An empty list can never be a 200. Research is the ground truth (§1 principle 3), so Phase 1 should assert **"never empty; partial only because the dropped cards were themselves invalid"**. Alternatively, the owner reopens that decision.

### Risk #3 at the unit and component layer

- **Client:**
  - The payload is built only from non-rejected items.
  - Each card carries the trimmed post-edit wording, and its `source` is computed in the browser.
  - `generation_id` is minted once per generation and reused on every retry.
  - After an ambiguous failure the command is frozen and resent byte-identical.
- **Server:**
  - Saving runs one `security invoker` RPC with one transaction.
  - The function claims `generations.id` with `on conflict do nothing` before it inserts cards, so a replay returns the original count and writes nothing.
- **Already proven by pgTAP:** atomicity, replay of the same payload, and counter derivation. pgTAP runs locally only.
- **Not proven anywhere:**
  - the `ProposalReview` component itself;
  - a replay carrying a _different_ payload;
  - a concurrent double submit (needs two sessions, which is Phase 2 territory).
- **Origin label:** it is client-asserted by design. The server cannot detect a lie. This is an accepted risk, not a test target.

### Test infrastructure

Component tests need:

- `jsdom`, `@testing-library/react`, `@testing-library/dom` and `@testing-library/user-event`, plus optionally `@testing-library/jest-dom`;
- the Vitest include widened to `.tsx`, because today a `*.test.tsx` file is **silently skipped**;
- a per-file `// @vitest-environment jsdom` comment.

> [!WARNING]
> `jsdom@30` requires Node ≥ 22.22.2, but `.nvmrc` says 22.14.0. Either pin `jsdom@29`, or raise the local Node.

## Detailed Findings

### 1. Server: generation endpoint and classification (risk #1)

**Who calls the AI**

- Only `POST /api/proposals` (`src/pages/api/proposals/index.ts`) does. Its steps:
  1. session check (:18)
  2. API key from `astro:env/server` (:2, :22)
  3. 128 KiB body cap (:13, :26)
  4. JSON parse (:36)
  5. zod validation (:41)
  6. `generateProposals` (:51)
  7. error mapping (:61-80)
- It persists nothing.
- `POST /api/generations` saves; it never calls the AI.

**Provider call** (`src/lib/services/generation.ts`)

- **Transport:** OpenRouter over plain `fetch`, non-streaming (:6, :130).
- **Models:** `google/gemini-3.1-flash-lite` with fallback `mistralai/mistral-small-2603`, routed by OpenRouter (:10, :140).
- **Output format:** `response_format: json_schema, strict` (:145-148).
- **Privacy:** `provider: {zdr, data_collection:"deny", require_parameters}` (:150).
- **Token cap:** `max_tokens: 3500` (:14, :151).
- **Timeout:** `AbortController` plus `setTimeout(60_000)` covers both `fetch` and `response.json()`, and it is cleared in `finally` (:15, :119-124, :172-173).
  - It deliberately avoids `AbortSignal.timeout` because of workerd#4936 (:120-121).
- **Retries:** none on the server, by design. The client has its own 75 s timeout.
- **Worker behaviour:** a closed tab does not abort the upstream call, because `enable_request_signal` is off.
- **Test seams:** `opts.fetchImpl` and `opts.timeoutMs` (:87-90, :117).

**Error-check order** (:154-211)

1. non-2xx
2. error body or missing choice or `finish_reason:"error"` → `upstream_body_error` (:180)
3. `content == null` → `invalid_output` (:195)
4. `JSON.parse` → `invalid_output` (:198-200)
5. `rawOutputSchema {cards: unknown[]}` → `invalid_output` (:202-203)
6. per-card `createFlashcardSchema`; invalid cards are **dropped** (:205-209)
7. cap at 20 (:210)
8. zero left → `no_valid_cards` (:211)

`CONFIG_STATUSES = {400, 401, 403, 404}` (:51).

**Route mapping** (`index.ts:74-80`)

- Each `GenerationError` kind → **502 `generation_failed`**.
- `upstream_config` → **500 `server_error`**.
- Anything else thrown → 500 `server_error`.

**Classification table** (current behaviour)

| Upstream situation                                     | Result             | 200 with partial possible? | Tested?                          |
| ------------------------------------------------------ | ------------------ | -------------------------- | -------------------------------- |
| 400/401/403/404                                        | 500 `server_error` | no                         | yes                              |
| 402/408/429/5xx                                        | 502                | no                         | 402/429/502/503 yes; 408, 500 no |
| network error                                          | 502                | no                         | yes                              |
| timeout (headers or body)                              | 502                | no                         | yes                              |
| 200 non-JSON body                                      | 502                | no                         | yes (HTML)                       |
| 200 with top-level `error`                             | 502                | no                         | yes                              |
| `{}` / `choices: []`                                   | 502                | no                         | no                               |
| choice without `message` / content as parts array      | 502                | no                         | no                               |
| `finish_reason:"error"`                                | 502                | no                         | yes                              |
| **choice-level `error`, other finish_reason**          | parsed as success  | **yes** (G2)               | no                               |
| `content: null`                                        | 502                | no                         | yes                              |
| `content: ""`                                          | 502                | no                         | no                               |
| prose / fenced JSON                                    | 502                | no                         | prose yes; fenced no             |
| truncated JSON (`length`)                              | 502                | no                         | yes                              |
| **`length` / `content_filter` with parseable content** | 200                | **yes** (G1)               | no                               |
| wrong top-level shape                                  | 502                | no                         | `{flashcards:[]}` only           |
| some cards invalid                                     | 200 subset         | yes, by design             | yes                              |
| >20 cards                                              | 200 first 20       | capped, by design          | yes                              |
| all invalid / zero                                     | 502                | no                         | yes                              |

**Logging**

- Success logs only counts, latency and usage (`index.ts:53-58`).
- Failure logs `{kind, status, finishReason?, completionTokens?, latencyMs}` (:67-72). `finishReason` is kept only if it matches `^[a-z_]{1,32}$` (`generation.ts:188`).
- Error bodies are fixed strings.
- The upstream `error.message` is never read. That matters because OpenRouter moderation metadata carries `flagged_input`, which is user text.
- The tests assert no source text in logs (`proposals/index.test.ts:227-241`) and no console use by the service (`generation.test.ts:68-82`). That makes this ground relevant to risk #7.

**Real OpenRouter failure shapes**
Sources: https://openrouter.ai/docs/api/reference/errors-and-debugging and https://openrouter.ai/docs/api/reference/overview, fetched 2026-10-26.

- **Error envelope:** `{error:{code, message, metadata?}}`.
- **Errors inside a 200:** a failure after a provider has accepted the request arrives as **a 200 with an `error` body**.
- **Status meanings:**
  - 403 = permissions, guardrail **or moderation**
  - 408 = timeout
  - 502 = model down or invalid response
  - 503 = no provider meets routing, which matters with `zdr` plus `require_parameters`
- **Choice shape:** `{finish_reason, native_finish_reason, message:{role, content:string|null}, error?}`.
- **`finish_reason` values:** `stop | length | content_filter | tool_calls | error`.
- **"No content generated":** happens on cold start or scaling, and the prompt may still be charged. This is where null or empty content comes from in practice.

**Oracle-problem finding**

The fixture helper `completion()` (`generation.test.ts:9-15`) emits only `{choices:[{message:{content}}], usage}`. That is exactly the shape the parser reads, and it lacks `id`, `model`, `provider`, `role`, `native_finish_reason`, `finish_reason:"stop"` and `error`.

The route test mocks the whole service (`proposals/index.test.ts:18-21`). So **no test takes a raw OpenRouter body all the way to an HTTP status**.

Phase 1 fixtures should come from the documented shapes above, not from `completion()`.

### 2. Client: generate island (risks #1, #3)

**Mounting:** `src/pages/generate.astro:19` mounts `<GenerateProposals client:load />` with no props.

**GenerateProposals state** (`src/components/generate/GenerateProposals.tsx:57-118`)

- **State:** `text`, `fieldError`, `requestError {message, retryable}`, `review {generationId, proposals} | null`, `discarded`, `pending`, and `elapsed` via `useElapsedSeconds(pending)`.
- **Guard:** `if (pending || review) return` (:69). This is a closure check, not a ref.
- **Client validation failure:** returns before `pending` is set (:72-76).
- **The fetch itself is in try/catch** (:82-97):
  - `TimeoutError` → `GENERATION_FAILED`, retryable.
  - Anything else → "Network error…", retryable.
  - `setPending(false)` (:95).
- **The body** goes through `response.json().catch(() => null)` (:99).
- **Branches:**
  - OK with a non-empty `proposals` array → review, with a new `crypto.randomUUID()` (:101-103).
  - `validation_failed` with `details` → inline field error (:104-105).
  - `generation_failed` → retryable message (:106).
  - `unauthorized` → non-retryable (:108).
  - Anything else, including **a 200 with `[]`, `{}` or a non-JSON body** → generic message, retryable when `response.ok` (:113-116).
- `setPending(false)` (:117). There is **no `finally`**.
- **Client timeout:** `AbortSignal.timeout(75_000)` (:45, :87).

**Text retention:** `setText` is only called from `onChange` (:153), so the text survives failure, success and discard (comment :256).

**Button state**

- The Generate button has `disabled={pending}` (:177). It re-enables on every **planned** path.
- `retryable:false` only hides the extra "Try again" (:206).
- While a review exists: `aria-disabled` plus the hint "Save or discard these proposals first." (:180, :198).

**Gaps on unplanned paths**

- **G3:** `ProposalReview.tsx:62-66` maps `p.front` directly.
  - `[null]` throws; an item missing `front` throws in `proposalSource().trim()` (:214 → `generation.ts:51`).
  - There is no error boundary, so the whole island, and with it the pasted text, unmounts.
  - Archived impl-review-phase-3 F1 named the null-item crash, but the fix only added the `Array.isArray` check.
- **G4:** `body.error.details.fieldErrors.text` (:105) throws if `details` has no `fieldErrors`.
  - This happens between `setPending(true)` and :117, so the spinner sticks.
  - The same happens in `ProposalReview.tsx:178`, via `Object.entries(undefined)` in `cardErrors` (:45).
  - Our own contract (`src/lib/api-errors.ts:24-26`) always includes `fieldErrors`, so only a foreign body reaches this.
- **Latent:** `crypto.randomUUID()` (:103) also sits before `setPending(false)`. It is safe on HTTPS and on localhost.

### 3. Client: review and save (risk #3)

**ProposalReview state** (`src/components/generate/ProposalReview.tsx`)

- **Items:** `items[]` hold `{id, original, front, back, rejected, editing, errors}` (:62-72).
- **Other state:** `pending` (:73), `error` (:74), `frozen: SentCommand | null` (:78), `announce` (:79).
- **Lock:** `locked = pending || frozen !== null` (:83).
- **Unload guard:** `useUnsavedChangesGuard` stays armed for the whole mount (:81).

**Building the payload: `buildCommand()`** (:110-128)

- Keeps the non-rejected items in list order (:111).
- Validates each one with `createFlashcardSchema`, using the current text whether or not its editor is open.
- Sends `{...parsed.data, source: proposalSource(original, parsed.data)}` (:114-117).
  - `proposalSource` compares the trimmed text (`src/lib/validation/generation.ts:47-53`).
  - A reverted edit or a whitespace-only change counts as `"ai"`.
- Sets `generated_count = proposals.length`, rejected ones included (:125).
- If any card is invalid, it opens those editors, shows "N card(s) need fixing", and sends nothing (:119-122).

**Double submit**

- `if (pending) return` (:131), and `disabled={locked}` on every control (:271, :285, :300, :315, :348).
- Editors close before sending (:138).
- Save timeout is 30 s (:15, :147).

**Outcomes**

| Response                                                  | Client behaviour                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| network error / timeout (:149-155)                        | freeze the sent command, "Could not save"                                                                         |
| 5xx / malformed 200 / `invalid_json` (:188-192)           | freeze, `SAVE_FAILED`                                                                                             |
| `validation_failed` (:174-184)                            | **unfreeze** (a 400 proves nothing was written); map `cards.N.field` to items by the sent `itemIds`, open editors |
| `unauthorized` (:185-187)                                 | message "sign in in another tab"; no freeze change                                                                |
| 200 with numeric `saved_count`, sent cards > 0 (:160-167) | `disarm()` then `window.location.assign("/deck")`; `pending` stays true                                           |
| 200, sent cards = 0 (:168-171)                            | `onDiscarded()` → parent clears review, keeps text (`GenerateProposals.tsx:255-259`)                              |

- **While frozen**, only "Try again" (:333-343) is active, and it resends `frozen` unchanged (:134).
- The success branch counts the **sent** command, not the live list (:161).

### 4. Server: save path (risk #3)

**Route** (`src/pages/api/generations/index.ts:17-60`)

- **Branch order:** 401 → client missing 500 → 64 KiB body cap → `invalid_json` → zod 400 with dotted per-card keys → `saveGeneration` → 200 `{saved_count}`.
- Any throw → 500 `server_error`. Only `{code, message}` is logged.

**Schema** (`src/lib/validation/generation.ts:34-43`)

- `generation_id`: uuid.
- `generated_count`: 1..20.
- `cards`: at most 20, using the flashcard rules plus `source ∈ {ai, ai_edited}`.
- Refine: `cards.length ≤ generated_count`.
- Unknown keys are stripped.

**Service** (`src/lib/services/generations.ts:11-22`)

- One `rpc("save_generation", …)`.
- The cards are rebuilt as `{front, back, source}` only (:16).
- The PostgrestError is rethrown unchanged.

**SQL function** (`supabase/migrations/20261006211722_review_and_save_proposals.sql:104-180`)

- `plpgsql`, `security invoker`, `search_path = ''`.
- **One transaction:**
  1. It claims `generations.id` with `on conflict do nothing` (:139-147).
  2. On a conflict it reads back `accepted_unedited + accepted_edited` through RLS and returns it **without writing cards**. The replayed payload is ignored even when it differs (:149-162).
  3. If the id belongs to another user, it raises 22023 `generation id unavailable` (:158-160), which the route maps to 500.
  4. The cards go in as one multi-row `INSERT … SELECT jsonb_array_elements` (:165-167).
  5. Counters are derived from the sources (:129-133, :146) and tied together by a CHECK (:33-35).
- EXECUTE is granted only to `authenticated` and `service_role` (:179-180).

**Origin label**

- It is client-asserted by design: archived `review-and-save-proposals/plan.md:70-71` and `plan-brief.md:90`.
- The server never sees the originals, because nothing is stored between generate and save (`plan.md:64, :67`).
- A client can mislabel its own cards. These are self-reported metrics (impl-review-phase-1 F1). Phase 1 can prove only that the **honest client** labels correctly.

**pgTAP** (`supabase/tests/generations_rls.test.sql`, 38 assertions, local only)

- **Covers:** RLS and policies, privileges, `source` default and check, happy-path counts, zero cards, replay of the **same** payload, atomic rollback on a bad card, bounds, forged `user_id`, immutability, cross-user replay refused, anon denied, and the deletion cascade.
- **Missing:** replay with a **different** payload; a concurrent double submit.

### 5. Test infrastructure

**Vitest config** (`vitest.config.ts`)

- Plain config, chosen because `getViteConfig()` boots workerd and reads `.dev.vars` (:4-7).
- `@` alias (:10).
- **`include` glob (:13)**: `include: ["src/**/*.test.ts"]` skips a `.test.tsx` file without a warning.
- No `environment` (so node), no `setupFiles`, no `globals`.

**JSX in tests**

- No plugin is needed. Vite 7.3.6's esbuild reads `jsx: react-jsx` from `tsconfig.json:6-7`.
- `@vitejs/plugin-react` is only a transitive dependency of `@astrojs/react`.

**Packages:** none of jsdom, happy-dom or `@testing-library/*` is installed.

| Package                       | Version on npm, 2026-10-26 | Notes                                                   |
| ----------------------------- | -------------------------- | ------------------------------------------------------- |
| `@testing-library/react`      | 16.3.3                     | needs `@testing-library/dom` ^10 installed explicitly   |
| `@testing-library/user-event` | 14.6.8                     |                                                         |
| `@testing-library/jest-dom`   | 7.0.1                      | `@testing-library/jest-dom/vitest` entry                |
| `jsdom`                       | 30.1.3                     | requires Node `^22.22.2`; local `.nvmrc` is **22.14.0** |
| `jsdom`                       | 29.1.1                     | fits Node 22.14                                         |

**Docs (Context7: Vitest v5.0.2, Testing Library, jest-dom, user-event)**

- **Environment:** use a per-file `// @vitest-environment jsdom` comment. This keeps the 23 node tests, which rely on Node's `Response` and stream `duplex`, out of jsdom.
- **Vitest 5:** `workspace` became `projects`, and inline projects inherit the root config.
- **Cleanup:** RTL auto-cleanup works only with `globals:true`, which the repo does not use. Call `afterEach(cleanup)` explicitly.
- **act:** import it from `@testing-library/react`. React 19 warns about un-wrapped updates, and existing tests often assert on console output.
- **Fake timers:** `userEvent.setup({advanceTimers: vi.advanceTimersByTime})`. `useElapsedSeconds` runs a 1 s interval.

**Lint:** type-checked ESLint (`eslint.config.js:15-20`) plus `react-compiler` (:58) apply to `*.test.tsx`. Watch for `no-floating-promises` (await every `user.*`), `unbound-method` and `no-non-null-assertion`.

**CI:** `.github/workflows/ci.yml:21` runs `npm test`. Node `22`, which resolves to the latest 22.x, satisfies jsdom 30.

**Polyfills:** none needed. The generate screens use only `Button` (Radix `Slot`), `Textarea`, `Skeleton` and lucide icons. There are no portals, popovers or ResizeObserver users.

**jsdom traps**

| API                                       | Where                                                        | Approach                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `fetch` (relative URL, no injection seam) | `GenerateProposals.tsx:83`, `ProposalReview.tsx:143`         | `vi.stubGlobal("fetch", …)` + `vi.unstubAllGlobals()`; first use of stubGlobal in the repo             |
| `DOMException` `TimeoutError`             | `GenerateProposals.tsx:90-91` uses `instanceof DOMException` | reject with the `DOMException` from the same global the component sees (jsdom vs Node realm); verify   |
| `AbortSignal.timeout`                     | :87, `ProposalReview.tsx:147`                                | fake timers won't fire it when fetch is mocked; simulate by rejecting                                  |
| `crypto.randomUUID`                       | `GenerateProposals.tsx:103`, `ProposalReview.tsx:64`         | confirm under jsdom or stub deterministically                                                          |
| `window.location.assign`                  | `ProposalReview.tsx:167`                                     | jsdom does not navigate and `location` may be non-configurable; stub, or assert fetch + disarm instead |
| `beforeunload`                            | `src/components/hooks/useUnsavedChangesGuard.ts:42-44`       | dispatch a cancelable event, check `defaultPrevented`                                                  |

**Handles for queries** (there are no `data-testid` attributes anywhere)

- The textarea's label is "Source text" (:133-141).
- The Generate button's name is "Generate proposals" or "Generating…" (:184-194).
- Errors render as `role="alert"` through `ServerError` (`src/components/auth/ServerError.tsx:12`).
- Card controls have `aria-label`s: "Edit / Done editing / Revert / Reject / Restore proposal n" (`ProposalReview.tsx:272-315`).
- The card editors are labelled "Front" and "Back" (`src/components/deck/CardField.tsx:44`). Scope queries with `within(listitem)`.
- The Save button reads "Save N card(s)" or "Discard all" (:358-368).

## Code References

- `src/lib/services/generation.ts:51` — `CONFIG_STATUSES` includes 403 (G5)
- `src/lib/services/generation.ts:92-103` — `completionSchema`, no choice-level `error` (G2)
- `src/lib/services/generation.ts:176-211` — classification order; only `finish_reason === "error"` rejected (G1)
- `src/lib/services/generation.ts:119-124,172-173` — 60 s abort covering fetch and body
- `src/lib/services/generation.test.ts:9-22` — `completion()` / `stubFetch` fixture helpers (parser-shaped)
- `src/pages/api/proposals/index.ts:61-80` — kind → HTTP mapping
- `src/pages/api/proposals/index.test.ts:18-21,227-241` — service mocked; no-source-text-in-logs assertion
- `src/components/generate/GenerateProposals.tsx:67-118` — generate state machine
- `src/components/generate/GenerateProposals.tsx:101-105` — the success guard and the `fieldErrors` dereference (G4)
- `src/components/generate/ProposalReview.tsx:62-72` — item construction from unvalidated proposals (G3)
- `src/components/generate/ProposalReview.tsx:110-128` — `buildCommand`
- `src/components/generate/ProposalReview.tsx:130-194` — save state machine, freeze and retry
- `src/lib/validation/generation.ts:34-53` — save schema, `proposalSource`
- `src/lib/api-errors.ts:24-37` — `ValidationDetails` contract
- `src/lib/services/generations.ts:11-22` — save service
- `supabase/migrations/20261006211722_review_and_save_proposals.sql:104-180` — `save_generation`
- `supabase/tests/generations_rls.test.sql` — 38 pgTAP assertions on the save path
- `vitest.config.ts:13` — include glob, `.ts` only

## Architecture Insights

- **Two-level error vocabulary.**
  - The service throws typed `GenerationError` kinds.
  - The route collapses them to `generation_failed` (retryable) or `server_error` (non-retryable).
  - The client branches on `error.code`, and on `response.ok` for the generic case.
  - A test at each seam is cheap: service with fixtures (node), route with the service mocked (node), component with `fetch` stubbed (jsdom).
  - Today nothing joins service to route with a real upstream body. A route test that keeps the real service and injects only the upstream response would close that gap without e2e. The service already takes `fetchImpl`; the route would need a seam or a module mock of `fetch`.
- **Client distrusts response shape at the top level, but trusts it inside.** `Array.isArray` and `.catch(() => null)` guard the envelope. Item shape and `details.fieldErrors` are trusted. G3 and G4 are the same pattern.
- **"Ambiguous failure → freeze; proven-not-written → unfreeze"** is the save's core invariant. It is the highest-value thing for a component test to pin.
- **Idempotency is client-minted and server-enforced.** The client test proves "same id, same body on retry". The DB test proves "a replay writes nothing". Neither alone proves "no duplicates".
- **No server state between generate and save** keeps source text out of the DB. It also means the origin label can never be verified server-side.

## Historical Context (from prior changes)

**`context/archive/2026-09-29-ai-proposals-from-text/`**

- `plan-brief.md:37`: "Drop invalid cards; zero valid → error"; "an empty result never poses as success". This is the source of the partial-200 design.
- `plan.md:61-63`: synchronous, non-streaming, no server retry.
- `plan.md:81`: truncation should be `invalid_output`, "not a partial result". This holds only when the cut JSON fails to parse (G1).
- `plan.md:446-447`: loose `rawOutputSchema` so that drop and cap are reachable; `dropped` includes capped cards.
- `plan.md:451, 459-460`: `finish_reason:"error"`, null content, and 400/401/403/404 → `upstream_config`, all added after review.
- `reviews/impl-review-phase-3.md`:
  - F1: client body handling, including the null-item note that G3 shows is not fully closed.
  - F5: 75 s client timeout.
  - F4: always-mounted live region.
- `reviews/impl-review.md` F4: accepted risk that a 20-card answer can exceed 3,500 tokens and fail.

**`context/archive/2026-10-05-review-and-save-proposals/`**

- `plan.md:64-72`:
  - The generations row is created at save time.
  - The `source` label is client-asserted.
  - **No component-test infrastructure; UI verified manually.**
- `plan.md:87-93`: the idempotency ordering, and the client keeping the same id across retries.
- `plan.md:394-399`, `reviews/plan-review.md` F1: the freeze-after-ambiguous-failure design.
- `reviews/impl-review-phase-3.md` F1: unfreeze on `validation_failed`.
- `plan.md:598-599`: manual check 3.9 "a lost-response retry writes a single set of rows" passed.

**Other archived plans**

- `context/archive/2026-09-28-manual-card-and-deck/plan.md:30,53` and `reviews/impl-review-phase-1.md:22`: why the plain Vitest config.
- `context/archive/2026-10-10-srs-review-session/plan.md:68`: "node-env Vitest only"; new tests must be mutation-checked.

## Related Research

- `context/archive/2026-09-29-ai-proposals-from-text/research.md`: Worker limits and OpenRouter behaviour (:39, :178-187, :231).
- `context/archive/2026-10-05-review-and-save-proposals/research.md`: save design and the zero-card discard (:196-209).

## Open Questions

These are for `/10x-plan` and the owner.

1. **Partial list: keep the design, or change the protection wording?**
   - Recommendation: keep the design.
   - Rephrase the risk #1 assertion as "never empty; a partial list only when the dropped cards were themselves invalid".
   - Make G1 and G2 the actual protections: a `content_filter`/`length` finish or a choice-level `error` must not produce a 200.
2. **Fix or pin the gaps?**
   - Tests written against G1–G4 will fail on today's code. Phase 1 must choose one of:
     - (a) fix them in this change, each with its regression test;
     - (b) record them as `it.fails` / known gaps and fix them later.
   - The test-plan lesson boundary keeps the bug-to-fix workflow for Lesson 5, which leans towards (b) plus tracking issues. But G1 directly contradicts risk #1's protection.
3. **G5 (403 moderation).** Should a moderation 403 become retryable `generation_failed` with a "text was refused" message? Or is it out of scope for a testing phase? It probably needs `error.metadata` inspection without reading `flagged_input`.
4. **jsdom version.** Choose between:
   - pinning `jsdom@29` (works on the local Node 22.14.0);
   - raising `.nvmrc` to ≥ 22.22.2 and taking `jsdom@30`.
5. **Navigation seam.** For `window.location.assign("/deck")` under jsdom, choose between:
   - stubbing `location`;
   - asserting only the fetch and the disarm;
   - adding a tiny injectable navigate.
6. **A route-plus-real-service test.** Should Phase 1 add one fixture-driven test that goes from a raw OpenRouter body to the HTTP code, joining the two layers that are mocked against each other today? Or should the service-level fixtures be enough?
7. **Different-payload replay and concurrent double submit.** Out of scope for Phase 1, since they need a real DB. Hand them to Phase 2 explicitly so they are not lost.
