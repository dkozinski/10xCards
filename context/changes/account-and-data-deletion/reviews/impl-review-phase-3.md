<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-06 Account and Data Deletion

- **Plan**: context/changes/account-and-data-deletion/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-10-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

All four planned items match the plan, with nothing missing or extra in intent. The account page, the island, `/account` in `PROTECTED_ROUTES` with the Topbar link, and the `?deleted=1` notice are all in place.

One deviation was documented to the owner during implementation: the live region does not repeat the server error, because `ServerError` already has `role="alert"`. This was judged sound, since `ServerError` remounts on each attempt and is therefore re-announced.

These were checked and are not findings:
- XSS: the email is escaped by both Astro and React.
- Email in island props: it is the viewer's own address, and the page is served with `no-store`.
- `/?deleted=1` spoofing: the notice is gated on there being no signed-in user, and it carries no action.
- Double submit: `pending` disables the button before a second click can land.

Automated checks were re-run during the review: `npm run lint` exits 0, `npm test` passes 311 of 311, and `npm run build` completes.

## Findings

### F1 — Network/timeout failure shows a message that can be false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/components/account/DeleteAccount.tsx:59-62
- **Detail**: When the request gets no response, the `catch` shows "Something went wrong on our side. Your account was not deleted." Both halves can be false:
  - Offline is not "our side".
  - After the 30 s timeout the delete may already have committed. The comment on the line above says so itself.

  The plan's "anything else" rule covers HTTP responses, so a separate message here does not break the contract. Siblings already split network failures from server failures: `DeckCard.tsx:108`, `NewFlashcardForm.tsx:54`, and `ReviewSession.tsx:43-55`.
- **Fix**: In the `catch`, show "Could not reach the server. Check your connection and try again." Keep `NOT_DELETED` for non-2xx responses. A retry stays safe: it answers 204, or 401 if the first delete committed.
- **Decision**: FIXED — the `catch` shows `UNREACHABLE` ("Could not reach the server. Check your connection and try again."); `NOT_DELETED` is kept for non-2xx responses.

### F2 — Keyboard focus is lost after a failed attempt

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/components/account/DeleteAccount.tsx:96
- **Detail**: `disabled={!matches || pending}` disables the focused button on submit. The browser then drops focus to `<body>`. After a `validation_failed` or server error, a keyboard or screen-reader user has to find the field and the button again. The manual keyboard run (3.7) covered the happy path only, not the error path.
- **Fix**: After a failure, move focus to the field on `validation_failed` and back to the button otherwise.
- **Decision**: FIXED — after a failure, focus returns to the field (`validation_failed`) or to the button, through `refocusRef` and an effect on `pending` (a ref, because `react-hooks/set-state-in-effect` rejects state here).

### F3 — `_root`-only validation error is shown under the email field

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/account/DeleteAccount.tsx:52-55
- **Detail**: The route returns `fieldErrors._root` for a body that is too large. The island then falls back to `CONFIRM_EMAIL_MESSAGE` under the field, whereas `DeckCard.tsx` treats an `_root`-only error as a server error. This cannot happen in practice: the button enables only on a matching email, which makes the body about 350 B against a 1024 B limit.
- **Fix**: Show the field error only when `fieldErrors.confirm_email` is present; otherwise show `NOT_DELETED`.
- **Decision**: FIXED — the field error is shown only when `fieldErrors.confirm_email` is present; anything else shows `NOT_DELETED`.

### F4 — Field error not linked to the input (inherited from FormField)

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/components/auth/FormField.tsx (used at DeleteAccount.tsx:76-89)
- **Detail**: `FormField` sets no `aria-invalid` or `aria-describedby`. The live region covers the moment the error appears, but not a later re-focus of the field. The same gap affects the sign-in and sign-up forms.
- **Fix**: Handle it in `FormField` as a separate follow-up, not in this slice.
- **Decision**: DEFERRED — queued in `follow-ups/review-fixes.md`.

### F5 — Screen-reader part of 3.7 not exercised; notice's `role="status"` is static

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: plan.md Progress 3.7; src/components/Welcome.astro:34-43
- **Detail**: Manual check 3.7 ("Keyboard and screen-reader run") was ticked after a keyboard-only run, with no screen reader. Separately, a `role="status"` region present in the server-rendered HTML is usually not announced on page load. It works as a visible notice, as the plan specifies, but the role adds little.
- **Fix**: Accept as is: keyboard-only evidence is recorded here, and the notice matches the plan.
- **Decision**: ACCEPTED — the keyboard-only run is recorded here; the notice follows the plan.
