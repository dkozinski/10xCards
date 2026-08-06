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
