# Production Deployment Controls

## Overview

Production deployments are controlled through a single approval-gated mechanism.
No automatic deployments occur on merge to `main`.

## The Controlled Path

**Workflow:** `.github/workflows/deploy-production.yml`

1. A person triggers the workflow manually from GitHub Actions
2. They select a service and provide an exact commit SHA
3. The workflow verifies:
   - Service is in the allowed list
   - Commit is an ancestor of `main`
   - Required CI checks passed on that exact SHA
4. The `production` GitHub environment requires manual approval
5. Only after approval does the Railway deployment proceed
6. Health check verifies the deployment

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
