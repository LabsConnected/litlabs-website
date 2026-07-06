# LiT Console v2 — Architecture Blueprint

## Design goals

1. **One execution loop**: every user intent becomes a `Run` with a visible timeline.
2. **Agent-agnostic tools**: tools (terminal, files, GitHub, etc.) are registered and callable by any agent.
3. **Durable state**: runs, sessions, memories, and rules live in Supabase, not in memory.
4. **Trust by default**: every destructive or risky action is classified and routed through approval policy.
5. **Composable UI**: panels (chat, terminal, preview, files) are independent but share a single run context.

## High-level flow

```text
User intent
    │
    ▼
┌─────────────┐
│  Director   │  ← reads project context, rules, memories, repo
│  Agent      │
└──────┬──────┘
       │ emits JSON plan
       ▼
┌─────────────┐
│  RunEngine  │  ← persists run, schedules steps
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Code Champ │     │   Terminal  │     │   GitHub    │
│   Agent     │◄───►│   Tool      │     │   Tool      │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Observer   │  ← reads output, decides next action
                    │  + Approve  │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  Artifact   │  ← diffs, logs, screenshots, tests
                    │  + Memory   │
                    └─────────────┘
```

## Core entities

### Run

```typescript
interface Run {
  id: string;
  project_id: string;
  user_id: string;
  intent: string;
  status: "planning" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  plan: Plan;
  created_at: string;
  updated_at: string;
}

interface Plan {
  goal: string;
  steps: Step[];
}

interface Step {
  id: string;
  agent_id: string;
  type: "chat" | "terminal" | "file" | "tool" | "approval";
  description: string;
  payload: unknown;
  depends_on?: string[];
  needs_approval: boolean;
  status: "queued" | "running" | "awaiting_approval" | "completed" | "failed";
  output?: string;
  artifacts?: Artifact[];
}

interface Artifact {
  id: string;
  type: "diff" | "file" | "log" | "screenshot" | "test_result" | "pr";
  url?: string;
  content?: string;
  metadata: Record<string, unknown>;
}
```

### Project context

```typescript
interface ProjectContext {
  id: string;
  name: string;
  description?: string;
  stack?: string[];
  repo_url?: string;
  rules: ProjectRule[];
  memories: ProjectMemory[];
  skills: Skill[];
}

interface ProjectRule {
  id: string;
  name: string;
  pattern: string;      // glob or regex
  instruction: string;  // what the agent must do
}

interface ProjectMemory {
  id: string;
  key: string;
  value: string;
  source: "user" | "extracted" | "run";
}

interface Skill {
  id: string;
  name: string;
  trigger: string;      // natural language trigger
  steps: Step[];
}
```

## Layer details

### UI Layer (Next.js App Router)

Responsibilities:

- Render chat, terminal, preview, file tree, run timeline, approval panels.
- Maintain WebSocket connection to terminal server.
- Stream run updates via Server-Sent Events or WebSocket.
- Show diff review UI for file changes.

Key components:

- `LitConsole` — layout shell
- `ChatPanel` — chat + tool cards + run timeline
- `CommandDock` — intent input + agent/model/tool pickers
- `TerminalPanel` — xterm + session tabs
- `PreviewPanel` — iframe preview + browser logs
- `FileTree` — project files
- `RunTimeline` — plan, steps, status, artifacts
- `ApprovalCard` — approve/reject/edit risky actions

### API Layer (Next.js API Routes)

Routes:

- `POST /api/runs` — create a run from intent
- `GET /api/runs/:id` — get run state + timeline
- `POST /api/runs/:id/approve` — approve a step
- `POST /api/runs/:id/cancel` — cancel run
- `POST /api/plan` — get a plan without executing
- `POST /api/execute` — execute a single step (used by background worker)
- `POST /api/chat` — chat endpoint
- `POST /api/tools/:toolId` — call a registered tool
- `GET /api/tools` — list available tools

### Agent Orchestrator

A single orchestrator replaces the current two (`src/lib/agents.ts` and `src/lib/AgentOrchestrator.ts`).

Responsibilities:

- Maintain agent registry.
- Build plan from intent using Director.
- Dispatch steps to the right agent or tool.
- Observe step output and decide next action.
- Handle subagent spawning and parallel execution.
- Aggregate results and synthesize final answer.

