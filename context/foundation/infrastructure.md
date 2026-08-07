---
project: 10xCards
researched_at: 2026-08-07
recommended_platform: Cloudflare Workers
runner_up: Railway
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (SSR, output "server") + React 19 islands
  runtime: workerd (Cloudflare Workers) via @astrojs/cloudflare v13 for production; Node 22.14.0 for local
external_services:
  database_auth: Supabase (Postgres + @supabase/ssr cookie sessions)
  ai: OpenRouter
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare and Vercel tied at the top of the scoring matrix (10/10 each), so the
decision came down to constraints rather than criteria. Three broke the tie: the
developer has hands-on Cloudflare experience and none elsewhere; the repository is
already scaffolded on the current Workers path (`@astrojs/cloudflare` v13,
`main: "@astrojs/cloudflare/entrypoints/server"`, `nodejs_compat`,
`compatibility_date: 2026-05-08`); and Cloudflare acquired Astro on 2026-01-16, making
Astro 6 first-party on workerd — the release runs workerd at every stage, dev through
production. Against a 3-week after-hours budget, adopting a platform that is already
wired and already known is worth more than any remaining criterion-level difference.

Two things this decision explicitly does **not** rest on. Edge/CDN proximity is
irrelevant here — users are single-region (EU/Poland), so Cloudflare's global network
is not a benefit being purchased. And co-located managed services carry zero weight:
Supabase (database + auth) and OpenRouter (AI generation) are both external, so D1, KV,
R2 and Queues are not part of the value. The platform is being chosen to run one
Astro SSR application and nothing else.

The ~20-second OpenRouter generation call — the requirement that most constrains
platform choice — is the easiest fit on Workers of any platform evaluated: Cloudflare
does not count time spent awaiting `fetch()` as CPU time, and imposes no hard duration
limit on HTTP-triggered Workers. The call bills as a few milliseconds of CPU.

## Platform Comparison

Scored against the five criteria in `references/agent-friendly-criteria.md`
(Pass = 2, Partial = 1, Fail = 0). All research conducted 2026-08-07.

| Platform               | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total  |
| ---------------------- | --------- | ------------------ | ------------------- | ----------------- | ----------------- | ------ |
| **Cloudflare Workers** | Pass      | Pass               | Pass                | Pass              | Pass              | **10** |
| **Vercel**             | Pass      | Pass               | Pass                | Pass              | Pass              | **10** |
| **Render**             | Partial   | Pass               | Pass                | Partial           | Pass              | **8**  |
| Netlify                | Partial   | Pass               | Pass                | Partial           | Pass              | 8      |
| Fly.io                 | Pass      | Partial            | Partial             | Pass              | Partial           | 7      |
| Railway                | Partial   | Pass               | Pass                | Partial           | Partial           | 7      |

### Hard filters applied

No platform was eliminated. The two filters that could have applied did not:

- **Persistent connections** — not required (request/response only), so the
  serverless-only platforms (Netlify, Vercel) survive the filter.
- **Runtime compatibility** — all six run Astro 6 SSR, via `@astrojs/cloudflare` v13,
  `@astrojs/vercel` v10, `@astrojs/netlify` v7, or `@astrojs/node` on the three
  container platforms.

The ~20s OpenRouter call clears every platform's ceiling. Tightest is Netlify at 60s
(non-configurable, streaming included); most generous are Cloudflare (no limit) and
Fly.io (no limit, 60s idle-proxy window).

### Per-platform scoring notes

**Cloudflare Workers — 10.** _CLI-first (Pass):_ wrangler 4.x closes the full loop —
`deploy`, `rollback [VERSION_ID]`, `versions upload|deploy|list`, `deployments list`,
`tail`, `secret put|list|delete`. _Managed (Pass):_ no OS, no container, no process
supervision. _Docs (Pass):_ the strongest of the six — `llms.txt`, `llms-full.txt`,
per-page `/index.md`, `Accept: text/markdown`, and full source at
`github.com/cloudflare/cloudflare-docs`. _Deploy API (Pass):_ `wrangler deploy` is
deterministic and returns a version ID. _MCP (Pass):_ ~16 domain MCP servers plus an
official Claude Code plugin (`/plugin install cloudflare@cloudflare`) — the deepest
agent integration in the field.

