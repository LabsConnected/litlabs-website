# LiTTree LabStudios — Current Architecture Audit

**Phase 0 deliverable.** Verified state of the codebase at the moment the LiTT Coder Master Rebuild began. Every claim below is backed by a file path and line range citation. No application code was changed to produce this document.

---

## Audit metadata

| Field | Value |
|---|---|
| Audit branch | `feat/litt-coder-rebuild` |
| Baseline SHA (`BASE_MAIN_SHA`) | `729b3d72e8779dca47cde5b3e70827fb98e39012` |
| Audit performed | 2026-07-27 |
| Working tree at audit | Clean (no uncommitted changes) |
| Canonical Handbook | `docs/litt/ultra-handbook-v11.md` |
| Handbook SHA-256 | `D1A30BD00B6AB33B94FE452D03DA21B21399CE31320B3D71328ADCF20453B609` |
| Handbook source | Converted from `LiTTree_LabStudios_Ultra_Handbook_v11(1).docx` via `python-docx` (the supplied Markdown was not reachable from this Windows environment) |

### Commits on `main` above the prior-known `d798193c`

| SHA | Subject | Author |
|---|---|---|
| `729b3d72` | fix: add nixpacks.toml for terminal-server Railway build | Larry B |
| `77433087` | fix: terminal-server Dockerfile build from repo root | Larry B |

Both are part of `main`'s history and pushed to `origin/main`. Per directive, they are treated as part of the baseline and were **not** reset, moved, or cherry-picked. `77433087` is reachable from `main`, `origin/main`, and `HEAD@{1}` in the reflog.

### Rescue branch / tag

Not created. The working tree was clean at audit time — there was nothing uncommitted to preserve. The pricing redesign referenced in the prior session is already committed on `main` (last touched at `346990b1`).

---

## Confirmed diagnosis

### 1. Studio routing — `tool=code` → CanvasTool, `tool=build` → BuilderTool

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\app\studio\components\StudioOS.tsx" lines="60-61" />

`StudioOS.tsx` switches tools by query param. `tool=code` mounts `CanvasTool`; `tool=build` mounts `BuilderTool`. No `CoderWorkspace` exists yet.

### 2. CanvasTool is localStorage-based and bypasses the kernel

`CanvasTool.tsx` persists files and messages to `localStorage` under `litlabs:canvas:files` and `litlabs:canvas:messages`:

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\app\studio\tools\CanvasTool.tsx" lines="81-82" />

It loads persisted state on mount and writes back on every change:

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\app\studio\tools\CanvasTool.tsx" lines="103-133" />

It posts the last user message to `/api/ai-chat` and parses fenced Markdown code blocks out of the response:

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\app\studio\tools\CanvasTool.tsx" lines="161-179" />

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\app\studio\tools\CanvasTool.tsx" lines="208" />

Preview is rendered from `srcDoc` constructed in-browser from the parsed files — there is no real workspace preview.

### 3. `/api/ai-chat` uses a static system prompt and direct LLM call

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\app\api\ai-chat\route.ts" lines="46-92" />

The system prompt is a hardcoded string (`"You are LiTT, a production-grade code builder assistant..."`). It calls `generateText()` directly with `task: "code"`. It does **not** import or invoke `routeKernel`, `composeSystemPrompt`, or any `litt-kernel` module. Memory is fetched from Supermemory if a key is present, but no Kernel decision is produced and no canonical events are emitted.

### 4. The LiTT Kernel exists but is bypassed by production surfaces

The kernel is a synchronous decision function:

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\lib\litt-kernel\kernel.ts" lines="63-169" />

`routeKernel()` classifies intent, resolves context, looks up mode defaults, classifies risk, and returns a `LiTTControlDecision`. It does **not** execute — it returns a decision the caller is expected to act on. The public API is exported from:

<ref_file file="C:\Users\litbi\CascadeProjects\litlab\src\lib\litt-kernel\index.ts" />

The **only** production route that imports the kernel is `/api/gemini/chat`:

<ref_snippet file="C:\Users\litbi\CascadeProjects\litlab\src\app\api\gemini\chat\route.ts" lines="10-11" />

It imports `routeKernel`, `composeSystemPrompt`, and `adaptLegacyCapability`. No Studio tool calls `/api/gemini/chat` from `tool=code`; `ChatTool` and `AgentsTerminalTool` do call it (see route inventory), but `CanvasTool` does not.

