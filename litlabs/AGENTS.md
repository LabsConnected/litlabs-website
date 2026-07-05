# LiTTree Lab Studios - Project Guide

## Quick Commands

```bash
pnpm dev          # Start dev server (webpack)
pnpm dev:turbo    # Start dev server (turbopack)
pnpm build        # Production build
pnpm typecheck    # TypeScript check (tsc --noEmit)
pnpm lint         # ESLint
pnpm check        # lint + typecheck + build
pnpm dev:all      # Dev server + terminal server
```

## Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS v4
- **Auth**: Clerk (gracefully degrades when keys missing)
- **Database**: Supabase (PostgreSQL)
- **Storage**: Cloudflare R2
- **AI/LLM**: Google Gemini 2.5 Flash (primary), OpenRouter (fallback)
- **Payments**: Stripe
- **Node**: >= 22 (see `.nvmrc`)

## Architecture

- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components (Sidebar, Dashboard, LiTTree LiT terminal, etc.)
- `src/lib/` - Core libraries (agents, LLM, Supabase, auth, navigation)
- `src/hooks/` - Custom React hooks (useClerkAuth, etc.)
- `src/context/` - React context providers (Theme, Profile, Wallet)
- `terminal-server/` - Express + Socket.IO terminal backend

## Auth

The app supports two auth modes:

1. **Clerk** (production) - Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
2. **Custom JWT** (fallback) - Works when Clerk keys are missing; uses `/api/auth/session`

The middleware (`src/proxy.ts`) and `useClerkAuth` hook both gracefully degrade
when Clerk is not configured.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values. Required for full functionality:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` - Authentication
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` - Database
- `GEMINI_API_KEY` - AI features
- `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Payments

**Never commit `.env.local` or any file with real API keys.**

## Known Security Notes (as of 2026-07-05)

### Remaining npm audit findings (6 moderate, all upstream)

| Package             | Via            | Issue                | Status                    |
| ------------------- | -------------- | -------------------- | ------------------------- |
| dompurify <= 3.4.10 | monaco-editor  | XSS variants         | Waiting on Monaco update  |
| postcss < 8.5.10    | next (bundled) | XSS in CSS stringify | Waiting on Next.js update |

These are transitive dependencies with no available fix. Monitor for upstream releases.

### Secrets

- All `.env*` files (except `.env.example`) are gitignored
- Historical env dump files were removed from tracking in commit `d178f5d`
- The Vercel OIDC token in the old `env_dump.txt` was a short-lived JWT (expired)
- Rotate any keys that may have been exposed if pushing to a public repo

## Conventions

- Theme: "Volcanic Cyber" dark theme (#0a0a0f bg, cyan/orange accents)
- Fonts: Inter (UI), JetBrains Mono (code)
- Components use `useTheme()` for resolved colors (`T.bgColor`, `T.accentColor`, etc.)
- Navigation defined in `src/lib/navigation.ts` (8 groups, 50+ items)
- Agent definitions in `src/lib/agents.ts` (5 core agents)
