---
bootstrapped_at: 2026-08-02T09:44:50Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10xcards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

Verbatim from `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

A solo developer shipping a flashcard MVP in three weeks of after-hours work
needs a starter that hands over auth, a per-user database, and a deploy target
without any assembly. Astro + Supabase + Cloudflare is the recommended default
for a TypeScript web app and clears all four agent-friendly gates: explicit
types end to end, conventional layout, heavy presence in training data, and
current documentation. Supabase covers email/password registration, login, and
account deletion (FR-001 through FR-003) plus row-level security for the
data-isolation requirement, so none of that is hand-rolled. TypeScript with Zod
schemas at the boundaries keeps the AI generation contract explicit, which
matters when proposals must be reviewed before anything reaches the deck.
Payments, realtime, and background jobs are all out of scope per the PRD's
non-goals. CI runs on GitHub Actions with auto-deploy on merge to main — what
the starter ships with. Two setup notes carry forward: write RLS policies early
rather than retrofitting them, and stream or poll the ~20-second generation
request instead of holding a synchronous connection open on the edge runtime.

## Pre-scaffold verification

| Signal      | Value                                                          | Severity | Notes                                                              |
| ----------- | -------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| npm package | not run                                                          | n/a      | `cmd_template` starts with `git clone`; no npm CLI package to resolve |
| GitHub repo | `przeprogramowani/10x-astro-starter` last pushed 2026-05-17     | fresh    | from `card.docs_url`; ~2.5 months old, inside the 3-month fresh window |

Note: `gh` is not installed on this machine, so the repo check was made through
an unauthenticated call to the GitHub REST API instead. Same signal, different
transport.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 18
**Conflicts (.scaffold siblings)**: `CLAUDE.md.scaffold`
**.gitignore handling**: append-merged (starter patterns appended under a `# from 10x-astro-starter` marker; exact-duplicate lines dropped; comment headers kept only where at least one pattern under them survived de-duplication)
**.bootstrap-scaffold cleanup**: deleted (upstream `.git/` removed before move-up, so the starter's commit history did not leak into this repo)

**Moved to cwd**: `astro.config.mjs`, `components.json`, `.env.example`,
`eslint.config.js`, `.github/`, `.husky/`, `node_modules/`, `.nvmrc`,
`package.json`, `package-lock.json`, `.prettierrc.json`, `public/`,
`README.md`, `src/`, `supabase/`, `tsconfig.json`, `.vscode/`, `wrangler.jsonc`

**Preserved in cwd (untouched)**: `context/`, `.claude/`, `CLAUDE.md`, `.git/`,
`idea-notes.md`

**Toolchain warning captured during install** (non-fatal, exit code was still 0):
`npm install` emitted repeated `EBADENGINE` warnings. The starter's `.nvmrc`
pins Node 22.14.0 and `astro@6.3.1` requires `node >=22.12.0`, but the local
Node is v20.20.2. Dependencies installed regardless, but `npm run dev` and
`npm run build` are likely to fail until Node is upgraded. Packages that
flagged the mismatch: `astro`, `@astrojs/prism`, `@astrojs/react`,
`@cloudflare/kv-asset-handler`, `miniflare`, `wrangler`.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Exit code**: 1 (informational — npm audit exits non-zero whenever findings exist; not treated as a halt)
**Summary**: 1 CRITICAL, 12 HIGH, 7 MODERATE, 2 LOW (22 total across 895 resolved dependencies — 449 prod, 316 dev, 131 optional)
**Direct vs transitive**: 0/1/2/0 direct of total 1/12/7/2. Three findings sit on
packages this project depends on directly (`astro`, `supabase`, `wrangler`); the
other 19 are transitive and become actionable when the direct parents publish
updated ranges.

#### CRITICAL findings

- **`tar`** (range `<=7.5.20`) — transitive, reached via `supabase`. Two
  advisories: a PAX size-override parser interpretation differential enabling
  file smuggling, and a process crash via PAX numeric path type confusion. Fix
  available upstream.

#### HIGH findings

- **`astro`** (range `<=7.0.9`) — **direct dependency**. Reflected XSS via
  unescaped slot name; Host header SSRF in the prerendered error page fetch.
  Fix available.
- **`brace-expansion`** (`<=1.1.16 || 3.0.0 - 5.0.7`) — transitive. DoS via
  exponential-time expansion of consecutive non-expanding `{}` groups.
- **`devalue`** (`5.6.3 - 5.8.0`) — transitive. DoS via sparse array
  deserialization.
- **`fast-uri`** (`3.0.0 - 3.1.3`) — transitive. Host confusion via literal
  backslash authority delimiter and failed IDN canonicalization.
- **`js-yaml`** (`4.0.0 - 4.2.0`) — transitive. Quadratic-complexity DoS in
  merge key handling via repeated aliases.
- **`miniflare`** — transitive, via `sharp` and `undici`.
- **`postcss`** (`<=8.5.17`) — transitive. Path traversal in `sourceMappingURL`
  auto-loading leading to arbitrary `.map` file disclosure.
- **`sharp`** (`<0.35.0`) — transitive. Inherits libvips CVE-2026-33327,
  CVE-2026-33328, CVE-2026-35590, CVE-2026-35591.
- **`svgo`** (`4.0.0 - 4.0.1`) — transitive. `removeScripts` plugin leaves some
  executable scripts intact.
- **`undici`** (`7.0.0 - 7.27.2`) — transitive. TLS certificate validation
  bypass via dropped `requestTls` in the SOCKS5 ProxyAgent; HTTP header
  injection via `Set-Cookie` percent-decoding.
- **`vite`** (`7.0.0 - 7.3.3`) — transitive. `server.fs.deny` bypass on Windows
  alternate paths; NTLMv2 hash disclosure via UNC path handling in
  `launch-editor`.
- **`ws`** (`8.0.0 - 8.20.1`) — transitive. Uninitialized memory disclosure;
  memory exhaustion DoS from tiny fragments and data chunks.

#### MODERATE findings

- **`supabase`** (`1.1.6 - 2.98.2`) — **direct dependency**, inherits the `tar`
  CRITICAL above.
- **`wrangler`** — **direct dependency**, via `esbuild` and `miniflare`.
- **`@astrojs/language-server`** (`2.14.0 - 2.16.10`) — via `volar-service-yaml`.
- **`@cloudflare/vite-plugin`** — via `miniflare` and `wrangler`.
- **`volar-service-yaml`** (`<=0.0.70`) — via `yaml-language-server`.
- **`yaml`** (`2.0.0 - 2.8.2`) — stack overflow via deeply nested YAML
  collections.
- **`yaml-language-server`** — via `yaml`.

#### LOW / INFO findings

- **`@babel/core`** (`<=7.29.0`) — arbitrary file read via `sourceMappingURL`
  comment.
- **`esbuild`** (`0.27.3 - 0.28.0`) — arbitrary file read when running the dev
  server on Windows.

Every finding reports `fixAvailable: true`, so `npm audit fix` is likely to
resolve most of them. Bootstrapper does not run it — that is your call.

Several of the highest-severity findings (`vite`, `esbuild`, `@babel/core`,
`svgo`, `postcss`, `sharp`) sit in the dev/build toolchain rather than the
deployed runtime, and two of them only apply on Windows. That does not make them
irrelevant, but it does change the urgency relative to the `astro` XSS/SSRF
finding, which is the one that reaches production.

## Hints recorded but not acted on

| Hint                    | Value              |
| ----------------------- | ------------------ |
| bootstrapper_confidence | first-class        |
| quality_override        | false              |
| path_taken              | standard           |
| self_check_answers      | null               |
| team_size               | solo               |
| deployment_target       | cloudflare-pages   |
| ci_provider             | github-actions     |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true               |
| has_payments            | false              |
| has_realtime            | false              |
| has_ai                  | true               |
| has_background_jobs     | false              |

Note: the starter ships its own `.github/workflows/` directory. Bootstrapper did
not generate or modify any CI configuration — whatever is there came from the
starter and has not been reconciled against the `ci_provider` /
`ci_default_flow` hints above.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Upgrade Node to 22.14.0 (the version in `.nvmrc`) before running `npm run dev` or `npm run build` — the local v20.20.2 does not satisfy the starter's engine requirements.
- `git init` (if you have not already) to start your own repo history. This directory already had a `.git/`, which was left untouched.
- Review the `CLAUDE.md.scaffold` sibling the conflict policy created and decide which version of the file to keep — the starter's copy documents its own commands, architecture, and conventions.
- Copy `.env.example` to `.env` (or `.dev.vars` for Cloudflare local dev) and fill in `SUPABASE_URL` and `SUPABASE_KEY`.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log. The `astro` direct HIGH is the one that reaches production.
