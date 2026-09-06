---
project: 10xCards
change: deployment
planned_at: 2026-08-31
verified_at: 2026-08-31
status: planned
platform: Cloudflare Workers
worker_name: 10xcards
auto_deploy: Cloudflare Workers Builds (no GitHub Actions in the deploy path)
plan_language: en
---

# Cloudflare Workers — Integration & Deployment Plan

> **Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked
> 🚦 **GATE** = a human decides or runs the step; an agent must stop here.

## Context

`context/foundation/infrastructure.md` selected **Cloudflare Workers** as the MVP
platform, but nothing has ever been deployed. The repo still carries the starter's
identity, violates one of its own AGENTS.md hard rules, and has a signup flow that
cannot complete on any deployed origin. There is also live drift between the
Cloudflare/Supabase accounts and what `main` records.

The goal: one verified production deployment on `*.workers.dev`, a working auth
round-trip against the Frankfurt Supabase project, a rehearsed rollback, and
**auto-deploy on push to `main` handled entirely by Cloudflare Workers Builds** — no
GitHub Actions in the deploy path, no `CLOUDFLARE_API_TOKEN` stored in GitHub.

This file is the audit trail: what was supposed to happen, what actually happened, and
the dashboard-only settings no file in the repo can express.

## Verified starting state (2026-08-31, checked live)

| Fact | Value |
| --- | --- |
| Workers deployed | **None.** `deployments list --name 10xcards` → `10007`; `--name 10x-astro-starter` → `10007`. Both names checked. |
| Worker name in `wrangler.jsonc` | `10x-astro-starter` (starter default) |
| Cloudflare account | `d6b37cfd4e6eebd6767c201f8f5491b5`, OAuth as `dkozinsk@gmail.com`, **Workers Free** |
| wrangler / Node / npm | 4.118.0 / 22.14.0 / 10.9.2 |
| KV namespaces | exactly one — `736db4b78a574ebf912a5d6f02926b90` titled `SESSION`, orphaned |
| Supabase | `xjykknkrkmtcdqvyirtt` "10xcards", `eu-central-1` (Frankfurt), PG 17.6.1, ACTIVE_HEALTHY, **zero migrations** |
| `compatibility_date` | `2026-05-08` — safe (see E14) |
| `@astrojs/cloudflare` | range `^13.5.0`, lockfile **13.5.0**, `node_modules` **13.7.0** ← drift |
| `prerender = false` | **absent from all three API routes** — violates AGENTS.md |
| git | `main` @ `54cccbb`, **3 commits ahead of unpushed `origin/main`**; remote `dkozinski/10xCards`; no branch protection |
| `dist/` + `.wrangler/` | stale, from a deleted branch — see the landmine below |

**The stale-build landmine.** `.wrangler/deploy/config.json` redirects wrangler to
`dist/server/wrangler.json`, and that file says `"name": "10xcards"` — a name that
appears nowhere in `main`. Any wrangler command run from the repo root can therefore
target a different Worker than `wrangler.jsonc` names. Both names are confirmed empty
today, so nothing was silently shipped, but Phase 0 deletes the artifacts and every
command in this plan passes `--name` explicitly.

That same stale file is the empirical proof for the two adapter-injection traps: it
contains `kv_namespaces: [{binding:"SESSION", id:"736db4…"}]` **but**
`previews: {kv_namespaces: [{binding:"SESSION"}]}` — no id.

A deleted branch `chore/cloudflare-deploy` holds earlier work on this. It is
deliberately **not** reused; it stays recoverable at `c38da1c`. The orphaned KV
namespace and the `10xcards` name in the stale build are both its residue.

## Decisions taken

- **Workers Free** now. Paid ($5/mo) fires on **sustained `cpuTime` > 6 ms in Workers
  Logs, or the PR that adds the AI proposals route — whichever comes first.** Free retains
  only 24 h of Workers Logs, so "sustained" can never be judged over a longer window (E28).
- Auto-deploy = **Cloudflare Workers Builds**. GitHub holds no Cloudflare credential.
- Worker name **`10xcards`** — `infrastructure.md`, the stale build, the orphaned KV,
  and every downstream URL and Supabase glob already assume it.
- KV: **reuse and pin** `736db4…` rather than delete-and-recreate.
- Email confirmation stays **ON**; build the `/auth/confirm` route in this change.
- `*.workers.dev` only. No custom domain, no migrations.
- Start fresh from `main` — no cherry-picks from the deleted branch.

---

## Prerequisites — tooling and accounts (verified live 2026-08-31)

Everything here must be true **before Phase 0**. Nothing in this plan requires a global
install: `wrangler` and `supabase` are devDependencies and every command is `npx`-scoped.
✅ = confirmed on this machine today; ⬜ = still to do.

### P1 — Local toolchain

- ✅ Node `22.14.0`, npm `10.9.2` — matches `.nvmrc`. If `node -v` disagrees, `nvm use`.
- ✅ `npm ci` run 2026-08-31 — `node_modules` now matches `package-lock.json`, both at adapter
  **13.5.0** (was drifted to 13.7.0). That is the correct clean baseline; Phase 1 deliberately
  bumps it. Use **`npm ci`**, not `npm install`: only `ci` wipes `node_modules` and installs the
  lockfile exactly, and it never rewrites `package.json` / `package-lock.json`.
  `@emnapi/runtime` still reports as extraneous — an artefact of `sharp`'s optional native
  builds, harmless.
- ✅ `npx wrangler --version` → `4.118.0`; `npx supabase --version` → `2.111.0`.
- Wrangler `4.127.1` is available. **Updating is optional and not part of this change** — the
  adapter + wrangler pair is what generates the deployed config, so if you do update, re-run
  check 4 before deploying and treat any diff in the generated `wrangler.json` as a finding.

### P2 — Cloudflare CLI authentication

- ✅ `npx wrangler login` already done — OAuth as `dkozinsk@gmail.com`, account
  `d6b37cfd4e6eebd6767c201f8f5491b5`. Credentials live at
  `~/.config/.wrangler/config/default.toml`; never commit or paste them.
