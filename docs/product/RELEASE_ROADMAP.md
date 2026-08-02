# LiTTree Release Roadmap

> **Product direction document.** Defines the implementation order. Each
> release lists its current status. Do not skip releases or build features
> out of order.

## Status legend

| Label | Meaning |
|---|---|
| IMPLEMENTED | Verified in current production code |
| PARTIAL | Infrastructure exists, but the journey is incomplete |
| PLANNED | Approved product direction, not yet implemented |
| LATER | Intentionally outside the near-term release |

---

## Guiding principle

> Deliver vertical slices, not disconnected systems.

A vertical slice means the user can complete something from beginning to end.
Building services in isolation while the user cannot finish anything is
failure.

## Bad implementation order (do not do this)

```
Build memory service
Build file service
Build agent service
Build approval service
Build dashboard widgets
```

Those can all exist while the user still cannot finish anything.

## Correct implementation order

```
User selects "Build a website"
→ project is created
→ LiTT produces a plan
→ user approves it
→ files are created
→ preview appears
→ user requests one change
→ checkpoint is created
→ result is saved
→ dashboard lets them continue later
```

That proves the whole product loop.

---

## Release 0 — Stable foundation — PARTIAL (in progress)

### User achievement

> "My work will not disappear or report false success."

### Required work

- Stable authentication — IMPLEMENTED (Clerk)
- Server-backed files — PARTIAL (`project_files` table exists, live runtime incomplete)
- Correct project ownership — IMPLEMENTED (`studio_projects` with `user_id`)
- Checkpoints and rollback — PARTIAL (table exists, rollback incomplete)
- Accurate terminal command results — PARTIAL (terminal server needs restoration)
- Correct conversation failure recovery — PARTIAL (canonical conversation service exists)
- Durable activity records — PARTIAL (`project_activity` table exists)
- Credit ledger accuracy — PARTIAL (`credit_ledger` table exists, settlement incomplete)
- Mobile-safe layouts — PARTIAL
- Production smoke tests — PARTIAL

### Release gate

- No data loss after refresh
- No cross-user leakage
- No false "success" status
- Rollback actually restores files
- Errors explain recovery
- All required CI checks green

**Do not aggressively promote the platform before this gate passes.**

### Branch

```
fix/studio-foundation-v1
```

---

## Release 1 — Easy first start — PLANNED

### User achievement

> "I created my first real result without understanding repositories."

### Build

- Goal-based onboarding — PLANNED
- Start with an idea — PLANNED
- Connect existing project — PARTIAL (GitHub connect works, other sources PLANNED)
- Explore a demo — PLANNED
- Managed project creation — PARTIAL (blank project creation works, full provisioning PLANNED)
- Starter templates — PARTIAL (3 templates exist: blank-static, nextjs, react-vite)
- Guided first mission — PLANNED
- Plain-language progress — PLANNED
- First-result screen — PLANNED
- Clear next action — PLANNED

### Default choices

```
Build a website
Create a brand
Make music or media
Build an application
Plan a campaign
Connect an existing project
Explore a demo
```

### Release gate

A new tester can produce a useful result without help, repository knowledge,
or API configuration.

### Branch

```
feat/onboarding-v1
feat/managed-projects-v1
```

---

## Release 2 — Mission operating system — PARTIAL

### User achievement

> "I understand what LiTT is doing and remain in control."

### Build

- Mission overview — PARTIAL (`missions` table + MissionForge UI exist)
- Plan visualization — PARTIAL (mission graph stored, visualization incomplete)
- Current step — IMPLEMENTED (`mission_steps` table with status tracking)
- Completed steps — IMPLEMENTED (`mission_steps` with `completed` status)
- Approval center — IMPLEMENTED (`mission_approvals` table + resolve API)
- Permission summary — PLANNED
- Credit estimate — PLANNED
- Files changed — PARTIAL (approvals track `affected_files`)
- Preview — PARTIAL (preview API exists)
- Result — PARTIAL (`mission_artifacts` table exists)
- Failure recovery — PARTIAL
- Stop and retry — IMPLEMENTED (cancel API exists)
- Checkpoint before major changes — PARTIAL (table exists, auto-create PLANNED)

### Every mission must answer

- What is the goal?
- What is happening now?
- What has changed?
- What needs approval?
- What will it cost?
- How can I undo it?
- What should I do next?

### Release gate

A user can start a mission, understand its progress, approve or reject
sensitive steps, see the result, and undo if needed.

### Branch

```
feat/mission-engine-v1
```

---

## Release 3 — Simple Mode and Pro Mode — PLANNED

### User achievement

> "The platform is easy when I need simplicity and powerful when I need
> control."

### Simple Mode — PLANNED

Show: conversation, mission, progress, preview, results, approvals,
plain-language changes.

### Pro Mode — PLANNED

Show: repository, branch, file explorer, diff, terminal, logs, checkpoints,
CI status, deployment, pull requests.

Both modes operate on the same project and same files.

### Release gate

A user can switch modes without duplicating, migrating, or losing the
project.

### Branch

```
feat/pro-mode-git-v1
```

---

## Release 4 — Results and continuity — PLANNED

### User achievement

> "I can leave and later continue immediately."

### Build