```typescript
class AgentOrchestrator {
  async plan(intent: string, context: ProjectContext): Promise<Plan>;
  async run(runId: string): Promise<RunResult>;
  async executeStep(step: Step, context: ProjectContext): Promise<StepResult>;
  async approveStep(runId: string, stepId: string): Promise<void>;
  async spawnSubagent(agentId: string, task: string, context: ProjectContext): Promise<SubagentResult>;
}
```

### Tool Registry

Every tool implements a standard interface:

```typescript
interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  riskLevel: "read" | "write" | "network" | "destructive" | "system";
  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

interface ToolContext {
  projectId: string;
  userId: string;
  terminalSessionId?: string;
  runId?: string;
}
```

Built-in tools:

| Tool | Purpose | Risk |
|---|---|---|
| `terminal` | Run commands in PTY session | network, destructive, system |
| `filesystem` | Read/write/list files | write, destructive |
| `git` | Status, diff, commit, branch | write |
| `github` | Issues, PRs, repo context | network, write |
| `supabase` | Query, introspect, migrations | network, write |
| `vercel` | Deploy, preview, logs | network, write |
| `browser` | Preview, console errors, screenshots | network |
| `mcp` | Generic MCP client | network |

### Terminal Server

Current: `terminal-server/server.ts` (Express + Socket.IO + node-pty).

Additions:

- Named sessions stored in `terminal_sessions`.
- Reconnect to existing session.
- CWD tracking per session.
- Command risk classification before execution.
- Output streaming to run timeline.
- Optional Docker sandbox mode.

### Data Layer (Supabase)

Tables:

- `projects` — project metadata + context
- `project_rules` — per-project rules
- `project_memories` — extracted facts
- `skills` — reusable workflows/skills
- `runs` — top-level run records
- `run_steps` — individual steps
- `run_artifacts` — diffs, logs, screenshots, etc.
- `terminal_sessions` — persistent terminal sessions
- `terminal_logs` — command history
- `agent_logs` — agent activity
- `approval_events` — approval audit trail

### Background Worker

For long-running or async jobs:

- Option A: Supabase Edge Functions + pg_cron
- Option B: Inngest / Trigger.dev (managed)
- Option C: Custom worker using BullMQ / pg-boss

Recommendation: start with **Inngest** or **Trigger.dev** for reliability, then evaluate cost.

## Trust & safety model

### Risk classification

| Risk | Examples | Default policy |
|---|---|---|
| read | `cat`, `ls`, `git status` | allow |
| write | `echo > file`, `git commit` | smart (ask if outside auto-allow list) |
| network | `curl`, `npm install`, API calls | ask |
| destructive | `rm -rf`, `drop table`, force push | always ask |
| system | `sudo`, `chmod`, `kill` | block |

### Approval flow

1. Step is classified.
2. Policy engine decides: allow, smart, ask, block.
3. If ask: pause run, show ApprovalCard.
4. User approves, rejects, or edits.
5. Action is recorded in `approval_events`.

### Sandbox

- Per-project workspace directory (already done).
- Optional Docker container per session.
- Network egress allow/deny list.
- Secret redaction in logs.

## Implementation order

1. **Data model** — Supabase migrations for runs, steps, rules, memories.
2. **Tool registry** — standard interface + terminal/filesystem/git tools.
3. **Run engine** — create run, plan, execute steps, observe, approve.
4. **UI updates** — run timeline, diff review, approval card.
5. **Preview + browser** — preview pane, error capture.
6. **Integrations** — GitHub, Supabase, Vercel, MCP.
7. **Background worker** — async jobs, workflows.
8. **Enterprise trust** — policies, sandbox, audit.

## Key technical decisions

- **Next.js 16 + React 19 + Tailwind 4**: keep current stack.
- **Supabase**: keep for data + auth; add background worker later if needed.
- **Clerk**: keep for auth; use organizations for team features.
- **Gemini + OpenRouter**: keep LLM failover; add tool-use models for agents.
- **node-pty**: keep terminal server; add session persistence and Docker sandbox.
- **xterm.js**: keep terminal UI; add session tabs.
- **Monaco**: use diff editor for code review.

## Open questions

1. Do you want to support local LLMs (Ollama) in production, or only as dev fallback?
2. Do you want Docker sandbox by default, or optional?
3. Do you want a managed queue (Inngest/Trigger.dev) or build your own?
4. Do you want MCP first, or native GitHub/Supabase/Vercel integrations first?

## Next file

See `docs/LIT_CONSOLE_V2_ROADMAP.md` for the phased build plan and `docs/roadmap.svg` for a visual timeline.