- ✅ Scopes present and sufficient: `workers (write)`, `workers_scripts (write)`,
  `workers_kv (write)`, `account (read)`.
- ✅ Verified 2026-08-31: `whoami` lists **exactly one** account, so wrangler will not stop to
  ask which one to use and the non-interactive steps cannot stall on it. Re-run
  `npx wrangler whoami` at the start of each session anyway — if a second account ever appears
  (a shared team account, an org invite), pin it for the session with
  `export CLOUDFLARE_ACCOUNT_ID=d6b37cfd4e6eebd6767c201f8f5491b5`.
- **Do not set `CLOUDFLARE_API_TOKEN` in this shell.** When both exist the env token silently
  wins over the OAuth session, and a token with narrower scopes fails mid-deploy with an
  authorization error that reads like a Cloudflare outage.
- **Token posture, deliberately.** This OAuth session is account-wide write across many
  products — acceptable here because a human runs every mutating command and the account holds
  one project. This plan creates **no API token at all**: Workers Builds authenticates through
  the GitHub App (Phase 6), so no Cloudflare credential is ever stored in GitHub. The scoped
  token posture (Workers-only, single project, no DNS, no billing) is what you move to the day
  an unattended agent or a CI runner does the deploying.

### P3 — Supabase project and keys

- ✅ Cloud project exists: `xjykknkrkmtcdqvyirtt` "10xcards", `eu-central-1` (Frankfurt),
  PG 17.6.1, `ACTIVE_HEALTHY`, zero migrations.
- ✅ Both values collected and **validated live** on 2026-08-31 — not merely present:
  - **URL** → `https://xjykknkrkmtcdqvyirtt.supabase.co` (ref matches this plan)
  - **Key** → type `sb_publishable_` ✅, and `curl -H "apikey: $KEY" $URL/auth/v1/settings`
    returned **`HTTP 200`** (check 13). This is the distinction E7 is about: the banner and
    `config-status.ts` only prove non-emptiness; the 200 proves the key actually authenticates
    against *this* project. A `sb_secret_` / `service_role` key would bypass RLS from the edge —
    harmless at zero tables, catastrophic the day the first one lands (E8).
  - Source page, for when the key needs rotating:
    https://supabase.com/dashboard/project/xjykknkrkmtcdqvyirtt/settings/api-keys
- These two values are consumed in exactly two places: `wrangler secret put` (Phase 4) and
  `.dev.vars` (P5). They are **not** needed for `npm run build`, and the CI workflow's build
  `env` is being removed in Phase 1 precisely because it never used them.
- ✅ Dashboard access to both 🚦 GATE pages confirmed (no CLI equivalent for either).
  Sidebar: **Authentication** → *Emails* / *URL Configuration*; in older layouts both sit
  under Authentication → **Configuration**. Direct links for this project:
  - Email templates (Phase 2) →
    https://supabase.com/dashboard/project/xjykknkrkmtcdqvyirtt/auth/templates
  - URL configuration (Phase 4) →
    https://supabase.com/dashboard/project/xjykknkrkmtcdqvyirtt/auth/url-configuration

### P4 — Supabase CLI (not needed for this deploy)

- `npx supabase login` and `npx supabase link` are required for **migrations**, and this change
  ships zero (E18). Skip both.
- Note the misleading state: `supabase/.temp/linked-project.json` exists and names the right
  project, but the CLI reads `.temp/project-ref`, which does **not** exist — so the project is
  *not* actually linked despite appearances. Confirmed today. Harmless now; fix it (together
  with `project_id = "10x-astro-starter"` in `config.toml`) before the first migration, which
  is already recorded in Out of scope.

### P5 — `.dev.vars` for the local workerd run

Phase 1's `wrangler dev` step needs `.dev.vars` at the repo root (gitignored, `.gitignore:55`).

- ✅ **`.dev.vars` exists and is correct** (verified 2026-08-31): both keys present, URL points
  at the **cloud** project with the matching ref, key is `sb_publishable_`, and
  `git check-ignore` confirms `.gitignore:55` covers it. `.dev.vars.example` is still missing —
  Phase 1 adds it as the committed template.
- Point `.dev.vars` at the **cloud** project, not a local stack. That step exists to prove
  the Worker bundle boots under workerd and to surface E15 (`[unenv] … not implemented yet!`,
  `Dynamic require of "stream"`); the cloud project is the closer parity and needs no Docker.
- `npx supabase start` (local stack) requires Docker and is **not** a prerequisite of this
  plan. If you use it anyway, remember Workers cannot reach `http://127.0.0.1:54321` — a local
  URL in a deployed secret is a silent, confusing failure.
- `wrangler dev` serves on `:8787`, an origin not in Supabase's Redirect URLs. That is fine:
  the smoke test only needs pages to render and the console to stay clean. A full auth
  round-trip belongs to Phase 4 against the real hostname.

### P6 — GitHub

- ✅ SSH remote reachable, push access confirmed: `git ls-remote --heads origin` succeeds;
  `main` is **3 commits ahead** of `origin/main` (E19).
- ✅ **`dkozinski/10xCards` is public** (verified 2026-08-31). Consequence, and it is not
  cosmetic: rulesets / branch protection are **free**, so the Phase 6 gate — *merging to `main`
  is the production promote* — is genuinely enforced rather than a convention. The fallback
  this plan used to hedge on (a local `pre-push` hook rejecting `main`) is **not needed**;
  drop it from consideration. GitHub also shows 17 commits on `main` against 20 locally,
  independently confirming the 3 unpushed commits (E19).
- `gh` is installed but **not authenticated** (`gh auth status` → not logged in). It is not
  required — pushes go over SSH — but `gh auth login` is the quickest way to check visibility
  and to set branch protection without clicking. Optional.
- ⬜ Phase 6 installs the Cloudflare GitHub App scoped to this one repo. The repo is personal,
  so you can approve the install yourself; under an org this would need an owner.

### P7 — Account limits to know before you hit them