**Vercel — 10.** Ties on every criterion. `vercel deploy --prod`, `vercel rollback`,
`vercel promote`, `vercel logs --follow`, `vercel env` cover operations; Vercel MCP is
GA with OAuth; docs serve markdown via `.md` suffix and `llms-full.txt` (no public docs
repo). Function budget is generous — 300s even on Hobby. What kept it second: Astro is
documented but second-class next to Next.js (the adapter is maintained by the Astro
team, not Vercel, and Vercel's own Astro page is stale — still showing
`@astrojs/vercel/serverless` and `output: 'hybrid'`); Hobby is non-commercial-use only,
so any monetization forces $20/seat/mo; and it is unfamiliar territory that would cost
an adapter migration inside a 3-week budget.

**Render — 8.** The sober fallback, and ranked third for exactly that reason: it is the
platform where the entire _class_ of workerd-compatibility bugs does not exist. Native
Node 24 runtime, no Dockerfile, `render.yaml` blueprints, Frankfurt region (matches the
EU-single-region constraint), and a 100-minute maximum request duration that makes the
20s call a non-issue. _CLI (Partial)_ and _deploy API (Partial)_: the CLI went GA in
Dec 2024 and covers `deploys create --wait`, `logs --tail`, `services`, `psql` — but
there is no rollback command (dashboard or REST API only) and `services update` cannot
edit env vars. Previews require the $25/mo Pro tier. Compute is $7/mo Starter (the free
tier spins down after 15 min with a ~1-minute cold start).

**Netlify — 8.** Official MCP server with a broad skill set, GA Astro adapter (v7 for
Astro 6), and solid docs (`llms.txt` + `.md` suffix; no `llms-full.txt`, no public docs
repo). Marked down twice: no rollback command in the CLI (dashboard, or
`netlify api restoreSiteDeploy`), and `netlify logs:function` was removed in CLI v25.
The 60-second non-configurable function limit is the tightest ceiling of any platform
here — a 20s call fits today, but leaves the least headroom if generation slows. The
credit-based pricing (since 2025-09-04) also makes the free tier unusable for this
project: at ~30 deploys/month, production deploys alone burn 450 of the 300 free
credits, so realistic entry is $9/mo.

**Fly.io — 7.** Genuinely strong on the two criteria that matter for long requests: no
duration limit, real persistent processes, and a fully scriptable CLI (`fly deploy`,
`fly logs`, `fly secrets set`, `fly scale`; rollback via `fly releases --image` then
`fly deploy --image <ref>`). Marked down on _Managed (Partial)_ — `fly launch`
generates a Dockerfile that you then own and maintain, and Fly does not regenerate it;
single-machine deployments take downtime during host maintenance, and the recommended
fix (≥2 machines) doubles compute. _Docs (Partial)_: `llms.txt` only — no
`llms-full.txt`, no per-page `.md`. _MCP (Partial)_: every `fly mcp` subcommand is
labeled `[experimental]`. No free tier; ~$3.19/mo for a 512 MB always-on machine.

**Railway — 7.** Best-in-class docs for agents (`llms.txt`, `llms-full.txt`, `.md` per
page) and a genuinely pleasant DX — Railpack autodetects Node with no Dockerfile, EU
region available (Amsterdam), PR environments are GA. Marked down on _CLI_ and _deploy
API (Partial)_: there is no `railway rollback`; `redeploy` only re-runs the latest
deployment, and rolling back to an older one is dashboard-only or a raw GraphQL call
via `railway api`. _MCP (Partial)_: the official server's own docs call it "a work in
progress" and advise avoiding production use. The decisive mark against it is not a
criterion at all — Railway published postmortems for at least five major incidents
between Nov 2025 and May 2026, including an ~8-hour platform-wide outage on 2026-05-19.
Its Railpack/Astro default also builds _static_ unless you explicitly switch to
`@astrojs/node` standalone, a documented 502 trap.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on the two things this project actually cannot buy elsewhere: existing developer
familiarity, and a scaffold that is already on the correct current path. Beyond the
tie-breakers, it is objectively the best fit for the ~20s AI generation call — awaiting
`fetch()` costs no CPU time and there is no HTTP duration cap — and it has the deepest
agent tooling of the six (16 MCP servers, official Claude Code plugin, docs published
as `llms-full.txt` and per-page markdown with source on GitHub). Astro being a
first-party Cloudflare property since January 2026 means the adapter is unlikely to lag.
Realistic cost: **$5/mo** (Workers Paid — see risk register; the free tier is not
viable for this app).

