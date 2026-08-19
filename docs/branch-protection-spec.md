# Branch Protection Spec — `main`

Apply this **after** the `feat/agent-os-setup` PR is merged and CI is green.
Do not apply while checks are failing — a broken required-check config can lock
you out of merging fixes.

## How to apply

### Option A — `gh api` (recommended)

```powershell
gh api ``
  --method PUT ``
  repos/LabsConnected/litlabs-website/branches/main/protection ``
  -F required_status_checks[strict]=true ``
  -F required_status_checks[contexts][]="Build and Type Check" ``
  -F required_status_checks[contexts][]="Secret Scan (Gitleaks)" ``
  -F enforce_admins=true ``
  -F required_pull_request_reviews[required_approving_review_count]=1 ``
  -F required_pull_request_reviews[dismiss_stale_reviews]=true ``
  -F required_pull_request_reviews[require_code_owner_reviews]=false ``
  -F restrictions= ``
  -F allow_force_pushes=false ``
  -F allow_deletions=false
```

### Option B — GitHub UI

Settings → Branches → Branch protection rules → Add rule for `main`:

## Required settings

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ |
| Required approving reviews | 1 |
| Dismiss stale pull request approvals when new commits are pushed | ✅ |
| Require status checks to pass before merging | ✅ |
| Require branches to be up to date before merging | ✅ |
| Required status checks | `Build and Type Check`, `Secret Scan (Gitleaks)` |
| Require conversation resolution before merging | ✅ |
| Do not allow bypassing the above settings | ✅ (enforce on admins) |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

## Notes

- `Lighthouse` is not required (it's informational, not blocking).
- After applying, verify by opening a test PR: confirm direct pushes to `main`
  are rejected and the two required checks gate merging.
- If you add more CI workflows later, update `required_status_checks[contexts]`
  to include them.
