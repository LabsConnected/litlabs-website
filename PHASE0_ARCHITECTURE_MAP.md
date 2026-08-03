# Phase 0 — StudioOS Architecture Map, Duplicate Report & Canonicalization Plan

**Date:** 2026-08-04
**Branch:** `fix/v1-release-gates` (up to date with `main` after PR #56)
**Build status:** `npx tsc --noEmit` passes, `pnpm build` passes (183 routes)

---

## 1. Current Architecture Map

### 1.1 Live Studio Render Chain

```
/studio (src/app/studio/page.tsx)
  → StudioHub (auth gate: Clerk)
    → <CommandStudio /> (src/app/studio/components/CommandStudio.tsx)
      → <VoiceSessionProvider> (src/app/studio/context/VoiceSessionContext.tsx)
        → <CommandStudioContent>
          ├── <CommandStudioHeader>     — top bar (project, status, model label, profile)
          ├── <CommandStudioNav>        — left sidebar / mobile bottom nav (5 destinations)
          ├── <StudioTranscript>        — conversation message list (center)
          ├── <CommandComposer>         — bottom input bar
          ├── <StudioWorkspaceFrame>    — inspector + drawer (activity, terminal, files, preview)
          └── dynamic tool components   — Canvas, Image, Video, Audio, Music, Builder, etc.
```

**Key:** `CommandStudio` is the single canonical shell. No `StudioOS.tsx` exists (already removed or renamed). No competing shell is rendered.

### 1.2 Conversation System (CANONICAL — LIVE)

```
User types in <CommandComposer>
  → handleComposerSend() in CommandStudio.tsx
    → conversation.send() in useCanonicalConversation.ts
      → useConversationStore (zustand) for optimistic messages
      → fetch POST /api/studio/conversations/[conversationId]/messages
        → auth() (Clerk)
        → routeKernel() + composeSystemPrompt() from @/lib/litt-kernel
        → streamText() from @/lib/llm (real SSE streaming)
        → insertMessage() to Supabase via conversation-service.ts
        → SSE response: text/event-stream with incremental tokens
      → Client reads SSE stream, updates optimistic message live
      → On done: replaces optimistic IDs with real server IDs
```

**Streaming:** REAL SSE (`text/event-stream`), not fake timer-based. Event types: `text`, `reasoning`, `done`, `error`. AbortController with 120s timeout.

**Persistence:** Messages persisted to Supabase via `conversation-service.ts`. Conversation store (`useConversationStore`) is zustand with server sync. Revision control (409 conflict handling with retry).

**Model selection reaches backend:** YES. The `send` function includes `provider`, `category`, and `model` in the POST body from `useStudioModelStore`. The API route uses these to select the LLM provider.

### 1.3 LiTT Implementations

| Path | Status | Purpose |
|------|--------|---------|
| `src/lib/litt-kernel/` | **CANONICAL** | LiTT brain — intent routing, prompt composition, capability registry, event bus, principles. Used by `/api/studio/conversations/[conversationId]/messages`, `/api/studio/conversations/[conversationId]/regenerate`, `/api/gemini/chat` |
| `src/lib/litt.ts` | LIVE (notifications only) | Notification system (Discord, webhook, push, email). NOT a brain. Used by `/api/litt/notify` and `agent-worker.ts` |
| `src/lib/litt/` | **DEAD** | Full duplicate: ConversationEngine, CanvasEngine, EventBus, CapabilityRegistry, VoiceProvider. Only imported by `ConversationContext.tsx`, which is itself dead (no file imports it) |
| `src/app/studio/context/ConversationContext.tsx` | **DEAD** | Duplicate conversation provider. Not imported by any file. Uses `@/lib/litt/` dead implementation |
| `terminal-server/jarvis-ai.ts` | LIVE (terminal server) | Naming violation — should be renamed to `litt-ai.ts` or similar |

### 1.4 Chat API Routes

| Route | Status | Purpose |
|-------|--------|---------|
| `/api/studio/conversations/[conversationId]/messages` | **CANONICAL** | SSE streaming chat. Used by `useCanonicalConversation` |
| `/api/studio/conversations/[conversationId]/regenerate` | LIVE | Regenerate assistant response |
| `/api/studio/conversations` | LIVE | List/create conversations |
| `/api/studio/conversations/[conversationId]` | LIVE | Get/update/delete conversation |
| `/api/ai/chat` | Legacy | Non-streaming Ollama/OpenRouter fallback. Uses different system prompt. Not used by Studio |
| `/api/chat/route.ts` | Legacy | Unknown — needs investigation |
| `/api/chat/unified/route.ts` | Legacy | Unknown — needs investigation |
| `/api/gemini/chat` | LIVE | Gemini-specific chat (uses litt-kernel). Used by GlobalCompanion |

### 1.5 Chat UI Components

| Component | Status | Path |
|-----------|--------|------|
| `StudioTranscript` | **CANONICAL** | `src/app/studio/components/StudioTranscript.tsx` |
| `CommandComposer` | **CANONICAL** | `src/app/studio/components/CommandComposer.tsx` |
| `LiTTChatBox` | Dead/legacy | `src/components/LiTTChatBox.tsx` — not imported by Studio |
| `GlobalCompanion` | LIVE (site-wide) | `src/components/companion/GlobalCompanion.tsx` — uses `/api/gemini/chat`, separate from Studio |
| `ConversationContext` | **DEAD** | `src/app/studio/context/ConversationContext.tsx` |

### 1.6 Stores

| Store | Status | Path |
|-------|--------|------|
| `useConversationStore` | **CANONICAL** | `src/app/studio/stores/useConversationStore.ts` — messages, conversations, revision control |
| `useStudioAgentStore` | **CANONICAL** | `src/app/studio/stores/useStudioAgentStore.ts` — active agent, AGENT_META (LiTT, Spark, specialists) |
| `useStudioModelStore` | **CANONICAL** | `src/app/studio/stores/useStudioModelStore.ts` — selected model, provider health, fallback notice |
| `useCanvasStore` | LIVE | `src/app/studio/stores/useCanvasStore.ts` — canvas state, uses localStorage for active canvas ID only |
| `useVoiceStore` | LIVE | `src/features/voice/store/useVoiceStore.ts` — voice session state |

### 1.7 Model Picker

**Component:** `src/components/ModelPicker.tsx` (full dropdown with search, categories, cost badges)
**Re-export:** `src/app/studio/components/ModelPicker.tsx` (just re-exports the above)
**Store:** `useStudioModelStore` — persists to `localStorage["litt-selected-model-v2"]`
**Model list:** `src/lib/studio-models.ts` (CHAT_MODELS array)

**CRITICAL GAP:** The `ModelPicker` component is **NOT rendered** in the Studio header. `CommandStudioHeader.tsx` imports `useStudioModelStore` and displays `selectedModel.label` as static text, but never mounts `<ModelPicker>`. The picker dropdown is invisible to users.

**Backend flow:** The selected model from the store DOES reach the backend — `useCanonicalConversation.send()` includes `provider`, `category`, and `model` in the POST body. The API route uses these to select the LLM.

### 1.8 Terminal Architecture

```
Browser (StudioTerminalDrawer)
  → Socket.IO client connection to terminal-server
    → Express server (terminal-server/server.ts, port 4001)
      → Bearer token auth (verifyTerminalToken)
      → WorkspaceManager (prepareWorkspace, getWorkspace)
        → WorkspaceSecurity (path traversal protection)
      → node-pty (shell sessions)
      → Docker manager (production isolation)
      → FileService / GitService
```

**Auth:** Terminal JWT (separate from Clerk). Internal service auth via `X-Internal-Service-Key` header.
**Workspace:** `TERMINAL_WORKSPACE_ROOT` env var, per-project directories.
**Security:** Path traversal protection, blocked commands list, Docker isolation in production.

### 1.9 File APIs

| Route | Purpose |
|-------|---------|
| `/api/studio-projects/[projectId]/files` | Canonical file API for Studio projects |
| `/api/studio-projects/[projectId]/workspace` | Workspace preparation |
| `/api/galaxy/files` | Legacy file route |
| `/api/litt/file` | LiTT file operations |
| `/api/projects/[projectId]` | Project CRUD |

### 1.10 GitHub Integration

- `/api/github/*` — OAuth, repositories, branches, sync, webhook
- `/api/github/connection-state` — returns connection status
- `useConnectionSummary` hook — aggregates capabilities including GitHub
- **Status clarity:** The `useConnectionSummary` hook distinguishes between `githubAuthorized`, `repositoryName`, and `writeAccess` — so authorization vs. synchronization is separated at the data level. UI presentation needs verification.

### 1.11 Canvas Storage

`useCanvasStore.ts` uses `localStorage` only for the active canvas ID (a string). Canvas blocks themselves are managed through the Canvas engine and API, not localStorage. The blueprint's concern about "files persisted in localStorage" appears to be outdated or refers to a different system.

### 1.12 Sub-routes

| Route | Renders |
|-------|---------|
| `/studio` | `CommandStudio` (main shell) |
| `/studio/github` | GitHub connection page |
| `/studio/image` | Image tool page |
| `/studio/visual-test` | Visual test harness |
| `/chat` | Redirect to `/studio?tool=chat` |
| `/agent-chat` | Redirect to `/studio?tool=chat` |

---

## 2. Duplicate-System Report

### 2.1 Dead LiTT Implementation (`src/lib/litt/` + `ConversationContext.tsx`)

**Severity:** Medium (confusion, maintenance burden, no runtime impact)
**Files:**
- `src/lib/litt/conversation-engine.ts`
- `src/lib/litt/canvas/canvas-engine.ts`
- `src/lib/litt/event-bus.ts`
- `src/lib/litt/capability/capability-registry.ts`
- `src/lib/litt/voice/openai-realtime.ts`
- `src/lib/litt/voice/text-only-fallback.ts`
- `src/lib/litt/types.ts`
- `src/app/studio/context/ConversationContext.tsx`

**Evidence:** `ConversationContext.tsx` is not imported by any file. The `src/lib/litt/` modules are only imported by `ConversationContext.tsx`. No runtime impact — dead code.

**Action:** Delete all files. Run `npx tsc --noEmit` to confirm no breakage.

### 2.2 Legacy Chat API Routes

**Severity:** Low (no runtime impact, but confusing)
**Files:**
- `src/app/api/ai/chat/route.ts` — non-streaming, different system prompt, not used by Studio
- `src/app/api/chat/route.ts` — needs investigation
- `src/app/api/chat/unified/route.ts` — needs investigation

**Action:** Verify no callers, then delete or mark as deprecated.

### 2.3 Legacy Chat UI Components

**Severity:** Low
**Files:**
- `src/components/LiTTChatBox.tsx` — not imported by Studio
- `src/components/chat/MessageAvatar.tsx` — needs investigation

**Action:** Verify no callers, then delete.

### 2.4 Terminal Server `jarvis-ai.ts`

**Severity:** Low (naming violation per blueprint)
**File:** `terminal-server/jarvis-ai.ts`
**Action:** Rename to `litt-ai.ts` and update imports in `terminal-server/server.ts`.

### 2.5 `src/lib/litt.ts` (Notification System)

**Severity:** Low (naming confusion — named "LiTT" but is just notifications)
**Action:** Rename to `src/lib/notifications.ts` and update the 2 importers.

---

## 3. Canonicalization Plan

### Phase 1 — Fix Core Studio Reliability (Priority Order)

1. **Mount the ModelPicker in the Studio header**
   - `CommandStudioHeader.tsx` needs to render `<ModelPicker>` with `selectedModel` from `useStudioModelStore` and `onModelChange` calling `selectModel`.
   - Ensure dropdown opens upward when near viewport bottom.
   - The backend already receives the model — no API changes needed.

2. **Verify chat Send end-to-end**
   - The flow is already canonical: `useCanonicalConversation.send()` → `/api/studio/conversations/[conversationId]/messages` → SSE streaming.
   - Verify: input handler fires, request reaches API, auth succeeds, model request starts, response streams, message persists, UI updates, errors are shown.
   - The `handleComposerSend` in `CommandStudio.tsx` already restores typed text on failure.

3. **Verify real response streaming**
   - Already implemented as real SSE. Verify no fake timer-based typing anywhere.

4. **Verify active project restoration**
   - `useCanonicalConversation` loads conversations from server on mount, using `serverProjectId` from `useConnectionSummary`.
   - `getActiveProjectId` falls back to user-scoped localStorage.
   - Verify: reload page → project and conversation restore correctly.

5. **Fix terminal workspace resolution**
   - Terminal server has `WorkspaceManager` with path traversal protection.
   - Verify: terminal connects to correct project workspace, not a default/global one.

6. **Remove control collisions (mobile)**
   - Verify: microphone doesn't overlap input, camera accessible, keyboard doesn't cover controls.

### Phase 2 — Canonicalize Architecture (Remove Dead Code)

1. **Delete dead LiTT implementation**
   - Remove `src/lib/litt/` directory (7 files)
   - Remove `src/app/studio/context/ConversationContext.tsx`
   - Run `npx tsc --noEmit` to confirm

2. **Rename `src/lib/litt.ts` → `src/lib/notifications.ts`**
   - Update 2 importers: `/api/litt/notify/route.ts`, `agent-worker.ts`

3. **Rename `terminal-server/jarvis-ai.ts` → `terminal-server/litt-ai.ts`**
   - Update import in `terminal-server/server.ts`

4. **Investigate and remove legacy chat routes**
   - `/api/ai/chat/route.ts` — verify no callers, delete
   - `/api/chat/route.ts` — verify no callers, delete
   - `/api/chat/unified/route.ts` — verify no callers, delete

5. **Remove legacy chat UI components**
   - `src/components/LiTTChatBox.tsx` — verify no importers, delete
   - `src/components/chat/MessageAvatar.tsx` — verify no importers, delete

### Phase 3+ — Per Blueprint

Phase 3 (Mission Forge), Phase 4 (Unified workspace tools), Phase 5 (Creative suite), Phase 6 (Memory and automation), Phase 7 (Production hardening) — proceed per the master blueprint.

---

## 4. Uncommitted Working Tree

One uncommitted change: `src/lib/litt-intelligence/mcp-adapter.ts` — implements real MCP `connect()` with Bearer auth (SUPABASE_ACCESS_TOKEN), replacing the Phase 1 stub. This is a work-in-progress improvement aligned with blueprint Section 17 (MCP Integration). Should be committed and tested.

---

## 5. Immediate Next Actions

1. **Mount ModelPicker in CommandStudioHeader** — this is the highest-impact single fix. The component exists, the store works, the backend receives the model. Only the UI mounting is missing.
2. **Delete dead LiTT code** — cleanest cleanup, reduces confusion.
3. **Commit the MCP adapter improvement** — already in working tree, aligned with blueprint.
4. **Run the Studio smoke flow** (blueprint Section 28) to verify the Send flow, model picker, project restoration, and terminal.
