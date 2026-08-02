# LiTTree User Journeys

> **Product direction document.** Defines the target user journeys. Many
> capabilities described here are PLANNED, not IMPLEMENTED. See status labels.

## Status legend

| Label | Meaning |
|---|---|
| IMPLEMENTED | Verified in current production code |
| PARTIAL | Infrastructure exists, but the journey is incomplete |
| PLANNED | Approved product direction, not yet implemented |
| LATER | Intentionally outside the near-term release |

---

## The complete user journey

```
Discover
   ↓
Choose a goal                          — PLANNED (goal-based onboarding)
   ↓
Start without setup                    — PLANNED (managed project creation)
   ↓
LiTT creates a mission                 — PARTIAL (mission table + executor exist)
   ↓
User sees progress                     — PARTIAL (mission steps tracked server-side)
   ↓
User reviews and approves              — IMPLEMENTED (mission_approvals table + API)
   ↓
A real result is produced              — PARTIAL (artifacts table exists, result delivery incomplete)
   ↓
Save, publish, export, deploy or remix — PARTIAL (preview exists; deploy/export/remix PLANNED)
   ↓
Return and continue                    — PARTIAL (project memory exists, resume flow incomplete)
```

## Three user personas

### 1. Beginner — "I have an idea"

Does not know repositories, branches, APIs, or deployment. Has a goal:
build a website, design a brand, make music, create a video concept, plan a
business, write content, build an app.

**Needs:** Zero setup. Plain language. Visible progress. Clear results.
No technical jargon. Managed project that just works.

**First session target:** Produce one meaningful result without help.

### 2. Creator — "I make things"

Knows what they want to produce (music, art, campaigns, content). May not
know code but knows creative tools. Wants quality output and brand
consistency.

**Needs:** Creative-focused tools. Image generation, copywriting, audio,
branding. Templates. Remix capability. Publishing.

**First session target:** Produce a complete creative package (e.g., cover
art + social posts + press kit).

### 3. Developer — "I build software"

Knows Git, repositories, frameworks, deployment. Wants real files, diffs,
terminals, CI, PRs, and full control.

**Needs:** Pro Mode. GitHub integration. Branch selection. Diff viewer.
Terminal. Checkpoints. Deployment. Export.

**First session target:** Connect a repo, get a project audit, fix an issue
or add a feature, deploy.

## Three entry paths

When users enter Studio for the first time, they get three clear choices. — PLANNED

### Path 1: Start with an idea — PLANNED

Best for most users. No repository, provider key, or technical setup needed.

Options:
- Build a website
- Design a brand
- Make music
- Create a video concept
- Plan a business
- Write content
- Build an app
- Surprise me

LiTT creates a **managed project** behind the scenes. The user never needs
to know Git.

**Current state:** Managed (blank) project creation is IMPLEMENTED via
`/api/studio-projects` with `source_type: "blank"`. Goal-based onboarding
UI is PLANNED.

### Path 2: Bring an existing project — PARTIAL

Best for developers and users with existing work.

Options:
- Connect GitHub — IMPLEMENTED (`/api/studio-projects` supports `source_type: "github"`)
- Paste a Git URL — PLANNED
- Upload ZIP — PLANNED
- Upload files — PLANNED
- Connect GitLab or Bitbucket — LATER
- Scan an existing website — LATER
- Import from Figma — LATER

After import, LiTT explains:
- What it found — PARTIAL (project scans table exists)
- Which framework it uses — PARTIAL (detected on project creation)
- Whether it builds — PLANNED
- Current problems — PLANNED
- Suggested next mission — PLANNED
- What permissions are required — PARTIAL

### Path 3: Explore a working demo — PLANNED

Best for visitors who are not ready to sign up.

They can:
- Open a sample project
- Ask LiTT to change something
- Watch the preview update
- Explore files and mission history
- See an approval request
- Understand the product before registering

No account required. No data persisted. Session-only.

**Current state:** Studio requires sign-in. No anonymous tour exists.

## Time-based achievement targets

### First 10 seconds

The visitor understands:
- LiTTree helps turn ideas into finished digital work
- LiTT is the main operator
- It does more than answer questions
- They can begin free

### First 2 minutes

