# LiTTree LabStudios — Route Inventory

**Phase 0 deliverable.** Scoped to AI, Studio execution, and persistence routes per directive. Each route is classified as `production canonical`, `adapter/compat`, `legacy redirect`, or `dead`. Caller analysis is based on `grep` of `fetch("/api/...")` in `src/app/studio/tools/*.tsx` and `src/app/studio/components/*.tsx`.

Classification legend:
- **production canonical** — correct architecture, reuse as-is
- **adapter/compat** — works but should be deprecated in favor of `/api/litt/run`
- **legacy redirect** — superseded, should redirect or be removed
- **dead** — no callers, candidate for removal

---

## AI / LLM routes

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/ai-chat` | POST | **legacy redirect** | `CanvasTool.tsx:208` | Static system prompt, no kernel, direct `generateText`. **Primary migration target for Phase 2.** |
| `/api/ai/chat` | POST | **legacy redirect** | (none in Studio tools) | Uses `runAI` from `@/lib/ai/providers` with hardcoded `llama3.2:3b`. Parallel chat path. |
| `/api/chat` | POST | **adapter/compat** | (none in Studio tools) | Agent-to-agent orchestrator. Used by gallery/agent chat. Keep for agent-to-agent; do not route user LiTT chat here. |
| `/api/chat/unified` | POST | **adapter/compat** | (none in Studio tools) | Multi-mode (agent/llm/simple). Does not call `routeKernel`. Deprecate in favor of `/api/litt/run`. |
| `/api/gemini` | POST | **adapter/compat** | `MissionForge.tsx:648`, `PipelineTool.tsx:378,431` | Direct `generateText` with task routing. No kernel. Deprecate. |
| `/api/gemini/chat` | POST | **production canonical (kernel-integrated)** | `ChatTool.tsx:129`, `AgentsTerminalTool.tsx:254`, `AgentTool.tsx:412` | **Only route that imports `routeKernel` + `composeSystemPrompt`.** Reference implementation for `/api/litt/run`. |
| `/api/gemini/build` | POST | **legacy redirect** | (none in Studio tools) | `generateComponent`, `directorPlan`, `executorCode` — direct Gemini calls. Fold into kernel planning. |
| `/api/llm/health` | GET | **production canonical** | (health check) | LLM provider health. Keep. |

## `/api/litt/*` routes

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/litt/command` | POST | **production canonical** | (terminal server) | Runs typecheck/lint/test/build against real workspace. Reuse as structured workspace tool in Phase 3. |
| `/api/litt/file` | GET | **production canonical** | (none in Studio tools) | Read files with path traversal protection. Reuse for `project-index`. |
| `/api/litt/scan` | GET | **production canonical** | (none in Studio tools) | Scan repository structure. Reuse for `project-index`. |
| `/api/litt/notify` | POST | **production canonical** | (admin only) | Discord/webhook notifications. Admin-gated. Keep. |
| `/api/litt/think` | POST | **adapter/compat** | (none in Studio tools) | Uses `buildJarvisPrompt` + `collectJarvisContext` — legacy "Jarvis" naming. Does not call `routeKernel`. Fold into `/api/litt/run`. |
| `/api/litt/run` | — | **greenfield** | — | Does not exist. **Phase 2 creates this as the canonical SSE run endpoint.** |

## `/api/projects/*` and `/api/studio-projects/*`

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/studio-projects` | GET, POST | **production canonical** | `BuilderTool.tsx:44` | List + create canonical projects. |
| `/api/studio-projects/[projectId]` | GET, PATCH | **production canonical** | — | Get/update project. |
| `/api/studio-projects/[projectId]/files` | GET | **production canonical** | — | List project files. |
| `/api/studio-projects/[projectId]/workspace` | GET | **production canonical** | — | Workspace status. |
| `/api/studio-projects/[projectId]/workspace/prepare` | POST | **production canonical** | — | Prepare workspace. |
| `/api/studio-projects/[projectId]/checkpoints` | GET, POST | **production canonical** | — | List/create checkpoints. **Not wired to any Studio tool — Phase 4 wires this into CoderWorkspace.** |
| `/api/studio-projects/[projectId]/preview` | GET | **production canonical** | — | Preview URL/status. |
| `/api/studio-projects/[projectId]/preview/proxy` | GET | **production canonical** | — | Preview proxy. |
| `/api/projects/[projectId]/visual-builds` | GET, POST | **production canonical** | — | List/run visual builds. **Not wired to any Studio tool — Phase 5 wires this in.** |
| `/api/projects/[projectId]/visual-builds/[buildId]` | GET | **production canonical** | — | Get build status. |
| `/api/projects/[projectId]/visual-builds/[buildId]/approve` | POST | **production canonical** | — | Approve build. |
| `/api/projects/[projectId]/visual-builds/[buildId]/retry` | POST | **production canonical** | — | Retry build. |

## `/api/missions/*`

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/missions` | GET, POST | **production canonical** | — | List/create missions. **Not wired to any Studio tool — Phase 2/4 wires this in.** |
| `/api/missions/[missionId]` | GET | **production canonical** | — | Get mission. |
| `/api/missions/[missionId]/run` | POST | **production canonical** | — | Start mission run. |
| `/api/missions/[missionId]/events` | GET | **production canonical (polling)** | — | Polling endpoint (SSE "could be added later" per source comment). Phase 2 may add SSE. |
| `/api/missions/[missionId]/cancel` | POST | **production canonical** | — | Cancel mission. |

## `/api/approvals/*`

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/approvals` | GET | **production canonical** | — | List pending approvals. **Not wired to any Studio tool — Phase 3 wires this into CoderWorkspace.** |
| `/api/approvals/[approvalId]` | GET, POST | **production canonical** | — | Get/resolve approval. |

## `/api/conversations/*`

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/conversations` | GET, POST | **production canonical** | — | List/create conversations. **Phase 2 persists every LiTT turn here.** |
| `/api/conversations/[id]/messages` | GET, POST | **production canonical** | — | Messages for a conversation. |

## `/api/canvases/*`

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/canvases` | GET, POST | **production canonical** | — | List/create canvases. **Phase 2 mirrors run output into Canvas blocks via these routes.** |
| `/api/canvases/[canvasId]` | GET, PATCH, DELETE | **production canonical** | — | Get/update/delete canvas. |
| `/api/canvases/[canvasId]/blocks` | GET, POST | **production canonical** | — | Canvas blocks. |
| `/api/canvases/[canvasId]/blocks/[blockId]` | PATCH, DELETE | **production canonical** | — | Update/delete block. |
| `/api/canvases/[canvasId]/revisions` | GET | **production canonical** | — | Canvas revisions. |
| `/api/canvases/[canvasId]/promote` | POST | **production canonical** | — | Promote canvas revision. |

## Builder / Director / Agents

| Route | Methods | Classification | Caller(s) | Notes |
|---|---|---|---|---|
| `/api/builder/sessions` | GET, POST, PATCH, DELETE | **adapter/compat** | — | Persists to `builder_chat_sessions` — parallel to `conversations`. Consolidate in Phase 2/7. |
| `/api/director/plan` | GET, POST | **adapter/compat** | — | `DirectorGraphPlanner` — separate planner outside kernel. Fold into kernel planning. |
| `/api/agents/chat` | POST | **adapter/compat** | — | Agent chat with Supermemory + capability context. Does not call `routeKernel`. |
| `/api/agents/run` | POST | **adapter/compat** | — | Agent execution. Separate from mission runs. |
| `/api/agents/*` (other) | various | **adapter/compat** | `AgentsTerminalTool.tsx:168` (logs) | Agent backlog/commits/execute/status/task. Keep agent ops; fold chat into `/api/litt/run`. |

---

## Migration priority order

1. **Phase 2 — Critical:** Create `/api/litt/run` (SSE) + run-executor. Migrate `CanvasTool` off `/api/ai-chat`. This is the single highest-leverage change.
2. **Phase 2 — High:** Wire `/api/litt/run` to create missions/runs/steps via `mission-repository`, persist conversations via `/api/conversations`, and mirror to Canvas via `/api/canvases`.
3. **Phase 7 — Medium:** Deprecate `/api/ai-chat`, `/api/ai/chat`, `/api/chat/unified`, `/api/gemini`, `/api/gemini/build`, `/api/litt/think`, `/api/builder/sessions`, `/api/director/plan`, `/api/agents/chat`, `/api/agents/run`. Add deprecation headers/logs. Do not delete until usage proven zero.
4. **Phase 7 — Low:** Remove dead routes after a verification period.

## Key finding

The **only** kernel-integrated route is `/api/gemini/chat`. It is the reference implementation for `/api/litt/run`. Phase 2 should:
- Extract its kernel integration pattern (`routeKernel` → `composeSystemPrompt` → `streamText`/`generateText` → memory → Supabase)
- Generalize it into a streaming run-executor that also creates missions/runs/steps, emits canonical events, persists conversations, and mirrors to Canvas
- Replace the `/api/ai-chat` static-prompt path used by `CanvasTool`

---

## Phase 0 confirmation

- Zero application-code changes
- Zero migration files created
- Zero routing modifications
- Clean rebuild branch
- Awaiting Phase 1 approval