- Results library — PLANNED (`mission_artifacts` table exists, library UI PLANNED)
- Project timeline — PLANNED (`project_activity` table exists, timeline UI PLANNED)
- Recent meaningful result — PLANNED
- Current mission — PARTIAL (mission data exists, dashboard surfacing PLANNED)
- Next milestone — PLANNED
- Blockers — PLANNED
- Resume action — PLANNED
- Version comparison — PLANNED
- Export and download — PLANNED
- Deployment history — PARTIAL (`deployments` table exists, history UI PLANNED)
- Return notifications — PLANNED

### Dashboard priority order

1. Continue current project
2. Review pending approval
3. Open completed result
4. Start another project

### Release gate

A user can leave mid-mission, return later, and resume from the exact point
they left off.

### Branch

```
feat/results-continuity-v1
```

---

## Release 5 — Community and remixing — PLANNED

### User achievement

> "I published something real and another person can build from it."

### Build

- Public creation pages — PLANNED
- Creator profile — PARTIAL (user profiles exist, creator pages PLANNED)
- Final result — PLANNED
- Original mission — PARTIAL (mission data exists, public surfacing PLANNED)
- Build highlights — PLANNED
- Tools and agents used — PARTIAL (agent data exists, surfacing PLANNED)
- Appreciation — PLANNED
- Comments — PLANNED
- Save — PLANNED
- Share — PLANNED
- Remix — PLANNED
- Attribution — PLANNED
- Privacy controls — PARTIAL (project `access_mode` field exists)
- Reporting and moderation — PLANNED

### Remix flow

```
Open creation
→ Remix
→ create private copy
→ preserve attribution
→ ask what should change
→ create new mission
→ produce personalized result
```

### Release gate

A user can publish a creation, and another user can remix it into a new
project with attribution preserved.

### Branch

```
feat/community-remix-v1
```

---

## Release 6 — Marketplace production — PARTIAL

### User achievement

> "I understand exactly what an agent does, buy it safely and get a result."

### Finish

- Real production Stripe prices — PARTIAL (Stripe integration exists, production prices need verification)
- Production migrations — PARTIAL (marketplace tables exist)
- Verified webhooks — PARTIAL (webhook routes exist, verification needed)
- Permission review — PLANNED
- Install/open flow — IMPLEMENTED (marketplace install flow exists)
- Guided first run — PLANNED
- Usage and credit reporting — PARTIAL (`agent_entitlements` table exists)
- Refund handling — PLANNED
- Agent version history — PARTIAL (`agent_versions` table exists)
- Disable/uninstall — PARTIAL
- Outcome-focused listings — PLANNED

### Agent pages must explain

- Exact result
- Ideal user
- Example mission
- Example output
- Required permissions
- Credit usage
- Purchase model
- Update policy
- Privacy behavior
- Limitations

### Release gate

A user can discover an agent, understand what it does, purchase it, install
it, run a guided first mission, and get a result. The complete
purchase-to-result journey works.

### Branch

```
feat/marketplace-production-v1
```

---

## Release 7 — Retention and growth — PLANNED

### User achievement

> "My work keeps progressing, so I have a reason to return."

### Build

- Daily or weekly project brief — PLANNED
- Pending approval notifications — PARTIAL (notifications table exists)
- Completed result notifications — PLANNED
- Community feedback alerts — PLANNED
- Suggested next milestone — PLANNED
- Project progress summaries — PLANNED
- Useful agent recommendations — PLANNED
- Conversion analytics — PLANNED
- Referral/remix attribution — PLANNED

### Release gate

Users return because their work is progressing—not because they are spammed.

### Branch

```
feat/product-analytics-v1
```

---

## The single first-release target

> A visitor signs up, chooses "Build a website," receives a managed project,
> approves a mission, watches LiTT create a working preview, saves the
> result, leaves, and later resumes from the dashboard—without ever needing
> GitHub.

Once that works reliably, GitHub and Pro Mode become an upgrade—not a
barrier.

---

## Branch structure

```
main
feat/landing-page-wow-v2
fix/studio-foundation-v1
feat/managed-projects-v1
feat/onboarding-v1
feat/mission-engine-v1
feat/results-continuity-v1
feat/pro-mode-git-v1
feat/community-remix-v1
feat/marketplace-production-v1
feat/product-analytics-v1
```

## Branch rules

- One outcome per branch
- One owner per branch
- No experimental work directly on `main`
- No giant mixed-purpose PR
- Open draft PR early
- Vercel Preview for user-facing work
- Rebase before final validation
- Do not resolve review comments until the code is actually fixed
- Do not merge based only on an agent's written report

Limit concurrent code work to surfaces that do not overlap. Two coordinated
branches are safer than six agents editing shared files.

## Feature flags

Large experiences launch behind flags:

```
LANDING_V2
MANAGED_PROJECTS_V1
ONBOARDING_V1
MISSION_ENGINE_V1
PRO_MODE_V1
COMMUNITY_REMIX_V1
MARKETPLACE_PAID_V1
```

Flags allow:
- Preview privately
- Test with selected users
- Disable broken behavior
- Deploy code before public activation
- Compare old and new experiences

**Do not use feature flags to preserve permanent duplicate systems.** Once
a replacement is stable, remove the old version.
