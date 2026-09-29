<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Proposals from Pasted Text (S-02)

- **Plan**: `context/changes/ai-proposals-from-text/plan.md`
- **Scope**: Phase 2 of 4 (uncommitted working tree on `feat/ai-proposals-from-text`)
- **Date**: 2026-09-29
- **Verdict**: NEEDS ATTENTION → APPROVED after triage (all 4 fixed; each new test verified to fail against a deliberate mutation: old text() read, removed size cap, logging the error object)
- **Findings**: 0 critical · 3 warnings · 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Success criteria were re-run for this review:
- `npm test`: 98/98
- `npm run lint`: exit 0, 0 warnings in `src`
- `npm run build`: exit 0
- Manual 2.4–2.8 were confirmed by the owner in-session, with measurements recorded in plan `## Deviations`.

Verified clean:
- CSRF: Astro 6.4.8's origin check blocks a cross-site `text/plain` POST before the route runs (`node_modules/astro/dist/core/app/middlewares.js:8-34`), so `request.text()` ignoring Content-Type is covered.
- Secrets: the key appears only in the Authorization header, and the missing-key check runs before the body is read.
- Logs: only numbers, `kind`, `status` and `error.name` are logged.
- workerd compatibility.
- CPU: well under 1 ms per request (measured).

## Findings

### F1 — Body read is unbounded and outside any try

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/proposals/index.ts:26-27
- **Detail**:
  - `await context.request.text()` buffers the whole body before the 128 KiB check. Workers accept up to 100 MB, so an authenticated user could force a ~200 MB UTF-16 string. That is over the 128 MB isolate limit and far beyond 10 ms of CPU, giving a 1102 or an isolate reset that also kills concurrent requests.
  - The read is also outside any try (the sibling reads inside one, `flashcards/index.ts:21-25`). A failing body stream (disconnect mid-upload) escapes as Astro's generic 500 instead of our `apiError` shape.
- **Fix**: read the body in a small helper that:
  - rejects early when `Content-Length` > 128 KiB
  - otherwise streams `request.body` with a reader, counts bytes and `cancel()`s once past the cap
  - decodes only then
  - runs inside a try that maps a stream failure to `invalid_json`

  Tests: a streamed oversize body that is also invalid JSON, and a body stream that errors.
  - Strength: bounds memory and CPU per request regardless of headers; matches the sibling's try-around-read.
  - Tradeoff: ~20 lines of stream handling instead of one `text()` call.
  - Confidence: HIGH — the Web Streams reader API is native to workerd.
  - Blind spot: the platform body limit on the Paid plan was not re-checked (it only raises the ceiling).
- **Decision**: FIXED

### F2 — Oversize-body test passes even with the size check deleted

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/proposals/index.test.ts:72-86
- **Detail**: The payload `{text: "x".repeat(200_000)}` is valid JSON over the 20,000 schema max, so schema validation alone returns the same 400 with `fieldErrors.text`. Deleting the byte check, or swapping branches 3 and 4, would not fail the test. Swapping branches 1 and 2 (auth vs missing key) is also untested.
- **Fix**:
  - Make the oversize body invalid JSON and assert `fieldErrors.text` is "Request body is too large" (not `invalid_json`), for both the with-header and without-header cases.
  - Add "no session and no key → 401".
- **Decision**: FIXED

### F3 — No-leak test cannot see `Error.message`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/proposals/index.test.ts:46-48, 141-155
- **Detail**: `loggedText()` serializes log arguments with `JSON.stringify`, which renders an Error as `{}`, because `message` is not enumerable. A regression such as `console.error("crashed", error)`, with the TypeError deliberately carrying the marker, would pass the test.
- **Fix**: serialize each logged argument with `util.inspect` (covers Error message and stack plus nested objects) before searching for the marker. Also assert the exact `server_error` log shape.
- **Decision**: FIXED

### F4 — The unexpected-error log carries `latencyMs`, but the plan said `{ name }` only

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/proposals/index.ts:66-68
- **Detail**: Harmless: latency is inside the plan's allowed-metadata list. But the plan and the code disagree, and the `astro.config.mjs` comment on `checkOrigin` names only `request.json()`, while the new route relies on it for `request.text()` as well.
- **Fix**: record the extra field in `## Deviations`, and mention `/api/proposals` and `request.text()` in the `checkOrigin` comment.
- **Decision**: FIXED
