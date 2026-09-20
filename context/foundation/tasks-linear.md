# Management — Linear mirror of roadmap.md

> [!IMPORTANT]
> **`context/foundation/roadmap.md` is the source of truth.** Linear is a second **mirror**, parallel to the
> GitHub one described in `tasks-github.md`. Mapping, body formats and lifecycle rules are the same as there;
> this file records only what differs in Linear.

- **Workspace / team:** `dawid-kozinski` / `Dawid Kozinski` (prefix `DAW`)
- **Project:** [10xCards](https://linear.app/dawid-kozinski/project/10xcards-294d6999eac8)
- **Mirrors:** milestone M-1 of `roadmap.md` (roadmap `version: 1`, mirrored 2026-09-19 via Linear MCP)

## Mapping: GitHub → Linear

| GitHub | Linear |
| --- | --- |
| Repo `dkozinski/10xCards` | Project `10xCards` |
| Milestone `M-1: Paste-to-review loop` | Project milestone `M-1: Paste-to-review loop` |
| Issue `#N` | Issue `DAW-(N+4)` (DAW-1..4 are Linear onboarding issues, not ours) |
| Label `type:*` + `question` | Label group `type` → `foundation` / `slice` / `question` |
| Label `status:*` | Label group **`readiness`** → `ready` / `proposed` / `blocked` (`status` is a reserved name in Linear) |
| Label `stream:*` | Label group `stream` → `A-deck` / `B-ai` / `C-review` |
| Label `north-star` | Label `north-star` |
| Native "blocked by" | Linear **blocked by** relation (same 9 edges) |
| Non-blocking question link | Linear **related** relation + mention in the body |
| Issue open / closed | Workflow status (see below) |

> [!NOTE]
> A Linear label group allows **one child per issue**, so an issue cannot be `ready` and `blocked` at once —
> the closed vocabulary from `tasks-github.md` is enforced by the tool here, not just by convention.

**Workflow status** (Linear-only; GitHub has just open/closed):

- `Todo` — `readiness/ready` items (F-01, S-02) and the two blocking questions (Q-2, Q-3)
- `Backlog` — everything else
- `Done` — equivalent of a closed GitHub issue

## Issue inventory

| Linear | GitHub | Roadmap ID | Labels | Blocked by |
| --- | --- | --- | --- | --- |
| DAW-5 | #1 | Q-1 | `question` | — |
| DAW-6 | #2 | Q-2 | `question` | — |
| DAW-7 | #3 | Q-3 | `question` | — |
| DAW-8 | #4 | Q-4 | `question` | — |
| DAW-9 | #5 | Q-5 | `question` | — |
| DAW-10 | #6 | Q-6 | `question` | — |
| DAW-11 | #7 | F-01 | `foundation` `ready` `A-deck` | — |
| DAW-12 | #8 | S-02 | `slice` `ready` `B-ai` | — |
| DAW-13 | #9 | S-01 | `slice` `proposed` `A-deck` | DAW-11 |
| DAW-14 | #10 | S-03 | `slice` `blocked` `B-ai` `north-star` | DAW-13, DAW-12, DAW-6, DAW-7 |
| DAW-15 | #11 | S-04 | `slice` `proposed` `A-deck` | DAW-13 |
| DAW-16 | #12 | S-05 | `slice` `proposed` `C-review` | DAW-13 |
| DAW-17 | #13 | S-06 | `slice` `proposed` `C-review` | DAW-13, DAW-16 |

Every Linear issue carries a link attachment back to its GitHub issue.

## Keeping two mirrors in sync

Nothing syncs automatically — not roadmap → mirrors, and not GitHub ↔ Linear. Each lifecycle event in
`tasks-github.md` has to be applied **in both** trackers by hand (label swap, close / move to `Done`,
recording a Decision on a question).

> [!WARNING]
> Linear turns every `DAW-N` mention in a description into a **related** relation. That is why some issues
> show "related" links to items they are only "parallel with". They are harmless noise; the **blocked by**
> relations are the ones that carry meaning.

## Undo

Everything lives in Linear and can be removed there: delete issues DAW-5..17, the project `10xCards`, and
the label groups `type` / `readiness` / `stream` plus `north-star`. The GitHub mirror and `roadmap.md` are
unaffected.
