---
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10xcards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
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
---

## Why this stack

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