- Cloudflare **Workers Free**: 10 ms CPU, 50 subrequests, 3 MB gzipped bundle, 100k req/day
  (E13), and 24 h of Workers Logs retention (E28).
- No `workers.dev` subdomain is registered on the account yet — which is why Phase 3 has an
  interactive prompt that a human must answer (E5).
- Supabase free tier sends roughly **2 confirmation emails per hour** (E24). Budget test
  addresses before smoke-testing signup, and don't read the rate limit as a broken deploy.

### Prerequisite verification (run as one block)

```bash
node -v && npm -v                                   # v22.14.0 / 10.9.2
npx wrangler --version && npx wrangler whoami       # 4.118.0, account d6b37cfd…
npx supabase --version                              # 2.111.0
git ls-remote --heads origin >/dev/null && echo "git ok"
test -f .dev.vars && echo ".dev.vars present" || echo ".dev.vars MISSING (P5)"
node -p "require('@astrojs/cloudflare/package.json').version"   # 13.5.0 == lockfile
KEY=$(grep '^SUPABASE_KEY=' .dev.vars | cut -d= -f2-)
curl -sS -o /dev/null -w 'supabase key -> HTTP %{http_code}\n' -H "apikey: $KEY" \
  https://xjykknkrkmtcdqvyirtt.supabase.co/auth/v1/settings   # 200
```

**Status 2026-08-31: all of P1–P7 pass.** Every line above was run and returned the expected
value. Nothing in the prerequisites blocks Phase 0 any more — the remaining work is Phase 1
code, not setup.

**Re-verified 2026-08-31 (second sweep).** The whole block was run again against live
Cloudflare, Supabase and GitHub state and every check still returns the expected value:
adapter `13.5.0` across `node_modules` / lockfile / `package.json`, `whoami` still a single
account with no `CLOUDFLARE_API_TOKEN` in the shell, check 13 still `HTTP 200`,
`mailer_autoconfirm` still `false` (so E9's premise holds), exactly one KV namespace, and
both Worker names still `10007`. The only value that moved is the unpushed-commit count:
**2 → 3**, because the plan file itself was committed as `54cccbb`. The stale-build landmine
(`dist/`, `.wrangler/`) is still present and still Phase 0's job.

The last two lines are the ones worth keeping: the adapter version guards against E11 (a
lockfile that builds a different version in the cloud than on your machine), and the `curl`
is the only check that distinguishes a *valid* key from a merely *present* one (E7).

---

## Phase 0 — Disarm and establish ground truth

No Cloudflare writes. Agent may run unattended.

- [ ] `git status` clean; note the 3 unpushed commits — **do not push yet**.
- [ ] `rm -rf dist .wrangler` — removes the redirect-config landmine (`astro build`
      empties `dist/` itself, so this is one-time hygiene, not a recurring step).
- [ ] Re-confirm nothing is deployed under **either** name (checks 1–2 below).
- [ ] `npx wrangler kv namespace list` — snapshot: exactly one namespace.
- [ ] `git switch -c chore/cloudflare-deploy` from `main` (@ `54cccbb`).
- [ ] Record the baseline table above with the commands that produced each row.
- [ ] `npm run lint && npm run build` — clean before anything changes.

---

## Phase 1 — Repo prep (local only)

Everything that must be true *before Cloudflare ever builds this repo*. One reviewable
diff, one commit.

### `wrangler.jsonc`

- [ ] `"name"`: `10x-astro-starter` → `"10xcards"`.
- [ ] Pin the SESSION namespace at the **top level**:
      `"kv_namespaces": [{ "binding": "SESSION", "id": "736db4b78a574ebf912a5d6f02926b90" }]`.
- [ ] **Mirror the pin into `previews`** —
      `"previews": { "kv_namespaces": [{ "binding": "SESSION", "id": "736db4…" }], "images": { "binding": "IMAGES" } }`.
      The adapter re-runs binding injection against this sub-config; a top-level pin
      alone leaves preview uploads auto-provisioning an untracked namespace (E3).
- [ ] Declare `"images": { "binding": "IMAGES" }` explicitly so the injection
      short-circuits and the binding is visible in the diff (E4).
- [ ] `not_found_handling`: `"404-page"` → `"none"`. With `output: "server"` the Worker
      owns unmatched paths; `404-page` starts hijacking them the day someone adds a
      prerendered `src/pages/404.astro` (E23).
- [ ] Set `"workers_dev": true` and `"preview_urls": true` explicitly — both currently
      ride on defaults, and Cloudflare made `preview_urls` opt-in in Sept 2025 (E5).
- [ ] Comment that `SESSION` exists only because the adapter injects it and **must not**
      hold review state — KV is eventually consistent up to 60 s, against the PRD guardrail.
- [ ] Leave `assets.directory: "./dist"` **alone** — the build discards it and writes
      `../client`. Changing it is a no-op that looks like a fix (E2).

### Dependencies

- [ ] `@astrojs/cloudflare` `^13.5.0` → `^13.7.0`, then `npm install` so
      **`package-lock.json` moves too**. Without it, Workers Builds' clean install
      builds against 13.5.0 — a version never tested here, and the adapter minor is
      exactly what controls the generated config this plan depends on (E11). Never widen
      to `^14` (peers on Astro 7).
- [ ] `npm audit fix` — **without `--force`**. The lockfile is already being rewritten by the
      bump above, so this rides along for free and clears `nanoid` and `undici` (both
      `fixAvailable: true`), taking the audit from 4 high to 2 with no major version change.
      Re-run check 5 afterwards to confirm the adapter is still 13.7.0.
- **What the remaining audit findings are, so nobody re-litigates them mid-deploy.**
  `npm audit` reports 9 (1 low, 4 moderate, 4 high). Most never reach workerd: `sharp`,
  `undici`, `miniflare`, `wrangler`, `esbuild` and `@cloudflare/vite-plugin` are build-time or
  local-runtime only — `sharp` cannot run on workerd at all, and the adapter defaults to
  `cloudflare-binding` rather than using it. The two that *do* reach production are `astro`
  (three XSS advisories: spread attribute names, `transition:*` directive values, View
  Transition animation properties) and `nanoid`. Practical exposure today is near zero — the
  deployed surface is auth forms that render no user-controlled content through any of those
  mechanisms — but that changes when the proposals screen renders user-pasted text. The fix is
  **Astro 7.2.9, a major**, dragging `@astrojs/cloudflare` v14 with it; that is a separate
  migration, deliberately **not** part of this change. Commit `ce8bf40` already cleared 18 of
  22 findings; these are the known hard residue.

### Application code — the minimum that makes a deployed app work

- [ ] `export const prerender = false;` in all three
      `src/pages/api/auth/{signin,signup,signout}.ts` — AGENTS.md hard rule, currently
      violated repo-wide.
- [ ] **New `src/pages/auth/confirm.ts`** (`export const prerender = false`): a `GET`
      route handling both flows —
      `?token_hash=&type=` → `supabase.auth.verifyOtp({ type, token_hash })`, and
      `?code=` → `supabase.auth.exchangeCodeForSession(code)`. Redirect to `next ?? "/"`
      on success, to `/auth/signin?error=…` on failure. This is what makes signup
      completable at all (E9); the same route serves password reset later.
- [ ] `src/pages/api/auth/signup.ts`: pass
      `{ options: { emailRedirectTo: <origin>/auth/confirm } }` to `signUp`, and branch
      on the returned session —
      `return context.redirect(data.session ? "/" : "/auth/confirm-email")`.
      Needed because `confirm-email.astro:4` keys its copy off `import.meta.env.DEV`, so
      production would otherwise tell an already-signed-in user to check their email (E22).
- [ ] **`Cache-Control: private, no-store` on every response that issues `Set-Cookie`** —
      `src/middleware.ts`, the three `src/pages/api/auth/*` routes, and the new
      `src/pages/auth/confirm.ts`. E25 only checks that the cookie is *present* on the 302;
      this makes sure the edge never holds a response carrying someone's session.
- [ ] `astro.config.mjs`: leave `site` unset for now — filled in Phase 6 once the
      hostname exists.

### Scripts & housekeeping

- [ ] `package.json` scripts, named for what they actually do:
      `"deploy:preview": "astro build && wrangler versions upload"`,
      `"deploy:promote": "wrangler versions deploy"`,
      `"deploy:rollback": "wrangler rollback"`.
      Deliberately **no bare `"deploy"`** — an unqualified name invites the one-shot
      100%-traffic command the risk register asks us to avoid.
- [ ] `.dev.vars.example` (committed — `.gitignore` matches `.dev.vars`, not
      `.dev.vars.example`).
- [ ] `.github/workflows/ci.yml`: drop the `SUPABASE_URL`/`SUPABASE_KEY` build `env`.
      They are inert — `access: "secret"` astro:env values resolve at runtime, not build,
      and both are `optional`. Keep `npm run build` and both triggers: CI is the only
      thing that can fail a change *before* merge, and Workers Builds does not read
      GitHub check status.
- [ ] `npm run lint` clean; rebuild; **assert the generated config** (check 4).
- [ ] **Local workerd run before Cloudflare ever sees this.** `cp .dev.vars.example .dev.vars`,
      fill it with the **cloud** project's URL and publishable key (P5 — not a local stack, and
      never a `127.0.0.1` URL), `npx wrangler dev`, then exercise `/`, `/auth/signin`,
      `/dashboard`. Watch the console for `[unenv] … not implemented yet!` and
      `Dynamic require of "stream"` — this is the cheapest place to hit E15, and the only one
      that costs nothing when it fails. `.dev.vars` is gitignored (`.gitignore:55`);
      `.dev.vars.example` is the committed template (check 21).

