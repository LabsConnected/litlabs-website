# AGENTS.md

## Stack

- Next.js 16 + Turbopack + React 19 + Tailwind CSS v4
- pnpm 9.15+ (packageManager in package.json)
- Clerk auth, Supabase DB, Stripe payments
- AI: OpenRouter, Gemini, Together, Fal, MiniMax
- Deployed on Vercel; Docker available for self-hosting

## Commands

```bash
pnpm dev          # Start dev server with Turbopack on :3000
pnpm dev:webpack  # Dev server with Webpack (rarely needed)
pnpm build        # Production build
pnpm lint         # ESLint (flat config, eslint-config-next)
```

No test runner configured. No typecheck script — run `npx tsc --noEmit` manually if needed.

## Architecture

Multi-agent AI app ("LiTTree Lab Studios"). Key subsystems in `src/lib/`:

- `AgentOrchestrator.ts`, `agents.ts`, `agent-profiles.ts` — agent orchestration matrix
- `jarvis.ts` — main AI assistant logic
- `director-graph.ts` — director agent graph
- `llm.ts`, `llm-completion.ts`, `llm-executor.ts` — LLM abstraction layer
- `supabase.ts`, `supabase-admin.ts`, `supabase-client.ts` — DB access (service role vs anon)
- `auth.ts`, `jwt.ts` — auth layer (Clerk + custom JWT)
- `r2.ts` — Cloudflare R2 storage
- `agent-logger.ts` — logging for agent actions

App routes in `src/app/` — standard Next.js App Router. API routes under `src/app/api/`.

## Environment

Runs in WSL2 Linux. Node 22+ required (CI uses Node 22).

Copy `.env.example` to `.env.local` and fill in secrets. Key groups:
- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs
- AI: `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, etc.
- Auth: `AUTH_SECRET` (generate: `openssl rand -hex 32`)

Run `bash scripts/setup-env.sh` to configure Vercel environment variables interactively.

## Quirks

- `ignore-scripts=true` in `.npmrc` — postinstall scripts are skipped
- `cleanDistDir: false` in next.config.ts to avoid WSL2 EPERM errors on `.next/` cleanup
- `serverExternalPackages: ["jose"]` — jose must be externalized from middleware bundle
- Turbopack root explicitly set to `__dirname` to suppress lockfile detection warning
- `strict: false` in tsconfig — no strict type checking
- Supabase migrations in `supabase/migrations/`
- `chrome/` directory contains a local Chromium binary for Lighthouse/Playwright
- `.cursorrules` exists with environment context — do not scaffold boilerplate

## CI

Single workflow: `.github/workflows/lighthouse.yml` — runs Lighthouse on `litlabs.net` on push/PR to main. No build/test/lint CI steps.
