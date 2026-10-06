<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Review and Save Proposals (S-03)

- **Plan**: context/changes/review-and-save-proposals/plan.md
- **Mode**: Deep
- **Date**: 2026-10-06
- **Verdict**: SOUND
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

10/10 paths ✓, 6/6 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (24/24 bullets).

Codebase verification confirmed:

- **Grants**: flashcards grants are table-wide, not per column. Inserting `source` needs no extra grant.
- **Column defaults and checks**: `user_id default auth.uid()`; the blank-text CHECK raises `23514`.
- **Navigation**: no `ClientRouter`, so `beforeunload` fires on Topbar links.
- **Validation**: `MAX_PROPOSALS` and `createFlashcardSchema` are where the plan expects them, and zod is v4.
- **Existing pgTAP suite**: unaffected by a defaulted `source` column.

## Findings

### F1 — Retry after a lost response can drop changes without telling the user

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 — Response handling
- **Detail**: The list stayed editable after a network error or timeout, and Try again resent the same `generation_id`. If the first attempt had committed, the retry is a replay that ignores the new payload. Any change made in between was silently dropped:
  - a card rejected after the error still lands in the deck;
  - "Discard all" clears a list whose cards were already saved.
- **Fix**: Freeze the list after an ambiguous failure, and resend the identical command. After the 200, branch on the sent command's `cards.length`.
  - Strength: The UI matches the idempotency key's one-payload guarantee; a single `frozen` flag.
  - Tradeoff: If the request never reached the server, the user cannot change anything until the retry finishes.
  - Confidence: HIGH — the function's replay branch makes the scenario deterministic.
  - Blind spot: None significant.
- **Decision**: FIXED — Phase 3 §2 "Frozen after an ambiguous failure", Critical Implementation Details, Phase 3 manual "Lost response".

### F2 — The function does not check the shape of p_cards elements

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 — function sketch
- **Detail**: Two inputs behave differently from what the pgTAP bounds tests might assume. Zod in the route catches both, so only direct RPC calls are affected.
  - A missing `front` key yields NULL, which raises `23502`, not `23514`.
  - The `btrim` CHECK strips only spaces, so a tab-only front passes the DB.
- **Fix**: State that the function's guarantees are the DB constraints and that content validation is zod's job. The pgTAP atomicity case uses an explicit blank string.
- **Decision**: FIXED — Phase 1 §1 function contract and §2 atomicity assertion.
