<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Proposals from Pasted Text (S-02)

- **Plan**: context/changes/ai-proposals-from-text/plan.md
- **Scope**: Full plan (Phases 1–4), `32df951..318449e`
- **Date**: 2026-10-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

**Automated checks:** `npm test` 101/101, `npm run lint` clean, `npm run build` OK, `npx tsc --noEmit` clean, PR #22 checks green, `OPENROUTER_API_KEY` in the Worker secrets. All 27 Progress rows are `[x]` with a SHA, and the manual rows carry recorded evidence in `## Deviations` / measurements.

**What holds across phases:**
- Every planned file has a MATCH verdict, and every `## Deviations` entry is true in the code.
- Every FIXED finding from the phase 1–3 reviews is still present, except P3 F8 (see F3 below).
- The privacy contract holds end to end: request flags, fixed error messages, metadata-only logs (confirmed in production), React text rendering, no web storage.
- Timeouts are coherent: `max_tokens` ≈ 50 s, then 60 s service abort, then 75 s client, then ~100 s CDN.
- `z.toJSONSchema` runs once at module scope.
- Not raised: the upstream body is read without a byte cap (`generation.ts:150`). It is bounded in practice by `max_tokens`, a trusted upstream and the 60 s abort; reuse `readBody` there if it is ever made shared.

## Findings

### F1 — Permanent upstream misconfiguration is shown to users as a temporary failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/generation.ts:143-146; src/pages/api/proposals/index.ts:97-101
- **Detail**: Every non-2xx answer from OpenRouter becomes `upstream_http`, which the route returns as 502 `generation_failed`. The island then says "usually temporary — please try again". The cases at issue:
  - 400 (schema rejected, or a retired model id such as the dated `mistral-small-2603`)
  - 401/403 (revoked key)
  - 404

  These are our misconfiguration, which AGENTS.md maps to `server_error`. Users would retry forever, and the only trace is `status` in Workers Logs. The plan itself specified "non-2xx → `upstream_http`" (Phase 1 §5), so this is a plan gap, not drift. 402 (credit exhausted) as `generation_failed` was accepted in plan.md:64.
- **Fix A ⭐ Recommended**: Add a `GenerationError` kind `upstream_config` for upstream 400/401/403/404. The route maps it to `server_error` (500), which shows the island's non-retryable "Something went wrong" message. 408/429/5xx/402 and network failures stay `generation_failed`.
  - Strength: matches the AGENTS.md vocabulary ("`server_error` means our bug or misconfiguration"), and the status still shows up in the failure log line.
  - Tradeoff: a small change across service, route and both test files, shipped through a PR, so a production deploy.
  - Confidence: HIGH — the mapping is one branch in the service and one in the route.
  - Blind spot: whether OpenRouter ever answers 400 for a transient provider problem. If it does, that request would no longer offer a retry.
- **Fix B**: Keep the behaviour and record it in plan `## Deviations` as accepted.
  - Strength: no code change and no deploy.
  - Tradeoff: a revoked key or a retired model ID would fail silently from the user's side, with endless retries and only the log `status` as a signal.
  - Confidence: MED — this is fine while the owner watches the logs, and degrades once nobody does.
  - Blind spot: there is no alerting on Workers Logs.
- **Decision**: FIXED via Fix A — `upstream_config` kind for upstream 400/401/403/404, mapped by the route to `server_error` (500); tests added in both files (106 pass). Recorded in plan `## Deviations`.

### F2 — Island behaviour added in the phase 3 review is not recorded in plan Deviations

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/generate/GenerateProposals.tsx:35-37, 81-83, 105
- **Detail**: Plan Phase 3 §2 gives the retry button only to `generation_failed`. The code also offers it after a network error, a client timeout and a malformed 200, and adds a 75 s client timeout. All of this came from impl-review-phase-3 F1/F5 and is sound, but `## Deviations` (the plan's source of truth) does not mention it.
- **Fix**: Add one Deviations bullet: retry also on network error, client timeout and malformed 200, plus the 75 s `AbortSignal.timeout` (impl-review-phase-3 F1, F5).
- **Decision**: FIXED — Deviations bullet added under Phase 3 (retry cases + 75 s client timeout); F1's change recorded there too.

### F3 — `.dev.vars.bak` with live secrets is back, and nothing prevents it recurring

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .gitignore:55; .dev.vars.bak (repo root)
- **Detail**: The P3 F8 deletion no longer holds. The file was recreated 2026-10-01 22:40, presumably by another `.dev.vars` swap. `.gitignore` covers only `.dev.vars`, so any backup copy is one `git add -A` away from GitHub. Deleting the file again does not stop it recurring.
- **Fix**: In `.gitignore`, replace `.dev.vars` with `.dev.vars*` plus `!.dev.vars.example`. The owner then deletes the backup.
- **Decision**: FIXED — `.gitignore` now `.dev.vars*` + `!.dev.vars.example` (verified with `git check-ignore`); `.dev.vars.bak` deleted after confirming its key lines match `.dev.vars`.

### F4 — An `invalid_output` failure cannot be diagnosed from the logs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/generation.ts:14, 162-177; src/pages/api/proposals/index.ts:100
- **Detail**: A maximal valid answer (20 × (200+500) characters ≈ 14.5k characters of JSON, about 3.6k tokens in English and ~5k in Polish) can exceed `MAX_TOKENS = 3500`. It is then truncated and fails the whole request as `invalid_output`, which is accepted by design. The failure log carries only `{kind, status, latencyMs}`, so a truncation, a refusal and malformed JSON all look the same.
- **Fix**: Carry `finish_reason` and `completion_tokens` (both content-free) on `GenerationError` and add them to the failure log line. Then decide on `max_tokens` from real `length` counts.
- **Decision**: FIXED — `GenerationError.diagnostics` `{finishReason, completionTokens}` on `invalid_output`/`no_valid_cards`, finish_reason whitelisted to `^[a-z_]{1,32}$`, spread into the failure log; 3 tests (109 pass). Privacy-boundary extension recorded in plan `## Deviations`.

### F5 — Service tests do not assert that the service writes nothing to the console

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/generation.test.ts
- **Detail**: The no-leak property is pinned at the route, but the route test mocks the whole service. A future `console.*` added inside `generateProposals`, such as a debug log of `content`, would pass every test.
- **Fix**: In `beforeEach`, spy on `console.log/info/warn/error/debug`, and assert none was called in `afterEach`.
- **Decision**: FIXED — file-wide `beforeEach` console spies (log/info/warn/error/debug) with an `afterEach` assertion; verified non-vacuous (a planted `console.log` in the service failed all 31 service tests).

### F6 — Small boundary-test gaps

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/proposals/index.test.ts; src/lib/services/generation.test.ts
- **Detail**:
  - A body of exactly 131,072 bytes being accepted is not pinned (`>` vs `>=`).
  - "usage must never fail a good completion" is tested with `usage: null` but not with a malformed value (e.g. `{ cost: "0.1" }`).
  - The island has no component tests, which is consistent with the repo.
- **Fix**: Add the two unit cases.
- **Decision**: FIXED — boundary test (131,072 bytes passes the size check, 131,073 is "too large") and a malformed-usage success case; 112 tests pass.
