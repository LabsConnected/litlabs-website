# LiTTree Lab Studios

LiTTree Lab Studios is a multi-agent creative workspace built with Next.js 16, React 19, Tailwind CSS 4, Clerk, Supabase, Stripe, and several AI providers.

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

Production deploys run through Vercel. The terminal service can be built with Docker using the provided Dockerfiles. Heavy Studio and media builds are intended for GitHub Codespaces, as described in `.devin-config.json`.

Never commit `.env.local` or any secret-bearing environment file.
