# Agent Management — "My AI Crew"

## The problem

The current Agents tool behaves like another chat interface — transcript, composer, duplicate conversation thread. That's wrong.

Agents should be a **management/catalog page**, not a second chat.

## What the page answers in 3 seconds

- What agents do I have?
- Which are online?
- What are they for?
- What can they access?
- Are they healthy?
- Can I open/configure/disable one?

## Layout

```
Agents

[ Search agents... ]   [ Filter ▾ ]   [ + Create Agent ]

INSTALLED

┌──────────────────────┐  ┌──────────────────────┐
│ LiTT                 │  │ Spark                │
│ Operator             │  │ Creative Agent       │
│ ● Online             │  │ ● Online             │
│                      │  │                      │
│ Code · Files · Voice │  │ Images · Branding    │
│ Browser · Workspace  │  │ Music · Video        │
│                      │  │                      │
│ [Open] [Configure]   │  │ [Open] [Configure]   │
└──────────────────────┘  └──────────────────────┘

AVAILABLE

┌──────────────────────┐  ┌──────────────────────┐
│ Forge                │  │ Atlas                │
│ Build Specialist     │  │ Research Agent       │
│ + Install            │  │ + Install            │
└──────────────────────┘  └──────────────────────┘

DISABLED

┌──────────────────────┐
│ Old Agent            │
│ ○ Disabled           │
│ [Enable] [Delete]    │
└──────────────────────┘
```

No chat transcript. No composer. No duplicate conversation thread.

## Sections

| Section | What it shows |
|---|---|
| **Installed** | Agents the user owns and has configured |
| **Available** | Agent templates the user can install later |
| **Disabled** | Agents turned off by the user |

## Agent card

Each card shows:

- **Avatar** — strong visual identity, character-driven
- **Name** — "LiTT", "Spark"
- **Role** — "Primary Operator", "Creative Specialist"
- **Status** — online/working/needs setup/degraded/offline/disabled
- **Short description** — one line
- **Capabilities** — derived from real connected tools (not hardcoded)
- **Provider/model** — current canonical model routing
- **Permission summary** — concise
- **Last activity** — timestamp + last action

### Primary actions

```
[ Open ]  [ Configure ]
```

### Secondary menu

```
Permissions
Tools
Memory
Duplicate
Disable
Delete
```

## Core agents

### LiTT — Primary Operator

```
LiTT
Primary Operator

● Online

Capabilities
✓ Projects
✓ Files
✓ Code
✓ Workspace
✓ Terminal
✓ Browser
✓ Voice
✓ Preview
✓ Deploy approvals

Brain
Canonical LiTT Core

Mode
ACT

[ Open LiTT ]  [ Configure ]
```

### Spark — Creative Specialist

```
Spark
Creative Specialist

● Online

Capabilities
✓ Images
✓ Branding
✓ Video concepts
✓ Music concepts
✓ Creative direction

[ Open Spark ]  [ Configure ]
```

### Important: capabilities are derived, not hardcoded

Do not hardcode capabilities that are not actually available. Derive them from canonical agent/tool configuration. If a tool is not connected, it doesn't appear as a capability.

## Agent detail page

Clicking an agent opens its **profile/config**, not chat.

### Tabs

```
Overview    Capabilities    Tools    Permissions    Memory    Model    Activity    Settings
```

### Overview

```
LiTT
Primary Operator

Status: ● Online
Last activity: 2 min ago · Edited Canvas.tsx

Brain: Canonical LiTT Core
Model: GPT-4o (Auto Best)
Mode: ACT

[ Chat with LiTT ]
```

### Capabilities

Derived from real connected tools:

```
CAPABILITIES

Projects          ✓ Connected
Files             ✓ Connected
Code              ✓ Connected
Workspace         ✓ Connected
Terminal          ✓ Connected
Browser           ○ Not configured
Voice             ✓ Connected
Preview           ✓ Connected
Deploy            ✓ Approval required
```

### Tools

