# Canonical Runtime Map — Real Flows

> How text, voice, tools, project, and context actually flow through the system today.

## Flow 1: Studio Text Chat

```
User types in CommandComposer
  → useConversationStore.sendMessage()
  → fetch POST /api/studio/conversations/[conversationId]/messages
    Body: { message, clientRequestId, expectedRevision, runtimeContext, executionMode }

  API ROUTE:
  → auth(req) → { userId, clerkId }
  → getConversation(convId, userId) → ownership check
  → RPC try_increment_conversation_revision → atomic revision bump
  → resolveAgent(agentSlug) → agent config
  → insertMessage(user message) → DB (idempotent via clientRequestId)
  → buildStudioContext(userId, conversationId, projectId, agentSlug) → project context
  → buildCanonicalRuntimeContext(userId, projectId, clientHint) → runtime state
  → listMessages() → DB history (last HISTORY_LIMIT)
  → recallMemories(message, userId, projectId) → memory recall
  → buildRunContextFromStudio() → ResolvedRunContext
  → buildPrompt(runCtx, message, agent) → system prompt + context

  BRANCH: V2 (workspaceExecutionAvailable && projectId)
  → createWorkspaceTransport(projectId, userId)
  → runAgentLoopV2(message, transport, config)
    → callLLMWithTools() → LLM with structured tool calls
    → PermissionEngine checks each tool call
    → toolRegistry executes approved tools via transport
    → runBuildFixLoop() → typecheck/lint/test/build
    → Loop detection (3 identical calls = cancel)
    → Checkpoint before mutation batches
    → Returns: { finalText, events, toolCalls, pendingApproval? }

  BRANCH: V1 (fallback — no workspace)
  → runAgentLoop(message, projectId, prompt)
    → Pre-LLM auto-inspection (read-only tools)
    → Enriches prompt with tool results
  → streamText(enrichedPrompt) → LLM call

  SSE STREAM:
  → V2: emit progress events (tool_start, tool_result, phase, build_start, build_result, checkpoint, approval_required)
  → V2: emit final text as single chunk
  → V1: stream text chunks as they arrive
  → emit { type: "done", userMessage, assistantMessage, revision }
  → emit [DONE]

  PERSISTENCE:
  → updateMessageStatus(assistantMessage.id, "completed", text)
  → persistMemory(conversation summary)
  → settleRun(credits) if marketplace agent

  CLIENT:
  → useConversationStore receives SSE events
  → Appends text to assistant message
  → Renders tool_execution events in transcript
  → Updates revision
```

### Duplicate state paths in text flow

1. **Runtime context built twice**: `buildStudioContext` (project resolver) + `buildCanonicalRuntimeContext` (runtime context) — overlapping concerns, both query project state.
2. **Memory recalled in route AND in voice-runtime**: `recallMemories` called in messages route, but `voice-runtime.ts` also calls it independently for voice turns.
3. **Agent resolution split**: `resolveAgent` (builtin) vs `resolveRuntimeAgent` (marketplace) — two paths, same purpose.

---

## Flow 2: Studio Voice

```
User taps mic in CommandComposer or FloatingVoiceButton
  → VoiceSessionContext.startMicrophone()
  → useInworldSession connects to voice-server (WebSocket proxy → Inworld)
  → VAD detects speech → audio sent to Inworld for STT
  → Inworld returns transcript
  → Transcript validation (reject filler/noise/duplicate)
  → Transcript appears as editable draft in composer
  → User presses Send (or auto-send if enabled)

  SEND:
  → useConversationStore.sendMessage(transcript)
  → SAME PATH AS TEXT: POST /api/studio/conversations/[conversationId]/messages
  → Same auth, same conversation, same project, same memory
  → SSE response with assistant text

  TTS:
  → VoiceSessionContext speaks assistant text via Inworld TTS
  → Mic paused during TTS, resumed after cooldown
```

### Key observation

Studio voice (Inworld) sends the transcript through the **same text API route**. Voice is just a different input method for the same conversation. This is correct architecture.

### Duplicate state paths in voice flow

1. **VoiceSessionContext** (1121 lines) manages its own state machine separate from conversation store.
2. **ConversationContext** also has voice provider (`OpenAIRealtimeProvider`, `TextOnlyFallbackProvider`) — a second voice abstraction that appears unused or legacy.
3. Two voice systems exist: `VoiceSessionContext` (Inworld, active) and `ConversationContext.voiceProvider` (OpenAI Realtime, unclear if active).

---

## Flow 3: Vapi Phone

```
Caller dials phone number
  → Vapi handles telephony + STT/TTS
  → Vapi POST /api/litt/voice/v1/chat/completions
    Body: OpenAI chat completions format
    metadata: { conversationId?, projectId?, agentSlug? }

  API ROUTE:
  → auth(req) → Bearer token (Clerk session)
  → Extract latest user message from messages array
  → Extract metadata (conversationId, projectId)
  → If no conversationId: resolveVoiceContext creates one
  → resolveVoiceContext(args):
    → resolveProject(userId, projectId)
    → getConversation(convId, userId) → DB history
    → recallMemories(message, userId, projectId)
    → buildProjectContextBlock(project)
    → Returns ResolvedRunContext
  → buildPrompt(runCtx, message) → system prompt
  → executeRun(runCtx) → LiTT Runtime execution
  → verifyResult() → result verification
  → auditRun() → audit log
  → detectActions() → action detection
  → Returns OpenAI-format streaming response

  Vapi speaks response via TTS
```

### Key observation

