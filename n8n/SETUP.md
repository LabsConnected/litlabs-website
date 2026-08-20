# n8n Setup Guide — LiTTree Lab Studios

Self-hosted n8n Community Edition on Railway, fully private, behind the LiTTree app.
All webhooks are **HMAC-SHA256 signed** for integrity and replay protection.

## Architecture

```
External services (Stripe, GitHub, Gmail, custom)
         ↓ POST (signed payload)
  automate.litlabs.net/api/n8n/webhook/{path}   ← Railway (public, authenticated)
         ↓ verify HMAC-SHA256 signature + timestamp
  n8n on Railway (private, no public URL)
         ↓
  Supabase, Gmail, AI APIs, Discord, Slack
```

- **n8n editor** — only accessible via `railway run` CLI tunnel (localhost:5678)
- **Webhooks** — forwarded through the Next.js bridge (`/api/n8n/[...path]/route.ts`)
  with HMAC-SHA256 signed payloads
- **Health check** — `/api/n8n/health` (admin only) pings n8n's `/healthz`
- **Database** — Postgres on Railway (same project)

## Signed Webhook Format

All requests from the LiTTree app to n8n use a structured, signed payload.

### Payload structure

```json
{
  "userId": "user_abc123",
  "projectId": "proj_xyz",
  "missionId": null,
  "eventType": "lead.created",
  "approvedAction": "send_welcome_email",
  "callbackUrl": "https://litlabs.ai/api/n8n/callback",
  "idempotencyKey": "uuid-v4",
  "data": { "email": "newuser@example.com", "name": "Jane" }
}
```

### Headers

| Header | Description |
|--------|-------------|
| `x-litt-signature` | HMAC-SHA256 hex signature over the JSON-serialized body |
| `x-litt-timestamp` | Unix timestamp (seconds) when the payload was signed |
| `Content-Type` | `application/json` |

### Signing & verification

The signature is computed using `LITT_N8N_BRIDGE_SECRET` as the HMAC key over
the exact JSON-serialized payload string. The bridge verifies the signature
with `timingSafeEqual` and rejects timestamps older than **5 minutes** (replay
protection).

See `src/lib/n8n-webhook.ts` for the implementation:

- `signWebhookPayload(payload)` — signs a payload and returns `{ body, signature, timestamp }`
- `sendToN8n(webhookPath, payload)` — signs and sends a request to n8n
- `verifyWebhookSignature(body, signature, timestamp)` — verifies an incoming request

### Backward compatibility

The bridge also accepts the legacy `x-n8n-bridge-secret` header for existing
external integrations that haven't migrated to signed webhooks yet. This mode
does NOT have replay protection and should be migrated to signed webhooks.

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

# Bridge shared secret (used for HMAC-SHA256 signing)
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
Also set `N8N_WEBHOOK_URL` on the Railway web service so the bridge knows where to forward.

## Step 4: Set Railway environment variables

In your Railway web service variables (or `.env.local` for dev):

```bash
# The Railway n8n URL (e.g. https://n8n-production.up.railway.app)
N8N_WEBHOOK_URL=https://your-n8n-service.up.railway.app

# Shared secret — used for HMAC-SHA256 signing. Must match n8n's LITT_N8N_BRIDGE_SECRET.
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

## Step 6: Import the 7 workflows

In the n8n editor:
1. Click **Workflows** → **Import from File**
2. Import each file from `n8n/workflows/`:

| # | File | Trigger | Purpose |
|---|------|---------|---------|
| 1 | `01-new-lead.json` | Webhook `litt-new-lead` | Save lead → welcome email → notify owner → record campaign |
| 2 | `02-new-user.json` | Webhook `litt-user-created` | Onboarding state → email → award LiTTBits → first-action suggestions |
| 3 | `03-mission-automation.json` | Webhook `litt-mission-event` | Approved mission → external integrations → write results → update dashboard |
| 4 | `04-github-deployment.json` | Webhook `litt-deployment-event` | Record commit/deployment → notify failures → update project health |
| 5 | `05-stripe-entitlement.json` | Webhook `litt-stripe-entitlement` | Verify Stripe sig → update plan → add LiTTBits → billing event → receipt |
| 6 | `06-failure-alerts.json` | Schedule (every 5 min) | Watch failures/provider errors → system event → notify owner (no secrets) |
| 7 | `07-daily-owner-summary.json` | Schedule (daily 8AM) | Aggregate signups/prompts/upgrades/revenue/failures/missions → summary email |

3. Configure credentials for each node (Gmail OAuth, Supabase, Discord, etc.)
4. Activate the workflows

## Step 7: Configure external webhooks

Point external services to the bridge URL at **automate.litlabs.net**:

| Service | URL | Auth |
|---------|-----|------|
| Stripe | `https://automate.litlabs.net/api/n8n/webhook/litt-stripe-entitlement` | Signed webhook (preferred) or `x-n8n-bridge-secret` |
| GitHub | `https://automate.litlabs.net/api/n8n/webhook/litt-deployment-event` | Signed webhook (preferred) or `x-n8n-bridge-secret` |
| Custom | `https://automate.litlabs.net/api/n8n/webhook/{your-path}` | Signed webhook (preferred) or `x-n8n-bridge-secret` |

**Signed webhook (preferred):** Send the structured payload with `x-litt-signature`
and `x-litt-timestamp` headers. Use `sendToN8n()` from `src/lib/n8n-webhook.ts`.

**Legacy shared secret:** Include `x-n8n-bridge-secret: <secret>` header.
This is supported for backward compatibility but should be migrated.

## Step 8: Check n8n health

The Owner Console at `/owner` (admin only) shows a live n8n status card that
calls `/api/n8n/health`. This endpoint:
- Checks if `N8N_WEBHOOK_URL` is configured
- Pings n8n's `/healthz` endpoint
- Returns `{ configured, reachable, responseTime }`
- Does NOT expose n8n credentials or the editor URL

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
- All webhook requests are HMAC-SHA256 signed with `LITT_N8N_BRIDGE_SECRET`
- Signatures older than 5 minutes are rejected (replay protection)
- Legacy shared-secret auth is supported but should be migrated to signed webhooks
- n8n editor protected by basic auth
- Credentials stored encrypted in Postgres (N8N_ENCRYPTION_KEY)
- SSL enforced for Railway Postgres connection
- The Owner Console never exposes the n8n editor URL or credentials
- Social media automation is draft-and-approve only (n8n never bypasses LiTT approval)
- n8n never bypasses LiTT's approval system — all actions require `approvedAction`

## n8n License

n8n Community Edition uses the Sustainable Use License (fair-code):
- ✅ Use internally at LiTTree Lab Studios
- ✅ Build automations behind your product
- ❌ Do NOT rebrand and resell n8n itself as your product

For a MIT-licensed alternative, consider Activepieces Community Edition.
