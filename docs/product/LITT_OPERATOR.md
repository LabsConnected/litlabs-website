# LiTT Operator — Agent Control Architecture

## The principle

Terminal, Browser, Computer, Code, Voice are not separate features. They're all capabilities of **one LiTT Operator**.

## 4 Levels of Control

```
LITT CORE
   │
   ├── 1. Workspace Control
   │      files / git / terminal / tests / preview
   │
   ├── 2. Browser Control
   │      websites / forms / dashboards / uploads
   │
   ├── 3. Cloud Computer
   │      full desktop apps inside isolated VM
   │
   └── 4. My Computer
          paired local LiTT Bridge Desktop
```

Build in this order. Do NOT start with direct control of somebody's personal desktop.

## Level 1: Workspace Control

The strongest foundation. LiTT needs real typed tools for project operations.

### Tool inventory

```
files.read          — read file contents
files.patch         — apply targeted patch
files.create        — create new file
files.delete        — delete file (risk-classified)

workspace.exec      — execute bounded command with timeout + risk level
workspace.process.start
workspace.process.stop

git.status
git.diff
git.branch
git.commit
git.push
git.pull_request

checks.typecheck
checks.lint
checks.test
checks.build

preview.start
preview.stop
preview.inspect
```

### Architecture

Real execution happens in an **isolated execution plane**, not directly inside serverless app hosts. Ownership checks and bounded commands. Control-plane / execution-plane split.

### Shell is the escape hatch, not the primary interface

Bad:
```
shell("random arbitrary command")
```

Better:
```
workspace.exec({ command, cwd, timeout, riskLevel })
```

Best (whenever possible):
```
git.status()
git.diff()
checks.test()
preview.start()
files.read()
```

## Level 2: Browser Control

The near-term money maker. Lets users say:

> "Go into Shopify and update these products."
> "Open my website and test every page."
> "Fill this application out but ask me before submitting."
> "Log into WordPress and change the homepage."
> "Upload these images to my business listing."

### Architecture

```
LiTT
 ↓
BrowserAdapter
 ↓
Playwright (deterministic — accessibility snapshots, element references)
```

Optionally:
```
BrowserAdapter
├── Local Playwright       (deterministic, fast)
└── Browserbase + Stagehand (managed cloud, persistent sessions, observability, AI-native)
```

### Why Playwright first

Playwright MCP works from accessibility snapshots and element references instead of blindly guessing screen coordinates. Exposes navigation, clicking, typing, dragging, screenshots, network/storage/testing, and persistent sessions.

### Priority hierarchy for ALL agent control

```
1. API                    (best — structured, reliable)
2. DOM / accessibility    (Playwright, web)
3. OS UI Automation       (winapp ui, Windows)
4. Shell                  (PowerShell / PTY)
5. Visual computer-use    (screenshot + coordinates — last resort)
```

**Do not use screenshot/coordinate clicking when a structured API exists.** This makes LiTT faster and far less hallucination-prone.

## Level 3: Cloud Computer

For apps that aren't websites: LibreOffice, desktop IDE, file manager, GUI utilities, legacy software.

### Architecture

```
LiTT → E2B Desktop → isolated Linux desktop with VNC
```

E2B Desktop provides isolated Linux desktops with VNC live viewing plus mouse, keyboard, screenshot, scrolling, drag/drop and terminal operations.

### UX

```
Computer
────────────────
● LiTT controlling

[ LIVE DESKTOP ]

Current task:
Preparing spreadsheet...

[Pause] [Take Over] [Stop]
```

LiTT learns full computer operation **without risking the user's actual laptop**.

## Level 4: LiTT Bridge Desktop

Install on Windows. Paired local agent.

```
litlabs.net
    │
    │ encrypted authenticated connection
    ▼
LiTT Bridge Desktop
    │
    ├── Browser          → Playwright
    ├── Native Windows UI → Windows UI Automation / winapp ui
    ├── Shell            → PowerShell / PTY
    ├── Files            → LiTT Bridge filesystem API
    ├── Screen           → computer-use vision (fallback only)
    ├── Clipboard
    └── Notifications
```

Windows has command-line UI Automation tooling for AI agents: `winapp ui` can inspect and interact with WPF, WinForms, Win32, Electron, and WinUI apps through Windows UI Automation.

## Command system — cleanup

### Current problem: too many top-level commands

The existing slash-command set has 30+ commands with overlapping purposes. Reduce to a clean, composable set.

### Reduced command set

