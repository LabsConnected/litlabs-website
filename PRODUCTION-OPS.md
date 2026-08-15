# LiTLabs Production Operations

## Canonical Deployment Path

**Production domain:** https://litlabs.net
**Vercel project:** `litlabs` (canonical — owns `litlabs.net`)
**Git repo:** `LabsConnected/litlabs-website`
**Production branch:** `main` (protected — PR required, no direct pushes)

### Deployment flow
1. Develop on a feature branch (`feat/...` or `fix/...`)
2. Open a PR against `main`
3. Merge after review
4. Vercel auto-deploys from `main` via Git integration
5. Railway deploys `terminal-server` and `litt-voice-worker` via GitHub Action (`deploy-terminal.yml`) on changes to `terminal-server/**`

### Duplicate Vercel projects (do NOT use for production)
- `litlab-fresh` — duplicate Git integration, Node 24
- `litlabs-website` — duplicate Git integration, Node 24
- `litlabs-command-studio-v12` — stale, unlinked

Only the `litlabs` project deploys to `litlabs.net`.

## Rollback Procedures

### Vercel rollback (promote previous deployment)
1. Go to https://vercel.com/larrys-projects-db0e2aa2/litlabs
2. Find the last known-good deployment
3. Click "..." → "Promote to Production"
4. Verify `litlabs.net` serves the previous version

### Git revert (undo a bad commit on main)
```powershell
git switch main
git pull
git revert <bad-sha>
# Push the revert branch, then merge via PR
git push origin HEAD:revert/bad-sha
```
Never use `git reset --hard` or `git push --force` on published branches.

### Railway rollback (redeploy previous deployment)
1. Go to the Railway project (litlabs-terminal-server)
2. Select the service (litlabs-terminal-server or litt-voice-worker)
3. Find the last successful deployment in the Deployments tab
4. Click "Redeploy" on that deployment
5. Verify health: `curl https://litlabs-terminal-server-production-0be1.up.railway.app/health`

### Cloudflare rollback
- Cloudflare rules are versioned in the dashboard under "Audit Log"
- To revert a WAF/Access rule change, find the change in Audit Log and revert
- Never weaken security rules to make a single curl request pass

## Branch Policy

- `main` is the only production deployment source
- Feature branches are for development only
- No direct feature-to-production deploys
- `main` is protected: PR required, force-push blocked, deletion blocked
- Do not deploy from a feature branch unless explicitly approved for emergency production deployment

## CLI Branch Cleanup Guidance

- The feature branch `feat/litt-phase3b-hardened-executor` contains local stabilization fixes (lint, test path updates, missing exports)
- These fixes should be merged to `main` via a normal PR after validation
- PR #77 (if still open/draft) should be closed if its content is already merged — only the remaining delta should be in a new PR
- After merging stabilization fixes, the feature branch can be deleted

## Health Endpoints

| Endpoint | URL | Auth |
|---|---|---|
| App health | `https://litlabs.net/api/health` | Public |
| LLM health | `https://litlabs.net/api/llm/health` | Public |
| System health | `https://litlabs.net/api/system-health` | Auth required |
| Voice health | `https://litlabs.net/api/voice/health` | Public |
| Terminal server | `https://litlabs-terminal-server-production-0be1.up.railway.app/health` | Public |
| Voice worker | Internal only (Railway, no public URL) | Internal |

## Observability

- **Sentry:** Client + server error tracking via `@sentry/nextjs`
  - DSN: `NEXT_PUBLIC_SENTRY_DSN` env var
  - Sample rate: 10% in production, 100% in dev
  - Config: `sentry.client.config.ts`, `sentry.server.config.ts`
- **Cloudflare Insights:** Enabled via CSP header
- **Studio logging:** `studioLog()` writes to Supabase `agent_logs` table

## Known Issues

1. **3 pre-existing test failures** in `CommandStudio.routing.test.tsx` — Builder routing tests fail because `next/dynamic` with `ssr: false` doesn't render in jsdom. Not a production issue.
2. **7 high-severity dependency vulnerabilities** — all in transitive deps of `@browserbasehq/stagehand` and `@expo/metro-runtime`. No patched versions available for `image-size`. Accepted risk until upstream upgrades.
3. **Railway "Deploy failed" status** — both services are online from previous deploys. The latest deploy attempt fails due to a Railway CLI/token issue in the GitHub Action. Running instances are healthy.
4. **Duplicate Vercel projects** — `litlab-fresh` and `litlabs-website` are duplicate Git integrations that should be disconnected to avoid confusion.
