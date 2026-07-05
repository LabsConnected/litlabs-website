# Agents Terminal — Design Document

**Author:** explore agent (scan-pages task)
**Date:** 2026-06-07
**Status:** Draft v1

---

## 1. Problem Statement

The existing `/agents/page.tsx` provides a full agent log terminal with task tree + live log streaming. It is functional but has gaps:

- **No provider toggle** — all agent calls go through hardcoded `/api/gemini/chat`
- **No CRT toggle** — retro aesthetic missing despite being a terminal page
- **No task management** — can view logs but not queue, pause, or cancel tasks
- **No agent config** — can only use agents as defined, not customize parameters
- **No multi-agent orchestration** — chat-only interface, no boardroom coordination
- **Separate from Studio** — Studio sidebar has an "Agents" tool (AgentTool) that is a different UI

The goal: build a unified **Agents Terminal** that consolidates agent management, task orchestration, provider configuration, and real-time monitoring into a single professional interface accessible from both `/agents` and `/studio/tools/AgentTool`.

---

## 2. Design Goals

1. **Professional terminal aesthetic** — CRT scanlines, monospace fonts, terminal green/cyan color scheme, consistent with existing `/agents` page
2. **Provider flexibility** — user can choose which LLM provider/model to use per agent, persisted in localStorage (pattern from `ChatTool.tsx`)
3. **Task lifecycle management** — queue tasks, view live streaming logs, cancel running tasks, view history
4. **Multi-agent boardroom** — launch multiple agents simultaneously, see their responses side-by-side
5. **CRT as first-class** — CRT toggle is built-in, not optional decoration
6. **Integrates with Studio sidebar** — accessible as AgentTool within the studio workspace, or as standalone `/agents` page
7. **Uses unified llm.ts** — all agent calls go through the failover chain, no hardcoded `/api/gemini/chat`

---

## 3. UI Layout

### 3.1 Page Structure

```
┌──────────────────────────────────────────────────────────────────┐
│ [Agents Terminal]              [Provider ▼] [CRT ◉] [⚙ Config]  │  ← Header bar
├────────────────┬───────────────────────────────────────────────────┤
│                │                                                   │
│  Agent Dock    │   Task Workspace                                 │
│  ───────────   │   ─────────────                                  │
│  + New Agent   │   [Task tabs with status indicators]             │
│                │                                                   │
│  [●] Hermes    │   ┌──────────────────────────────────────────┐  │
│  [●] OpenClaw  │   │  Live Log Stream (SSE)                   │  │
│  [○] LitAgent  │   │  ──────────────────────────────────────  │  │
│  [○] DevBot    │   │  > Agent: Hermes                         │  │
│                │   │  > Thinking...                           │  │
│  ───────────   │   │  > Retrieved 3 docs from knowledge base   │  │
│  Boardroom     │   │  > Generating response...                 │  │
│  [Launch All]  │   │  > Done in 1.4s                          │  │
│                │   └──────────────────────────────────────────┘  │
│                │                                                   │
│                │   [Input prompt textarea]  [▶ Run]  [⏹ Cancel] │
│                │                                                   │
├────────────────┴───────────────────────────────────────────────────┤
│ [History] [Config] [Stats]                         v1.0 | Online ● │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Hierarchy

```
AgentsTerminalPage
├── TerminalHeader
│   ├── ProviderSelector (dropdown — from llm.ts catalog)
│   ├── CrtToggle (built-in, not optional)
│   └── ConfigButton → AgentConfigModal
├── AgentDock (left sidebar, 240px)
│   ├── NewAgentButton
│   ├── AgentList (scrollable)
│   │   └── AgentItem (name, status dot, last active)
│   └── BoardroomSection
│       └── LaunchAllButton
├── TaskWorkspace (main area)
│   ├── TaskTabBar
│   │   └── TaskTab (id, status, model badge)
│   ├── LiveLogStream (scrollable, auto-scroll)
│   │   ├── LogEntry (timestamp, level, content, agent badge)
│   │   └── StreamingIndicator
│   ├── PromptInput (textarea)
│   └── ActionBar (Run, Cancel, Clear, Export)
├── AgentConfigModal (overlay)
│   ├── ModelSelector (from llm.ts)
│   ├── SystemPromptEditor
│   ├── TemperatureSlider
│   ├── MaxTokensInput
│   └── Save/Delete buttons
└── StatusBar (bottom)
    ├── HistoryButton
    ├── ConfigButton
    ├── StatsButton
    └── ConnectionStatus
