# Railway Deployment Guide

LiTLabs runs on Railway as a multi-service project. This document describes
the architecture, service configuration, environment variables, and external
service configuration.

## Architecture

```
LiTLabs Railway Project
│
├── web                    — Next.js app (litlabs.net)
│   ├── Dockerfile         — multi-stage, Next.js standalone output
│   └── railway.json       — healthcheck at /api/health
│
├── terminal-server        — terminal + WebSocket + LiveKit agent
│   ├── Dockerfile         — node-pty, sharp, ffmpeg
│   ├── railway.json       — healthcheck at /health
│   └── railway.worker.json — LiveKit agent worker (healthcheck at /health/live)
│
├── voice-server           — Inworld voice proxy (WebSocket)
│   ├── Dockerfile         — tiny Node.js image
│   └── railway.json       — healthcheck at /health
│
├── worker                 — LiTT agent worker daemon
│   ├── Dockerfile         — monorepo build with agent-core
│   └── railway.json       — healthcheck at /health
│
├── n8n                    — self-hosted n8n automation
│   ├── Dockerfile         — official n8n image
│   └── railway.json       — healthcheck at /healthz
│
├── music-worker           — persistent 2-minute worker
│   ├── Dockerfile         — tiny Node.js image
│   ├── railway.json       — restartPolicy: ALWAYS
│   └── worker.js          — setInterval, hits /api/music/worker every 2min
│
└── deployment-digest      — Railway native Cron Job
    └── GET /api/deployments/digest (weekdays 9:00 AM UTC)
```

## Service Setup

### 1. Web (Next.js app)

**Build:** Dockerfile at repo root (multi-stage: deps → builder → runner).
Next.js `output: "standalone"` produces a minimal self-contained server.

**Start command:** `node server.js` (from `.next/standalone/`)

**Healthcheck:** `GET /api/health`

**Port:** Railway assigns `$PORT` dynamically. The standalone server reads
`process.env.PORT` and binds to `0.0.0.0`.

**Root directory:** `/` (repo root — the Dockerfile is at the top level)

### 2. Terminal Server

Terminal + WebSocket server with LiveKit agent worker.

**Root directory:** `terminal-server/`

**Healthcheck:** `GET /health` (main server), `GET /health/live` (worker)

**Volume:** Requires a Railway Volume mounted at `/data/littree-workspaces`
for persistent workspace storage. Set `TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces`.

### 3. Voice Server

Inworld voice proxy — WebSocket server that bridges browser ↔ Inworld AI.

**Root directory:** `voice-server/`

**Healthcheck:** `GET /health`

### 4. Worker

LiTT agent worker daemon — polls Supabase for pending agent tasks.

**Root directory:** `/` (repo root — Dockerfile at `worker/Dockerfile`)

**Dockerfile path:** `worker/Dockerfile`

**Healthcheck:** `GET /health`

### 5. n8n

Self-hosted n8n automation engine. Uses the official n8n Docker image.

**Root directory:** `n8n/`

**Healthcheck:** `GET /healthz` (built into n8n)

### 6. Deployment Digest (Railway native Cron Job)

Railway Cron Jobs are configured in the Railway dashboard (not in code).

**Setup:**
1. In the Railway project, add a new service → Cron Job
2. Name: `deployment-digest`
3. **Schedule:** `0 13 * * 1-5` (weekdays at 13:00 UTC = 9:00 AM Detroit/EDT)
4. **URL:** `https://<web-domain>/api/deployments/digest`
5. **Method:** `GET`
6. **Headers:** `Authorization: Bearer $INTERNAL_API_KEY`
7. **Timeout:** 60s

**Auth:** The endpoint accepts `Authorization: Bearer <INTERNAL_API_KEY>`.

**Note:** Railway Cron's minimum frequency is 5 minutes. This job runs once
daily, so that's fine.

### 7. Music Worker (persistent Railway worker)

A tiny persistent service that calls the web app's `/api/music/worker`
endpoint every 2 minutes. Railway Cron's minimum is 5 minutes, so we use a
dedicated worker for this sub-5-minute interval.

**Build:** Dockerfile in `music-worker/`

**Start command:** `node worker.js`

**Root directory:** `music-worker/`

**Restart policy:** `ALWAYS` (persistent service, not a cron job)

