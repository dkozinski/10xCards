<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Card and Deck (S-01)

- **Plan**: context/changes/manual-card-and-deck/plan.md
- **Scope**: Phase 1 of 3 (uncommitted working tree)
- **Date**: 2026-09-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated: `npm test` passes (29/29), `npm run lint` exits 0, `npm run build` exits 0. Manual 1.6 (CI on the PR) is still pending, because the branch has not been pushed yet.
Drift: every planned item MATCHES. The `vitest.config.ts` fallback away from `getViteConfig()` is the one named in the plan's Critical Implementation Details.

## Findings

### F1 — `parsePage` accepts unbounded page numbers

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/pagination.ts:4-7
- **Detail**: This was verified with Node. `parsePage("99999999999999999999")` returns `1e20`, which gives `from = to = 5e+21`. supabase-js would send `offset=5e+21`, and PostgREST rejects that, so the user gets a 500 instead of the planned redirect to the last page. `"9007199254740993"` gives a 65-row window because of float precision. Phase 3 reads the count and the rows in one query, so the error fires before any clamp to `lastPage` can run.
- **Fix**: Return 1 unless `Number.isSafeInteger(page)`, cap at a `MAX_PAGE` (for example 100 000), and add tests for both inputs.
- **Decision**: FIXED

### F2 — Schema accepts strings Postgres `text` cannot store

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/validation/flashcard.ts:11-12
- **Detail**: This was verified with Node. `"a\u0000b"` (NUL) and a lone surrogate `"\ud800"` both pass the schema. Postgres rejects NUL in `text`, and PostgREST rejects unpaired surrogates, so a request the plan classifies as `validation_failed` (400) would surface as `server_error` (500).
- **Fix**: Add a refinement to both fields that rejects `\0` and requires `String.prototype.isWellFormed()`. It is available in Node 22 and in every browser the PRD targets. Add tests for both inputs.
- **Decision**: FIXED

### F3 — Schema comment overstates app/DB agreement

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/validation/flashcard.ts:3-4
- **Detail**: JS is **stricter** than the DB, and that direction is safe. JS `trim()` strips tabs, newlines and NBSP, while Postgres `btrim` strips only spaces. `.max()` counts UTF-16 units, while `char_length` counts code points, so 150 emoji are rejected although the DB would allow them. The comment says the two "agree on every input", which is not accurate, and the guarantee holds only if routes insert `parsed.data`.
- **Fix**: Reword the comment: every value the schema accepts, the DB accepts. The schema may reject some the DB would allow (emoji count double). Routes must insert the parsed output.
- **Decision**: FIXED

### F4 — Zero-width-only card passes both layers

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/validation/flashcard.ts:11-12
- **Detail**: `"​"` passes zod and the DB CHECK, which is consistent, but the card renders blank. This is an edge case that only deliberate input produces.
- **Fix**: Skip for the MVP, or extend the F2 refinement to require at least one visible character.
- **Decision**: FIXED

### F5 — `ValidationDetails.fieldErrors` hard-coded to front/back

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/api-errors.ts:14
- **Detail**: A module meant as the app-wide error vocabulary types its details for one resource. The next endpoint with other fields (S-02 source text) will have to edit this type.
- **Fix**: Type it as `Partial<Record<string, string[]>>`. The route still passes only `front`/`back`.
- **Decision**: FIXED
