# LiTTree State Machines

> **Product direction document.** Defines canonical state definitions for
> all product entities. The server owns real state. Never infer status from
> frontend timers or optimistic UI. Status labels show current implementation
> state of each entity.

## Status legend

| Label | Meaning |
|---|---|
| IMPLEMENTED | Verified in current production code |
| PARTIAL | Infrastructure exists, but the journey is incomplete |
| PLANNED | Approved product direction, not yet implemented |
| LATER | Intentionally outside the near-term release |

---

## Durable product entities

```
User              — IMPLEMENTED (public.users with clerk_id)
Workspace         — PLANNED (concept only; no workspace table yet)
Project           — PARTIAL (studio_projects table is canonical)
ProjectSource     — PARTIAL (blank + github sources implemented)
Mission           — PARTIAL (missions table + executor exist)
MissionStep       — IMPLEMENTED (mission_steps table with status tracking)
AgentRun          — PARTIAL (agent_runs table exists, lifecycle incomplete)
Artifact          — PARTIAL (mission_artifacts table exists, delivery incomplete)
Approval          — IMPLEMENTED (mission_approvals table + resolve API)
Checkpoint        — PARTIAL (project_checkpoints table exists, rollback incomplete)
Integration       — PARTIAL (integration_* tables exist, sync incomplete)
Agent             — IMPLEMENTED (agents table + marketplace)
Entitlement       — PARTIAL (agent_entitlements + subscriptions exist)
UsageLedger       — PARTIAL (credit_ledger table exists, settlement incomplete)
ActivityEvent     — PARTIAL (project_activity table exists, surfacing incomplete)
```

## Project — PARTIAL

### Source types

```
managed          — PARTIAL (blank source_type implemented)
github           — IMPLEMENTED (github source_type with full GitHub App flow)
git_url          — PLANNED
upload           — PLANNED
website_import   — LATER
figma_import     — LATER
gitlab           — LATER
bitbucket        — LATER
```

### Project states

```
draft            — PLANNED (no draft state in current schema)
active           — PARTIAL (projects are created active)
paused           — PLANNED
archived         — PLANNED
deleted          — PLANNED (soft-delete not implemented)
```

### State transitions

```
draft → active       (first mission started) — PLANNED
active → paused      (user pauses) — PLANNED
paused → active      (user resumes) — PLANNED
active → archived    (user archives) — PLANNED
archived → active    (user unarchives) — PLANNED
any → deleted        (user deletes) — PLANNED
```

### Managed project requirements

A managed project is not a fake project. It must have:
- Real files — PARTIAL (`project_files` table exists)
- Assets — PARTIAL (`project_assets` table exists)
- Project memory — PARTIAL (`memories` table exists)
- Missions — IMPLEMENTED (`missions` table)
- Approvals — IMPLEMENTED (`mission_approvals` table)
- Checkpoints — PARTIAL (`project_checkpoints` table exists)
- Preview history — PARTIAL (`preview_captures` table exists)
- Results — PARTIAL (`mission_artifacts` table exists)
- Export capability — PLANNED

### Connected repository additions

A connected repository adds:
- Repository URL — IMPLEMENTED (stored on `studio_projects`)
- Branches — PARTIAL (default branch stored, branch switching PLANNED)
- Commits — PLANNED
- Pull requests — PLANNED
- CI status — PLANNED
- Deployment information — PARTIAL (`deployments` table exists)

### Export to GitHub — PLANNED

A managed project can be exported to GitHub with:
- Project files
- Clean initial commit
- README
- Environment-variable guide
- Deployment instructions
- LiTTree project metadata where appropriate

---

## Mission — PARTIAL

### Mission states

```
draft              — IMPLEMENTED (initial status)
planning           — PLANNED (no planning state in current schema)
awaiting_approval  — PLANNED (no awaiting_approval state yet)
queued             — PLANNED
running            — IMPLEMENTED (mission_runs with running status)
blocked            — PLANNED
completed          — IMPLEMENTED (mission_runs with completed status)

Alternative endings:
failed             — IMPLEMENTED (mission_runs with failed status)
cancelled          — IMPLEMENTED (cancel API exists)
rolled_back        — PLANNED
```

### Current implemented statuses

```
Mission:    draft | ready | running | paused | completed | failed | cancelled
MissionRun: pending | running | paused | completed | failed | cancelled
MissionStep: pending | running | waiting_approval | completed | failed | skipped
```

### State transitions (target)

```
draft → planning              — PLANNED
planning → awaiting_approval  — PLANNED
awaiting_approval → queued    — PLANNED
awaiting_approval → draft     — PLANNED
queued → running              — PLANNED
running → blocked             — PLANNED
blocked → running             — PLANNED
running → completed           — IMPLEMENTED
running → failed              — IMPLEMENTED
any active state → cancelled  — IMPLEMENTED
completed → rolled_back       — PLANNED
failed → draft                — PLANNED
```

### Mission required fields

