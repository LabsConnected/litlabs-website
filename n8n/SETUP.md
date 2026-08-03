# n8n Setup Guide — LiTTree Lab Studios

Self-hosted n8n Community Edition on Railway, fully private, behind the LiTTree app.

## Architecture

```
External services (Stripe, GitHub, Gmail, custom)
         ↓ POST
  litlabs.ai/api/n8n/webhook/{path}   ← Vercel (public, authenticated)
         ↓ forward with shared secret
  n8n on Railway (private, no public URL)
         ↓
  Supabase, Gmail, AI APIs, Discord, Slack
```

- **n8n editor** — only accessible via `railway run` CLI tunnel (localhost:5678)
- **Webhooks** — forwarded through the Next.js bridge (`/api/n8n/[...path]/route.ts`)
- **Database** — Postgres on Railway (same project)

## Step 1: Create Railway services

```powershell
# Create a new Railway project for n8n (or add to existing)
railway init

# Add a Postgres database service
railway add --service postgres

# Add the n8n service from this repo
railway add --service n8n
railway up  # deploys using n8n/Dockerfile + railway.json
```

## Step 2: Set environment variables

Copy values from `n8n/env.example` into Railway → n8n service → Variables tab.

**Generate secrets:**
```powershell
# Encryption key (64 hex chars)
openssl rand -hex 32

# Bridge shared secret
openssl rand -hex 24

# Basic auth password
openssl rand -base64 18
```

**Link Postgres:**
- Go to Railway → Postgres service → Connect tab
- Copy host, port, database, user, password
- Paste into n8n service variables as `DB_POSTGRESDB_*`

## Step 3: Get the n8n private URL

After deployment, Railway assigns a private URL:
```powershell
railway domain  # for the n8n service
```

Set this as `N8N_WEBHOOK_URL` and `WEBHOOK_URL` in the n8n service variables.
Also set `N8N_WEBHOOK_URL` in your Vercel env vars so the bridge knows where to forward.

## Step 4: Set Vercel environment variables

In your Vercel project settings (or `.env.local` for dev):

```bash
# The Railway n8n URL (e.g. https://n8n-production.up.railway.app)
N8N_WEBHOOK_URL=https://your-n8n-service.up.railway.app

# Shared secret — must match n8n's LITT_N8N_BRIDGE_SECRET
LITT_N8N_BRIDGE_SECRET=your_generated_secret
```

## Step 5: Access the n8n editor

n8n is private — no public URL. Access it via CLI tunnel:

```powershell
# Link to the n8n service if not already linked
railway link

# Tunnel n8n to localhost:5678
railway run
```

Open http://localhost:5678 in your browser.
Log in with the `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` you set.

## Step 6: Import starter workflows

In the n8n editor:
1. Click **Workflows** → **Import from File**
2. Import each file from `n8n/workflows/`:
   - `01-stripe-onboarding.json` — Stripe checkout → Supabase → welcome email → Slack
   - `02-github-supabase-sync.json` — GitHub PR/issue events → Supabase → Discord
   - `03-ai-orchestration.json` — Multi-step AI pipeline (OpenAI → Gemini refine)
   - `04-email-social-digest.json` — Daily 9AM email digest with AI summary
3. Configure credentials for each node (Gmail OAuth, Supabase, OpenAI, etc.)
4. Activate the workflows

## Step 7: Configure external webhooks

Point external services to the bridge URL:

| Service | URL | Header |
|---------|-----|--------|
| Stripe | `https://litlabs.ai/api/n8n/webhook/stripe-onboarding` | `x-n8n-bridge-secret: <secret>` |
| GitHub | `https://litlabs.ai/api/n8n/webhook/github-sync` | `x-n8n-bridge-secret: <secret>` |
| Custom | `https://litlabs.ai/api/n8n/webhook/{your-path}` | `x-n8n-bridge-secret: <secret>` |

**For Stripe/GitHub webhooks** that don't support custom headers, create a
separate bridge route that validates their signature instead. See:
`src/app/api/n8n/stripe/route.ts` (TODO — create if needed).

## Cost

| Item | Cost |
|------|------|
| n8n Community Edition | $0 |
| Railway Postgres | ~$5/mo (or free tier) |
| Railway n8n service | ~$5/mo (or free tier) |
| AI provider usage | Pay per use |
| **Total infrastructure** | **~$10/mo** |

## Security

- n8n has NO public URL — only reachable via Railway CLI tunnel
- All webhook requests must include `x-n8n-bridge-secret` header
- n8n editor protected by basic auth
- Credentials stored encrypted in Postgres (N8N_ENCRYPTION_KEY)
- SSL enforced for Railway Postgres connection

## n8n License

n8n Community Edition uses the Sustainable Use License (fair-code):
- ✅ Use internally at LiTTree Lab Studios
- ✅ Build automations behind your product
- ❌ Do NOT rebrand and resell n8n itself as your product

For a MIT-licensed alternative, consider Activepieces Community Edition.
