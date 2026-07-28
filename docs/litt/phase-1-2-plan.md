# Phase 1-2 Implementation Plan

**Phase 0 deliverable.** Concrete plan for the first vertical slice: `Studio conversation → Kernel decision → canonical run events → persisted conversation → Canvas update`. Proposed SQL appears in this document only — **no migration files are created during Phase 0.**

The directive is clear: the right job is **integration and consolidation**, not blindly creating every system again. Existing Project, Mission, approval, checkpoint, workspace, and visual-build systems are reused unless this audit proves they cannot be.

---

## Phase 1 — Canonical Coder shell (UI only, no new AI behavior)

### Goal

Replace `CanvasTool` as the default `tool=code` surface with a `CoderWorkspace` shell that reads from existing APIs only. No new AI behavior — just the canonical layout that Phase 2 will wire to `/api/litt/run`.

### Proposed files

| File | Purpose |
|---|---|
| `src/app/studio/tools/CoderWorkspace.tsx` | Canonical coder UI (desktop + mobile layouts) |
| `src/app/studio/tools/coder-workspace/` | Subcomponents (ProjectBar, ConversationPane, FilesPane, CodePane, PreviewPane, Composer, MobileSheets) |

### Modified files

| File | Change |
|---|---|
| `src/app/studio/components/StudioOS.tsx` (line 60-61) | Route `tool=code` → `CoderWorkspace`. Preserve `CanvasTool` behind `?legacy=code` query flag. |

### Layout (per Handbook Section 11 + directive Section 2)

**Desktop (≥1024px):**
- Top bar: Project name | Branch | Run status | Model | Credits
- Left rail: LiTT conversation + Plan/timeline tabs
- Right pane: Files | Code | Preview | Review tabs
- Bottom drawer: Canvas | Terminal (collapsible)
- Persistent composer at bottom of left rail

**Mobile (<1024px):**
- Top bar: Project | Run status | Menu
- Main: Conversation OR work view (toggle)
- Persistent composer
- Bottom sheet: Files | Code | Preview | Canvas | Terminal

### Data sources (read-only, no new AI behavior)

- Project list/status: `GET /api/studio-projects`
- Files: `GET /api/studio-projects/[projectId]/files`
- Preview: `GET /api/studio-projects/[projectId]/preview`
- Checkpoints: `GET /api/studio-projects/[projectId]/checkpoints`
- Conversations: `GET /api/conversations`
- Canvas: `GET /api/canvases?projectId=...`

### Rollback strategy (Phase 1)

1. `CoderWorkspace.tsx` is a new file — delete it.
2. Revert `StudioOS.tsx` line 60-61 to mount `CanvasTool` for `tool=code`.
3. The `?legacy=code` flag and `CanvasTool` are preserved throughout, so rollback is a single-line revert.
4. No migrations, no API changes, no DB changes — rollback is purely client-side.

### Verification (Phase 1)

- `npx tsc --noEmit` — 0 new errors
- `pnpm lint` — 0 errors
- `pnpm build` — 57+ routes, no errors
- Visual check: `CoderWorkspace` renders at 1440×900 and 390×844
- `?legacy=code` still mounts `CanvasTool`

---

## Phase 2 — Canonical LiTT run API

### Goal

Build the canonical `/api/litt/run` SSE endpoint and migrate `CoderWorkspace` off `/api/ai-chat`. This is the first real behavior change and the smallest verified vertical slice.

### Proposed files

| File | Purpose |
|---|---|
| `src/lib/litt/run-events.ts` | `LiTTRunEvent` union + Zod schemas |
| `src/lib/litt/run-executor.ts` | Streaming run loop wrapping `routeKernel()` |
| `src/lib/litt/run-repository.ts` | Persist runs + events to Supabase |
| `src/app/api/litt/run/route.ts` | `POST` — start run, return `runId`, stream SSE |
| `src/app/api/litt/runs/[runId]/events/route.ts` | `GET` — SSE replay/live stream |
| `src/app/api/litt/runs/[runId]/approve/route.ts` | `POST` — approval gate |
| `src/app/api/litt/runs/[runId]/cancel/route.ts` | `POST` — cancel run |
| `src/app/api/litt/runs/[runId]/retry/route.ts` | `POST` — retry run |

