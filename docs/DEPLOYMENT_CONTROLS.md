# Production Deployment Controls

## Overview

Production deployments are controlled through a single approval-gated mechanism.
No automatic deployments occur on merge to `main`.

## The Controlled Path

**Workflow:** `.github/workflows/deploy-production.yml`

1. A person triggers the workflow manually from GitHub Actions
2. They select a service, provide an exact commit SHA, and type the authorization phrase `DEPLOY <service> <first 8 chars of sha>`
3. The workflow verifies:
   - Service is in the allowed list
   - Commit is an ancestor of `main`
   - The authorization phrase matches exactly
   - Required CI checks (`Build and Type Check`, `gitleaks`) passed on that exact SHA
4. The `production` GitHub environment requires manual approval
5. Only after approval does the Railway deployment proceed
6. Health check verifies the live endpoint reports the deployed commit (fails the run otherwise)

## Required GitHub Configuration

### Environment: `production`

Configure at: Repository → Settings → Environments → New environment → `production`

**Required settings:**
- ✅ Required reviewers: Add at least one person (Larry)
- ✅ Deployment branches: Only `main`
- ❌ Administrators bypass: Disabled (no bypass)

**Secrets (to be added by repository owner):**
- `RAILWAY_TOKEN`: Scoped Railway API token for production deployments

### What NOT to do

- Do NOT add `RAILWAY_TOKEN` as a repository-level secret
- Do NOT enable auto-deploy on any Railway production service
- Do NOT add `push:` triggers to deployment workflows

## Railway Configuration

For every production service:
1. Settings → Source → Auto-deploy: **OFF**
2. Keep GitHub connected as build source (needed for manual rebuilds)
3. Deployments happen only via:
   - The controlled GitHub workflow (preferred)
   - Manual "Deploy" button in Railway dashboard (emergency only)
   - `railway up` CLI with production token (emergency only)

## Rollback

If a deployment causes issues:

1. Go to Railway → Project → Service → Deployments
2. Find the previous healthy deployment
3. Click ⋯ → Redeploy

Or via the controlled workflow: deploy the previous known-good SHA.

## Monitoring

The `audit-deployment-controls.yml` workflow runs daily and on PRs touching
`.github/workflows/` to detect unauthorized deployment paths.

## Production targets (verified in Railway, Oct 21 2026)

Services are addressed by Railway service ID, never by name (the two Railway projects contain same-named services).

| Alias | Railway project / service | Public health URL |
|---|---|---|
| `litt-shell` | litlabs-website / @litlabs/litt-shell | https://www.litlabs.net/api/health |
| `terminal-server` | litlabs-website / terminal-server | https://terminal-server-production-68ac.up.railway.app/health |
| `web-app` | litlabs-terminal-server / web | https://app.litlabs.net/api/health |
| `terminal-server-prod` | litlabs-terminal-server / litlabs-terminal-server | https://terminal.litlabs.net/health |
| `cli`, `litt-models`, `voice-proxy`, `voice-worker` | various | none (verify in Railway) |

There are TWO live terminal servers: `litt-shell` calls `terminal-server` (68ac) server-side, while browsers connect to
`terminal.litlabs.net` (`terminal-server-prod`). A web release must deploy BOTH at the same SHA. The hourly Release Gate
checks all four public endpoints and compares the first 8 characters of each reported SHA with `main`.

## Release order (never skip)

1. All required checks green on the exact commit; Secret scanning green on main.
2. Staging validated with the same commit; database migrations applied to staging first, production only with explicit owner approval.
3. Deploy terminal servers, then `litt-shell` and `web-app`, each through the workflow above.
4. Confirm the Release Gate is green and `/api/health` commit equals the release commit.

## Rollback

Record the currently live commit of every target before deploying (`/api/health`, `/health`).
- Fastest: Railway > service > Deployments > previous SUCCESS deployment > Redeploy.
- Or run the workflow again with the previous known-good SHA (it must be an ancestor of main).
- Database migrations are NOT rolled back by a redeploy: take a Supabase backup first and keep a down-migration.
