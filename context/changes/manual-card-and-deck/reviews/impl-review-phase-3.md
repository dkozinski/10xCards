<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Card and Deck (S-01)

- **Plan**: context/changes/manual-card-and-deck/plan.md
- **Scope**: Phase 3 of 3 (uncommitted working tree)
- **Date**: 2026-09-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

### Checks run

- **Automated:**
  - `npm test` passes, 48/48.
  - `npm run lint` exits 0.
  - `npm run build` exits 0.
- **Manual 3.4–3.9, verified on the local stack:**
  - A signed-out user is redirected.
  - A new card appears on top of the list.
  - 51 cards produce 2 pages, and `?page=99` redirects to `?page=2`.
  - A second account sees nothing.
  - Cards survive sign-out and a fresh cookie jar.
  - The owner confirmed in a browser that field errors keep the typed text.
- **3.10** (production smoke check) is pending until after merge.

### Drift

- Every planned item matches.
- **Deliberate deviations, all benign:**
  - `no-misused-promises` is turned off for `.astro` only. The rule crashes on a top-level `return Astro.redirect()`, and no `.astro` file uses async handlers.
  - The island uses its own pending state instead of `SubmitButton`, because `useFormStatus` cannot see a `fetch` submit.
  - The page relies on the PGRST103 fallback.
- **Extras, also benign:**
  - A load-error banner.
  - A dedicated message for an expired session.
- No redirect loop is possible, because the target is always `lastPage` and page 1 never redirects.

### Security, verified clean

- **XSS:** card text is auto-escaped in both Astro and React, and the codebase contains no `set:html` or `dangerouslySetInnerHTML`.
- **Open redirect:** the redirect target is built from an integer only.
- **Access-check bypass:** encoded or case-variant paths cannot get around the check. Astro decodes the URL before middleware runs, and routes are case-sensitive.
- **Caching:** `Cache-Control: private, no-store` is applied to the page and to its redirects.

## Findings

### F1 — An error body without `error` shows "Network error"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/deck/NewFlashcardForm.tsx (error handling after `fetch`)
- **Detail**: If a JSON response has no `error` key, for example from a proxy, `body?.error.code` throws a TypeError. The `catch` then shows the network-error message, which is misleading. Non-JSON bodies are already handled correctly: they parse to `null` and show the generic message.
- **Fix**: Type the body as `Partial<ApiErrorBody> | null` and read `body?.error?.code`.
- **Decision**: FIXED

### F2 — The counter counts untrimmed length

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/deck/NewFlashcardForm.tsx (`CardField` counter)
- **Detail**: The schema trims before measuring, but the counter shows the raw `value.length`. Padded input can show a red "203/200" and still save.
- **Fix**: Show `value.trim().length`.
- **Decision**: FIXED

### F3 — `PROTECTED_ROUTES` prefix match catches sibling paths

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:18
- **Detail**: `startsWith("/deck")` also gates `/decks`, `/deck-share` and similar paths. The same applies to `/dashboard…`, so the behaviour predates this phase. It is harmless today because those paths return 404. A future public route under such a name would be auth-gated without anyone noticing.
- **Fix**: Match `path === route || path.startsWith(route + "/")`.
- **Decision**: FIXED

### F4 — The expired-session message has no sign-in link

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/deck/NewFlashcardForm.tsx (`unauthorized` branch)
- **Detail**: The message tells the user to sign in again but offers no link. `ServerError` renders plain text only.
- **Fix**: Skip it. The Topbar already shows "Sign in" after a reload. Alternatively, render a link under the error.
- **Decision**: SKIPPED (Topbar shows Sign in after reload)

### F5 — `ServerError` is not announced to screen readers

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/auth/ServerError.tsx
- **Detail**: The shared component has no `role="alert"`, so an error that appears after submit is silent to assistive technology. This predates the phase and also affects the sign-in and sign-up forms.
- **Fix**: Add `role="alert"` to the `<p>`.
- **Decision**: FIXED