### Modified files

| File | Change |
|---|---|
| `src/app/studio/tools/CoderWorkspace.tsx` | Replace `fetch("/api/ai-chat")` with `fetch("/api/litt/run")` + SSE consumption |

### Reused systems (NOT recreated)

| System | Reuse |
|---|---|
| `routeKernel()`, `composeSystemPrompt()` | Called by run-executor (same pattern as `/api/gemini/chat`) |
| `mission-repository.ts` | run-executor creates mission + run + steps via `createMission`, `createRun`, `createStep` |
| `conversations` API | run-executor persists each turn via `/api/conversations/[id]/messages` |
| `canvas` API | run-executor mirrors output to Canvas blocks via `/api/canvases/[canvasId]/blocks` |
| `streamText`/`generateText` from `@/lib/llm` | LLM execution (same as `/api/gemini/chat`) |
| Supermemory | Memory recall/save (same as `/api/gemini/chat`) |

### Proposed Supabase migrations (SQL in this doc only — NOT created during Phase 0)

```sql
-- Migration: create litt_runs table
-- Purpose: Persist each canonical LiTT run
CREATE TABLE IF NOT EXISTS public.litt_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  mission_id TEXT,
  conversation_id TEXT,
  canvas_id TEXT,
  parent_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','awaiting_approval','completed','failed','cancelled')),
  mode TEXT NOT NULL,
  intent_text TEXT NOT NULL,
  decision JSONB NOT NULL,
  model_profile_id TEXT,
  model_provider TEXT,
  model_name TEXT,
  approval_mode TEXT NOT NULL DEFAULT 'approval'
    CHECK (approval_mode IN ('read_only','approval','autonomous')),
  error TEXT,
  token_input INT,
  token_output INT,
  cost_cents NUMERIC(10,4) DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS litt_runs_user_id_idx ON public.litt_runs (user_id);
CREATE INDEX IF NOT EXISTS litt_runs_project_id_idx ON public.litt_runs (project_id);
CREATE INDEX IF NOT EXISTS litt_runs_mission_id_idx ON public.litt_runs (mission_id);
CREATE INDEX IF NOT EXISTS litt_runs_conversation_id_idx ON public.litt_runs (conversation_id);
CREATE INDEX IF NOT EXISTS litt_runs_status_idx ON public.litt_runs (status);
CREATE INDEX IF NOT EXISTS litt_runs_created_at_idx ON public.litt_runs (created_at DESC);

ALTER TABLE public.litt_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY litt_runs_user_select ON public.litt_runs
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY litt_runs_user_insert ON public.litt_runs
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY litt_runs_user_update ON public.litt_runs
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
```

```sql
-- Migration: create litt_run_events table
-- Purpose: Persist the canonical event stream for each run
CREATE TABLE IF NOT EXISTS public.litt_run_events (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.litt_runs(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS litt_run_events_run_id_seq_idx
  ON public.litt_run_events (run_id, seq);

ALTER TABLE public.litt_run_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY litt_run_events_user_select ON public.litt_run_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.litt_runs r
      WHERE r.id = run_id AND r.user_id = auth.jwt() ->> 'sub'
    )
  );
```

```sql
-- Migration: create litt_messages table
-- Purpose: Persist each user + LiTT turn in a canonical conversation
CREATE TABLE IF NOT EXISTS public.litt_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  run_id TEXT REFERENCES public.litt_runs(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  content_blocks JSONB,
  model_provider TEXT,
  model_name TEXT,
  token_input INT,
  token_output INT,
  cost_cents NUMERIC(10,4) DEFAULT 0,
  memory_ids TEXT[],
  context_files TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS litt_messages_conversation_id_idx
  ON public.litt_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS litt_messages_run_id_idx ON public.litt_messages (run_id);

ALTER TABLE public.litt_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY litt_messages_user_select ON public.litt_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.litt_runs r
      WHERE r.id = run_id AND r.user_id = auth.jwt() ->> 'sub'
    )
    OR conversation_id IN (
      SELECT id FROM public.conversations WHERE user_id = auth.jwt() ->> 'sub'
    )
  );
```

