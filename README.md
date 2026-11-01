# 10xCards

![10xCards](./public/10xCards.png)

A web app for learning with flashcards. Paste a piece of text, get flashcard proposals drafted by AI, keep the ones worth keeping, and review them on a spaced-repetition schedule.

**Live:** https://10xcards.dkozinski.workers.dev

> [!NOTE]
> Built as the course project for 10xDevs. The requirements, roadmap, test strategy and every shipped change, with its research, plan and review, live in [`context/`](#project-documentation).

## What it does

- **Sign in** with email and password.
- **Paste text** (up to 20 000 characters) and get flashcard proposals from an LLM via OpenRouter.
- **Review each proposal**: accept, edit or reject it. Nothing reaches the deck without an explicit save.
- **Write cards by hand**, and browse, edit or delete everything in the deck.
- **Run a review session** scheduled by FSRS (`ts-fsrs`).
- **Delete the account** together with all of its data.

## Tech stack

- [Astro](https://astro.build/) 6: full server-side rendering, deployed as a Cloudflare Worker
- [React](https://react.dev/) 19: interactive islands only
- [TypeScript](https://www.typescriptlang.org/) 5, [Tailwind CSS](https://tailwindcss.com/) 4, [shadcn/ui](https://ui.shadcn.com/)
- [Supabase](https://supabase.com/): Postgres with row-level security, email/password auth with cookie sessions
- [OpenRouter](https://openrouter.ai/): LLM gateway for card generation
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs): review scheduling
- [Cloudflare Workers](https://workers.cloudflare.com/): runtime and hosting, deployed by Workers Builds
- [Vitest](https://vitest.dev/) with Testing Library for unit and component tests; [Stryker](https://stryker-mutator.io/) for local mutation testing

## Prerequisites

- Node.js 22.14.0 (see `.nvmrc`) and npm
- [Docker](https://www.docker.com/) with about 7 GB of RAM, for the local Supabase stack
- An [OpenRouter API key](https://openrouter.ai/settings/keys), only for AI generation; everything else works without it

## Getting started

1. Clone and install:

   ```bash
   git clone https://github.com/dkozinski/10xCards.git
   cd 10xCards
   npm install
   ```

2. Start the local Supabase stack. On first run it pulls the Docker images and applies every migration in `supabase/migrations/`:

   ```bash
   npx supabase start
   ```

3. Create `.dev.vars`, the file `npm run dev` reads its secrets from:

   ```bash
   cp .env.example .dev.vars
   ```

   Fill it in with the `API_URL` and `ANON_KEY` that `npx supabase status -o env` prints, and add your OpenRouter key:

   ```
   SUPABASE_URL=http://127.0.0.1:54321
   SUPABASE_KEY=<ANON_KEY>
   OPENROUTER_API_KEY=<your OpenRouter key>
   ```

4. Run the app at http://localhost:4321:

   ```bash
   npm run dev
   ```

> [!WARNING]
> `.dev.vars` decides which database the dev server talks to. With a hosted Supabase URL in it, everything you do locally writes to that project.

A missing key does not stop the app: a banner names what is not configured, and the feature that needs it is disabled.

| Local service             | URL                    |
| ------------------------- | ---------------------- |
| Supabase API              | http://127.0.0.1:54321 |
| Studio (database UI)      | http://127.0.0.1:54323 |
| Mailpit (captured emails) | http://127.0.0.1:54324 |

Email confirmation is off in the local stack (`supabase/config.toml`), so a new account can sign in straight away. Stop the stack with `npx supabase stop`.

## Scripts

| Command                             | What it does                                                  |
| ----------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                       | Dev server in Cloudflare's `workerd` runtime                  |
| `npm run build`                     | Production build                                              |
| `npm run preview`                   | Serve the production build locally                            |
| `npm run lint` / `npm run lint:fix` | ESLint with type-checked rules / auto-fix                     |
| `npm run format`                    | Prettier                                                      |
| `npm test`                          | Every Vitest suite once                                       |
| `npx vitest run <file>`             | One test file                                                 |
| `npm run db:types`                  | Regenerate `src/db/database.types.ts` from the local database |
| `npm run deploy:preview`            | Build and upload a new Worker version without promoting it    |
| `npm run deploy:promote`            | Promote an uploaded version to production                     |
| `npm run deploy:rollback`           | Roll production back to the previous version                  |

Where a new test goes and how it is written: [`context/foundation/test-plan.md`](context/foundation/test-plan.md) §6.

## Project structure

```
src/
├── pages/          # routes; pages/api/ holds the JSON endpoints
├── components/     # React islands by feature (generate, deck, review, account, auth); shadcn/ui in ui/
├── lib/            # services, validation schemas, helpers
├── db/             # generated database types
├── layouts/
└── middleware.ts   # resolves the session and guards protected routes
supabase/
├── config.toml     # local stack
└── migrations/     # schema, grants and row-level security policies
context/            # product and engineering documentation (see below)
wrangler.jsonc      # Cloudflare Worker config
```

## Database

- The schema lives in `supabase/migrations/` (six migrations). Every table has row-level security with a separate policy per operation and role, so a user only ever sees their own data.
- Locally, `npx supabase start` applies the migrations, and `npx supabase db reset` rebuilds the local database from them, wiping its data.
- In production, migrations are applied by hand with `npx supabase db push`, after a `--dry-run`. Neither CI nor the deploy runs them.

## Deployment

- **Production:** every merge to `main` is built and deployed by [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/). A docs-only merge deploys too.
- **Other branches:** Workers Builds only uploads a preview version; production stays as it is.
- **Secrets:** `SUPABASE_URL`, `SUPABASE_KEY` and `OPENROUTER_API_KEY` are Worker secrets (`npx wrangler secret put <NAME>`). The build needs none of them.
- **Rollback:** `npm run deploy:rollback` reverts code only, not database migrations and not secret values.

Full runbook: [`context/changes/deployment/deployment-plan.md`](context/changes/deployment/deployment-plan.md).

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `astro sync`, lint, `npm test` and build on every push and pull request to `main`. It needs no secrets and never deploys: it is the gate a change passes before merge.

## Project documentation

| Path                                                                           | What is there                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------- |
| [`context/foundation/prd.md`](context/foundation/prd.md)                       | Product requirements                           |
| [`context/foundation/roadmap.md`](context/foundation/roadmap.md)               | Milestones and the slices that delivered them  |
| [`context/foundation/test-plan.md`](context/foundation/test-plan.md)           | Risk-based test strategy and its rollout       |
| [`context/foundation/tech-stack.md`](context/foundation/tech-stack.md)         | How the stack was chosen                       |
| [`context/foundation/infrastructure.md`](context/foundation/infrastructure.md) | How the hosting platform was chosen            |
| [`context/archive/`](context/archive/)                                         | Every shipped change: research, plan, reviews  |
| [`AGENTS.md`](AGENTS.md)                                                       | Rules for AI coding agents working in the repo |