#### 2. Vercel

Scored identically and would be a defensible choice for a developer without the
Cloudflare background. Its concrete advantages over the recommendation are real: GA
per-PR preview deployments (Cloudflare's equivalent on the Workers path is private
beta), a 300-second function budget on the free tier, and no workerd-shaped
compatibility class of bug. The gap is situational rather than technical — unfamiliar
platform, an adapter migration to `@astrojs/vercel@^10` inside a 3-week budget, Astro
positioned behind Next.js, and a Hobby tier that forbids commercial use.

#### 3. Render

The escape hatch, and worth recording as one. If workerd compatibility becomes the
thing that eats the schedule — an unenv stub throwing at runtime, a dependency that
will not bundle, Sharp-shaped image needs — Render runs the same app on plain Node 24
with `@astrojs/node`, no Dockerfile, in Frankfurt, with a 100-minute request ceiling.
The gap versus the recommendation: no CLI rollback, previews gated behind the $25/mo
Pro tier, $7/mo compute versus $5/mo, and no existing familiarity. Its value here is as
a documented fallback with a known migration path, not as a contender.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The free tier is not viable for this application.** Workers Free caps CPU at
   **10 ms per invocation** (Error 1102). Server-rendering ~30 React 19 flashcard
   proposals plus `@supabase/ssr` cookie parsing will exceed that. The failure mode is
   what makes it dangerous: `astro dev` enforces no CPU meter, so it cannot reproduce
   locally, and it scales with payload size — meaning it surfaces on the proposals
   screen, which is the product's core value, under real user input.
2. **Preview deployments on the Workers path are private beta.** Cloudflare Pages had
   them GA, but `@astrojs/cloudflare` v13.0.0 **dropped Pages support outright**. The
   per-PR preview URL — the headline DX feature of this platform category, and GA on
   Vercel, Netlify and Railway — is not available as a first-class feature here.
   (Partial substitute exists: `wrangler versions upload` produces a version preview
   URL. See Operational Story.)
3. **Node compatibility fails at runtime, not at build time.** `nodejs_compat` covers a
   real subset natively, but unsupported APIs receive unenv polyfills that throw
   `[unenv] … not implemented yet!` **when executed**. A transitive dependency of an
   OpenRouter client or a spaced-repetition library that touches `child_process`,
   `worker_threads`, or `dgram` will build green, deploy green, and fail in production
   on the code path that reaches it.
4. **Astro Sessions auto-provision a KV binding, and KV is eventually consistent for up
   to 60 seconds cross-region.** The PRD guardrail states the review session "never
   loses progress and never shows the wrong flashcard," and the acceptance criteria
   require a grade to be saved before the next card appears. Session state in
   eventually-consistent KV is in direct tension with that requirement. This is the one
   risk that touches a product guardrail rather than an operational concern.
5. **Hard ceilings that do not exist on Node platforms.** 3 MiB gzipped bundle on Free
   / 10 MiB on Paid; 128 MB memory; 50 subrequests on Free (10,000 on Paid); Sharp does
   not run on workerd at all (default `imageService` is `cloudflare-binding`). None
   block the MVP as specified, but each forecloses a direction later.

### Pre-Mortem — How This Could Fail