**Note on RLS:** The exact `auth.jwt() ->> 'sub'` predicate may need adjustment to match the Clerk user ID mapping used by the rest of the codebase (`src/lib/user-db.ts` maps Clerk IDs to `users.id`). The migration author in Phase 2 must verify the auth pattern against existing tables (`conversations`, `missions`) before finalizing RLS.

### `LiTTRunEvent` contract (proposed, Zod-validated)

```typescript
export type LiTTRunEvent =
  | { type: "run.started"; runId: string; decision: LiTTControlDecision }
  | { type: "decision.created"; decision: LiTTControlDecision }
  | { type: "context.loaded"; files: string[]; memories: string[] }
  | { type: "plan.created"; plan: BuildPlan }
  | { type: "plan.approval_required"; plan: BuildPlan }
  | { type: "plan.approved"; plan: BuildPlan }
  | { type: "llm.streaming"; delta: string }
  | { type: "llm.completed"; text: string; provider: string; model: string }
  | { type: "tool.called"; tool: string; input: unknown }
  | { type: "tool.result"; tool: string; output: unknown; exitCode?: number }
  | { type: "tool.approval_required"; tool: string; input: unknown }
  | { type: "tool.approved"; tool: string; input: unknown }
  | { type: "file.proposed"; path: string; diff: string; artifactId: string }
  | { type: "file.applied"; path: string; artifactId: string }
  | { type: "canvas.block_added"; canvasId: string; blockId: string; block: unknown }
  | { type: "mission.step_completed"; stepId: string }
  | { type: "run.awaiting_approval"; reason: string }
  | { type: "run.completed"; summary: string; artifacts: string[] }
  | { type: "run.failed"; error: string }
  | { type: "run.cancelled" };
```

### Run-executor flow

```
POST /api/litt/run { message, projectId?, conversationId?, approvalMode? }
  │
  ├─ 1. auth() → userId
  ├─ 2. routeKernel({ message, userId, projectId, ... }) → decision
  ├─ 3. Create litt_runs row (status='running')
  ├─ 4. Emit run.started + decision.created events
  ├─ 5. composeSystemPrompt(decision) → systemPrompt
  ├─ 6. (if decision.planning.required) → emit plan.created / plan.approval_required
  ├─ 7. streamText({ systemPrompt, message, ... })
  │     ├─ on delta → emit llm.streaming
  │     ├─ on tool_call → emit tool.called
  │     │     ├─ if approval required → emit tool.approval_required, await POST /approve
  │     │     └─ execute tool → emit tool.result
  │     └─ on complete → emit llm.completed
  ├─ 8. Persist litt_messages (user + assistant)
  ├─ 9. Mirror to Canvas via /api/canvases/[canvasId]/blocks
  ├─ 10. (if mission) createStep + updateStepStatus → emit mission.step_completed
  └─ 11. Emit run.completed, update litt_runs.status='completed'
```

### Rollback strategy (Phase 2)

1. **Revert `CoderWorkspace.tsx`** to call `/api/ai-chat` again (single fetch change).
2. **Delete the 8 new files** (run-events, run-executor, run-repository, 5 API routes).
3. **Drop the 3 new tables** via a down-migration:
   ```sql
   DROP TABLE IF EXISTS public.litt_messages;
   DROP TABLE IF EXISTS public.litt_run_events;
   DROP TABLE IF EXISTS public.litt_runs;
   ```
4. `CanvasTool` (behind `?legacy=code`) is untouched and remains the fallback.
5. No existing system (Project, Mission, visual-build, approval, checkpoint, conversation, canvas) is modified — only new tables and new routes are added. Rollback is additive-revertible.

### Verification (Phase 2)

- `npx tsc --noEmit` — 0 new errors
- `pnpm lint` — 0 errors
- `pnpm test` — new SSE event-order + approval tests pass
- `pnpm build` — 57+ routes, no errors
- Vertical-slice acceptance test below passes

---

## First vertical-slice acceptance test

**Path:** `Studio conversation → Kernel decision → canonical run events → persisted conversation → Canvas update`

