<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-05 Review Session (FSRS)

- **Plan**: context/changes/srs-review-session/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-10-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated checks re-run 2026-10-11:
- `npm run lint` is clean.
- `npm test` passes 281/281.
- `npm run build` passes.
- `npm run preview` answers `/review` with 302 and `/api/reviews/next` with 401, with no `[unenv]` lines in the log.

## Findings

### F1 — validation_failed (stale `day_end`) is reported as "could not save" and can loop

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/review/ReviewSession.tsx:104, :150-151, :204-209
- **Detail**:
  - `POST /api/reviews` saves the grade first and then answers `400 validation_failed` (`fieldErrors.day_end`) when `day_end` is out of window (`src/pages/api/reviews/index.ts:75-77`). The island sends every code except `not_found`/`unauthorized` to the generic branch, so it shows "Could not save the grade. Check your connection and retry" for a grade that **was** saved.
  - The live region announces "Could not reach the server." for a 400 or a 500 as well.
  - Midnight falling during a request recovers through Retry, because `day_end` is recomputed for each attempt and Retry replays the saved grade.
  - A device clock skewed beyond the window (behind the server by more than the time left until local midnight, or more than 48 h ahead) recomputes the same bad `day_end` on every Retry. The result is an endless Retry loop that blames the network.
  - GET `/next` behaves the same on the first load.
  - The plan addendum says "the island recomputes `day_end` and retries". The behaviour matches that, but the retry is manual.
  - No data is lost.
- **Fix A ⭐ Recommended**: Branch on `code === "validation_failed"` with a clock-specific message, and word the other failures by kind.
  - Message for `validation_failed`: "Your device clock looks wrong — check the date and time, then retry". Keep Retry.
  - Network or timeout (no code): "Check your connection".
  - `server_error`: "Something went wrong on our side".
  - Make the live-region text follow the same split.
  - Strength: The message matches what happened. The skewed clock is the only input the user can fix, and this names it. `validation_failed` is the only code the island can trigger on its own, because it builds every other field itself.
  - Tradeoff: Three message variants in the island. Still no automatic retry: with a skewed clock it would loop silently.
  - Confidence: HIGH — the route's ordering of save then bound check is fixed by the Phase 2 addendum (F1).
  - Blind spot: The clock-skew path cannot be reproduced without changing the system clock, so it would ship tested only by reading the code.
- **Fix B**: Leave the code as is and reword the plan addendum to "the user retries manually".
  - Strength: No code change. Midnight already recovers.
  - Tradeoff: A user with a skewed clock is stuck with a false "could not save" message.
  - Confidence: MED — the case is rare. When it happens, though, the user cannot get out of it.
  - Blind spot: How often real devices drift far enough to hit it.
- **Decision**: FIXED (Fix A) — `causeOf()` + `failureMessage()` in ReviewSession.tsx; ServerError and the live region share the per-cause text

### F2 — A 2xx body of the wrong shape is trusted and can end the session falsely

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/review/ReviewSession.tsx:40, :79-94
- **Detail**:
  - `call()` casts any 2xx JSON to `NextReviewResponseDto` without checking it. A proxy or platform page answering 200 with `{}` would take the island to `nothingDue` (or to `batchDone` with an undefined `due_count`), and that end screen has no Retry.
  - A `card` without `front` or `back` would render an empty card that can still be graded.
  - The sibling island checks the shape first: `ProposalReview.tsx:160` accepts success only when `typeof body?.saved_count === "number"`.
- **Fix**: In `call()`, accept a 2xx only if `typeof due_count === "number"` and `card` is `null` or has string `id`, `front` and `back`. Anything else becomes `{ ok: false }`, which leads to Retry. That is safe for POST, because the retry replays.
- **Decision**: FIXED — `isNextReviewResponse()` in src/lib/review-session.ts (+11 unit cases); `call()` turns any other 2xx body into `{ ok: false }` → Retry