The team ships on the free plan. Everything works locally, because `astro dev` runs
workerd without a CPU meter. The first real user pastes a 4,000-word article; the
proposals screen server-renders thirty cards and trips Error 1102. That one is cheap to
fix — upgrade to Paid — but it burned a week of confusion first, because it could not
be reproduced on the developer's machine. Then review sessions start misbehaving: a
card that was just graded reappears, or the queue serves a stale entry, because session
state lives in eventually-consistent KV. It is non-deterministic and regional, so it
reproduces locally approximately never. With no preview environment on the Workers path
(private beta), every diagnostic change is tested in production against real user
decks — and each failed attempt erodes trust in exactly the thing the PRD named
non-negotiable. Meanwhile an unenv stub in a transitive dependency of the SRS library
throws only on the code path that schedules the next review, so it stays hidden until
the second session. Six months in, the product works, but the guardrail that was
supposed to be non-negotiable has been quietly violated more than once, and every
debugging session opens with "is this our bug, or is this workerd?"

### Unknown Unknowns

- **Cloudflare acquired Astro on 2026-01-16, and the lock-in is already in the source
  tree.** `Astro.locals.runtime` was removed in adapter v13 in favor of
  `import { env } from 'cloudflare:workers'` — a workerd-only module specifier. Once
  that import is in application code, `astro build` against a Node target will not
  compile. Leaving Cloudflare is a refactor, not an adapter swap. The framework's
  roadmap is now steered by a hosting vendor.
- **Nearly every tutorial you will find is wrong for this version.** "Astro on
  Cloudflare Pages" is still the dominant search result and no longer applies —
  adapter v13 dropped that path. Any guidance mentioning `wrangler pages dev`,
  `wrangler pages deploy`, or `platformProxy` is stale for this repository.
- **`compatibility_date` is executable configuration, not metadata.** Bumping it
  changes runtime behavior. This repo's `2026-05-08` is safe, but a date below
  `2026-02-19` makes SSR-plus-middleware return a literal `[object Object]` — and this
  project has `src/middleware.ts` on every request. "Just update the compatibility
  date" is never a no-op here.
- **"100,000 requests/day free" does not mean what it appears to for this app.** Static
  asset requests are free and unlimited; Worker invocations are not. With
  `output: "server"`, every single page view is a billed invocation. There is no static
  tier to hide behind.
- **`wrangler deploy` shifts 100% of traffic immediately.** There is no default canary
  or gradual rollout; that requires the separate `wrangler versions upload` →
  `wrangler versions deploy` flow. The safety net is opt-in and easy not to know about.

## Operational Story

- **Preview deploys**: Per-PR preview deployments on the Workers path are **private
  beta (checked 2026-08-07)** — do not plan around them. The available substitute is
  version preview URLs: `npx wrangler versions upload` uploads a version **without**
  shifting production traffic and returns a preview URL of the form
  `<version-prefix>-10xcards.<subdomain>.workers.dev`. Promote with
  `npx wrangler versions deploy`. This works from CI on fork PRs only if the workflow
  has access to `CLOUDFLARE_API_TOKEN`, which GitHub withholds from fork PRs by
  default — so fork previews will not work without a `pull_request_target` workflow.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` live in Cloudflare's secret store via
  `npx wrangler secret put <NAME>` — write-only, not readable back through the CLI or
  dashboard once set. Local development reads them from `.dev.vars` (gitignored). CI
  needs three GitHub repository secrets: `SUPABASE_URL` and `SUPABASE_KEY` (already
  required for the build step per the existing workflow) plus `CLOUDFLARE_API_TOKEN`
  for deploys. Rotation is `wrangler secret put` again followed by a redeploy; the
  OpenRouter key follows the same path once added. Never place secrets in
  `wrangler.jsonc` `vars` — that file is committed.
- **Rollback**: `npx wrangler deployments list` to find the target version ID, then
  `npx wrangler rollback <VERSION_ID> --message "reason"`. Time-to-revert is seconds —
  it is a routing change, not a rebuild. **Caveat: this reverts code only.** Supabase
  migrations do not roll back with it, and secrets are not versioned, so a rollback
  across a schema change or a key rotation leaves the old code pointed at new state.
- **Approval**: A human decides — promoting a version to production
  (`wrangler versions deploy` / `wrangler deploy`), rotating or setting any secret,
  applying a Supabase migration, subscribing to or changing the billing plan, and
  anything touching the account-deletion path (FR-003). An agent may run unattended —
  `npm run lint`, `npm run build`, `npx wrangler versions upload` (preview only, no
  traffic shift), `npx wrangler deployments list`, `npx wrangler tail`, and any
  read-only MCP query.
- **Logs**: `npx wrangler tail --format json` streams live requests and exceptions;
  add `--status error` to filter. `observability.enabled` is already `true` in
  `wrangler.jsonc`, so invocation logs are also queryable after the fact via Workers
  Logs. For structured agent access, the Cloudflare observability MCP server
  (`https://observability.mcp.cloudflare.com/mcp`) exposes logs and analytics as typed
  tools rather than parsed CLI output; install the Claude Code plugin with
  `/plugin marketplace add cloudflare/skills` then `/plugin install cloudflare@cloudflare`.