### Preconditions

- Authenticated user with at least one Project (or no Project — the slice must work without one for non-Project requests)
- `feat/litt-coder-rebuild` branch checked out
- Dev server running (`pnpm dev`)
- Supabase migrations applied (Phase 2 creates them)

### Test steps

1. **Open** `/studio?tool=code` — `CoderWorkspace` mounts.
2. **Type** "Build a premium landing page for LiTTree LabStudios" into the composer.
3. **Submit** — `CoderWorkspace` calls `POST /api/litt/run` with `{ message, projectId: null, conversationId: null }`.
4. **Observe SSE stream** — the following events arrive in order:
   - `run.started` with `runId` and `decision`
   - `decision.created` with a `LiTTControlDecision` where `routing.mode === "build"` (or `"create"`)
   - `llm.streaming` deltas (one or more)
   - `llm.completed` with final text, provider, model
   - `run.completed` with summary and artifacts
5. **Verify persistence** — query Supabase:
   - `SELECT * FROM litt_runs WHERE id = '<runId>'` → row exists, `status='completed'`
   - `SELECT * FROM litt_run_events WHERE run_id = '<runId>' ORDER BY seq` → events match the stream order
   - `SELECT * FROM litt_messages WHERE run_id = '<runId>'` → 2 rows (user + assistant)
   - `SELECT * FROM conversations WHERE id = '<conversationId>'` → conversation created
6. **Verify Canvas update** — if a Canvas was created/updated:
   - `SELECT * FROM canvases WHERE conversation_id = '<conversationId>'` → canvas row exists
   - `SELECT * FROM canvas_blocks WHERE canvas_id = '<canvasId>'` → at least one block with the assistant output
7. **Verify no `/api/ai-chat` call** — DevTools Network tab shows no request to `/api/ai-chat`.
8. **Verify `?legacy=code` still works** — navigate to `/studio?tool=code&legacy=code`, confirm `CanvasTool` mounts and calls `/api/ai-chat`.

### Assertions

| # | Assertion | Pass criteria |
|---|---|---|
| 1 | `CoderWorkspace` mounts for `tool=code` | No `CanvasTool` in DOM (unless `?legacy=code`) |
| 2 | `POST /api/litt/run` returns `runId` | 200 with `{ runId }` |
| 3 | SSE stream emits `run.started` first | First event `type === "run.started"` |
| 4 | SSE stream emits `decision.created` | Event contains `LiTTControlDecision` with `routing.mode` |
| 5 | SSE stream emits `llm.streaming` + `llm.completed` | At least one delta + a completed event |
| 6 | SSE stream emits `run.completed` last | Final event `type === "run.completed"` |
| 7 | `litt_runs` row persisted | `status='completed'`, `mode` matches decision |
| 8 | `litt_run_events` rows persisted in order | `seq` ascending, types match stream |
| 9 | `litt_messages` rows persisted | 2 rows: role='user' + role='assistant' |
| 10 | `conversations` row persisted | Created with correct `user_id` |
| 11 | Canvas updated | Canvas + block rows exist linked to conversation |
| 12 | No `/api/ai-chat` request | Network tab clean |
| 13 | `?legacy=code` fallback works | `CanvasTool` mounts, calls `/api/ai-chat` |

### Out of scope for this slice

- Project indexing (Phase 3)
- Context selection (Phase 3)
- Structured workspace tools / patches (Phase 3)
- Approval gating for writes (Phase 3)
- Plan mode (Phase 4)
- Checkpoints (Phase 4)
- Visual builds (Phase 5)
- Multimodal review (Phase 6)
- Control Inspector (Phase 7)
- Route consolidation (Phase 7)

This slice proves the canonical pipe end-to-end with the smallest possible surface area. Once it passes, Phase 3+ layers on the richer capabilities.

---

## Phase 0 confirmation

- Zero application-code changes
- Zero migration files created (SQL appears in this document only)
- Zero routing modifications
- Clean rebuild branch (`feat/litt-coder-rebuild` at `BASE_MAIN_SHA = 729b3d72`)
- Awaiting Phase 1 approval
