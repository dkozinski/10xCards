# Edit and Delete Cards (S-04) — Plan Brief

> Full plan: `context/changes/edit-and-delete-cards/plan.md`
> Research: `context/changes/edit-and-delete-cards/research.md`

## What & Why

The user can fix the wording of a card already in their deck, or remove it for good, directly on `/deck`. This is roadmap S-04 (issue #11), PRD FR-010 and FR-011. It is small and self-contained, and needs no schema change.

## Starting Point

The database already lets the owner update and delete their own cards (grants plus RLS from F-01). The app has no update or delete code, no dynamic API route, and `/deck` renders cards as static markup.

## Desired End State

Every card on `/deck` has Edit and Delete:

- **Edit** swaps the card for two inline editors with Save/Cancel.
- **Delete** asks for confirmation on the same card.
- Success reloads the page.
- `PATCH` and `DELETE` on `/api/flashcards/:id` answer 404 for a card that is missing or not yours.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| `source` after editing a saved card | Unchanged | It records where the card came from; Q-3 covered edits before save only, and the update path stays front/back only. | Plan |
| Missing or foreign card | New `not_found` (404) in the closed vocabulary | Correct semantics; one answer for both cases leaks nothing about other users' ids. | Plan |
| `updated_at` column | Not now | Nothing reads it in S-04; skipping it keeps the release migration-free. | Plan |
| Edit/delete UX | Inline editors + two-step delete button | Reuses the ProposalReview pattern, needs no new dependency. | Plan |
| PATCH semantics | Full replacement of front + back, `createFlashcardSchema` | Matches the edit form, and the shared schema strips unknown keys. | Plan |
| Malformed id | `not_found`, validated before Postgres | A non-UUID would otherwise surface as `server_error`. | Plan |
| Authorization | RLS only; 0 rows → `not_found` | The single-owner-module convention from F-01. | Research |

## Scope

**In scope:**
- `not_found` code (in code and in AGENTS.md)
- service `updateFlashcard` / `deleteFlashcard`
- `api/flashcards/[id].ts` with `PATCH` and `DELETE`
- `DeckCard` island
- Vitest and pgTAP tests
- release

**Out of scope:**
- relabelling `source`
- `updated_at`
- partial PATCH
- undo or soft delete
- dialog dependency
- grade history (S-05)
- hardening the old `POST /api/flashcards`

## Architecture / Approach

```
DeckCard (React island, per card)
  -> PATCH/DELETE /api/flashcards/[id]
     (auth -> uuid -> readBody/zod -> service)
  -> flashcards service
     (request client, RLS; 0 rows = not found)
  -> on success: reload /deck (server render stays the source of truth)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | `not_found`, service pair, `[id]` route, Vitest + pgTAP | First dynamic route; 0-row detection must use `maybeSingle` / a returned id |
| 2. UI | Per-card edit and two-step delete on `/deck` | Page-reload UX; unsaved-edit guard |
| 3. Release | PR `Closes #11` → merge → production smoke check | None structural (no migration) |

**Prerequisites:** local Supabase stack for pgTAP and manual tests (`.dev.vars` swapped to local with backup).
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- A body-less `DELETE` is assumed to be protected from cross-site requests by the CORS preflight (non-simple method) plus SameSite=Lax cookies. Verify during Phase 1 manual testing or review.
- Deleting a card that S-05 will later reference is safe today because no other table references cards. S-05 must query live rows.

## Success Criteria (Summary)

- The user edits and deletes cards on `/deck`, and the changes survive a reload and other devices.
- Nobody can edit or delete another user's card, and the API answers 404 without revealing whether the id exists.
- An edit never changes `source` or the recorded generation metrics.