A mission must contain:
- Goal — PARTIAL (name + description stored)
- Proposed plan — PARTIAL (graph stored, visualization PLANNED)
- Expected result — PLANNED
- Estimated credit cost or range — PLANNED
- Required permissions — PLANNED
- Current step — IMPLEMENTED (mission_steps with status)
- Activity history — PARTIAL (project_activity exists)
- Result — PARTIAL (mission_artifacts exists)
- Files or assets changed — PARTIAL (approvals track affected_files)
- Approval status — IMPLEMENTED
- Checkpoint — PARTIAL (table exists, auto-create PLANNED)

### Mission communication contract — PARTIAL

**Before work:** — PLANNED
**During work:** — PARTIAL
**After work:** — PARTIAL
**On failure:** — PARTIAL

Never show only "Something went wrong."

---

## MissionStep — IMPLEMENTED

### Step states

```
pending           — IMPLEMENTED
in_progress       — IMPLEMENTED (as "running")
waiting_approval  — IMPLEMENTED
completed         — IMPLEMENTED
skipped           — IMPLEMENTED
failed            — IMPLEMENTED
```

### State transitions

```
pending → in_progress    — IMPLEMENTED
in_progress → completed  — IMPLEMENTED
in_progress → failed     — IMPLEMENTED
pending → skipped        — IMPLEMENTED
failed → pending         — PLANNED (retry)
```

---

## Approval — IMPLEMENTED

### Approval states

```
requested          — IMPLEMENTED (as "pending")
approved           — IMPLEMENTED
rejected           — IMPLEMENTED (as "denied")
expired            — IMPLEMENTED (expires_at field exists)
superseded         — PLANNED
```

### State transitions

```
requested → approved     — IMPLEMENTED
requested → rejected     — IMPLEMENTED
requested → expired      — IMPLEMENTED
approved → superseded    — PLANNED
rejected → superseded    — PLANNED
```

### Approval requirements

Sensitive actions that require approval:
- Deployment to a public URL — PARTIAL
- Deletion of files or projects — PLANNED
- Sending emails or external API calls with real-world side effects — PLANNED
- Purchasing or installing agents — PARTIAL
- Modifying environment variables or secrets — PLANNED
- Any action that cannot be undone — PLANNED

**LiTT never performs sensitive actions without explicit user approval.**

---

## Checkpoint — PARTIAL

### Checkpoint states

```
created            — IMPLEMENTED (row created)
active             — PLANNED (no active flag in current schema)
restored           — PLANNED
superseded         — PLANNED
```

### State transitions

```
created → active          — PLANNED
active → superseded       — PLANNED
superseded → active       — PLANNED
active → restored         — PLANNED
```

### Checkpoint requirements

- Created before major changes — PLANNED (auto-create not implemented)
- Includes file state snapshot — PARTIAL (git_sha stored, file snapshot PLANNED)
- Includes mission state — PLANNED
- Includes project memory state — PLANNED
- Can be rolled back to at any time — PLANNED
- Rollback restores files, memory, and mission state — PLANNED

---

## Payment / Entitlement — PARTIAL

### Payment states

```
pending            — PARTIAL (Stripe integration exists)
completed          — PARTIAL
failed             — PARTIAL
refunded           — PLANNED
disputed           — PLANNED
```

### Entitlement states

```
active             — PARTIAL (agent_entitlements table exists)
expired            — PARTIAL
cancelled          — PLANNED
suspended          — PLANNED
revoked            — PLANNED
```

### State transitions

```
pending → completed     — PARTIAL
pending → failed        — PARTIAL
completed → refunded    — PLANNED
completed → disputed    — PLANNED

active → expired        — PARTIAL
active → cancelled      — PLANNED
active → suspended      — PLANNED
suspended → active      — PLANNED
suspended → revoked     — PLANNED
any → revoked           — PLANNED
```

---

## AgentRun — PARTIAL

### AgentRun states

```
queued             — PARTIAL (agent_runs table exists)
running            — PARTIAL
completed          — PARTIAL
failed             — PARTIAL
timeout            — PLANNED
cancelled          — PLANNED
```

### State transitions

```
queued → running         — PARTIAL
running → completed      — PARTIAL
running → failed         — PARTIAL
running → timeout        — PLANNED
running → cancelled      — PLANNED
queued → cancelled       — PLANNED
```

---

## Artifact — PARTIAL

### Artifact types

```
website_preview    — PARTIAL (preview_captures table exists)
image              — PARTIAL (project_assets table exists)
audio              — PARTIAL (tracks table exists)
video              — PLANNED
document           — PLANNED
code_change        — PARTIAL (approvals track affected_files)
research_report    — PLANNED
campaign           — PLANNED
deployment         — PARTIAL (deployments table exists)
downloadable       — PLANNED
```

### Artifact states

```
generating         — PLANNED
ready              — PARTIAL
published          — PLANNED
failed             — PLANNED
archived           — PLANNED
```

### State transitions

```
generating → ready      — PLANNED
generating → failed     — PLANNED
ready → published       — PLANNED
published → ready       — PLANNED
ready → archived        — PLANNED
published → archived    — PLANNED
```

---

## Critical rule

> **The server owns the real state.** Never infer "working," "completed,"
> or "healthy" from frontend timers. The frontend reflects server state; it
> does not create it.
