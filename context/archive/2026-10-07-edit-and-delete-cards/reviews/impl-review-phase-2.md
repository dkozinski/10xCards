<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edit and Delete Cards (S-04)

- **Plan**: context/changes/edit-and-delete-cards/plan.md
- **Scope**: Phase 2 of 3
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan adherence: all 15 planned items match. The two deviations (`position` prop, focus on mode change) were approved by the owner on 2026-10-08. Success criteria: `npm test` 166/166, lint clean, build complete; manual 2.2–2.9 confirmed by the owner, with `source = manual` checked in the local DB for the edited card.

## Findings

### F1 — Save/delete button stays stuck after "Stay" on another card's unload prompt

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/deck/DeckCard.tsx:65-70
- **Detail**: Each card has its own unsaved-changes guard, and `disarm()` only switches off the guard of the card that sent the request. Card A has unsaved edits; the user saves or deletes card B → `window.location.assign` fires A's guard and shows "Leave site?". If the user clicks "Stay", the reload is cancelled, but `send()` already returned without `setPending(null)`. B's buttons stay disabled with a spinner until a manual refresh. After a delete, B is still shown although it is already gone on the server.
- **Fix A ⭐ Recommended**: After `assign()`, re-enable after a delay: `setTimeout(() => setPending(null), 1000)`. If the navigation proceeds, the page is replaced and the timer is irrelevant.
  - Strength: 1–2 lines; recovers the card from a stuck state.
  - Tradeoff: on a slow reload (>1 s) the buttons come back briefly before the page changes; a second click gets a harmless 200 (PATCH) or 404 (DELETE).
  - Confidence: MED — browsers do not expose the "Stay" choice, so a timer is the only signal.
  - Blind spot: not tested across browsers.
- **Fix B**: Accept it and document it with a code comment.
  - Strength: no code change; it needs two cards edited at once plus "Stay".
  - Tradeoff: the stuck state stays possible.
  - Confidence: HIGH — a rare path.
  - Blind spot: none significant.
- **Decision**: FIXED (Fix A)

### F2 — Retrying a timed-out delete shows "no longer exists"

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/deck/DeckCard.tsx:77-78
- **Detail**: After a timeout the DELETE may already be committed. Retrying returns 404 and shows "This card no longer exists. Refresh the deck." right after the user asked to delete it.
- **Fix**: In delete mode, treat `not_found` like 204 (the goal is met) and reload.
- **Decision**: FIXED

### F3 — Keyboard focus lost when returning to view

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/deck/DeckCard.tsx:42-45
- **Detail**: After Cancel (edit or delete) the focused button disappears and focus falls to `<body>`; a keyboard user has to tab through the list again.
- **Fix**: Keep refs to Edit and Delete and focus the one that opened the mode when going back to `view` (not on the initial mount).
- **Decision**: FIXED

### F4 — Text fields stay editable during a save

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/deck/DeckCard.tsx:116-145
- **Detail**: Only the buttons are disabled while saving; text typed after Save is silently lost on reload.
- **Fix**: Add an optional `disabled` prop to `CardField` and pass `busy`.
- **Decision**: FIXED (read-only rather than disabled, so a focused field keeps focus)

### F5 — The whole card row is serialized into each island

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/deck.astro:78
- **Detail**: `card={card}` puts `user_id`, `source` and `created_at` into the HTML of all 50 islands. Not a leak (it is the viewer's own id) and not an XSS risk (Astro escapes props), but the island uses only `id`, `front` and `back`.
- **Fix**: Type the prop as `Pick<FlashcardDto, "id" | "front" | "back">` and pass only those fields.
- **Decision**: FIXED

### F6 — A `validation_failed` carrying only `_root` shows nothing

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/deck/DeckCard.tsx:75-76 (same in NewFlashcardForm.tsx:44)
- **Detail**: The route's `too_large` branch (`[id].ts:51-53`) answers `fieldErrors: { _root: [...] }`. `firstErrors` keeps only front/back, so no message is shown. It is practically unreachable from the UI: client validation caps the body far below 8 KB.
- **Fix**: When the mapped errors are empty, fall back to the generic message in `ServerError` (in both components).
- **Decision**: FIXED (both components)

## Triage outcome

All six findings fixed on 2026-10-08. After the fixes: `npm test` 166/166, lint clean, build complete. Owner re-ran a manual pass on the local stack, all passing: keyboard focus return after Cancel (edit and delete), read-only fields during a throttled save, plain save/delete, and NewFlashcardForm.