**Environment variables:**
- `WEB_URL` — the web app's public URL (e.g. `https://litlabs.net`).
  In Railway, use a service reference: `${{web.RAILWAY_PUBLIC_DOMAIN}}`
  or the custom domain: `https://litlabs.net`
- `MUSIC_WORKER_SECRET` — must match the web app's `MUSIC_WORKER_SECRET`
- `WORKER_INTERVAL_MS` — (optional) override the 2-minute interval

## Environment Variables

### Shared Variables (use Railway Shared Variables)

Set these once as Railway Shared Variables, then reference them in each
service with `${{shared.VAR_NAME}}`:

```
OPENAI_API_KEY
OPENROUTER_API_KEY
GEMINI_API_KEY
GOOGLE_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET_NAME
SENTRY_DSN
DISCORD_WEBHOOK_URL
INTERNAL_API_KEY
MUSIC_WORKER_SECRET
TERMINAL_AUTH_SECRET
TERMINAL_INTERNAL_SERVICE_KEY
```

### Web service

All production env vars must be set on the Railway web service.

**Critical URL vars (MUST set correctly for Railway):**
- `NEXT_PUBLIC_SITE_URL=https://litlabs.net`
- `NEXT_PUBLIC_APP_URL=https://litlabs.net` — used for OAuth callbacks, Stripe success URLs, internal API calls
- `NEXT_PUBLIC_TERMINAL_WS_URL=wss://<terminal-server-domain>` — WebSocket URL for terminal connections
- `NEXT_PUBLIC_TERMINAL_HTTP_URL=https://<terminal-server-domain>` — HTTP URL for terminal API
- `TERMINAL_SERVER_INTERNAL_URL=https://<terminal-server-domain>` — server-to-server terminal URL
- `NEXT_PUBLIC_VOICE_WS_URL=wss://<voice-server-domain>/voice` — voice WebSocket URL

**Auth:**
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`
- `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` — Clerk proxy rewrite target
- `AUTH_SECRET`
- `TURNSTILE_SECRET_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

**Database:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Payments:**
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`

**Storage (R2):**
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`

**AI Providers:**
- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY` / `GOOGLE_API_KEY`
- `HUGGING_FACE_API_KEY`
- `TOGETHER_API_KEY`
- `FAL_KEY`
- `MINIMAX_API_KEY`
- `RECRAFT_API_KEY`
- `ELEVENLABS_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_AI_API_TOKEN`
- `SUPERMEMORY_API_KEY`

**LiveKit (voice/vision transport):**
- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

**Cron / Worker auth:**
- `INTERNAL_API_KEY` — Bearer token for the deployment digest cron
- `MUSIC_WORKER_SECRET` — shared secret for the music worker

**Sentry:**
- `SENTRY_DSN`
- `SENTRY_AUTH_TOKEN` — for source map uploads during build

**Railway deploy trigger (optional):**
- `RAILWAY_API_TOKEN` — for the `/api/deploy/trigger` endpoint
- `RAILWAY_SERVICE_ID` — the Railway service ID to redeploy

**Rate limiting:**
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

**Integrations (set if used):**
- `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
- `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
- `N8N_WEBHOOK_URL`, `LITT_N8N_BRIDGE_SECRET`
- `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `LITTLABS_VAPI_TOOL_TOKEN`
- `DISCORD_WEBHOOK_URL`, `DISCORD_ALERTS_WEBHOOK`
- `RESEND_API_KEY`
- `YOUTUBE_DATA_API_KEY`

### Terminal Server service

- `TERMINAL_AUTH_SECRET` — >= 32 chars
- `TERMINAL_INTERNAL_SERVICE_KEY` — >= 32 chars
- `TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces` — Railway Volume mount
- `TERMINAL_ALLOWED_ORIGIN=https://litlabs.net,https://www.littlabs.net` — CORS
- `TERMINAL_USE_DOCKER=true` (if using Docker isolation)
- `DOCKER_TERMINAL_IMAGE` — Docker image for terminal sandbox
- `OPENROUTER_API_KEY` — for LiTT code assistant
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — for LiveKit agent
- `LIVEKIT_AGENT_NAME`
- `PORT` — provided by Railway

### Voice Server service

- `INWORLD_API_KEY`
- `INWORLD_LITT_VOICE`
- `INWORLD_SPARK_VOICE`
- `VOICE_AUTH_SECRET` — >= 32 chars
- `PORT` — provided by Railway

### Worker service

- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENROUTER_API_KEY`
- `TARGET_AGENT_SLUG` — default: `director`
- `MAX_CONCURRENCY` — default: 3
- `POLL_INTERVAL_MS` — default: 5000

### Music Worker service

- `WEB_URL` — web app URL (Railway service ref or custom domain)
- `MUSIC_WORKER_SECRET` — must match web service
- `WORKER_INTERVAL_MS` — (optional) default: 120000

## External Service Updates

After deploying to Railway and before switching DNS, update these external
services to point to the new Railway domain:

### Clerk Dashboard
- **Webhook URL:** `https://litlabs.net/api/webhook/clerk`
- **Authorized origins:** `https://litlabs.net`, `https://www.littlabs.net`
- **Redirect URLs:** already use relative paths (no change needed)

### Stripe Dashboard
- **Webhook endpoint:** `https://litlabs.net/api/stripe/webhook`

### GitHub App Settings
- **OAuth callback URL:** `https://litlabs.net/api/github/callback`
- **Homepage URL:** `https://litlabs.net`

### Vapi Dashboard
- **Custom LLM URL:** `https://litlabs.net/api/vapi/turn`
- **Tools server URL:** `https://litlabs.net/api/vapi/tools`

### Meta (Facebook/Instagram) Developer Console
- **OAuth redirect URI:** `https://litlabs.net/api/integrations/meta-developer/callback`
- Set `META_REDIRECT_URI` env var to match

### n8n Webhooks
- Update any n8n workflows that reference old deployment URLs to use `https://www.litlabs.net`

## Domain Setup

1. In the Railway web service → Settings → Networking
2. Add custom domain: `litlabs.net`
3. Add custom domain: `www.littlabs.net` (or rely on the Next.js redirect)
4. Update DNS at your registrar:
   - `litlabs.net` → CNAME to Railway's generated domain
   - `www.littlabs.net` → CNAME (Next.js redirects to apex)
5. Railway provides SSL automatically

## Railway Volume (terminal-server)

The terminal-server needs a persistent volume for workspace storage:

1. In the terminal-server service → Settings → Volumes
2. Add a volume mounted at `/data/littree-workspaces`
3. Set `TERMINAL_WORKSPACE_ROOT=/data/littree-workspaces`

Without this volume, all workspaces and cloned repositories will be lost
on every redeploy (Railway's filesystem is ephemeral outside volumes).

## Migration from Vercel — COMPLETE

The Vercel→Railway migration is complete. Railway is the canonical production platform.

**Removed in post-V1 cleanup:**
- `vercel.json` — Vercel build config + crons + function timeouts
- `.vercelignore` — Vercel deployment ignore rules
- `scripts/VERCEL_ENV_VARS.md` — Vercel CLI env setup guide
- `scripts/setup-env.sh` — Vercel CLI env setup script
- `scripts/fix-all-env.sh` — Vercel CLI env pull script

**Cron migration:**
- `/api/deployments/digest` (weekdays 09:00 UTC) → GitHub Actions `cron-deploy-digest.yml`
- `/api/music/worker` (every 2 min) → already handled by the persistent Railway `music-worker` service (GitHub Actions minimum interval is 5 minutes, so the Railway worker is the correct solution for sub-5-minute cadence)

**Code changes made for Railway compatibility:**
- `next.config.ts`: `output: "standalone"` enabled, `automaticVercelMonitors` removed
- All 53 `export const maxDuration` declarations removed (Vercel-specific)
- `export const runtime = "edge"` → `"nodejs"` in OG image route
- `process.env.VERCEL` / `VERCEL_URL` detection replaced with `isDeployed()` (checks `RAILWAY_ENVIRONMENT`)
- Deploy trigger endpoint rewritten to use Railway GraphQL API
- Voice server binds to `0.0.0.0` + reads `process.env.PORT`
- LiveKit agent binds to `0.0.0.0` explicitly
- `@vercel/analytics` + `@vercel/speed-insights` removed (unused)
- Vercel geo headers documented as gracefully degrading (return null on Railway)

**Remaining Vercel references in code are intentional product features:**
- `vercel_project_id` in projects/mission-control/dashboard — allows users to deploy their projects to Vercel
- `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` in connectors — user-provided Vercel integration credentials
- `process.env.VERCEL` fallback in `env.ts` / `system-health.ts` — harmless compatibility detection