The user:
- Chooses what they want to make — PLANNED
- Names or describes the project — PARTIAL
- Receives a useful starting mission — PARTIAL
- Sees a preview, draft, plan, or initial result — PARTIAL

No settings maze. No provider configuration. No repository requirement.

### First 10 minutes

The user completes one meaningful win:
- A landing-page draft
- A generated brand direction
- A working app screen
- A song concept
- A social campaign
- A project audit
- A repaired code issue
- A published creation page

This is the first **magic moment**.

### First session

The user understands:
- Where their project is stored — PARTIAL
- What LiTT remembers — PARTIAL (memory service exists)
- Which files or assets were created — PARTIAL (project_files table exists)
- What requires approval — IMPLEMENTED
- How to undo something — PARTIAL (checkpoints exist, rollback incomplete)
- How to continue later — PARTIAL
- How credits or paid actions work — PARTIAL (credit_ledger exists)

### First week

The user can:
- Return to a project — PARTIAL
- Continue from the last mission — PARTIAL
- Finish another milestone — PLANNED
- Share or publish something — PLANNED
- Install an agent or template — IMPLEMENTED (marketplace install flow exists)
- Remix a community creation — PLANNED
- Invite someone or collect feedback — PLANNED
- See measurable project progress — PLANNED

## Achievement ladder — PLANNED

Achievements are tied to real progress, not meaningless actions.

| Level | Achievement         | Meaning                               |
| ----- | ------------------- | ------------------------------------- |
| 1     | Idea Captured       | Created the first project             |
| 2     | First Mission       | Gave LiTT a clear outcome             |
| 3     | First Result        | Produced a real artifact              |
| 4     | Director            | Reviewed or changed LiTT's plan       |
| 5     | In Control          | Used an approval or checkpoint        |
| 6     | Project Builder     | Completed multiple project milestones |
| 7     | Published           | Shared or launched real work          |
| 8     | Remixer             | Built on another creation             |
| 9     | Collaborator        | Worked with another person            |
| 10    | Creator Pro         | Finished and shipped several projects |

Achievements unlock:
- New templates
- Cosmetic profile items
- Extra showcase layouts
- Community visibility
- Limited bonus credits
- Advanced Studio tips

**Essential functionality is never locked behind achievements.**

## Dual-mode Studio — PLANNED

### Simple Mode (default for new users)

Shows:
- Conversation
- Mission goal
- Current activity
- Preview/result
- Approval requests
- Files changed in plain language
- Continue button

Hides advanced complexity. Instead of:
> Modified `src/app/page.tsx`

Says:
> Updated your homepage layout and headline.

Technical file information is still accessible behind an expandable control.

### Pro Mode (user-selectable)

Shows:
- Repository
- Branch
- Diff
- File explorer
- Terminal
- Checkpoints
- Logs
- Environment status
- Deployment status
- Advanced agent controls

**Critical:** Simple Mode and Pro Mode use the same underlying project. A
user can switch modes without changing projects or losing work. Do not
create separate simplified projects that cannot later become real
repositories.

## Repository strategy

### Managed project (default) — PARTIAL

LiTTree stores:
- Files — PARTIAL (`project_files` table exists)
- Assets — PARTIAL (`project_assets` table exists)
- Missions — IMPLEMENTED (`missions` table + repository)
- Decisions — PARTIAL (memory service exists)
- Checkpoints — PARTIAL (`project_checkpoints` table exists)
- Preview history — PARTIAL (`preview_captures` table exists)
- Approvals — IMPLEMENTED (`mission_approvals` table + API)
- Results — PARTIAL (`mission_artifacts` table exists)

The user does not need to know Git.

### Connected repository (optional, for power users) — PARTIAL

LiTTree additionally supports:
- Branch selection — PARTIAL (branch stored on studio_projects)
- Commits — PLANNED
- Pull requests — PLANNED
- Diffs — PLANNED
- CI status — PLANNED
- Deployment — PARTIAL (`deployments` table exists, external pipeline)
- Rollback — PARTIAL (checkpoints exist, full rollback PLANNED)
- Collaborators — PLANNED

### Upgrade path — PLANNED

A managed project can later be exported to GitHub with:
- Project files
- Clean initial commit
- README
- Environment-variable guide
- Deployment instructions
- LiTTree project metadata where appropriate

This bridges beginners into professional ownership without trapping them.
