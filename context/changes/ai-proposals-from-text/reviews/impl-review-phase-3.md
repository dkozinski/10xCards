<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Proposals from Pasted Text (S-02)

- **Plan**: context/changes/ai-proposals-from-text/plan.md
- **Scope**: Phase 3 of 4 (uncommitted working tree)
- **Date**: 2026-10-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated: `npm test` 101/101, `npm run lint` clean, `npm run build` OK, `npx tsc --noEmit` exit 0. `package.json`/lockfile unchanged (the `cn` package removal holds). Every Phase 3 contract item verified as MATCH. The three documented deviations (shadcn `cn` import, `aria-hidden` counter, hook extraction) are accurate. Manual items 3.4–3.8 confirmed by the owner in-session.

## Findings

### F1 — A malformed 200 response is reported as "no connection" or fails silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/GenerateProposals.tsx:68-70, 91-96
- **Detail**: Three cases go wrong:
  - **Non-JSON 200 body** (e.g. a proxy page): `response.json()` throws inside the same `try` as `fetch`, so the user sees "Brak połączenia…", which is wrong.
  - **200 with no `proposals`** (e.g. `{}`): `setProposals(undefined)` runs, and the page shows neither results nor an error.
  - **`proposals` not an array, or with `null` items**: the render throws. There is no error boundary, so the island unmounts and the pasted text is lost.
  - Also, the network-error message is `retryable: false`, although that is the most retry-worthy case.
- **Fix**: Catch only `fetch` as the network error, and make it retryable. Parse the 200 body with `.catch(() => null)` and require `Array.isArray(body?.proposals)`. Anything else shows the retryable generic message.
- **Decision**: FIXED — fetch-only try (network error now retryable); 200 body parsed with `.catch(() => null)` and accepted only with `Array.isArray(proposals)`, else generic message, retryable on a 200.

### F2 — Polish page with English validation messages and a mixed-language Topbar

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/generate/GenerateProposals.tsx:55, 76; src/components/Topbar.astro:13-15
- **Detail**: The plan sets Polish UI strings for this page (plan.md:303, 319), but the rest of the app is English.
  - The field error comes verbatim from the shared schema ("Text must be at least 500 characters") or from the server ("Request body is too large"). It appears in English directly under the Polish hint "Od 500 do 20 000 znaków."
  - The Topbar now reads "Generuj z AI | My deck | Sign out" on every page.
- **Fix A ⭐ Recommended**: Keep Polish as planned. Have the island show its own Polish text for the field error, keyed on the case (too short, too long, unprocessable) and not on the schema message. Record the language choice in `## Deviations`.
  - Strength: follows the approved plan. The schema and server stay untouched, so the API contract and the Phase 1/2 tests do not change.
  - Tradeoff: the island duplicates the length rules in its messages, and the Topbar stays mixed until the app picks one UI language.
  - Confidence: HIGH, because the change is local to one file.
  - Blind spot: whether the product is meant to be Polish or English overall is undecided (not in the PRD scope reviewed here).
- **Fix B**: Switch this page and the link to English, matching the existing UI.
  - Strength: one language across the app, and schema messages show as-is.
  - Tradeoff: overrides strings the plan explicitly approved, and it touches ~15 strings.
  - Confidence: MED, because it depends on the target audience.
  - Blind spot: the users' expected language.
- **Decision**: FIXED via Fix B — page, island and Topbar link switched to English; recorded in plan `## Deviations`.

### F3 — Polish page declared as `lang="en"`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/Layout.astro:14
- **Detail**: `<html lang="en">` is hard-coded, so screen readers read the Polish page with English pronunciation. The browser spellchecker and hyphenation also assume English.
- **Fix**: Add an optional `lang` prop to `Layout` (default `"en"`), and pass `lang="pl"` from `generate.astro`. This is moot if F2 goes with Fix B.
- **Decision**: DISMISSED — moot after F2 Fix B: the page is now English, so `lang="en"` is correct.

### F4 — The first stage and the result are never announced to screen readers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/GenerateProposals.tsx:185-188
- **Detail**:
  - The `aria-live` paragraph mounts together with its first text. Most screen readers only announce changes to a region that already exists, so "Czytam tekst…" is not spoken.
  - When results arrive, nothing is announced.
- **Fix**: Keep one always-mounted `sr-only` `aria-live="polite"` element. Put the stage text in it while pending, then "Wygenerowano N propozycji" on success.
- **Decision**: FIXED — always-mounted `sr-only` `aria-live="polite"` paragraph carries the stage while pending and "Generated N proposals" on success; the visible progress line is `aria-hidden`.

### F5 — No client-side timeout on the fetch

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/GenerateProposals.tsx:63-67
- **Detail**: The server gives up at 60 s and the CDN at ~100 s. If a connection hangs without closing, "Jeszcze chwila…" shows forever. (`AbortSignal.timeout` is fine in the browser; the workerd concern in the plan applied only to the server.)
- **Fix**: `signal: AbortSignal.timeout(75_000)` on the fetch. A `TimeoutError` maps to the retryable generation message.
- **Decision**: FIXED — `signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS)` (75 s); a `TimeoutError` shows the retryable generation-failed message, shared with the `generation_failed` branch as `GENERATION_FAILED`.

### F6 — The shadcn `aria-invalid:` classes override the island's red border

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/generate/GenerateProposals.tsx:132-137; src/components/ui/textarea.tsx:9
- **Detail**: In the error state, `aria-invalid:border-destructive` (a more specific selector) beats `border-red-400/60`. The border uses the theme's `--destructive` colour, not the `red-400/60` of `NewFlashcardForm`.
- **Fix**: Pass `aria-invalid:border-red-400/60 aria-invalid:ring-red-400` in the island's `className`.
- **Decision**: FIXED — error branch adds `aria-invalid:border-red-400/60 aria-invalid:ring-red-400`; verified `twMerge` drops the base `aria-invalid:*-destructive` classes.

### F7 — The browser may persist or ship the pasted text

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/generate/GenerateProposals.tsx:120
- **Detail**: Firefox session restore and back/forward form restoration can save textarea contents to disk. Chrome's enhanced spellcheck, when the user has it on, sends the text to Google. Both are outside the app's control but cut against the "no trace" NFR.
- **Fix**: Add `autoComplete="off"` and `spellCheck={false}` to the textarea.
- **Decision**: FIXED — `autoComplete="off"` and `spellCheck={false}` on the textarea.

### F8 — `.dev.vars.bak` with live secrets is untracked and not ignored

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .dev.vars.bak (repo root)
- **Detail**: The backup from manual test 3.7 holds the production Supabase key and the OpenRouter key. `.gitignore` covers only `.dev.vars`, so one `git add -A` would push them to GitHub. Its key lines are identical to `.dev.vars`, so nothing is lost by deleting it.
- **Fix**: Owner runs `rm .dev.vars.bak`.
- **Decision**: FIXED — `.dev.vars.bak` deleted (owner-approved); `.dev.vars` untouched.