| Command | Purpose |
|---|---|
| `/build` | Build something |
| `/fix` | Diagnose + fix |
| `/run` | Execute command/workflow |
| `/test` | Test current project |
| `/browser` | Browser control |
| `/computer` | Desktop/computer control |
| `/code` | Code actions |
| `/files` | Files/assets |
| `/git` | Git/GitHub |
| `/preview` | Preview |
| `/deploy` | Deployment |
| `/image` | Images |
| `/video` | Video |
| `/audio` | Music/audio |
| `/agent` | Agent configuration |
| `/memory` | Project/LiTT memory |
| `/screen` | Screen context |
| `/camera` | Camera |
| `/voice` | Voice |
| `/rollback` | Restore checkpoint |
| `/explain` | Teaching/explanation |
| `/help` | Discover capabilities |

### Composable usage

```
/fix mobile navbar
/code review current file
/git status
/git diff
/test mobile
/browser inspect checkout
/deploy preview
/explain selected code
```

No need for separate `/fix-mobile`, `/review-code`, `/run-tests`, `/check-errors` — they're aliases at most.

## Risk classification

Every operation gets classified.

### GREEN — automatic (no approval)

```
pwd, ls, cat
git status, git diff
read files
typecheck, lint, tests
browser inspect, screenshots
preview start/stop
```

### YELLOW — allowed in ACT/AUTO

```
edit files
install normal project dependencies
create files
browser form input
start server
create branch
```

### ORANGE — approval required

```
commit
push
pull request
publish content
submit important forms
change production data
```

### RED — explicit confirmation + extra safeguards

```
production deploy
delete repository/data
purchase/payment
account/security changes
privileged OS modifications
```

### Audit log

Every action records:

```
who     — user ID
what    — tool + parameters
where   — project / workspace / URL
when    — timestamp
result  — success/failure + output
approval — who approved, when
evidence — screenshot/log/diff
```

## PLAN / ACT / AUTO with operator control

### PLAN

LiTT can see, inspect, read, research, plan. **No mutations.** No browser actions beyond inspect/screenshot.

### ACT

LiTT can click, type, edit, run — but stays tightly within the requested task. Pauses at ORANGE risk level.

### AUTO

LiTT can inspect, act, observe, diagnose, retry, verify, continue until complete.

**Always requires approval for:**
- Purchases
- Sending messages as the user (when consequential)
- Publishing
- Production deployment
- Deleting important data
- Changing authentication/security
- Privileged OS changes

## Take Over / Give Back

When LiTT controls browser/computer:

```
┌──────────────────────────────┐
│ ● LiTT IS CONTROLLING        │
│                              │
│ [Pause] [Take Over] [Stop]   │
└──────────────────────────────┘
```

If user moves mouse / touches keyboard:

```
You took control.

LiTT paused.
[Resume LiTT]
```

This makes the feature feel **trustworthy instead of creepy**.

## LiTT Replay

Every agent run is replayable:

```
Task: Update homepage

01 Opened website
02 Inspected hero
03 Opened Studio
04 Edited Hero.tsx
05 Tested preview
06 Checked mobile
07 Completed
```

Stored as a sequence of `LiTTActivityEvent`s (see `LITT_ACTIVITY_STATES.md`). Can be replayed in the UI as a timeline. Browserbase sessions also support session recordings for browser-specific replay.

## The operator UX

### Split view during browser/computer control

```
┌─────────────────────────────┬─────────────────────────┐
│ LiTT                         │ LIVE BROWSER            │
│                              │                         │
│ ✓ inspecting                 │ user can watch          │
│ → fixing navbar              │ LiTT click/type/test    │
│ ○ testing                    │                         │
├─────────────────────────────┴─────────────────────────┤
│ Terminal / Activity / Changes                         │
└───────────────────────────────────────────────────────┘
```

### Pre-run confirmation

```
LiTT · Preparing

✓ Project identified
✓ Workspace ready
✓ Browser available
✓ Preview running

I'll inspect the site and code.
No production changes without approval.

[Begin]
```

### During run

```
LiTT · Working

✓ Opened homepage
✓ Found mobile overflow
✓ Located source component
→ Editing navigation
→ Running tests
```

## What makes money

Not "LiTT can move your mouse." That's a demo.

Sell outcomes:

| Audience | Pitch |
|---|---|
| Small business | "LiTT manages and updates your website." |
| Creator | "LiTT creates, uploads and publishes your campaign." |
| Developer | "LiTT fixes, tests and ships your code." |
| Agency | "LiTT maintains client sites and handles repetitive web work." |
| Beginner | "Tell LiTT what you need and watch it do it." |

**Delegated work with proof.** That's the money feature.

## Implementation phases