```

---

## 4. Feature Specifications

### 4.1 Agent Dock (Left Sidebar)

**Agent List:**
- Shows all configured agents from `src/lib/agents.ts`
- Status indicator: ● Online (green), ○ Idle (gray), ◐ Running (pulsing amber)
- Click to select → loads agent config into Task Workspace
- Hover shows last active time and model used

**New Agent:**
- Button at top opens `AgentConfigModal` with empty fields
- Saves to localStorage (key: `agent_configs`) as JSON map

**Boardroom:**
- "Launch All" button sends the current prompt to all online agents simultaneously
- Each agent gets its own task tab in the workspace
- Responses stream in real-time, side-by-side

### 4.2 Provider Selector

- Dropdown in header bar showing available providers from `llm.ts`
- Options: `gemini-2.5-flash`, `openrouter/free`, `deepseek-v3` (or whatever chain is configured)
- Persisted in localStorage (`provider_preference`)
- Falls back to default if selected provider fails (llm.ts handles failover)
- Shows provider badge next to each agent in the dock

### 4.3 Task Workspace (Main Area)

**Task Tabs:**
- Each agent response gets its own tab
- Tab shows: agent name, model badge, status (streaming/complete/error), duration
- Max 8 tabs open (oldest auto-closes when exceeded)
- Tab color matches agent's assigned color (from MODEL_MAP in studio)

**Live Log Stream:**
- SSE connection to `/api/agents/stream` (new endpoint)
- Log entry format: `{ timestamp, level: "info|warn|error|debug", agent, message }`
- Color-coded by level: info=cyan, warn=amber, error=red, debug=gray
- Auto-scroll with "pin" button to pause scroll
- Copy button per entry, export full log as .txt

**Prompt Input:**
- Large textarea (monospace, 4 rows default, auto-expand)
- Supports `@agent-name` mentions to route to specific agent
- `/system` prefix sets system prompt inline
- Enter to submit, Shift+Enter for newline

**Action Bar:**
- ▶ Run — submits prompt, creates new task tab
- ⏹ Cancel — aborts running SSE stream
- 🗑 Clear — clears log stream
- ⤓ Export — downloads log as .txt file

### 4.4 CRT Toggle (Built-in)

- Always visible in header bar — no opt-out
- State stored in `localStorage.getItem("crt_global_scanlines")` (shared with all pages)
- Visual: scanline overlay + subtle text shadow + phosphor glow on active elements
- Default: ON for Agents Terminal (more appropriate than other pages)

### 4.5 Agent Config Modal

**Fields:**
- Agent Name (text input)
- Provider (dropdown — from llm.ts)
- Model (text input — defaults based on provider)
- System Prompt (textarea — 8 rows)
- Temperature (slider 0-2, step 0.1)
- Max Tokens (number input, default 4096)
- Color (6 preset colors matching studio theme)

**Storage:**
- Saved to `localStorage.getItem("agent_configs")` as JSON map
- On load, merges with defaults from `src/lib/agents.ts`
- User overrides take precedence

### 4.6 Status Bar

- Connection status dot (● Online / ○ Reconnecting)
- Active task count
- Total tokens used this session
- Average latency
- Quick links: History (last 20 tasks), Config (opens modal), Stats (agent usage)

---

## 5. API Design

### 5.1 New Endpoints

**`POST /api/agents/stream`** — SSE agent streaming
```typescript
// Request body
{
  agentId: string;         // "hermes" | "openclaw" | etc.
  prompt: string;           // user input
  systemPrompt?: string;   // override
  provider?: string;        // "gemini" | "openrouter" | etc.
  model?: string;           // specific model
  temperature?: number;
  maxTokens?: number;
}

// Response: SSE stream
data: { type: "log", level: "info"|"warn"|"error"|"debug", message: string }
data: { type: "chunk", text: string }
data: { type: "done", totalTokens: number, latencyMs: number }
data: { type: "error", message: string }
```

**`POST /api/agents/boardroom`** — Multi-agent parallel
```typescript
// Request body
{
  prompt: string;
  agentIds: string[];       // ["hermes", "openclaw"]
  provider?: string;
  model?: string;
}

