<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-05 Review Session (FSRS)

- **Plan**: context/changes/srs-review-session/plan.md
- **Scope**: Phase 2 of 4 (uncommitted working tree on `feat/srs-review-session`, on top of c399748)
- **Date**: 2026-10-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence Summary

- Automated checks re-run during review: `npm test` 258/258, `npm run lint` clean, `npm run build` ok; `ts-fsrs` only in `dist/server/chunks/review_*.mjs`, absent from `dist/client`, chunk has no `node:` imports.
- Manual 2.6 (mutation check): executed by the agent (state-mapping swap → 4 failures, `not_found` branch removed → 2, edit payload widened → 2; all files restored and `cmp`-verified) and confirmed by the owner on 2026-10-10.
- Plan drift: every Phase 2 contract item MATCH; nothing MISSING. Declared deviations accepted: zod schemas in `src/lib/validation/review.ts`; `review_logs.due` keeps ts-fsrs semantics (owner decision, column comment added to the not-yet-pushed migration); `ReviewRating` (shipped in p1); query parsed with `Object.fromEntries` (repeated key keeps the last value, harmless). Plan item 5 is covered by the existing `flashcards.test.ts:86` (`toHaveBeenCalledWith` fails on any extra defined key).
- Security sweep: auth before any Supabase call; RLS scoping intact; no card text can reach logs (service selects only FSRS columns, fixed error messages); `day_end` only affects the caller's own queue; shared `fsrs()` instance is safe (synchronous `next()`, fuzz off). `tsc` reports one error in `src/lib/services/generations.test.ts:37` — pre-existing on `main`, unrelated.

## Findings

### F1 — A session that crosses local midnight cannot save grades

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/reviews/index.ts:55-62; plan.md:353
- **Detail**: POST validates `day_end` (must be after the server's now) before saving the grade, although `day_end` only feeds the next-card lookup. The Phase 3 contract computes `day_end` "on mount… recomputed when a fresh session starts", so once a session runs past local midnight every grade gets 400 `validation_failed` and is not saved. The same happens for X minutes each midnight when the client clock runs X minutes slow, even with a per-request `day_end`. This breaks the PRD promise "a grade is saved before the next card appears / never loses progress".
- **Fix A ⭐ Recommended**: Save first, bound `day_end` second — plus a per-request `day_end` in the Phase 3 contract
  - Strength: the grade is persisted whenever its own fields are valid; a stale `day_end` then yields 400 *after* the save, and the island's retry with a fresh `day_end` and the same `review_id` replays (nothing written twice) and gets the next card. Closes the clock-skew window too.
  - Tradeoff: POST validates in two steps (grade fields → save → `day_end`); a 400 can follow a successful write, which the plan addendum and the island must state.
  - Confidence: HIGH — rests on the replay guarantee already proven by pgTAP and the service tests.
  - Blind spot: the island's retry must reuse the `review_id` (already the plan's rule).
- **Fix B**: Plan-only — the island recomputes the next local midnight for every request
  - Strength: no server change; fixes the common midnight-crossing case.
  - Tradeoff: a slow client clock still loses grades for a few minutes around midnight; the save still depends on a field it does not use.
  - Confidence: MED — depends on client clocks.
  - Blind spot: real-world clock skew of users' devices.
- **Decision**: FIXED via Fix A — recordReviewSchema checks day_end shape only; route bounds it with dayEndInWindow after the save (400 after a successful write, replay-safe retry); plan line 353 now says per-request day_end, addendum bullet added; +4 route tests, validation tests reworked; mutant (guard moved before the save) fails 2 tests

### F2 — parseSrsState accepts inherited object keys

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/srs.ts:52
- **Detail**: `state in TO_FSRS` walks the prototype chain, so `"toString"`, `"constructor"` and `"__proto__"` pass as an `SrsState` (verified: `"toString" in {new: 1}` is `true`). Unreachable today because of the DB CHECK, but the function exists precisely to catch schema/code disagreement.
- **Fix**: Use `Object.hasOwn(TO_FSRS, state)` and add `"toString"` to the rejection test.
- **Decision**: FIXED — Object.hasOwn(TO_FSRS, state); rejection test covers mastered/toString/constructor/__proto__; reverting to `in` fails 3 tests

### F3 — Test gaps: the one-clock invariant and a few negative paths

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/reviews/index.test.ts; src/lib/services/reviews.test.ts
- **Detail**: With the clock frozen, a second `new Date()` in POST would go unnoticed, so "one clock for schedule, bound and lookup" is unpinned. Also missing: route-level `22023` from `record_review` → 500; `invalid_json` / oversized-body tests do not assert that Supabase was never called; no stored `due` with PostgREST's microsecond format (`…08:00:00.123456+00:00`).
- **Fix**: Advance the clock inside the mocked `record_review` and assert `p_reviewed_at === p_now`; add the 22023 → 500 route case; assert `from`/`rpc` not called on `invalid_json` and too-large bodies; use a microsecond timestamp in one service fixture.
- **Decision**: FIXED — one-clock test (clock moved inside the mocked record_review; a second new Date() for the lookup fails it); route 22023 → 500 without lookup; invalid_json and too-large assert no from/rpc; service fixture uses a microsecond timestamp and pins log.due. Tests 272/272

### F4 — logFailure is now copied in two routes and inlined in three

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/reviews/index.ts:15-21, src/pages/api/reviews/next.ts:40-42 (also flashcards/[id].ts:25, flashcards/index.ts, generations/index.ts)
- **Detail**: The "log only {code, message}" rule — a privacy guarantee — now lives in five hand-written copies. Consistent with the siblings, but a future copy that logs `details` would leak card text.
- **Fix**: Extract `src/lib/log-failure.ts` in a separate refactor change (touches S-01..S-04 routes, so not in this slice); for now keep the copies.
- **Decision**: FIXED (deferred) — queued as a separate refactor in follow-ups/review-fixes.md; no code change in this slice

## Not raised as findings (noted)

- **Retry after a grade was saved and the card then deleted** gives 404 instead of the next card. The plan's island rule ("not_found → message, then GET the next card") already handles it.
- **`22023` from `record_review` (reused or foreign review id) maps to 500.** A user-driven Retry with the same id would keep failing. This happens only on a client bug, and the plan addendum accepts it.
- **ts-fsrs throws `Invalid delta_t` → 500.** Requires clock skew across UTC midnight against a stored `last_review`. Rare, and it fails safe.
- **ts-fsrs patches `Date.prototype`** (`scheduler`, `diff`, `format`, `dueFormat`) globally in the isolate. Harmless.
