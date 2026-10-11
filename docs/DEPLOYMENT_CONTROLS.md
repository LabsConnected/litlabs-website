# Production deployment controls

Goal: nothing reaches production unless a person chose it, CI passed on that exact commit, and an approver clicked approve.

## Deploy paths (each must be controlled)
| Path | Control |
|---|---|
| GitHub Action `deploy-terminal.yml` | Manual only (`workflow_dispatch`); verifies commit is on `main` and required checks are green; the `production-terminal` environment requires approval. |
| Railway native GitHub integration (terminal server, web, others) | In Railway: service -> Settings -> Source: turn Autodeploy OFF, or enable "Wait for CI". Do this for EVERY service connected to this repo, in the production environment. |
| `cron-deploy-digest.yml` | Calls the production digest endpoint on a schedule. Not a code deploy. |
| `/api/deploy/trigger` | Needs `RAILWAY_API_TOKEN`; review who can call it. |
| Database migrations | Never applied automatically. Apply by hand after approval, staging first. |

## One-time setup (owner)
1. GitHub -> Settings -> Environments -> New environment `production-terminal`.
   Required reviewers: the owner. Deployment branches: `main` only. Move `RAILWAY_TOKEN` into this environment's secrets.
2. Railway: disable Autodeploy (or enable Wait for CI) on each production service. Record screenshots in the PR.
3. GitHub -> Settings -> Branches: protect `main` (require PR + the checks named in `REQUIRED_CHECKS`).

## Releasing
Actions -> "Deploy Terminal Server (manual, CI-gated)" -> Run workflow -> paste the full commit SHA -> approve when prompted.
