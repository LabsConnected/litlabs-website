# LiT Console v2 — Ultra Roadmap & Blueprint

## Product vision

**LiT Console is the project-aware AI command center.**

Not another chat UI. Not another copilot. A workspace where specialized agents understand your repo, execute in a real terminal, show you proof, and ship to preview / deploy / review — all under clear trust controls.

## Core principle

Reduce this loop to seconds and make it visible:

```text
Intent → Plan → Execute → Observe → Approve → Ship
```

## Phase 1: Foundation — Execution Loop (Weeks 1–4)

### 1.1 Unified run engine

- One `Run` path that every agent uses: chat command, terminal command, tool call, or background job.
- Each run produces a **run timeline**: plan, steps, terminal output, diffs, test results, approval state.
- Runs are persisted in Supabase (`runs`, `run_steps`, `run_artifacts`).

### 1.2 Plan → act → observe

- Director agent parses intent and returns a JSON plan:
  - `goal`, `steps`, `owner_agent`, `needs_approval`, `expected_files`, `test_command`
- Executor agents run their steps and stream progress back.
- Observer layer reads terminal output and decides: continue, retry, ask user, or fail.

### 1.3 File-diff-first editing

- Replace raw file writes with **diff proposals**.
- User sees `+/-` diff before apply.
- Apply via terminal API or direct write, then run lint/test.
- Monaco diff editor for review.

### 1.4 Approval checkpoints

- `needs_approval` steps pause the run.
- UI shows: command, files affected, risk level, Approve / Edit / Reject.
- Default policy: destructive commands and network calls require approval.

### 1.5 Persistent project memory

- `projects` table: stack, goals, repo URL, custom instructions.
- `project_memories` table: key facts extracted from conversations and runs.
- `project_rules` table: user-defined rules (like Cursor rules).
- Inject all of this into agent prompts automatically.

Deliverable: A user can say _"fix the auth bug in the login route"_ and LiT plans, edits, runs tests, and asks for approval to deploy.

---

## Phase 2: Terminal Intelligence (Weeks 5–8)

### 2.1 Real terminal sessions

- Named sessions, resumable on reconnect.
- Session history stored in `terminal_sessions`.
- Multiple tabs per project.
- CWD tracking per session.

### 2.2 Command intelligence

- Parse typed commands into structured intent.
- Suggest completions from project context.
- Show command risk level before execution.
- Detect errors in output and offer fixes.

### 2.3 Terminal + chat fusion

- Any terminal output can be copied into chat as context.
- Chat can ask the terminal to run commands and observe results.
- Terminal shows active agent runs in a split panel.

### 2.4 Safe execution model

- Command classification: read, write, network, destructive, system.
- Policy engine: ask, warn, allow, block based on classification + user policy.
- Dry-run mode for dangerous commands.

Deliverable: Terminal feels like a teammate that understands the project, not a raw shell.

---

## Phase 3: Preview & Debug Loop (Weeks 9–12)

### 3.1 Live preview pane

- Embed app preview in the console (iframe or dedicated panel).
- Support Next.js dev server, Vercel preview URLs, or static builds.
- Show preview status: building, ready, error.

### 3.2 Browser error capture

- Capture console errors, network errors, and uncaught exceptions.
- Feed errors back into chat as structured context.
- Agent can ask to inspect a specific route or element.

### 3.3 Route-aware debugging

- Parse Next.js app router routes.
- Link preview URL to source file.
- Show route + file + error as one traceable unit.

### 3.4 Visual regression / screenshot artifacts

- Screenshot preview on key milestones.
- Store as run artifacts.
- Compare before/after for UI changes.

Deliverable: User sees the app running and debugging inside the same workspace where they code.

---

## Phase 4: Integrations & MCP (Weeks 13–16)

### 4.1 MCP tool layer

- Implement an MCP server/client layer so external tools can plug in.
- First tools: filesystem, terminal, GitHub, Supabase, Vercel, browser, fetch.
- Tool registry UI: enable/disable per project.

### 4.2 GitHub integration

- Read repo context, issues, PRs.
- Create branches, commits, PRs.
- PR review agent: comment on diffs, suggest changes.
- Sync with `AGENTS.md` and project rules.

### 4.3 Supabase integration

- Introspect schema, run queries, generate migrations.
- RLS policy review agent.
- Type generation from schema.

### 4.4 Vercel / deploy loop

- Trigger deploy, get preview URL, capture deploy logs.
- Rollback on failure.
- Map deploy errors to source files.