## Risk Register

| Risk                                                                                                                        | Source                        | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free-tier 10 ms CPU cap trips Error 1102 on the proposals screen under real payloads                                        | Devil's advocate              | **H**      | **H**  | Subscribe to Workers Paid ($5/mo) before any real traffic. Treat the free tier as unusable for this app. Verify by rendering a 4,000-word input against a deployed Worker, not `astro dev` — the dev server enforces no CPU limit.                                                                                                    |
| Review-session state in eventually-consistent KV violates the "never loses progress / never shows the wrong card" guardrail | Devil's advocate / Pre-mortem | M          | **H**  | Persist all review state (grades, scheduling, queue position) in Supabase Postgres. Do **not** use Astro Sessions for anything the guardrail covers — the auto-provisioned `SESSION` KV binding is eventually consistent up to 60s and capped at 1,000 writes/day on Free. Write the grade transactionally before advancing the card. |
| unenv Node-compat stub throws `[unenv] … not implemented yet!` at runtime in a transitive dependency                        | Devil's advocate / Pre-mortem | M          | **H**  | Vet SRS and OpenRouter client libraries for workerd compatibility _before_ adopting them — prefer fetch-based, zero-Node-builtin packages. Exercise every new dependency against a deployed preview version (`wrangler versions upload`), never only against `astro dev`.                                                             |
| No GA per-PR preview environments on the Workers path (private beta) → changes tested in production                         | Devil's advocate / Pre-mortem | **H**      | M      | Use `wrangler versions upload` for a preview URL on every change before `wrangler versions deploy`. Wire it into CI on PRs. Accept that fork PRs get no preview (GitHub withholds secrets from fork workflows).                                                                                                                       |
| Rollback reverts code but not Supabase migrations or secrets                                                                | Research finding              | M          | **H**  | Keep migrations strictly additive and backward-compatible for one release (expand/contract). Never pair a destructive migration with a code deploy. Confirm a rollback target predates the last schema change before running `wrangler rollback`.                                                                                     |
| `wrangler deploy` shifts 100% of traffic with no canary                                                                     | Unknown unknowns              | M          | M      | Standardize on the two-step `wrangler versions upload` → `wrangler versions deploy` flow instead of bare `wrangler deploy`. Record it in `AGENTS.md` so agents do not reach for the one-shot command.                                                                                                                                 |
| Vendor lock-in via `cloudflare:workers` module specifier in application source                                              | Unknown unknowns              | M          | M      | Confine `import { env } from 'cloudflare:workers'` to a single module (`src/lib/env.ts` or the existing `src/lib/supabase.ts`) and import from there everywhere else. Keeps the Render fallback a one-file change rather than a codebase sweep.                                                                                       |
| Stale documentation: `wrangler pages dev` / `platformProxy` / Pages guides no longer apply to adapter v13                   | Unknown unknowns              | **H**      | L      | Local dev is `npm run dev` (`astro dev`) — workerd runs natively via the embedded `@cloudflare/vite-plugin`. This is already recorded in `AGENTS.md`; reject any suggestion to add a separate `wrangler dev` step.                                                                                                                    |
| Adapter pinned at 13.5.0 while 13.7.0 is available                                                                          | Research finding              | M          | L      | `npm i @astrojs/cloudflare@^13.7.0`. Stay on 13.x — **v14 requires Astro 7** and will break this project.                                                                                                                                                                                                                             |
| `astro:env` build-time `vars` resolution bug, fixed only in adapter 14.1.2 (never backported to v13)                        | Research finding              | **L**      | M      | Largely inapplicable here: both vars are declared `access: "secret"` (runtime-resolved) and `wrangler.jsonc` has no `vars` block. Preserve that — keep secrets out of `vars` and out of `envField` `access: "public"`.                                                                                                                |
| `compatibility_date` bump silently changes runtime behavior                                                                 | Unknown unknowns              | L          | M      | Current `2026-05-08` is safe (floor for SSR + middleware is `2026-02-19`). Treat any change to it as a code change: bump only deliberately, test on a preview version first.                                                                                                                                                          |
| Cloudflare-side outage or workerd regression with no contractual MVP-tier SLA                                               | Research finding              | L          | M      | Accepted for MVP scope. Render is the documented fallback: swap to `@astrojs/node`, deploy to Frankfurt. Keeping the `cloudflare:workers` import confined (above) is what keeps this a days-not-weeks migration.                                                                                                                      |
| Every page view is a billed Worker invocation (`output: "server"`) — no static tier                                         | Unknown unknowns              | L          | L      | Non-issue at PRD scale (medium users, low QPS): 10k–100k requests/month sits far inside the 10M included on Paid. Revisit only if traffic grows two orders of magnitude.                                                                                                                                                              |