---

## Phase 2 — Supabase prep — 🚦 GATE (human, dashboard)

- [x] Project confirmed: `xjykknkrkmtcdqvyirtt`, `eu-central-1`. A London (`eu-west-2`)
      project was created by mistake earlier and deleted — do not recreate it.
- [x] Publishable key collected **and validated** (`HTTP 200`, P3). Nothing more to copy.
- [ ] **Change the "Confirm sign up" email template** at
      https://supabase.com/dashboard/project/xjykknkrkmtcdqvyirtt/auth/templates

      The current template is the Supabase default and links via `{{ .ConfirmationURL }}` —
      the exact variant that strands the user (E9). Replace the link with the token-hash form
      so it lands on the Phase 1 route, where `verifyOtp()` can exchange the token for a
      session **server-side**, which is the only place `@supabase/ssr` can write the cookie:

      ```html
      <h2>Confirm your email address</h2>
      <p>Follow the link below to confirm this email address and finish signing up.</p>
      <p>
        <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/">
          Confirm email address
        </a>
      </p>
      ```

      **Do this only after `/auth/confirm` exists (Phase 1)** — otherwise confirmation links
      point at a 404.
- [ ] Leave Site URL / Redirect URLs until Phase 4 — the hostname doesn't exist yet.
      **Known gap between here and Phase 4:** `{{ .SiteURL }}` resolves from URL Configuration,
      which still points at the Supabase default (`http://localhost:3000`). So a signup
      completed in that window produces a link to localhost. Harmless — there are no users —
      but don't mistake it for a broken template.

---

## Phase 3 — First production deploy — 🚦 GATE (human runs it)

The one deliberate exception to the two-step version flow.

- [ ] `npm run build`
- [ ] `npx wrangler deploy` — **bare `deploy`, once.** `versions upload` does not apply
      configuration changes (routes, the `workers.dev` subdomain, triggers); only
      `deploy` does, which is also why secrets cannot come first — `secret put` against a
      non-existent script returns `10007` (E5, E6).
- [ ] Answer the interactive subdomain-registration prompt if the account has no
      `workers.dev` subdomain. **Human only** — this cannot run non-interactively.
- [ ] Record `https://10xcards.<subdomain>.workers.dev` and the version ID here.