### Phase 1 — LiTT Workspace Operator

- files (read, patch, create, delete)
- terminal (bounded exec, PTY)
- git (status, diff, branch, commit, push, PR)
- preview (start, stop, inspect)
- tests (typecheck, lint, test, build)
- diffs + checkpoints
- Activity events for all operations
- Risk classification + approval gates
- Audit log

### Phase 2 — Browser Operator

- Playwright integration (local)
- Browser live view in Studio
- Screenshots
- Click / type / form interactions
- Persistent authenticated browser sessions
- Browserbase + Stagehand for cloud browser
- Approval gates for form submission / purchases
- Replay (browser session recordings)
- Take Over / Give Back

### Phase 3 — Cloud Computer

- E2B Desktop integration
- VNC live view in Studio
- Desktop screenshots / mouse / keyboard
- Terminal + desktop combined
- Take Over / Give Back
- Replay

### Phase 4 — LiTT Bridge Desktop

- Windows desktop app
- Encrypted connection to litlabs.net
- Playwright browser (local)
- Windows UI Automation (winapp ui)
- Local terminal (PowerShell / PTY)
- File system access
- Screen (fallback)
- Clipboard
- Notifications
- Take Over / Give Back

### Phase 5 — Cross-device Operator

```
Web Studio
Phone
Mobile
VS Code/Windsurf
Windows desktop

        ↓

     SAME LiTT
```

All surfaces connect to the same LITT CORE. Same conversation, same project, same tools, same activity events.

## Tool type definitions

```ts
interface ToolDescriptor {
  name: string;                // "files.read"
  category: "workspace" | "browser" | "computer" | "git" | "checks" | "preview" | "media";
  riskLevel: "green" | "yellow" | "orange" | "red";
  requiresApproval: boolean;
  parameters: Record<string, { type: string; required: boolean; description: string }>;
  returns: { type: string; description: string };
}

interface ToolExecution {
  runId: string;
  tool: string;
  parameters: Record<string, unknown>;
  riskLevel: "green" | "yellow" | "orange" | "red";
  approved: boolean;
  approvedBy?: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "blocked";
  output?: unknown;
  evidence?: { type: "screenshot" | "log" | "diff" | "video"; url: string };
}
```

## Database schema

```sql
CREATE TABLE studio_tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  conversation_id UUID NOT NULL,
  project_id TEXT,
  tool TEXT NOT NULL,
  parameters JSONB NOT NULL,
  risk_level TEXT NOT NULL,
  approved BOOLEAN DEFAULT false,
  approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  output JSONB,
  evidence JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_tool_exec_run ON studio_tool_executions(run_id);
CREATE INDEX idx_tool_exec_conversation ON studio_tool_executions(conversation_id);
```

## Existing codebase mapping

| Concept | Current |
|---|---|
| Terminal | `useTerminalStore`, PTY connection |
| Files | File tree in inspector, `files.read` via API |
| Git | GitHub integration, branch display |
| Preview | `PreviewWorkspace` |
| Checks | Typecheck/lint in build pipeline |
| Browser | Not built |
| Computer control | Not built |
| Tool registry | `executeBusinessTool` |
| Approvals | `pendingApproval` on messages |
| Activity | `toolActivity` on messages (needs upgrade to events) |

### What needs to change

1. **Typed tool registry** — Replace ad-hoc tool execution with typed `ToolDescriptor`s
2. **Risk classification** — Classify every tool with green/yellow/orange/red
3. **Approval gates** — Block orange/red tools until approved
4. **Audit log** — `studio_tool_executions` table
5. **Playwright integration** — Browser adapter for Level 2
6. **Live browser view** — Stream browser screenshots / VNC into Studio
7. **Take Over / Give Back** — Input conflict detection + pause/resume
8. **Replay** — Store event sequence, render as timeline
9. **Command cleanup** — Reduce to 22 composable commands
10. **E2B Desktop** — Cloud computer for Level 3 (post-P0)
11. **LiTT Bridge Desktop** — Windows app for Level 4 (post-P0)

## Relationship to other specs

| Spec | Relationship |
|---|---|
| `LITT_CORE_ARCHITECTURE.md` | Operator tools are part of LITT CORE's tool layer |
| `LITT_ACTIVITY_STATES.md` | Tool executions emit activity events |
| `TRUTH_LAYER.md` | Tool executions produce evidence for receipts |
| `LITT_BRIDGE_EXTENSION.md` | VS Code extension is a surface; Bridge Desktop is Level 4 |
| `PROJECT_PORTABILITY.md` | `.litt/project.json` includes tool permissions |
