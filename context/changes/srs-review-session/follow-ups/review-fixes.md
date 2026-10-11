# Review follow-ups — srs-review-session

Items accepted during implementation review that belong outside this slice.

## Extract a shared `logFailure` helper (from impl-review-phase-2, F4)

- **Why:** the privacy rule "API routes log only `{code, message}`, never a PostgrestError's `details` (which can quote card text)" is hand-written in five places. A future copy that logs the whole error would leak card text to the Worker logs.
- **Where:** `src/pages/api/flashcards/[id].ts` (function), `src/pages/api/reviews/index.ts` (function), inline in `src/pages/api/flashcards/index.ts`, `src/pages/api/generations/index.ts`, `src/pages/api/reviews/next.ts`.
- **What:** one `src/lib/log-failure.ts` exporting `logFailure(operation, error)`, used by every route; one unit test that a `details` field never reaches `console.error`.
- **Scope:** a separate refactor change, because it touches S-01..S-04 routes; behaviour stays identical, and the existing route tests that assert `{code, message}` keep passing.
