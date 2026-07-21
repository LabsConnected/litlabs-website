# AGENTS.md

> Local-only project guide for human contributors. This file is gitignored
> (see `.gitignore`) and **must not** be edited as ground truth — the canonical
> rules for AI tooling live in `.clinerules` (Cline) and `.cursorrules` (Cursor).

## Stack

- Next.js 16 + Turbopack + React 19 + Tailwind CSS v4
- pnpm 9.15+ (packageManager in package.json)
- Clerk auth, Supabase DB, Stripe payments
- AI: OpenRouter, Gemini, Together, Fal, MiniMax
- Deployed on Vercel; Docker available for self-hosting
- Local host: Windows 11 (cmd.exe) — NOT WSL2

## Commands

```bash
pnpm dev          # Start dev server with Turbopack on :3000
pnpm dev:webpack  # Dev server with Webpack (rarely needed)
pnpm build        # Production build
pnpm lint         # ESLint (flat config, eslint-config-next)
pnpm test         # Vitest (jsdom env) — see vitest.config.ts
npx tsc --noEmit  # Type-check (no script in package.json yet)
```

## Architecture

Multi-agent AI app ("LiTTree Lab Studios"). Key subsystems in `src/lib/`:

- `agents.ts`, `agent-profiles.ts` — agent orchestration matrix
- `litt.ts — LiTT notification dispatcher (exports `litt` singleton; `jarvis` alias for compat)
- `director-graph.ts` — director agent graph
- `llm.ts`, `llm-completion.ts`, `llm-executor.ts` — LLM abstraction layer
- `supabase.ts`, `supabase-admin.ts`, `supabase-client.ts` — DB access (service role vs anon)
- `auth.ts`, `jwt.ts` — auth layer (Clerk + custom JWT)
- `r2.ts` — Cloudflare R2 storage
- `agent-logger.ts` — logging for agent actions

App routes in `src/app/` — standard Next.js App Router. API routes under `src/app/api/`.
Route group `(auth)` is a non-URL segment. (The `(dashboard)` group was removed — the
AutonomicLoopBanner now lives directly in `DashboardView.tsx`.)

## Environment

- Local development runs on Windows 11 (cmd.exe). Heavy builds (`/studio`,
  image generation) belong in GitHub Codespaces — see `.devin-config.json`.
- Node 22+ required (CI uses Node 22).

Copy `.env.example` to `.env.local` and fill in secrets. Key groups:
- Clerk: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`
- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price IDs
- AI: `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, etc.
- Auth: `AUTH_SECRET` (generate: `openssl rand -hex 32`)

Run `bash scripts/setup-env.sh` to configure Vercel environment variables interactively.

## Quirks

- `ignore-scripts=true` in `.npmrc` — postinstall scripts are skipped
- `cleanDistDir: false` in next.config.ts avoids Windows EPERM errors on `.next/` cleanup
- `serverExternalPackages: ["jose"]` — jose must be externalized from middleware bundle
- Turbopack root explicitly set to `__dirname` to suppress lockfile detection warning
- `strict: true` in tsconfig — full strict type checking (use `npx tsc --noEmit`)
- Supabase migrations in `supabase/migrations/`; do not edit `supabase/schema.sql` directly
- `chrome/` directory contains a local Chromium binary for Lighthouse/Playwright
- `.clinerules` and `.cursorrules` carry environment context — do not scaffold boilerplate
- `lucide-react` is pinned to `^1.24.0` (very old); many modern icons may be missing —
  fall back to inline SVG (see `src/components/dashboard/AutonomicLoopBanner.tsx` for the pattern)
- `litlabs/`, `litlabs-website/`, `Zoo-Code/`, `work/`, `meta/` are local artifacts
  and are excluded from `tsconfig.json` — do not import from them

## CI

GitHub Actions includes build/type-check, terminal deployment, and Lighthouse workflows.
The build workflow is the required quality gate for pull requests and should run lint and
tests in addition to TypeScript and the production build.
