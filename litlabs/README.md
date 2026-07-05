# LiTTree Lab Studios

The creator operating system for AI agents, studios, marketplaces, and community.

## Tech stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS v4
- Clerk authentication
- Supabase (Postgres + Auth + RLS)
- Vercel deployment

## Getting started

```bash
cd litlabs
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required environment variables

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## Scripts

- `pnpm dev` — start the Next.js dev server
- `pnpm lint` — run ESLint
- `pnpm typecheck` — run TypeScript without emitting
- `pnpm check` — lint + typecheck + build (CI gate)
- `pnpm build` — production build
- `pnpm terminal:dev` — start the terminal-server companion

## Project structure

- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — React components
- `src/lib/` — shared libraries and AI/agent logic
- `src/context/` — React context providers
- `terminal-server/` — separate Node.js service for browser terminal + LiTTree LiT AI
- `supabase/` — migrations and schema
- `docs/` — design docs and audits
- `scripts/` — deployment and utility scripts

## Contributing

1. Branch from `main`.
2. Run `pnpm check` before opening a PR.
3. Keep the terminal server and main app changes in separate commits when possible.
4. Do not commit `.env.local` or secrets.

## Deployment

- Main app: Vercel (`pnpm build`)
- Terminal server: Railway (`terminal-server/railway.json`)