### 5. Existing systems that WILL be reused

These systems already have Supabase persistence, Zod-validated types, and API routes. The rebuild wires them into the kernel + `CoderWorkspace` rather than recreating them.

#### LiTT Kernel — `src/lib/litt-kernel/`
- `kernel.ts` — `routeKernel()` synchronous decision function
- `intent-router.ts`, `context-resolver.ts`, `mode-router.ts`, `principles.ts`
- `capability-registry.ts`, `event-bus.ts`, `prompt-composer.ts`, `schemas.ts`
- `types.ts` — `LiTTControlDecision`, `LiTTMode`, `CapabilityRecord`, `KernelEvent`, `LiTTWorldModel`, `KernelContext`
- **Reuse status:** library is complete but unused in production except `/api/gemini/chat`. Phase 2 builds a run-executor on top of it.

#### Projects — `src/lib/projects/`
- `types.ts` — `CanonicalProject`, `StudioProjectRow`, `LegacyProjectRow`, `rowToCanonical`, `legacyRowToCanonical`, `CreateProjectInput`
- `project-repository.ts` — `createBlankProject`, `createGithubProject`, `listProjects`, `getProject`, `verifyProjectWorkspace`
- Supabase table: `studio_projects` (canonical) + legacy `projects` (read-only compat)
- API routes: `/api/studio-projects/*`, `/api/projects/*`
- **Reuse status:** production canonical. Reuse as-is.

#### Missions — `src/lib/missions/`
- `mission-repository.ts` exports 22 functions including:
  - `createMission`, `getMission`, `listMissions`, `updateMissionGraph`, `updateMissionStatus`
  - `createRun`, `getRun`, `updateRunStatus`
  - `createStep`, `updateStepStatus`, `listSteps`
  - `createApproval`, `getApproval`, `resolveApproval`, `listPendingApprovals`
  - `createValidationResult`, `listValidationResults`
  - `createCheckpoint`, `listCheckpoints`, `getCheckpoint`
- Supabase tables: `missions`, `mission_runs`, `mission_steps`, `mission_approvals`, `mission_validation_results`, `mission_checkpoints`
- API routes: `/api/missions/{,[missionId]/{run,events,cancel}}`, `/api/approvals/{,[approvalId]}`
- **Reuse status:** production canonical. The run-executor should create missions/runs/steps and emit approvals through this repository. **Note:** `/api/missions/[missionId]/events` is currently a polling endpoint (SSE "could be added later" per its own comment) — Phase 2 may add SSE here or alongside the new `/api/litt/run` stream.

#### Visual Builds — `src/lib/visual-builds/`
- `types.ts` — Zod-validated `VisualPlan`, `VisualPlanSection`, `ProjectAsset`, `AssetManifest`, `AssetInspection`, `VisualBuild`, `VisualReviewFinding`, `VisualBuildBudget`
- `orchestrator.ts` — `runVisualBuild()` (single export at line 104)
- `repository.ts` — `listVisualBuilds` and persistence helpers
- `qa.ts`, `capture.ts`, `storage.ts`, `security.ts`, providers
- Supabase tables: `visual_builds`, `visual_plans`, `project_assets`, `asset_manifests`, `visual_reviews`
- API routes: `/api/projects/[projectId]/visual-builds/{,[buildId]/{approve,retry}}`
- **Reuse status:** production canonical. Phase 5 enriches `VisualPlanSchema` to the model-generated form described in the Handbook and replaces the deterministic plan generator. The asset inspection, manifest, and review subsystems are reused as-is.

#### Canvas — `src/lib/canvas/`
- `types.ts` — `CanvasTypeSchema`
- `repository.ts` — `createCanvas`, `listCanvases`
- API routes: `/api/canvases/{,[canvasId]/{blocks,revisions,promote}}`
- **Reuse status:** production canonical. `CoderWorkspace` will mirror run output into Canvas blocks via these routes.

#### Conversations — `src/lib/` + `/api/conversations/*`
- `conversations` table with `messages` relation
- API routes: `/api/conversations/{,[id]/messages}`
- **Reuse status:** production canonical but currently used only by `/api/chat/unified` and `/api/agents/chat`. Phase 2 persists every LiTT turn here.

#### Terminal command execution — `/api/litt/command`
- Already runs `typecheck`, `lint`, `test`, `build` against the real workspace
- **Reuse status:** production canonical. Phase 3 wraps this as a structured workspace tool with recorded exit codes.