Deliverable: LiT Console can take a GitHub issue, implement the fix, open a PR, and deploy a preview.

---

## Phase 5: Background Agents & Workflows (Weeks 17–20)

### 5.1 Background job system

- Use Supabase + pg_cron or a durable queue (e.g. Inngest, Trigger.dev, or custom worker).
- Jobs survive browser disconnects.
- Users can view active jobs, pause/resume, inspect logs.

### 5.2 Reusable workflows

- Save a run as a reusable workflow.
- Workflows have inputs, steps, agents, and policies.
- Trigger manually, on schedule, or on GitHub events.
- Workflow marketplace (internal first, public later).

### 5.3 Async review agents

- Refactor agent, test-repair agent, dependency-update agent, security audit agent.
- Run in background, produce PR or report.

### 5.4 Agent handoffs

- Subagent pattern: Director spawns specialist agents with scoped tasks.
- Parallel execution where safe.
- Result aggregation and conflict resolution.

Deliverable: User schedules a weekly dependency-update-and-test workflow that runs autonomously and opens a PR.

---

## Phase 6: Trust, Safety, Enterprise (Weeks 21–24)

### 6.1 Approval policies

- Per-project: always ask, smart, auto.
- Granular: command categories, file paths, network domains, agents.
- Audit log of every approval, rejection, and autonomous action.

### 6.2 Sandbox controls

- Optional Docker sandbox for terminal sessions.
- Network egress controls.
- Secret redaction in logs.
- File-system jail per project.

### 6.3 Team features

- Shared projects, shared rules, shared workflows.
- Activity feed, run history, blame/audit.
- SSO (Clerk organizations).

### 6.4 Enterprise controls

- Custom data retention.
- Bring-your-own-keys.
- On-premise / dedicated terminal workers.
- Compliance audit exports.

Deliverable: A team can safely let LiT Console autonomously maintain a production repo.

---

## KPI Stack

| Metric                            | Target       | Why                    |
| --------------------------------- | ------------ | ---------------------- |
| Time from intent to first diff    | < 30 seconds | Speed of the core loop |
| Autonomous run completion rate    | > 70%        | Agent reliability      |
| Approval-to-action rate           | > 80%        | Trust and accuracy     |
| Preview/live error capture uptime | > 99%        | Debug loop quality     |
| User retention (weekly)           | > 40%        | Habit formation        |
| Background job success rate       | > 90%        | Async reliability      |

---

## Immediate backlog (do this week)

1. **Create `Run` model** in Supabase + TypeScript types.
2. **Refactor `CommandDock`** so `Run` sends intent to the Director API, not just chat.
3. **Build Director API** that returns a JSON plan.
4. **Build executor loop** that runs terminal commands and captures output.
5. **Add diff review UI** in `ChatPanel` for file changes.
6. **Add approval checkpoint** for destructive commands.
7. **Store project memories** from every chat and run.
8. **Add preview pane** to `LitConsole` layout.
9. **Add browser error capture** stub that pipes to chat.
10. **Document the run lifecycle** in `AGENTS.md`.

---

## Architecture snapshot

```text
┌─────────────────────────────────────────────────────────────┐
│                     LiT Console (Next.js)                    │
│  ChatPanel · CommandDock · Terminal · Preview · FileTree   │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                  Unified API Layer                          │
│  /api/runs  ·  /api/plan  ·  /api/execute  ·  /api/chat    │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                 Agent Orchestrator                          │
│  Director · Code Champ · Social Dom · Data Slayer · Writer  │
│  Plan → Delegate → Verify → Synthesize                      │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                   Tool & Memory Layer                       │
│  Terminal (node-pty) · FileSystem · GitHub · Supabase       │
│  MCP registry · Project memories · Rules · Skills         │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────────────┐
│                    Data Layer (Supabase)                    │
│  runs · run_steps · run_artifacts · terminal_sessions       │
│  projects · project_memories · project_rules · agent_logs   │
└─────────────────────────────────────────────────────────────┘
```

See `docs/ARCHITECTURE_BLUEPRINT.md` and `docs/roadmap.svg` for deeper visuals.

---

## Positioning statement

> **LiT Console** is the project-aware AI command center where chat, terminal, agents, previews, and deploy/review loops work together so your team moves from idea to shipped without switching tools.

Not: another chat UI. Not: another copilot. Not: another agent marketplace.

A command center for execution.
