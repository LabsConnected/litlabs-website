![LiTT](.github/assets/litt-banner.webp)

# LiTT — the AI-native creation platform

**Describe → Generate → Preview → Edit → Verify → Publish.**

[![litlabs.net](https://img.shields.io/badge/litlabs.net-live-22D3EE)](https://litlabs.net)
![Status](https://img.shields.io/badge/status-Paid%20beta%20%E2%80%94%20in%20development-A855F7)
![License](https://img.shields.io/badge/license-decision%20pending-lightgrey)

LiTT is built by **LiTTree LabStudios**. Describe the software you want, watch it generate, preview it live, edit, verify, and publish — without understanding hosting or DNS.

---

## About this repository

This repository holds LiTT — a multi-agent creative workspace built with Next.js 16, React 19, Tailwind CSS 4, Clerk, Supabase, Stripe, and several AI providers.

## Requirements

- Node.js 22+
- pnpm 9.15+
- A configured `.env.local` based on [.env.example](.env.example)

## Start locally

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000>. The optional terminal service runs separately:

```bash
pnpm terminal:dev
# or run both services
pnpm dev:all
```

## Useful checks

```bash
pnpm lint
pnpm test
npx tsc --noEmit
pnpm build
```

The app uses the LiTT surfaces at `/litt` and `/litt-terminal`; older routes such as `/chat` and `/agent-chat` redirect into the consolidated Studio experience. Core application code lives in `src/app`, `src/components`, and `src/lib`. Database changes belong in `supabase/migrations/`.

## Deployment

Production deploys run through Railway. The terminal service and voice worker are deployed as separate Railway services. See `RAILWAY.md` for the full deployment guide and `docs/ENVIRONMENTS.md` for which environments exist and how CI relates to production. Heavy Studio and media builds are intended for GitHub Codespaces, as described in `.devin-config.json`.

Never commit `.env.local` or any secret-bearing environment file.