#### File/scan helpers — `/api/litt/file`, `/api/litt/scan`
- Read files and scan the repository structure with auth + path traversal protection
- **Reuse status:** production canonical. Phase 3's `project-index` builds on these.

### 6. Existing systems that are bypassed or broken

| System | Evidence | Impact |
|---|---|---|
| `CanvasTool` → `/api/ai-chat` | Static prompt, no kernel, localStorage, srcDoc preview | The entire `tool=code` surface is outside the canonical control plane |
| `/api/ai/chat` | Uses `runAI` from `@/lib/ai/providers` with hardcoded `llama3.2:3b` default | Parallel chat path that does not route through the kernel |
| `/api/chat` | Agent-to-agent orchestrator path, separate from user-facing LiTT | Not broken, but not the canonical user conversation path |
| `/api/chat/unified` | Multi-mode chat (agent/llm/simple) — does not call `routeKernel` | Adapter that should be deprecated in favor of `/api/litt/run` |
| `/api/gemini/build` | `generateComponent`, `directorPlan`, `executorCode` — direct Gemini calls | Legacy builder path, no kernel |
| `/api/builder/sessions` | Persists to `builder_chat_sessions` table — separate from `conversations` | Parallel persistence; should consolidate |
| `/api/director/plan` | `DirectorGraphPlanner` — separate planner outside the kernel | Should fold into the kernel's planning phase |

### 7. Greenfield (does not exist)

| Item | Purpose | Phase |
|---|---|---|
| `POST /api/litt/run` | Canonical SSE run endpoint | 2 |
| `GET /api/litt/runs/[runId]/events` | SSE replay/live stream | 2 |
| `POST /api/litt/runs/[runId]/{approve,cancel,retry}` | Run control | 2 |
| `src/lib/litt/run-executor.ts` | Streaming run loop wrapping `routeKernel()` | 2 |
| `src/lib/litt/run-events.ts` | `LiTTRunEvent` contract + Zod schemas | 2 |
| `src/app/studio/tools/CoderWorkspace.tsx` | Canonical coder UI | 1 |
| `src/lib/litt/project-index.ts` | Repository indexing service | 3 |
| `src/lib/litt/context-selector.ts` | Context ranking | 3 |
| `src/lib/litt/workspace-tools.ts` | Structured file operations | 3 |
| `src/lib/litt/brand-profile.ts` | BrandProfile type + CRUD | 5 |
| `src/app/api/brand-profiles/*` | Brand profile routes | 5 |
| `litt_runs`, `litt_run_events`, `litt_messages` tables | Run + event persistence | 2 |
| `brand_profiles` table | Brand profile persistence | 5 |
| Control Inspector drawer | Evidence trail UI | 7 |

---

## Architecture diagram (current state)

```
User → /studio?tool=code → CanvasTool
                              │
                              ├─ localStorage (files, messages)
                              ├─ POST /api/ai-chat
                              │     └─ static system prompt
                              │     └─ generateText() (direct LLM)
                              │     └─ Supermemory (optional)
                              └─ srcDoc preview (in-browser)

User → /studio?tool=chat → ChatTool
                              └─ POST /api/gemini/chat
                                    └─ routeKernel() ✓
                                    └─ composeSystemPrompt() ✓
                                    └─ streamText/generateText
                                    └─ Supermemory
                                    └─ Supabase conversations

User → /studio?tool=build → BuilderTool
                              └─ GET /api/studio-projects (list only)

[Kernel] routeKernel() ── used by /api/gemini/chat ONLY
[Projects] /api/studio-projects/* ── used by BuilderTool (list)
[Missions] /api/missions/* ── NOT wired to any Studio tool
[Visual Builds] /api/projects/[projectId]/visual-builds/* ── NOT wired to any Studio tool
[Approvals] /api/approvals/* ── NOT wired to any Studio tool
[Checkpoints] /api/studio-projects/[projectId]/checkpoints ── NOT wired to any Studio tool
```

The rebuild's job is to make `tool=code` route through the kernel and reuse the Project/Mission/visual-build/approval/checkpoint systems that are currently orphaned.

---

## Phase 0 confirmation

- Zero application-code changes
- Zero migration files created
- Zero routing modifications
- Clean rebuild branch (`feat/litt-coder-rebuild` at `BASE_MAIN_SHA`)
- Awaiting Phase 1 approval
