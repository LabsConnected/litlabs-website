# Deployment Controls — terminal-server production

## The #650 incident (2026-10-10)

Merging PR #650 (commit `b9a80638`) triggered an **unwanted production deployment
of terminal-server** at ~22:21 EDT — via **Railway's native GitHub integration**.
The GitHub Actions workflow `.github/workflows/deploy-terminal.yml` had been
disabled via the GitHub API ~4 minutes earlier (22:21:33 EDT; API state
`disabled_manually`), but Railway's own integration was still set to auto-deploy
on push to `main` — and it fired on the merge.

**Lesson: the two deploy paths are independent. Disabling one does NOT disable
the other. Both must be audited, and both must stay audited.**

## The two deploy paths

### 1. GitHub Actions workflows (repo-controlled, auditable in git)

| Workflow | Trigger (file) | State |
|---|---|---|
| `deploy-terminal.yml` | push to `main` on terminal-server paths + manual dispatch | **DISABLED via API** (`disabled_manually`, verified 2026-10-10) — the file still contains push triggers; the disabled flag is what stops it |
| `release-terminal-production.yml` (new) | **release tags `terminal-prod-v*` + manual dispatch only** | The only approved path to production |

### 2. Railway native GitHub integration (Railway-dashboard-controlled, NOT in git)

Each Railway service has its own "auto-deploy on push" setting, configured in
the Railway dashboard per service — invisible to git, invisible to GitHub
Actions, and unaffected by disabling a workflow. On 2026-10-10 this was ON for
the production `terminal-server` service and fired on the #650 merge.

Per the owner, auto-deploy has since been turned **OFF on all 8 production
services** — re-verify in the Railway dashboard (this doc cannot verify it;
treat the claim as unchecked until the dashboard confirms).

## Required state (production)

- **Railway native auto-deploy: OFF** on every production service:
  `@litlabs/litt-shell`, `terminal-server`, `@litt/companion`,
  `litlabs-voice-proxy`, `@litlabs/litt-cli`, `@litt/agent-core`,
  `@litt/models`, `cli`.
- **`deploy-terminal.yml`: stays disabled** (or is retired/removed — owner
  decision; the disabled flag is load-bearing until then).
- **Production terminal-server releases: ONLY via
  `release-terminal-production.yml`:**
  1. A human pushes a `terminal-prod-v*` tag (or runs manual dispatch) —
     never on push-to-main, never on pull_request. A merge must never deploy.
  2. `resolve` pins the exact commit and proves it is on `origin/main`.
  3. `ci-gate` requires the blocking CI checks green on that commit
     (Terminal Server Tests, Build and Type Check, gitleaks) and fails closed
     on ANY failing check. Read-only; existing workflows are untouched.
  4. `deploy` runs only after the gate AND after a human approves the
     **`production` GitHub Environment**. Then it deploys via the Railway CLI
     (same mechanism as the old workflow), health-checks `/health/ready`,
     and verifies the deployed SHA matches the release commit.

## Owner setup required (cannot be done from a PR)

1. **Repo Settings → Environments → `production` → Required reviewers:**
   add the owner (and any backup approver). Without required reviewers the
   environment gate is a no-op and the workflow is NOT safe.
   (Note: existing environments such as `litlabs-terminal-server / production`
   currently have **no** protection rules — the new `production` environment
   must be configured with reviewers regardless.)
2. **Railway dashboard:** confirm auto-deploy is OFF on all 8 production
   services, and keep it off. Any re-enable silently bypasses this workflow.
3. **Decide the fate of `deploy-terminal.yml`:** keep disabled via API, or
   delete/retire the file so the push-to-main trigger cannot be
   re-enabled by accident.

## Audit checklist

Run before ANY production release, and monthly:

**GitHub Actions path**
- [ ] `deploy-terminal.yml` still `disabled_manually`
      (API: `GET /repos/LabsConnected/litlabs-website/actions/workflows/deploy-terminal.yml` → `state`)
- [ ] No other workflow gained a push-to-main trigger that deploys to production
      (grep `branches: [main]` together with deploy steps in `.github/workflows/`)
- [ ] `release-terminal-production.yml` triggers unchanged (tags + dispatch only)
- [ ] `production` environment still has required reviewers
      (Settings → Environments → `production`)

**Railway native path**
- [ ] Railway dashboard → each production service → auto-deploy **OFF**
- [ ] No production service tracks a branch that auto-deploys (`main`)
- [ ] After any Railway project/service change, re-run this checklist