**The success criterion is a site that says it is not configured.** A 200 plus the
"nie jest skonfigurowany" banner is exactly right — secrets aren't set yet, and seeing
the banner proves the banner works.

- [ ] `/_astro/*` assets return 200, not 404.
- [ ] `/dashboard` 302s to `/auth/signin`.
- [ ] `npx wrangler tail --name 10xcards --format json` open during these clicks.

**Actuals** *(fill in)*: URL · version ID · date

---

## Phase 4 — Secrets + Supabase origin wiring — 🚦 GATE (human)

Setting a secret creates and deploys a new version by itself; no manual redeploy.

- [ ] `npx wrangler secret put SUPABASE_URL --name 10xcards` → `https://xjykknkrkmtcdqvyirtt.supabase.co`
- [ ] `npx wrangler secret put SUPABASE_KEY --name 10xcards` → the `sb_publishable_…` key
- [ ] `npx wrangler secret list --name 10xcards` → exactly two, `type: secret_text`.
      Values are write-only — keep your own copy.
- [ ] Supabase → Auth → URL Configuration:
      - **Site URL** = `https://10xcards.<subdomain>.workers.dev` (production, never a preview)
      - **Redirect URLs** — three entries, and the production one is **not** optional:
        `https://10xcards.<subdomain>.workers.dev/**`,
        `https://*-10xcards.<subdomain>.workers.dev/**`,
        `http://localhost:4321/**`.
        Supabase globs treat `.` and `/` as separators, so `*-10xcards…` matches version
        and alias previews but **never** the bare production host (E10).

**Presence is not validity (E7).** The banner disappearing only proves the vars are
non-empty; a wrong-project or expired key renders as "configured" and then fails inside
`getUser()`, and `/dashboard` still redirects to sign-in — identical to "not logged in".

- [ ] Check 13 (`/auth/v1/settings` → 200) proves the key.
- [ ] Banner gone on `/` — the load-bearing proof that `astro:env/server` secret
      resolution works on workerd, a path this repo has never exercised in production.
- [ ] Sign up → confirmation email → click → land **authenticated**.
- [ ] Sign in → `Set-Cookie` present **on the 302** (check 15).
- [ ] `/dashboard` renders; sign out clears cookies.
- [ ] `wrangler tail` clean; read `cpuTime` and record the baseline.

**Actuals** *(fill in)*: cpuTime baseline · email-confirmation posture · date

---

## Phase 5 — Preview + rollback drill

Agent may run `versions upload`; a human promotes and rolls back.

- [ ] `npm run build && npx wrangler versions upload --name 10xcards --preview-alias staging`
      → stable `https://staging-10xcards.<subdomain>.workers.dev` plus a per-version URL.
- [ ] Open the preview and sign in there — proves the `previews` KV pin took and that the
      Supabase wildcard covers preview origins.
- [ ] `npx wrangler kv namespace list` → **still exactly one**. This is the check that
      catches the previews-pin failure, and this upload is the first moment it can bite.
- [ ] `npx wrangler deployments list --name 10xcards` → production still on the old
      version; the upload shifted no traffic.
- [ ] 🚦 GATE — human: `npx wrangler versions deploy` to promote.
- [ ] 🚦 GATE — human: `npx wrangler rollback <PREVIOUS_ID> --message "rollback drill"`,
      confirm the site serves, roll forward.

**Carry-forward:** rollback reverts **code only** — not Supabase migrations, not secrets
(E17). Safe today at zero migrations; a footgun the moment the first one exists. Keep
migrations additive and backward-compatible for one release (expand/contract), and never
pair a destructive migration with a code deploy.

---

## Phase 6 — Auto-deploy via Workers Builds — 🚦 GATE (dashboard)

Deliberately **last**. Connecting the GitHub App means the next push to `main` deploys;
by now everything it would deploy is known-good and already live.

- [ ] `astro.config.mjs`: set `site: "https://10xcards.<subdomain>.workers.dev"` —
      `sitemap()` is a silent no-op without it. One line to change when a real domain arrives.
- [ ] Push the branch, open a PR, merge. Push all 3 stale local commits too — Workers
      Builds builds what GitHub has, not what your machine has (E19).
- [ ] Dashboard → Workers & Pages → `10xcards` → Settings → **Builds** → install the
      Cloudflare **GitHub App**, scoped to `dkozinski/10xCards` only.
- [ ] Git branch `main`; root `/`; build `npm run build`; deploy `npx wrangler deploy`;
      non-production branch `npx wrangler versions upload` (default — leave it, it is
      what gives every branch a free preview URL).
- [ ] **No build variables.** Both env fields are `access: "secret"` + `optional`, so
      nothing is needed at build time. Only if the build fails on Node: set
      `NODE_VERSION=22.23.2` (`.nvmrc` pins `22.14.0`; the image preinstalls 22.23.2 /
      24.18.0, default 24.18.0) (E12).
- [ ] **Expect a build to fire the moment the integration connects.** Workers Builds may queue
      one immediately against the current `main` HEAD, redeploying exactly the code Phase 3
      already shipped. That is the pipeline validating itself, not an unintended deploy — don't
      go looking for what triggered it.
- [ ] Push a throwaway branch → confirm a preview URL, production untouched, **and no new
      KV namespace**. While the log is open, confirm an install step ran against
      `package-lock.json`: Workers Builds normally installs before the build command, but a
      missing install is exactly how E11's lockfile drift comes back. If no install appears,
      change the build command to `npm ci && npm run build`.
- [ ] Push `main` → confirm auto-deploy.

### Resolving the approval conflict

`infrastructure.md` requires a human gate on "promote to production"; Workers Builds
deploys `main` automatically. The gate does not vanish — **it moves upstream to the
merge.**

- [ ] Enable GitHub branch protection on `main`: PR required, no direct pushes, `ci`
      required. None exists today, and until it does the gate is convention, not
      enforcement. *Rulesets are free on public repos; private repos need a paid plan —
      verify this repo's visibility. If unavailable, fall back to a local `pre-push` hook
      rejecting `main`.*