```
CONNECTED TOOLS

files.read          Green (automatic)
files.patch         Yellow (ACT/AUTO)
workspace.exec      Yellow (ACT/AUTO)
git.status          Green (automatic)
git.push            Orange (approval)
checks.typecheck    Green (automatic)
preview.start       Green (automatic)
browser.navigate    ○ Not configured

[ Configure Tools ]
```

### Permissions

```
PERMISSIONS

Read files         Allowed
Write files        Approval required
Run commands       Approval required
Browser control    Blocked
Deploy             Blocked
External actions   Blocked

[ Edit Permissions ]
```

Approval states:
- **Allowed** — automatic
- **Approval required** — pauses for user approval
- **Blocked** — not permitted

### Memory

```
AGENT MEMORY

Project instructions (LITT.md)
  • Purpose: LiTTree Website
  • Framework: Next.js 15
  • Style: Glass OS, dark-first

Conversation summary
  • Last 20 messages summarized

User learning profile
  • HTML: Comfortable
  • CSS: Learning

[ Edit Memory ]
```

### Model

```
MODEL ROUTING

Primary: GPT-4o (Auto Best)
Fallback: Gemini 2.0 Flash

Provider: OpenAI
Health: ● Available

Cost this month: $12.40

[ Change Model ]
```

Do not create duplicate agent-level model state if canonical routing already exists. Display the canonical model routing from `useStudioModelStore`.

### Activity

Recent factual activity only:

```
RECENT ACTIVITY

2 min ago   Edited Canvas.tsx        ✓
5 min ago   Ran typecheck            ✓ 0 errors
8 min ago   Read 4 files             ✓
1 hour ago  Preview refreshed        ✓
3 hours ago  Build failed             ✗ 2 errors → fixed

[ View Full Log ]
```

No private chain-of-thought. Just factual tool executions and results.

### Settings

```
SETTINGS

Agent name: LiTT
Role: Primary Operator
Description: Primary operator for all project work

Execution mode: ACT
Auto-fallback: On
Teaching level: Helpful

[ Save ]  [ Disable Agent ]
```

## Health states

| State | Color | Meaning |
|---|---|---|
| Online | Green | Connected and ready |
| Working | Green (pulsing) | Currently executing a task |
| Needs setup | Amber | Requires configuration before use |
| Degraded | Amber | Partially functional |
| Offline | Gray | Not connected |
| Disabled | Gray | Turned off by user |

### Actionable health issues

If something is broken, say exactly what:

```
Voice
Needs attention
Vapi authorization failed

[ Fix ]
```

```
Browser
Needs setup
Playwright not configured

[ Configure ]
```

```
Workspace
Degraded
Terminal connection unstable

[ Reconnect ]
```

Way more useful than "agent unavailable."

## Health checks

Health is derived from real state, not assumed:

| Check | Source |
|---|---|
| Voice | `VoiceSessionContext` connection state |
| Terminal | `useTerminalStore.isUsable()` |
| Browser | Playwright/Browserbase connection status |
| Provider | `useStudioModelStore.providerHealth` |
| Preview | Preview server status |
| Workspace | Project file system access |

## Available agents (future)

Agent templates the user can install:

```
AVAILABLE

┌──────────────────────┐
│ Forge                │
│ Build Specialist     │
│                      │
│ Scaffolds projects,  │
│ runs builds, manages │
│ dependencies.        │
│                      │
│ [ + Install ]        │
└──────────────────────┘

┌──────────────────────┐
│ Atlas                │
│ Research Agent       │
│                      │
│ Reads docs, searches │
│ web, summarizes APIs │
│ and libraries.       │
│                      │
│ [ + Install ]        │
└──────────────────────┘
```

Visually separated from installed agents. Don't clutter the page if only LiTT and Spark exist.

## Visual design

- Use **Glass OS** design system
- Agent cards use `.glass-panel` with `.glass-chip` for capability tags
- Premium, character-driven feel
- LiTT and Spark have strong visual identity (avatars, colors)
- **Green** for online/healthy
- **Purple** for AI/creative
- **Amber** for setup/attention
- **Red** only for actual failures

## "Chat with Agent" flow

```
Agent detail → [ Chat with LiTT ]
  → Opens Studio Chat with LiTT as active agent
  → Does NOT open chat inside the agents page
```

