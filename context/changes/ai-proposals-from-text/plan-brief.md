# AI Proposals from Pasted Text (S-02) — Plan Brief

> Full plan: `context/changes/ai-proposals-from-text/plan.md`
> Research: `context/changes/ai-proposals-from-text/research.md`

## What & Why

A signed-in user pastes source text and gets up to 20 AI-drafted flashcard proposals on
screen, with visible progress during the ~20 s wait. This slice carries the milestone's
riskiest assumption: that a long AI call returns usable flashcards on Cloudflare Workers. It
also unblocks S-03 (review and save).

## Starting Point

There is no AI integration yet. S-01 left a proven vertical pattern: a shared zod schema, a
service that throws, a thin route using the closed `apiError()` vocabulary, and a React island
with manual `fetch`. S-02 copies that pattern. There is no DB work.

## Desired End State

The `/generate` page accepts 500–20,000 characters. "Generate" responds instantly: a
per-second counter, time-based stage messages and skeleton cards run until a list of valid
proposals appears. AI failures show a retryable `generation_failed` error, and the text is
kept. The source text is never logged or stored: not by our Worker, not by OpenRouter (ZDR),
not in the browser.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Transport | Synchronous POST, no streaming or polling | Workers has no duration limit and awaited fetch is CPU-free; streaming adds dev bugs and in-band errors. Overrides `tech-stack.md` "stream or poll". | Research + Plan |
| Progress UX | Elapsed counter + time-based stages + skeletons | Visibly alive every second without SSE complexity. | Plan (owner) |
| LLM client | Plain `fetch` + zod, no SDK | Zero dependencies removes the unenv runtime-failure risk (E15). | Research |
| Model | `gemini-3.1-flash-lite`, fallback `mistral-small-2603` | Cheap, ZDR + structured-output endpoints, ~70 tps ≈ 20 s for 20 cards; confirmed by a smoke test in Phase 2. | Research + Plan |
| Text limits | 500–20,000 chars (after trim) | Covers articles and short chapters; rejects one-liners; input cost is negligible. | Plan (owner) — closes PRD OQ-1 |
| Proposal count | Model decides, capped at 20 | Short text gets few cards, long text up to 20, within the ~20 s NFR. | Plan (owner) |
| Bad AI output | Drop invalid cards; zero valid → error | The user gets what is good; an empty result never poses as success. | Plan (owner) |
| Error code | New `generation_failed` (502) | Distinguishes "AI dependency failed, retry" from our own `server_error`. | Plan (owner) |
| Privacy | `provider.zdr` + `data_collection: deny` + `require_parameters`; log only metadata; no web storage | Implements "no trace in storage" across Worker, OpenRouter and browser. | Research |
| Workers Paid | Measure cpuTime on preview; subscribe before merge if > 6 ms or any 1102 | Pay when the data says so. | Plan (owner) |

## Scope

**In scope:**
- the `/generate` page and island
- `POST /api/proposals`
- the generation service and schemas
- the `generation_failed` code
- the `OPENROUTER_API_KEY` secret and config banner
- preview verification and release

**Out of scope:**
- saving, editing or rejecting proposals, and any DB write (S-03)
- streaming or SSE
- job queues
- AI Gateway
- abort-on-disconnect
- server-side retry
- LLM SDKs and tokenizers
- compatibility-flag changes

## Architecture / Approach

```
/generate (Astro page, protected)
  └─ GenerateProposals island ── POST /api/proposals {text}
        (progress timer, skeletons)     │ auth → key → size → JSON → zod
                                        └─ generateProposals(): fetch OpenRouter
                                             strict JSON schema + ZDR, 60 s abort
                                             → parse → createFlashcardSchema per card
                                             → drop invalid, cap 20 → {proposals}
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contract & service | Schemas, DTOs, `generation_failed`, secret, OpenRouter service + tests | Tests that stub `fetch` without asserting the request (vacuous) |
| 2. Endpoint | `POST /api/proposals` + branch tests; first real (billed) PL/EN call | Model quality in Polish, or latency, off target |
| 3. Page & island | `/generate`, progress UX, proposals list, error/retry | Progress UX feels fake or doesn't meet "<200 ms" |
| 4. Preview & release | Real run on the Worker, cpuTime → Paid decision, log check, merge | 1102 on Free; text leaking into logs |

**Prerequisites:**
- **Before Phase 2's first real call**, an OpenRouter account with credit: the owner creates the key and sets the credit limit, logging off and ZDR enforced.
- The owner's approval for `wrangler secret put` (Phase 4).

**Estimated effort:** ~3–4 sessions (Phases 1–2 one session each, Phase 3 one, Phase 4 short but needs the owner).

## Open Risks & Assumptions

- Model quality on Polish text is unproven until the Phase 2 smoke test. It may force a model swap, recorded as a deviation.
- The ~100–125 s CDN idle ceiling is assumed from docs and a staff answer. The 60 s timeout keeps well clear of it.
- Time-based stage messages are an approximation of progress. The owner accepted this over SSE.
- `wrangler secret put` redeploys current production code. It is harmless, but it is a production event.

## Success Criteria (Summary)

- A signed-in user pastes real Polish or English text on production and sees sensible proposals in about 20 s, with visible progress throughout.
- AI failures are recoverable (retry, text kept), and invalid input is caught before any AI call.
- No log, account setting or browser storage holds the pasted text.
