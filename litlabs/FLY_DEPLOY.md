# Deploying the Terminal Server to Fly.io

This is the more peaceful (and ~$20/mo cheaper) replacement for the Render
"standard" plan. Total expected cost: **~$4-6/mo** for a single always-on
`shared-cpu-1x` machine (1 vCPU / 2 GB RAM) in `iad`.

The Next.js app stays on Vercel/Cloudflare Pages. Only the **terminal server**
(Express + Socket.IO + node-pty) moves to Fly, because `node-pty` cannot run
on serverless.

---

## 1. Prerequisites

- A Fly.io account (you are signed in as `laidbacknostress4life@gmail.com`).
- A unique app name. `litlabs-terminal-server` is already reserved in `fly.toml`;
  if Fly says it's taken, change `app = "..."` in `fly.toml` to something like
  `litlabs-term-<your-handle>`.
- `flyctl` installed locally for volume + secrets + deploy:
  ```bash
  # macOS
  brew install flyctl
  # Windows (winget)
  winget install Fly.flyctl
  # or
  curl -L https://fly.io/install.sh | sh
  ```
  Then: `flyctl auth login`

## 2. Create the persistent volume (one-time)

The terminal server stores per-user workspaces in `/tmp/littree-workspaces`.
On Fly, that path must be backed by a volume so data survives redeploys.

```bash
cd /path/to/litlabs        # repo root, where fly.toml lives
flyctl volumes create littree_workspaces --size 1 --region iad
```

`--size 1` = 1 GB. Bump to `3` or `10` if you expect large workspaces.

## 3. Set secrets

These never go in `fly.toml` (it would leak them to git). Use `flyctl secrets set`:

```bash
flyctl secrets set \
  CLERK_SECRET_KEY="sk_test_..." \
  SUPABASE_URL="https://xxxx.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="ey..." \
  OPENROUTER_API_KEY="sk-or-..." \
  OLLAMA_BASE_URL=""            # leave blank if you don't self-host Ollama
```

Only `CLERK_SECRET_KEY` and `SUPABASE_*` are strictly required for the
terminal server to start; the others are optional integrations.

## 4. Deploy

Two options, pick whichever is easier for you.

### Option A — flyctl from your machine (no GitHub needed)

```bash
cd /path/to/litlabs
flyctl launch --no-deploy      # picks up existing fly.toml, just creates the app
flyctl deploy                  # builds Dockerfile.terminal and deploys
```

### Option B — GitHub auto-deploy (the UI you were just on)

1. In the Fly.io dashboard, click **"Manage GitHub integration"** and grant
   access to `LabsConnected`.
2. Choose repo `LabsConnected/litlabs-website`, branch `main`.
3. The `fly.toml` at the repo root will be auto-detected.
4. Push to `main` → Fly builds `Dockerfile.terminal` → deploys.

## 5. Verify

```bash
flyctl status                  # machine should be "running"
flyctl logs                    # tail startup
curl https://litlabs-terminal-server.fly.dev/health
# -> {"ok":true,"sessions":0,"docker":false,"clerk":true,"supabase":true}
```

Point your Next.js app's `NEXT_PUBLIC_TERMINAL_URL` (or equivalent) at
`https://<your-app>.fly.dev` and the Socket.IO connection on the frontend
should upgrade to websockets through Fly's HTTPS edge.

## 6. Teardown the Render service (save $25/mo)

Once the Fly deploy is healthy and your frontend is talking to it:

1. Render dashboard → `litlabs-terminal-server` → **Settings** → **Suspend Service**.
2. Watch a billing cycle to confirm $0, then **Delete Service**.

## Cost summary

| Item | Cost |
|---|---|
| Fly `shared-cpu-1x` always-on, 1 GB volume | ~$4-6/mo |
| Render Hobby plan (what we are leaving) | $5 + ~$25 usage = **~$30/mo** |
| **Monthly savings** | **~$24/mo** |

## Troubleshooting

- **`health check failing`** → `flyctl logs`, usually means a missing secret.
- **`node-pty: spawn ENOTSUP`** → image arch mismatch; the `npm rebuild node-pty`
  step in `Dockerfile.terminal` handles this, but if it persists, add
  `ARG TARGETARCH` and rebuild.
- **`Out of memory`** → bump `memory_mb = 2048` to `4096` in `fly.toml`.
- **Volume not mounting** → confirm the volume region matches
  `primary_region = "iad"` in `fly.toml`.