Vapi phone uses `/api/litt/voice/v1/chat/completions` which calls `runLiTT` / `runLiTTStream` from `@/lib/litt-runtime`. This is a **different entry point** than Studio text (`/api/studio/conversations/[conversationId]/messages` which calls `runAgentLoopV2`).

### Critical duplication

**Two LiTT runtime entry points exist:**

| Path | Entry point | Used by |
|---|---|---|
| Studio text | `runAgentLoopV2` (litt-intelligence) | Studio chat |
| Vapi phone | `runLiTT` / `runLiTTStream` (litt-runtime) | Phone calls |

These are **not the same code**. `litt-intelligence/agent-loop-v2.ts` and `litt-runtime/execution-engine.ts` are separate implementations. They share some utilities (buildPrompt, memory service) but have different execution logic.

**This is the #1 architectural duplication to fix.**

---

## Flow 4: Image Generation

```
User opens Image Studio (ImageTool.tsx)
  → Enters prompt, selects provider, aspect ratio
  → POST /api/studio/generate
    Body: { prompt, provider, aspectRatio, batchSize }

  API ROUTE:
  → auth(req) → userId
  → Provider selection:
    - "pollinations" → URL construction (free, no key)
    - Google GenAI → Imagen API call
  → Returns { images: [{ url, prompt, provider, timestamp }] }

  CLIENT:
  → ImageTool displays images
  → No connection to conversation or messages
```

### Key observation

Image generation is a **completely separate system** from chat. It does not:
- Use the conversation store
- Create message parts
- Go through the agent loop
- Use the tool registry
- Persist results in conversation

**This must be unified** — image generation should be a tool in the agent loop, returning an `ImagePart` in the assistant message.

---

## Flow 5: Canvas Agent Actions

```
User asks LiTT to modify canvas in chat
  → Text message sent through normal flow
  → LiTT responds with text instructions
  → User manually applies changes in CanvasPanel

  OR:

  Canvas action chip clicked in transcript
  → CanvasPanel receives pendingAction
  → executeAction(action) → useCanvasStore
  → API call to /api/canvases/[canvasId]/blocks
  → Block created/updated in DB
```

### Key observation

Canvas is **not wired to the agent loop**. LiTT cannot:
- Read canvas blocks as tool input
- Modify canvas blocks as tool output
- Use canvas as a visual representation of code

Canvas is a standalone visual editor with its own API, not integrated with the agent's tool registry.

---

## Flow 6: Code Agent Actions

```
User asks LiTT to edit code in chat
  → V2 path: agent loop calls tools:
    - files.read → reads file via workspace transport
    - apply_patch → applies diff via workspace transport
    - build.run → runs build via workspace transport
    - typecheck.run → runs typecheck
  → Results streamed as progress events
  → Final text explains what was done

  CodeWorkspace (separate):
  → User opens Code tool
  → Monaco editor loads files from workspace
  → User manually edits
  → Save writes to workspace
```

### Key observation

Code editing through the agent loop (V2) works via workspace transport tools. CodeWorkspace is a manual editor. These are correctly separate — the agent uses tools, the user uses the editor. But both operate on the same workspace files.

---

## Duplicate state/runtime paths — summary

| # | Duplication | Impact |
|---|---|---|
| 1 | **Two LiTT runtime entry points** — `litt-intelligence/agent-loop-v2.ts` vs `litt-runtime/execution-engine.ts` | Different execution logic for text vs phone. Must unify. |
| 2 | **Two voice abstractions** — `VoiceSessionContext` (Inworld) vs `ConversationContext.voiceProvider` (OpenAI Realtime) | Unclear which is active. Dead code risk. |
| 3 | **Runtime context built twice** — `buildStudioContext` + `buildCanonicalRuntimeContext` | Overlapping project state queries. |
| 4 | **Memory recall in two places** — messages route + voice-runtime | Same memory recalled differently. |
| 5 | **Image generation outside chat** — separate API, no conversation integration | Not unified with agent loop. |
| 6 | **Canvas outside agent loop** — own API, no tool registry integration | LiTT can't manipulate canvas programmatically. |
| 7 | **BuilderTool vs Quick Build** — BuilderTool is a project picker, not a guided flow | Two different "build" concepts. |
| 8 | **Agent store vs runtime agent** — `useStudioAgentStore` vs `resolveRuntimeAgent` | Two agent resolution systems. |

---

## Dependency graph (what must exist before what)

```
Canonical User / Project / Conversation
                ↓
         Canonical LiTT Core (ONE runtime)
                ↓
     Tool + Permission Runtime
                ↓
        Activity Event Stream
                ↓
        Universal Artifacts (message parts)
                ↓
     ┌──────────┼──────────┐
     ↓          ↓          ↓
   Text       Voice      Quick Build
                            ↓
                       Workspace
                            ↓
                  Files / Code / Canvas
                            ↓
                         Preview
                            ↓
                        Verification
                            ↓
                   Checkpoint / Publish
```

**If the foundation isn't canonical, Game Studio, Operator, IDE extension, mobile, etc. will all inherit the same mess.**

---

## Extensible interfaces to prepare now

Even though P1/P2 features wait, P0 architecture must be extensible:

```ts
channel:
  | "web"
  | "voice"
  | "phone"
  | "mobile"
  | "ide"

artifact:
  | "text"
  | "image"
  | "audio"
  | "video"
  | "code"
  | "file"
  | "preview"
  | "canvas"
  | "receipt"

workspaceType:
  | "project"
  | "sandbox"
  | "tutorial"
  | "game"
```

These types should be in the canonical type system so future features plug in rather than force another rewrite.
