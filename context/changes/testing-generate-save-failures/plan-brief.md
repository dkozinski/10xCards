# Generate and Save Screens Under Failure — Plan Brief

> Full plan: `context/changes/testing-generate-save-failures/plan.md`
> Research: `context/changes/testing-generate-save-failures/research.md`

## What & Why

This change is rollout Phase 1 of `context/foundation/test-plan.md`, for risks #1 (High × High) and #3. It proves that a bad AI response or a failed save never loses the pasted text, never locks the screen, never fakes a success and never saves a card twice.

Today the defences are deliberate but unproven at the screen level:

- server classification is tested only against fixtures shaped like its own parser;
- the save-side invariants were checked only by hand;
- there are no component tests at all.

## Starting Point

- The route, the service and the save RPC are sound. Research found four real gaps: G1 and G2 on the server, G3 and G4 on the client. G5 is an open product question.
- Found while planning: Astro builds all eight route tests under `src/pages/` as production routes, and Vitest is bundled into the Worker.

## Desired End State

- **The suite:** `npm test` runs the Node suites plus two jsdom suites, and the run is green.
- **Server:** one table at the HTTP boundary pins the answer for every documented OpenRouter response class.
- **Generate screen:** tests prove that the text stays, the action re-enables, a retry works without reload, and a second submit sends nothing.
- **Review screen:** tests prove that the save sends the approved set, in post-edit wording, with correct labels. They also cover the lock after an ambiguous failure and the unlock after a 400.
- **No routed tests:** no test file is routed, a guard test keeps it that way, and production returns 404 for the old test route.
- **Gaps:** they are visible, as executable pins where Vitest allows, and tracked as issues.

## Key Decisions Made

| Decision            | Choice                                                                           | Why (1 sentence)                                                                    | Source          |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------- |
| Partial list        | 200 with the valid subset; §2 wording backported                                 | The S-02 owner decision stands: zero valid cards → 502, never an empty success      | Research / Plan |
| Gaps G1–G4          | Pinned with tests and issues, fixed in Lesson 5                                  | Lesson boundary: bug → fix → regression is Lesson 5; this change stays test-only    | Plan            |
| G4 pin form         | `it.todo`, not `it.fails`                                                        | The bug is an unhandled rejection, and Vitest fails the whole run on it             | Plan            |
| G1 rule             | Denylist `length` + `content_filter`; a missing or unknown value passes          | A provider quirk must not turn into a total generation outage                       | Plan            |
| G5 (403 moderation) | Issue only, no test                                                              | The desired behaviour is a product decision still to make                           | Plan            |
| Server contract     | Real route + real service; only `fetch` stubbed; documented-shape fixtures       | The oracle is what the client sees, not an internal error kind                      | Plan            |
| Mutation check      | Stryker 10, narrow, local, after each test phase                                 | It measures vacuous tests, which is the main risk when characterizing existing code | Plan            |
| Route tests         | `_` prefix (Astro skips it), a guard test, an AGENTS.md rule                     | Stop shipping test code to production                                               | Plan            |
| jsdom version       | 29, not 30                                                                       | Workers Builds builds with Node from `.nvmrc` (22.14.0)                             | Research / Plan |
| Navigation in tests | `vi.stubGlobal("location", …)`                                                   | No production seam needed (Vitest 5 docs)                                           | Research / Plan |
| Edit semantics      | An open editor is saved as typed; whitespace-only edits and reverts save as `ai` | Already decided by the owner in the archive                                         | Research        |

## Scope

**In scope:**

- An HTTP-boundary table for `POST /api/proposals`, with OpenRouter fixtures built from the docs.
- Component tests for `GenerateProposals` and `ProposalReview`.
- Pins and issues for G1–G4, plus an issue for G5.
- `_`-prefixed route tests and a layout guard.
- Stryker setup and a triage report.
- test-plan §2, §4, §5, §6 and §8, and the `AGENTS.md` rule and commands.
- Release with production probes.

**Out of scope:**

- Fixing G1–G5.
- Any production code change in `src/lib` or `src/components`.
- A replay with a different payload, or a concurrent double submit (both rollout Phase 2).
- Content dedup across generations.
- Card quality (rollout Phase 4).
- Log assertions (rollout Phase 3).
- CI changes, e2e, and jsdom 30 or a higher `.nvmrc`.

## Architecture / Approach

```
OpenRouter (stubbed fetch, documented bodies)
   │
POST /api/proposals ── real route + real service ──► status + error.code table      (Node)
   │
GenerateProposals ──── stubbed fetch ──────────────► text / button / alert / retry   (jsdom)
   │
ProposalReview ─────── stubbed fetch + location ───► request body / locks / redirect (jsdom)
   │
POST /api/generations → save_generation RPC   (existing route tests + pgTAP; rollout Phase 2)
```

Expected values are literal data taken from the sources: OpenRouter docs, the PRD, and archived owner decisions. They are never computed with the code under test.

## Phases at a Glance

| Phase                                    | What it delivers                                                     | Key risk                                                   |
| ---------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Test layout, tooling and gap tracking | 8 renames, layout guard, AGENTS.md rule, Stryker smoke run, 5 issues | Stryker vs Vitest 5.0.2 (fallback: named manual mutations) |
| 2. Upstream contract at the API boundary | Documented-shape fixtures, a 21-row table, pins P1–P3                | Fixtures drifting from the docs                            |
| 3. Generate screen under failure         | jsdom harness, GS-1 to GS-7, pins G3/G4                              | jsdom traps; a pin leaking an unhandled error              |
| 4. Review and save under failure         | RV-1 to RV-8, the G4 review pin                                      | Freeze and index-mapping timing                            |
| 5. Cookbook and test-plan sync           | §2/§4/§5/§6/§8 and AGENTS.md commands                                | A §6 command that does not run as written                  |
| 6. Release                               | PR, CI, merge, production probes before and after                    | First deploy that changes the bundle layout                |

**Prerequisites:** research done; `gh` authenticated; the owner available to approve the issue texts and the production probes.

**Estimated effort:** about 6 sessions, one per phase. Phases 3 and 4 are the largest.

## Open Risks & Assumptions

- Stryker's vitest runner declares support for `vitest >= 2` but is unproven here on 5.0.2. The Phase 1 smoke run decides.
- The G3 pin may leak React's uncaught render error. If it does, it becomes `it.todo` like G4.
- G1 and G2 stay live in production until Lesson 5. Their likelihood is low to medium.
- The fixtures are only as realistic as OpenRouter's docs, fetched 2026-10-26.
- The pre-merge probe loads test code on the live Worker once and leaves one log line. Its status code is unknown; 500 is the most likely.

## Success Criteria (Summary)

- Tests show that a broken AI answer or a failed save never loses the text, never locks the screen, never fakes a success and never saves a card twice. The exception is the four pinned gaps, which are visible and tracked.
- Production no longer serves `/api/**/…test` routes.
- test-plan §6 tells the next rollout phase exactly how to add a route test or a component test.