## Getting Started

Commands validated against this repository's pinned versions (Astro 6.3.1,
`@astrojs/cloudflare` 13.5.0, wrangler 4.90.0) — **not** against general Cloudflare
documentation, most of which still describes the superseded Pages workflow.

1. **Rename the Worker.** `wrangler.jsonc` still carries the starter's identity:
   `"name": "10x-astro-starter"` → `"name": "10xcards"`. This becomes the production
   subdomain, so change it before the first deploy, not after.

2. **Authenticate and upgrade the adapter.**

   ```bash
   npx wrangler login
   npm i @astrojs/cloudflare@^13.7.0   # stay on 13.x — v14 requires Astro 7
   ```

3. **Develop locally with `npm run dev` — nothing else.** Since adapter v13 / Astro 6,
   `astro dev` runs on workerd natively through the embedded `@cloudflare/vite-plugin`.
   `wrangler dev`, `wrangler pages dev`, and `platformProxy` are all gone from this
   path; adding them is a regression, not a fidelity improvement. Local secrets go in
   `.dev.vars` (already gitignored).

4. **Set production secrets** (write-only once stored — keep your own copy):

   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```

5. **Subscribe to Workers Paid ($5/mo) before the first real user.** The 10 ms CPU cap
   on the free plan will fail the proposals screen with Error 1102, and it cannot be
   reproduced locally. This is the top entry in the risk register.

6. **Deploy via the two-step version flow**, not bare `wrangler deploy`:

   ```bash
   npm run build
   npx wrangler versions upload      # returns a preview URL — verify here first
   npx wrangler versions deploy      # promotes to production
   ```

   Confirm on the preview URL that `assets.directory: "./dist"` in `wrangler.jsonc`
   resolves your built client assets correctly before promoting — Astro's server build
   splits client output, and this is the first thing to check if CSS or islands 404.

7. **Verify and watch:**
   ```bash
   npx wrangler tail --format json
   npx wrangler deployments list     # note the version ID for rollback
   ```

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration and Dockerfile authoring
- CI/CD pipeline setup (the existing `.github/workflows/ci.yml` runs lint + build only;
  wiring the deploy step is downstream work)
- Production-scale architecture — multi-region, HA, disaster recovery, SLA commitments
- Supabase project sizing, region selection, and backup policy
- OpenRouter model selection, token budgeting, and cost controls