// Response: SSE stream with agent-tagged entries
data: { agentId: string, type: "log"|"chunk"|"done", ... }
```

**`GET /api/agents/config`** — List available agents + models
```typescript
// Response
{
  agents: AgentDefinition[];  // from src/lib/agents.ts
  providers: ProviderInfo[];  // from llm.ts
  userConfigs: Record<string, AgentConfig>;  // from localStorage
}
```

### 5.2 Integration Points

- All calls go through `src/lib/llm.ts` — no direct `gemini.ts` imports
- Task records saved to `localStorage.getItem("agent_tasks")` (last 50)
- Stats (token usage, latency) aggregated in `localStorage.getItem("agent_stats")`
- No Supabase dependency for v1 — localStorage only

---

## 6. Implementation Plan

### Phase 1: Core Terminal (do first)
1. Create `src/app/agents/components/AgentDock.tsx` — agent list + boardroom
2. Create `src/app/agents/components/TaskWorkspace.tsx` — tabs + log stream
3. Create `src/app/agents/components/TerminalHeader.tsx` — provider selector + CRT + config
4. Create `src/app/agents/components/AgentConfigModal.tsx`
5. Create `POST /api/agents/stream` endpoint (SSE)
6. Create `POST /api/agents/boardroom` endpoint
7. Refactor `src/lib/agents.ts` to use `llm.ts` (not `gemini.ts`)

### Phase 2: Studio Integration
8. Refactor `src/app/studio/tools/AgentTool.tsx` to use the same components
9. Add keyboard shortcuts (Ctrl+1-6 for tool switching)
10. Add CRT toggle to `/studio` page

### Phase 3: Polish
11. Add task history (`/agents/history` sub-route)
12. Add stats dashboard
13. Add export (JSON + TXT)
14. Persist agent configs to Supabase when available
15. Add "pin" scroll button to log stream

---

## 7. File Structure

```
src/
  app/
    agents/
      page.tsx                    # Standalone agents page
      components/
        AgentDock.tsx             # Left sidebar (agent list + boardroom)
        TaskWorkspace.tsx         # Main area (tabs + log stream)
        TerminalHeader.tsx        # Header (provider + CRT + config)
        AgentConfigModal.tsx      # Overlay modal for agent config
        LogEntry.tsx              # Single log line component
        TaskTab.tsx               # Tab component
        StatusBar.tsx             # Bottom status bar
  api/
    agents/
      stream/route.ts             # SSE streaming endpoint
      boardroom/route.ts          # Multi-agent parallel
      config/route.ts             # GET agent + provider catalog
  lib/
    agents.ts                     # Refactor to use llm.ts
    llm.ts                        # Unified LLM client (already exists)
```

---

## 8. Reference: Existing Code to Reuse

| Pattern | Location | Usage |
|---------|----------|-------|
| Provider toggle | `ChatTool.tsx` lines 20-30 | `PROVIDER_OPTIONS` + localStorage persistence |
| SSE streaming | `builder/page.tsx` (streaming) | ReadableStream + `onchunk` callback pattern |
| Log entry styling | `/agents/page.tsx` | `text-green-400 font-mono text-xs` terminal aesthetic |
| Tab component | `StudioSidebar.tsx` | Active glow dot + keyboard shortcut badges |
| CRT overlay | `/agent-chat/page.tsx` | `crt-overlay` class + `scanline` animation |
| Agent definitions | `src/lib/agents.ts` | Agent metadata (name, description, color, system prompt) |
| Provider catalog | `src/lib/llm.ts` | `generateText()`, `streamText()`, `llmHealth()` |

---

## 9. Open Questions

1. **Supabase persistence vs localStorage:** Should agent configs be saved to Supabase for multi-device sync? v1 can use localStorage; add Supabase in Phase 3.
2. **Task tab limit:** Max 8 tabs is arbitrary. Should this be configurable or tied to screen width?
3. **Boardroom response comparison:** Should the boardroom show a comparison table after all agents respond (token usage, latency, response length)?
4. **Agent tool vs standalone page:** Should AgentTool in Studio be a full embedded terminal, or just a launcher that opens `/agents` in a new tab/section?
5. **System prompt override:** Should users be able to override the system prompt per-task (inline `/system` prefix), or only globally via the config modal?