- [ ] Amend the `infrastructure.md` Approval bullet: **merging to `main` is the
      production promote.** The agent's unattended list survives — it may push feature
      branches (→ `versions upload`, no traffic shift) but may not merge.
- [ ] Never add a deploy job to `ci.yml`. Two deploy paths = double deploys and a race (E20).
- [ ] Once Workers Builds is live, **production promotes come from merging to `main`**.
      `deploy:promote` stays as break-glass only: a manual promote does not appear in the
      Workers Builds deployment list, which then misreports where the running version came
      from. `deploy:preview` remains fine for ad-hoc previews — it shifts no traffic.

Two things to keep in mind: Workers Builds does **not** gate on GitHub check status, so a
red CI will not stop a deploy — the merge is the only enforcement point. And if a true
post-merge gate is ever wanted, the escalation is to set the production deploy command to
`versions upload` and promote by hand; that contradicts the auto-deploy decision, so hold
it as a documented option, not the default.

Free budget: 3,000 build min/month, 1 concurrent build, 20-min timeout.

**Actuals** *(fill in)*: GitHub App install date · build settings as configured · first
auto-deploy version ID

---

## Phase 7 — Record the outcome

- [ ] Fill this file with actuals: URL, version IDs, dashboard settings, dates.
- [ ] `infrastructure.md` — mark **resolved**: the IMAGES-binding row (Images Free allows
      5,000 unique transformations/month; a Free deploy is not rejected) and the
      `previews`-pin row. Amend the Approval bullet per Phase 6.
- [ ] `tech-stack.md` — `ci_provider: github-actions` now describes only the lint/build
      check; record that the **deploy** path is Workers Builds.
- [ ] `README.md` — still the starter's ("10x Astro Starter", clone URL points at
      `przeprogramowani/10x-astro-starter`, script list predates the deploy scripts).
      Update title, clone URL, scripts, and add a Deployment section.
- [ ] `AGENTS.md` — deploys come from Workers Builds, not GitHub Actions; use
      `deploy:preview` / `deploy:promote`, never bare `wrangler deploy`; editing
      `wrangler.jsonc` requires a rebuild to take effect; review-session state lives in
      Supabase Postgres, never Astro Sessions.
- [ ] `lessons.md` — append two lessons: *the deployed config is generated, not the one
      you edited*, and *adapters inject bindings you did not declare*. Existing entries
      are **Polish**, Context / Problem / Rule / Applies-to — match that shape.
- [ ] **Secret rotation procedure** — record it here, because nothing in the repo can express
      it: rotate the key in the Supabase dashboard →
      `npx wrangler secret put SUPABASE_KEY --name 10xcards` → `secret put` deploys a new
      version by itself, no manual redeploy → re-run check 13 to prove the new key actually
      works. Skipping check 13 is how a rotation to a bad key ships silently: the banner stays
      hidden and the failure only appears inside `getUser()` (E7).
- [ ] Record the open Paid gate: **cpuTime > 6 ms sustained, or the proposals PR** — judged
      inside the 24 h Workers Logs window Free gives you (E28).

---

## Edge cases & extra support

### Cloudflare

- **E1 — Renaming the Worker does nothing until you rebuild.** The deploy reads
  `dist/server/wrangler.json` via the `.wrangler/deploy/config.json` redirect. Always
  rebuild after touching `wrangler.jsonc`, and pass `--name` so a stale artifact can
  never silently retarget you.
- **E2 — `assets.directory` is discarded** and replaced with `../client`. If CSS or React
  islands 404 on the preview URL, check here first — and the fix is never editing the
  source value.
- **E3 — Two KV traps.** The adapter injects an *unpinned* `SESSION` binding, and
  wrangler auto-provisioning would create `10xcards-session`. The pin must also be
  mirrored into `previews`, because the customizer re-runs against that sub-config. The
  orphan `736db4…` is what we pin to. Pinning ≠ using: Astro Sessions stay unconfigured.
- **E4 — IMAGES binding is unconditional and has no off switch.** `imagesBindingName` is
  typed `string`, so `imagesBindingName: false` (suggested in `infrastructure.md`) is not
  valid; only `imageService` is a lever. The repo has zero `astro:assets` / `<Image>` /
  `getImage` usage, so the binding is inert, and Images Free allows 5,000 unique
  transformations/month — it does **not** block a Free deploy. Declare it, don't fight it.
- **E5 — First deploy must be bare `wrangler deploy`.** `versions upload` applies no
  config changes — routes, subdomain, triggers (`wrangler triggers deploy` exists for
  exactly that). This also bites later: change `routes` or `workers_dev` and the preview
  will look fine while the change doesn't take effect. Note `preview_urls` defaults to the
  value of `workers_dev`, so disabling `workers_dev` silently kills the preview story too.
- **E6 — `secret put` before the Worker exists returns `10007`.** That error is the
  justification for the phase ordering, not a problem to work around.
- **E13 — Workers Free ceilings.** 10 ms CPU (Error 1102), 50 subrequests/request, 3 MB
  gzipped bundle, 128 MB memory, 100k req/day. The auth-only surface should fit, but
  React 19 + supabase-js is not small and `getUser()` runs on every request —
  **measure, don't assume** (checks 7 and 16). `astro dev` has no CPU meter, so this is
  unreproducible locally. Paid raises CPU to 30 s default / 5 min max and subrequests to
  10,000.