Management and conversation are separate. Always.

## Type definitions

```ts
interface AgentProfile {
  id: string;                    // "litt", "spark"
  name: string;                  // "LiTT", "Spark"
  role: string;                  // "Primary Operator"
  description: string;           // one line
  avatar: string;                // URL or emoji
  color: string;                 // accent color
  status: AgentStatus;
  capabilities: AgentCapability[];
  tools: AgentToolConnection[];
  permissions: AgentPermission[];
  modelRouting: {
    primary: string;
    fallback?: string;
    provider: string;
    health: ProviderHealth;
  };
  memory: {
    projectInstructions: boolean;
    conversationSummary: boolean;
    learningProfile: boolean;
  };
  lastActivity?: {
    timestamp: string;
    action: string;
    success: boolean;
  };
  installed: boolean;
  enabled: boolean;
}

type AgentStatus = "online" | "working" | "needs_setup" | "degraded" | "offline" | "disabled";

interface AgentCapability {
  name: string;                  // "Files", "Voice", "Browser"
  connected: boolean;
  healthIssue?: string;          // "Vapi authorization failed"
  fixAction?: string;            // "Reconnect Vapi"
}

interface AgentToolConnection {
  tool: string;                  // "files.read"
  riskLevel: "green" | "yellow" | "orange" | "red";
  configured: boolean;
}

interface AgentPermission {
  action: string;                // "Read files", "Write files", "Deploy"
  state: "allowed" | "approval_required" | "blocked";
}
```

## Database schema

```sql
CREATE TABLE studio_agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT,
  avatar TEXT,
  color TEXT DEFAULT '#8b5cf6',
  installed BOOLEAN DEFAULT true,
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE studio_agent_health (
  agent_id TEXT NOT NULL,
  check_name TEXT NOT NULL,      -- "voice", "terminal", "browser", "provider"
  status TEXT NOT NULL,          -- "online", "needs_setup", "degraded", "offline"
  issue TEXT,
  fix_action TEXT,
  checked_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, check_name)
);
```

## Existing codebase mapping

| Concept | Current |
|---|---|
| Agent store | `useStudioAgentStore` with `AGENT_META`, `STUDIO_AGENTS` |
| Agent meta | `AGENT_META` with color, description |
| Agent selection | `activeAgentId` in conversation store |
| Model routing | `useStudioModelStore` (canonical — don't duplicate) |
| Voice health | `VoiceSessionContext` connection state |
| Terminal health | `useTerminalStore.isUsable()` |
| Provider health | `useStudioModelStore.providerHealth` |
| Tool activity | `ConversationMessage.toolActivity` |

### What needs to change

1. **Replace Agents chat UI with management page** — Remove transcript/composer from Agents tool
2. **Agent card grid** — New component with installed/available/disabled sections
3. **Agent detail view** — Tabbed profile/config page (not chat)
4. **Capability derivation** — Pull from real tool connections, not hardcoded
5. **Health checks** — Query real connection states, display actionable issues
6. **Permissions display** — Show concise permission summary with allowed/approval/blocked
7. **"Chat with Agent" button** — Opens Studio Chat with agent pre-selected
8. **Available agents section** — Template catalog (future, but layout-ready)
9. **Glass OS styling** — `.glass-panel` cards, `.glass-chip` capability tags
10. **Agent CRUD** — Create, configure, disable, delete, duplicate

## Acceptance tests

1. Open Agents. No chat transcript appears.
2. No message composer appears.
3. LiTT and Spark appear as agent cards.
4. Status is accurate (derived from real state).
5. Capabilities reflect real connected tools.
6. Configure opens management view (not chat).
7. "Chat with Agent" explicitly opens Chat.
8. Missing tool/provider shows actionable health state with Fix button.
9. Disabled agents are clearly separated.
10. Search filters agents by name/role/capability.
11. Available agents are visually separated from installed.
12. Model routing displayed matches canonical `useStudioModelStore`.
13. Activity tab shows factual recent tool executions (no private reasoning).
14. Permissions tab shows allowed/approval/blocked states.

**Do not report complete until Agents functions as management/catalog, not a second chat system.**
