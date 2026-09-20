# Rules for AI

This file provides guidance to AI Agent when working with code in this repository.

## Hard rules

- **RLS on every new table.** Each Supabase migration that creates a table must
  `enable row level security` and add a separate policy per operation
  (`select` / `insert` / `update` / `delete`), separately for the `anon` and
  `authenticated` roles. Never a single `for all` policy.
- **API routes must export `const prerender = false`.** Without it the route is
  statically prerendered at build time and silently stops responding.
- **API error codes are a closed vocabulary.** Input validation returns **400**
  (never 422) with code `validation_failed`; unparseable JSON → `invalid_json`;
  missing session → `unauthorized`. Never invent a new code inline.
- **DTO fields use `snake_case`** (`user_id`, `created_at`) — the shape Postgres
  returns. Never map to camelCase in services.

## Working with the repo owner

The owner is an experienced software engineer with **no web-stack background**. Assume
fluency in general engineering — types, processes, git, SQL, CLIs, build systems as a
concept. Assume nothing about this stack: Astro rendering modes, Cloudflare's `workerd`
runtime and its Node-compat shims, `wrangler`, Supabase auth and RLS, bundler output
layout, cookie-based SSR sessions. Explain those; never explain what an env var is.

- **Say why before running it.** Before any command touching infrastructure, deploys,
  build artifacts, or external services, state in one or two sentences: what it does,
  which plan step or named risk it serves (the `E*` entries in
  `context/changes/deployment/deployment-plan.md`), and what changes on disk or on a
  remote. A command the owner cannot tie to a goal has failed even when it succeeds.
- **Show the diff for every change.** Never report a file as modified without showing
  what changed: `git diff` for tracked files, `git diff --no-index` or the written content
  for untracked and out-of-repo ones. This is easy to miss when editing through `Bash`
  (`sed`, heredocs, scripts) instead of the editing tools — a shell edit renders no diff on
  its own, so it must be followed by an explicit `git diff`.
- **Name the reversibility.** Mark each step reversible (and how) or irreversible (and
  what is lost). `rm -rf` on regenerable build output and a `DROP` on a live table are
  both "destructive"; only one deserves a pause.
- **Separate local from remote.** State whether an action stays on this machine, reaches
  Supabase, or reaches Cloudflare — and if it leaves the machine, what trace it leaves.
- **Interpret output; never just paste it.** Say what was expected, whether it matches,
  and what a pass actually proves. Flag when empty output is ambiguous rather than clean
  (e.g. a silenced `curl` failure looks identical to a filtered-out success).
- **Real choices go to the owner, false ones do not.** Present genuine options with their
  consequences. Where there is only one sane path, say so and take it — a manufactured
  choice costs the owner attention without buying control.
- **Plain language, analogy first, then the worked example from this repo.** Applies to
  explanations, not to code comments — code matches the surrounding density.

## Rule files — where to write

**This file is the source of truth.** Add project rules here, never to `CLAUDE.md`.

`CLAUDE.md` is a thin shim: an `@AGENTS.md` import plus a block between
`<!-- BEGIN @przeprogramowani/10x-cli -->` and `<!-- END ... -->` that
`npx @przeprogramowani/10x-cli get <lesson>` rewrites on every run. Content inside
that block is not yours and will be replaced; content above `<!-- BEGIN -->` survives.

Do **not** run `/init` in this repo — it rewrites `CLAUDE.md` whole and destroys the
managed block, and `CLAUDE.md` is gitignored, so there is no way back. Use
`/10x-agents-md` (writes here) and `/10x-rule-review AGENTS.md` instead.

## Commands

- `npm run dev` — start dev server (Cloudflare workerd runtime)
- `npm run build` — production build (SSR via `@astrojs/cloudflare`)
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier (includes prettier-plugin-astro + prettier-plugin-tailwindcss)

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Architecture

**Astro 6 SSR app** with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components. Deployed to Cloudflare Workers.

### Rendering mode

Full server-side rendering (`output: "server"` in astro.config.mjs). All pages are server-rendered by default. API routes: see Hard rules above.

### Auth flow

- `src/lib/supabase.ts` — creates a Supabase SSR client using `@supabase/ssr` with cookie-based sessions. Uses `astro:env/server` for `SUPABASE_URL` and `SUPABASE_KEY` (server-only secrets declared in astro.config.mjs `env.schema`).
- `src/middleware.ts` — runs on every request, resolves the current user, attaches to `context.locals.user`. Redirects unauthenticated users away from routes listed in `PROTECTED_ROUTES`.
- API endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Protected page example: `src/pages/dashboard.astro`

### Key conventions

- **Path alias**: `@/*` maps to `./src/*` (tsconfig paths).
- **Astro components** for static content/layout; **React components** only when interactivity is needed.
- **Tailwind class merging**: use the `cn()` helper from `@/lib/utils` (clsx + tailwind-merge) for conditional/merged class names. Do not concatenate class strings manually.
- **shadcn/ui**: components live in `src/components/ui/`, "new-york" style variant. Install new ones with `npx shadcn@latest add [name]`.
- **API routes**: use uppercase `GET`, `POST` exports; validate input with zod.
- **Supabase migrations**: `supabase/migrations/` using naming format `YYYYMMDDHHmmss_short_description.sql`. RLS requirements: see Hard rules above.
- **React**: no Next.js directives ("use client" etc.). Extract hooks to `src/components/hooks/`.
- **Services/helpers** go in `src/lib/` (or `src/lib/services/` for extracted business logic).
- **Shared types** (entities, DTOs) go in `src/types.ts`.

### Environment

- Node.js v22.14.0 (see `.nvmrc`)
- Env vars: `SUPABASE_URL`, `SUPABASE_KEY` (copy `.env.example` to `.env` for Node, or `.dev.vars` for Cloudflare local dev)
- Local Supabase: `npx supabase start` (requires Docker)
- Cloudflare local dev: secrets go in `.dev.vars` (gitignored)
- Deploy: `npx wrangler deploy` (requires Cloudflare account + `wrangler` auth)

## CI

GitHub Actions workflow (`.github/workflows/ci.yml`) runs lint + build on every push and PR to `main`. Requires `SUPABASE_URL` and `SUPABASE_KEY` repository secrets for the build step.

## Documentation & Note-taking

When generating or updating markdown notes (e.g., in the Obsidian vault), follow these strict formatting rules to ensure they are beautiful, scannable, and highly readable:
- **No text blobs:** Never output massive, unstructured walls of text. Break down information.
- **Use callouts:** Liberally use GitHub-style markdown callouts (`> [!NOTE]`, `> [!IMPORTANT]`, `> [!TIP]`, `> [!WARNING]`) to highlight key definitions, rules, or core examples.
- **Clear hierarchy:** Use Headings (`##`, `###`) to separate logical sections.
- **Bullet points over paragraphs:** Whenever listing features, options, or consequences, use bulleted or numbered lists.
- **Rich examples:** Always provide concrete, real-world examples (e.g., specific to the `10xCards` app) alongside dry definitions.
- **Bold key terms:** Use **bold text** to make important concepts stand out when scanning the document.
