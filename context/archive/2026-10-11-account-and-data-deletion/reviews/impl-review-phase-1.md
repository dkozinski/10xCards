<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: S-06 Account and Data Deletion

- **Plan**: context/changes/account-and-data-deletion/plan.md
- **Scope**: Phase 1 of 4 (uncommitted working tree)
- **Date**: 2026-10-11
- **Verdict**: APPROVED (all observations fixed)
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Checks re-run 2026-10-11:
- pgTAP: `npx supabase test db` 153/153 PASS.
- Types: `npm run db:types` changes one line only.
- Lint: exit 0.
- Vitest: 292/292.
- Manual:
  - 1.5 mutation check: granting EXECUTE to anon made test 4 fail; revoking it restored 153/153. Confirmed by the owner.
  - 1.6 migration reviewed by the owner.

Additions beyond the plan, all benign:
- The revoke also covers `authenticated` before the re-grant. The net privileges are exactly what the plan specifies.
- `comment on function` documents the `false` return.
- A pgTAP case asserts that a second call returns `false`, which pins `return found`.

Environment note: the local `postgres` role is **not** a superuser (`rolsuper = f`, checked during planning). The test therefore proves the explicit DELETE grant, not superuser bypass. Production is checked read-only in Phase 4 step 1.

## Findings

### F1 — anon throws_ok does not pin the message

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/account_deletion.test.sql:87-91
- **Detail**: The assertion expects `42501` with any message. If anon regained EXECUTE, the function's own `42501 'no signed-in user'` would still satisfy it. `function_privs_are` (test 4) covers the grant, but this assertion cannot prove it on its own.
- **Fix**: Pin the message to `'permission denied for function delete_my_account'`.
- **Decision**: FIXED (pinned; mutation re-check now fails tests 4 and 7)

### F2 — the PUBLIC check misses a NULL ACL

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/account_deletion.test.sql:74-80
- **Detail**: `aclexplode(NULL)` returns no rows, and a NULL `proacl` means default privileges, which include PUBLIC EXECUTE. Today the ACL is never NULL, because there is an explicit grant.
- **Fix**: Use `aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))`.
- **Decision**: FIXED

### F3 — the deadlock note does not name F6

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261011133135_account_deletion.sql:17-20
- **Detail**: The lock-order explanation is accurate, but it has no pointer to the archived S-05 review finding F6 that the plan cites.
- **Fix**: Add "(S-05 impl review F6)" to the comment.
- **Decision**: FIXED