- **E14 — Never lower `compatibility_date` below `2026-02-19`.** At/above it,
  `fetch_iterable_type_support` is auto-enabled, which is what fixes the Astro 6 +
  adapter + middleware + `nodejs_compat` bug that renders every SSR page as the literal
  string `[object Object]` (withastro/astro#14511). `2026-05-08` is safe.
  `compatibility_date` is executable config, not metadata.
- **E15 — unenv stubs fail at runtime, not build.** Watch `wrangler tail` for
  `[unenv] … not implemented yet!`. `@supabase/ssr` has an open report of
  `Dynamic require of "stream" is not supported` on workerd (supabase/supabase#37592, on
  0.6.1); we're on 0.10.3 and have never deployed, so Phase 3 is where we find out.
  `nodejs_compat` is already set, which is the mitigation.
- **E16 — `config-status.ts:14` reads `astro:env` secrets at module scope.**
  `missingConfigs` is a module-level const imported by `Layout.astro:4`, so it evaluates
  once at isolate startup and every page renders from that evaluation. Top-level `env`
  reads are supported on workerd, so this should work — confirm empirically (banner shown
  in Phase 3, gone in Phase 4). If it misbehaves, move the check into a request-scoped
  function.
- **E17 — Rollback reverts code only** — not Supabase migrations, not secrets.
- **E23 — `not_found_handling`.** `"404-page"` is wrong for `output: "server"`; the asset
  router would start serving a prerendered `404.astro` for paths the Worker owns.
  Harmless today (no `404.html` in `dist/client`), latent tomorrow. Set `"none"`.
- **E28 — Workers Logs retain 24 h on Free.** `wrangler tail` is live streaming and unaffected,
  but anything you want to look *back* at is gone after a day. Two consequences: a bug reported
  yesterday leaves no trail, and the Paid gate's "sustained `cpuTime` > 6 ms" can only ever be
  assessed over a 24 h window — so treat a single clear day above the threshold as the signal,
  not a week-long trend you cannot actually observe. Paid raises retention alongside the CPU
  ceiling, which makes this a second, quieter reason the gate exists.

### Supabase

- **E7 — Presence ≠ validity.** `config-status.ts` does `Boolean(URL && KEY)`;
  `supabase.ts` does `if (!URL || !KEY) return null`. Both are presence checks. Check 13
  is the only thing that proves the key.
- **E8 — Key type.** `sb_publishable_` honours RLS and is safe to expose;
  `sb_secret_` / `service_role` bypass RLS entirely. Legacy `anon` JWTs start `eyJ` and
  are deprecated by end of 2026. Assert the prefix before pasting.
- **E9 — The signup funnel is dead on any deployed origin today. Measured, not assumed.**
  `GET /auth/v1/settings` on this project returned `"mailer_autoconfirm": false` on
  2026-08-31 — email confirmation **is on**. The stock "Confirm sign up" template was read in
  the dashboard the same day and does use `{{ .ConfirmationURL }}`, which hits
  `/auth/v1/verify` and 302s to Site URL with tokens **in the URL fragment** — which a
  server-rendered app cannot read. There is no `/auth/callback`, no
  `exchangeCodeForSession`, no `verifyOtp`. The confirmed user lands on `/` with no cookie
  and no error. Phase 1's `/auth/confirm` route plus Phase 2's template change is the fix.
  Re-check with:
  `curl -sS -H "apikey: $KEY" $URL/auth/v1/settings | grep -o '"mailer_autoconfirm":[a-z]*'`
- **E10 — Redirect-URL globs.** `*` does not cross `.` or `/`; `**` does. List production
  separately — the preview glob will never match it.
- **E18 — Zero migrations is correct here.** `src/pages/` is auth-only. Don't invent a
  schema during a deployment change. When the first table lands, AGENTS.md requires RLS
  plus a separate policy per operation for `anon` and `authenticated` — never `for all`.
  Note `supabase/config.toml` still says `project_id = "10x-astro-starter"`,
  `[inbucket]` is deprecated in favour of `[local_smtp]`, and `.temp/linked-project.json`
  implies a link that doesn't exist (the CLI reads `.temp/project-ref`). All three need
  fixing before the first migration, not before this deploy.
- **E24 — Supabase's built-in email sender is rate-limited to ~2/hour on free.** Signup
  smoke-testing hits this fast; it surfaces as `over_email_send_rate_limit`. Budget test
  addresses, and don't mistake the rate limit for a broken deploy.
- **E25 — Cookie chunking.** `@supabase/ssr` splits large tokens into
  `sb-xjykknkrkmtcdqvyirtt-auth-token.0` / `.1`. Astro's `cookies.set` writes them on the
  response — verify `Set-Cookie` appears **on the 302**, since redirects are where cookie
  writes get silently dropped. Presence is only half of it: any response carrying `Set-Cookie`
  must also be uncacheable (`Cache-Control: private, no-store`). Astro sets no such header on
  its own, and a session cookie held at the edge is the one bug whose symptom is another user's
  data. Phase 1 adds the header; this is the reasoning.
- **E26 — `workers.dev` is on the Public Suffix List**, so `<subdomain>.workers.dev` is
  registrable and previews share a registrable domain with production. `@supabase/ssr`
  sets host-only cookies, so jars are separate *today*; any future `Domain=`-scoped cookie
  would leak production sessions into every preview origin.
- **E27 — `getUser()` runs on every request**, including `/`. That is one Frankfurt
  round-trip per page view, and a Supabase outage takes down the whole site, not just
  `/dashboard`. Latency and blast radius, not correctness — but worth knowing.

### GitHub

- **E11 — `npm ci` obeys the lockfile.** Bumping only `package.json` leaves Workers Builds
  on adapter 13.5.0 while you run 13.7.0. Commit the lockfile.
- **E12 — Node version.** Resolution order is `NODE_VERSION` → `.nvmrc` / `.node-version`
  → default 24.18.0 (22.23.2 also preinstalled).
- **E19 — Unpushed commits.** `main` is 3 ahead of `origin/main` (`5e19d63`, `63b9aa6`, `54cccbb`).
- **E20 — One deploy path only.** Never add a deploy job to `ci.yml`.
- **E21 — The GitHub App is account-scoped** and breaks silently if the repo is renamed,
  transferred, or its access narrowed. Symptom: pushes stop producing builds, with no
  error anywhere in the repo.
- **E22 — `confirm-email.astro:4` keys its copy off `import.meta.env.DEV`**, always
  `false` on the Worker. The Phase 1 `signup.ts` session branch is what keeps the page
  honest.

---

## Files touched

| File | Change |
| --- | --- |
| `wrangler.jsonc` | name → `10xcards`; SESSION KV pinned top-level **and** in `previews`; explicit `images`; `not_found_handling: "none"`; explicit `workers_dev` / `preview_urls` |
| `package.json` + `package-lock.json` | adapter `^13.7.0`; `deploy:preview` / `deploy:promote` / `deploy:rollback` |
| `src/pages/auth/confirm.ts` | **new** — `verifyOtp` / `exchangeCodeForSession` route |
| `src/pages/api/auth/{signin,signup,signout}.ts` | `prerender = false`; `signup.ts` also gets `emailRedirectTo` + session branch |
| `astro.config.mjs` | `site:` (Phase 6, once the hostname exists) |
| `.dev.vars.example` | new, committed |
| `.github/workflows/ci.yml` | drop the inert `SUPABASE_*` build env; keep `npm run build` and both triggers |
| `README.md`, `AGENTS.md`, `context/foundation/{infrastructure,tech-stack,lessons}.md` | Phase 7 |

---

## Verification

Pass `--name 10xcards` everywhere — it defeats any stale redirect config.

| # | Check | Command | Expected |
| --- | --- | --- | --- |
| 1 | Nothing deployed | `npx wrangler deployments list --name 10xcards` | `10007` (✓ confirmed 2026-08-31) |
| 2 | …under either name | `npx wrangler deployments list --name 10x-astro-starter` | `10007` (✓ confirmed 2026-08-31) |
| 3 | Landmine disarmed | `ls .wrangler/deploy/config.json dist` | both "No such file" |
| 4 | **Generated config** | `node -e "const c=require('./dist/server/wrangler.json');console.log(c.name, JSON.stringify(c.kv_namespaces), JSON.stringify(c.previews.kv_namespaces), c.assets.not_found_handling, c.assets.directory)"` | `10xcards`, **both** KV arrays carrying `id: 736db4…`, `none`, `../client`. **The failure you're hunting is a missing `id` in the previews array.** |
| 5 | Lockfile | `npm ci && node -p "require('@astrojs/cloudflare/package.json').version"` | `13.7.0` — if it prints `13.5.0`, stop |
| 6 | AGENTS.md rule | `grep -rn "export const prerender" src/pages/` | 4 hits (3 API + `auth/confirm.ts`), all `= false` |
| 7 | Bundle vs 3 MB Free cap | `npx wrangler deploy --dry-run --outdir /dev/null --name 10xcards` | `gzip: Y KiB`, Y well under 3000 |
| 8 | First deploy | `npx wrangler deploy` | `Deployed 10xcards triggers` + the URL. Record `<subdomain>` |
| 9 | Alive | `curl -sS -o /dev/null -w '%{http_code}\n' https://10xcards.<sub>.workers.dev/` | `200` |
| 10 | **Secrets resolve on workerd** | `curl -sS https://…/ \| grep -c "nie jest skonfigurowany"` | `1` before Phase 4, **`0` after** |
| 11 | Route guard | `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://…/dashboard` | `302 …/auth/signin` |
| 12 | Secrets set | `npx wrangler secret list --name 10xcards` | exactly `SUPABASE_URL` + `SUPABASE_KEY`, `secret_text` |
| 13 | **Key actually valid** | `curl -sS -o /dev/null -w '%{http_code}\n' -H "apikey: $KEY" https://xjykknkrkmtcdqvyirtt.supabase.co/auth/v1/settings` | `200`. `401` = wrong key — the banner would never tell you |
| 14 | Key type, before pasting | value matches `^sb_publishable_` | if `^sb_secret_`, **abort** |
| 15 | Cookie on the redirect | `curl -sS -i -X POST -d 'email=…&password=…' https://…/api/auth/signin \| grep -i '^set-cookie'` | ≥1 `sb-xjykknkrkmtcdqvyirtt-auth-token…`, `HttpOnly; Secure; Path=/`. **Zero `Set-Cookie` on the 302 is the failure mode** |
| 16 | Runtime + CPU baseline | `npx wrangler tail --name 10xcards --format json` while exercising the app | `"outcome":"ok"`, no exceptions; no `1102`, no `[unenv]`, no `Dynamic require`. Then read `cpuTime` — **≥7 ms on this tiny surface means Free will not survive the proposals screen** |
| 17 | **KV auto-provisioning** | `npx wrangler kv namespace list` — after first deploy **and** after the first `versions upload` | exactly one, `736db4…`. The upload is when the previews-pin failure bites |
| 18 | Upload shifts no traffic | `versions upload` then `deployments list --name 10xcards` | new Version ID + preview URL; active deployment unchanged |
| 19 | Workers Builds wiring | push a throwaway branch, read the build log | last step is `versions upload`, **not** `deploy`; then 17 and 18 still pass |
| 20 | Auto-deploy | merge a PR, then `deployments list --name 10xcards` | new deployment attributed to the Workers Builds trigger |
| 21 | **Local workerd boot** (run in Phase 1, *before* check 8) | `npx wrangler dev` with `.dev.vars` populated, then hit `/`, `/auth/signin`, `/dashboard` | pages render; console shows no `[unenv] … not implemented yet!` and no `Dynamic require of "stream"`. Numbered last to keep checks 1–20 stable, but it runs first |

Plus: full auth round-trip (sign up → confirm → signed in → `/dashboard` → sign out), a
rollback drill that serves the previous version and rolls forward, and no `[!]` markers
left in this file.

---

## Out of scope

OpenRouter integration; database schema and migrations; custom domain; the Workers Paid
subscription itself (gate recorded, not taken); per-PR preview *environments* (private
beta on the Workers path); `App.Locals` `Runtime` typing in `src/env.d.ts`
(`import("@astrojs/cloudflare").Runtime<{ ASSETS: Fetcher; IMAGES: ImagesBinding }>`) — nothing
in `src/` reads `locals.runtime.env` today, so this is needed the first time something does, not
before; multi-region / HA / DR; `supabase/config.toml` cleanup
(`project_id`, `[inbucket]` → `[local_smtp]`, real `supabase link`) — needed before the
first migration, not before this deploy.