### F3 — Live region does not speak the not_found notice; focus is lost on end screens

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/review/ReviewSession.tsx:86, :146, :170-174, :187
- **Detail**: The plan says the `aria-live` region announces the new card and the save result, and that focus moves to "Show answer" or "Good". In the code:
  - The `not_found` notice is rendered outside the live region and is overwritten at once by "Next card: …", so it is never spoken.
  - A card that comes straight back (learn ahead) gets identical text, so it may not be announced again.
  - In `batchDone`, `nothingDue` and `expired`, the focused grade button unmounts and nothing takes focus. A keyboard user has to Tab from the Topbar to reach Continue.
  - This is the half of 3.11 the owner did not test (screen reader).
- **Fix**:
  - Announce `not_found` as "This card no longer exists. Next card: …".
  - Prefix the announcement with a running counter ("Card 3: …") so repeated text changes.
  - Focus the Continue button in `batchDone`, and the end-state message (`tabIndex={-1}`) in `nothingDue` and `expired`.
- **Decision**: FIXED — announcements carry a running counter ("Card N: …") and the not_found notice as a lead; focus moves to Continue (batchDone) or the end-screen message (`tabIndex={-1}`) in batchDone/nothingDue/expired. Screen-reader check still not run (3.11 note stands)

### F4 — countFlashcards re-implements the requireCount guard

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/flashcards.ts:21
- **Detail**: The same file already has `requireCount()` (:84-86) for the null-count guard. `countFlashcards` writes the check again inline, with a different message.
- **Fix**: Replace the inline check with `return requireCount(count);`. The test asserts the substring "count missing", which still matches.
- **Decision**: FIXED — `countFlashcards` returns `requireCount(count)`

### F5 — The plan's `error` state is modelled as a `failed` overlay plus `expired`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/review/ReviewSession.tsx:23-33
- **Detail**:
  - The plan lists the states `loading → front → revealed → grading → front | batchDone | nothingDue | error`.
  - The code has no `error` phase. A retryable failure is a `failed` overlay on top of the current phase, which keeps the card on screen as the plan requires. `unauthorized` is a terminal `expired` phase.
  - The behaviour is equivalent to the plan's; only the names differ.
- **Fix**: Add a one-line note in the Phase 3 block of the plan. Leave the code unchanged.
- **Decision**: FIXED — Phase 3 addendum (2026-10-11) in plan.md documents the `failed` overlay + `expired`

### F6 — Benign additions beyond the plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/review-session.ts; src/lib/services/flashcards.ts:15-23; src/components/review/ReviewSession.tsx:185, :260-265
- **Detail**: Code not named in the plan:
  - `review-session.ts` (`nextLocalMidnight`, `REVIEW_BATCH_SIZE`) with unit tests;
  - `countFlashcards` with tests, which the page's head-count contract needs;
  - a "{N} due today" line;
  - in `batchDone`, Continue is hidden when `due_count` is 0 ("Done — nothing else is due today").

  None of them crosses the "What We're NOT Doing" list. The owner accepted the counter's semantics on 2026-10-10: learning cards that are not yet due are not counted.
- **Fix**: Mention them in the Phase 3 block note together with F5.
- **Decision**: FIXED — listed under "Beyond the contract" in the same Phase 3 addendum

### F7 — 3.11 is ticked with the screen-reader half untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/srs-review-session/plan.md (Phase 3 Manual, 3.11)
- **Detail**: The owner verified the keyboard. They chose not to test with a screen reader, and the plan's Phase 3 block records this. F3 shows that the untested half has real gaps. All other manual items (3.3–3.10, 3.12) were observed in this session and backed by local DB queries.
- **Fix**: None needed beyond F3. Re-run the screen-reader check once F3 is fixed, or carry the gap into Phase 4 as a known limitation.
- **Decision**: FIXED (re-test) — after F1–F3 the owner re-ran on the local stack (2026-10-11): outage + Retry shows the new "Check your connection" text and writes 1 log row; delete-on-screen gives the notice and no log row; Continue takes Enter with no Tab; focus lands on the "Nothing to review today" message. Screen reader still untested (3.11 note stands)
