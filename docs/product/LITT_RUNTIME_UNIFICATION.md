# LiTT Runtime Unification — Canonical Execution Engine

> **The one doorway into LiTT.** Every channel — text, voice, phone, mobile, future API — funnels through one execution engine.

## Current state (the problem)

```
TEXT
Studio Chat
   ↓
litt-intelligence/agent-loop-v2.ts   ← multi-step tool calling, build-fix, checkpoints
   ↓
tools / model / project actions

PHONE
Vapi
   ↓
litt-runtime/execution-engine.ts     ← single LLM call, no tools, no loop
   ↓
tools / project actions (but tool plan is voided — never executed)
```

### What each runtime has

| Capability | `litt-intelligence/agent-loop-v2.ts` | `litt-runtime/execution-engine.ts` |
|---|---|---|
| Multi-step tool calling | ✅ Yes | ❌ No (tool plan is `void`ed) |
| Workspace transport | ✅ Yes | ❌ No |
| Permission engine (PLAN/ACT/AUTO) | ✅ Yes | ❌ No |
| Build-fix loop | ✅ Yes | ❌ No |
| Checkpoints | ✅ Yes | ❌ No |
| Approval pause/resume | ✅ Yes | ❌ No |
| Progress events | ✅ Yes | ❌ No |
| Loop detection | ✅ Yes | ❌ No |
| Prompt builder | ❌ Uses its own | ✅ `litt-runtime/prompt-builder.ts` |
| Request context resolver | ❌ Uses `buildStudioContext` | ✅ `litt-runtime/request-context.ts` |
| Memory recall/persist | ❌ Uses route-level | ✅ `litt-runtime/runtime.ts` |
| Result verification | ❌ No | ✅ `litt-runtime/result-verifier.ts` |
| Audit logging | ❌ Route-level | ✅ `litt-runtime/audit-service.ts` |
| Action detection | ❌ No | ✅ `litt-runtime/response-stream.ts` |
| Streaming | ✅ SSE in route | ✅ `runLiTTStream` |

**The irony:** `litt-runtime/` has the better orchestration architecture (context resolution, memory, audit, verification, action detection) but lacks the execution muscle (tool calling, build-fix, checkpoints). `agent-loop-v2` has the execution muscle but lacks the orchestration framework.

**The fix:** Make `litt-runtime/execution-engine.ts` canonical. Move the execution capabilities of `agent-loop-v2` into the runtime. Make `agent-loop-v2` a thin adapter or delete it.

---

## Target architecture

```
                    ┌─ Studio text
                    │
                    ├─ Web microphone / voice
                    │
                    ├─ Vapi phone
                    │
                    ├─ Mobile app
                    │
                    └─ Future API/Slack/etc
                             ↓
                    INPUT ADAPTER LAYER
                             ↓
                ┌─────────────────────────┐
                │ LiTT Execution Engine   │
                │ litt-runtime/           │
                │ execution-engine.ts     │
                └─────────────────────────┘
                             ↓
          ┌──────────────────┼──────────────────┐
          ↓                  ↓                  ↓
       Memory             Tools             Models
          ↓                  ↓                  ↓
       Project          GitHub/PTY/etc      OpenAI/etc
          ↓
                   Verification layer
                             ↓
                         Result
                             ↓
                    OUTPUT ADAPTER
                             ↓
          text / web voice / phone / mobile
```

### Voice is not a different agent

```
Text ────┐
Voice ───┼──→ LiTT Execution Engine
Phone ───┘
```

Web voice (Inworld STT + TTS):
```
microphone → Inworld STT → transcript → executionEngine.execute() → response text → Inworld TTS → speaker
```

Phone (Vapi telephony + Inworld TTS):
```
caller speaks → Vapi telephony → STT → transcript → executionEngine.execute() → response text → Inworld TTS → Vapi → caller hears LiTT
```

Text:
```
typed message → executionEngine.execute() → response text
```

**The middle never changes.**

### Voice provider architecture

The key insight: **Inworld is the voice layer, not a brain.** Vapi is the phone infrastructure, not a brain. LiTT runtime is the brain.

```
Vapi:        telephony, calls, turn handling
Inworld:     natural/expressive TTS (same voice on web + phone)
LiTT runtime: reasoning, tools, memory, approvals, project state
Supabase:    memory + runs + conversation persistence
```

Vapi supports bringing your own Inworld API key, so Inworld usage bills directly through the Inworld account. Vapi handles its own platform/hosting charges.

**Don't let Inworld become another separate LiTT brain.** Use it for the voice layer only. The execution engine owns reasoning, tools, memory, approvals, and project state.

Once unified, the same Inworld voice powers both web LiTT voice and phone LiTT voice — same agent, same voice, same state, same conversation. Users hear the same LiTT whether they're on the website or on the phone.

---

## Canonical input/output types

### `LiTTExecutionRequest`

```ts
type LiTTExecutionRequest = {
  userId: string;
  conversationId: string;
  projectId?: string;

  channel:
    | "studio_text"
    | "studio_voice"
    | "phone"
    | "mobile";

  input: {
    type: "text";
    text: string;
  };

  capabilities: {
    canReadRepo: boolean;
    canWriteRepo: boolean;
    canUseTerminal: boolean;
    canDeploy: boolean;
  };

  metadata?: {
    callId?: string;
    sessionId?: string;
    deviceId?: string;
    agentSlug?: string;
    agentInstanceId?: string;
    executionMode?: "plan" | "act" | "auto";
    clientRequestId?: string;
    expectedRevision?: number;
  };
};
```

### `LiTTExecutionResult`

```ts
type LiTTExecutionResult = {
  runId: string;

  status:
    | "completed"
    | "failed"
    | "needs_approval"
    | "paused";

  response: string;

  actions: ExecutedAction[];

  verification: {
    verified: boolean;
    checks: VerificationCheck[];
  };

  artifacts?: {
    filesChanged?: string[];
    previewUrl?: string;
    deploymentUrl?: string;
  };

  checkpointId?: string;
};
```

### `ExecutedAction`

```ts
type ExecutedAction = {
  toolId: string;
  success: boolean;
  summary: string;
  durationMs: number;
};
```

### `VerificationCheck`

```ts
type VerificationCheck = {
  check: string;       // "build", "typecheck", "lint", "test", "preview"
  passed: boolean;
  errorCount?: number;
  output?: string;
};
```

---

## Target code structure

```
src/lib/litt-runtime/
  execution-engine.ts        ← THE BRAIN (upgraded with tool calling, build-fix, checkpoints)

  types.ts                   ← Canonical types (LiTTExecutionRequest, LiTTExecutionResult)

  context/
    build-context.ts         ← Resolve user/project/conversation/capabilities (from request-context.ts)

  tools/
    registry.ts              ← Tool registry (absorb litt-intelligence/tool-registry.ts)
    executor.ts              ← Tool executor (absorb litt-intelligence/tool-handlers-v2.ts)

  permission/
    engine.ts                ← PLAN/ACT/AUTO (absorb litt-intelligence/permission-engine.ts)
    gate.ts                  ← Approval gate (absorb litt-intelligence/permission-gate.ts)

  verification/
    verifier.ts              ← Result verification (upgrade result-verifier.ts)
    build-fix.ts             ← Build-fix loop (absorb litt-intelligence/build-fix-loop.ts)

  state/
    run-store.ts             ← Durable run state (NEW — for durable runs)
    checkpoint-store.ts      ← Checkpoint persistence (absorb workspace-checkpoint.ts)
    paused-run-store.ts      ← Paused run state (absorb litt-intelligence/paused-run-store.ts)

  memory/
    memory-context.ts        ← Memory recall/persist (already in runtime.ts, extract)

  adapters/
    studio-text.ts           ← Studio text adapter (replaces messages route agent loop)
    studio-voice.ts          ← Studio voice adapter (Inworld STT → execute → Inworld TTS)
    vapi-phone.ts            ← Vapi phone adapter (Vapi STT → execute → Inworld TTS → Vapi)
    mobile.ts                ← Mobile adapter (future)

  voice/
    inworld-tts.ts           ← Inworld TTS client (shared by web voice + phone)
    inworld-stt.ts           ← Inworld STT client (web voice only; Vapi does its own STT)

  prompt-builder.ts          ← Already exists
  provider-router.ts         ← Already exists
  response-stream.ts         ← Already exists (add progress events)
  audit-service.ts           ← Already exists (add run tracing)
```

### What gets absorbed/deprecated

| Current file | Fate |
|---|---|
| `litt-intelligence/agent-loop-v2.ts` | **Deprecated → deleted.** Capabilities moved into runtime. |
| `litt-intelligence/agent-loop.ts` | **Deprecated → deleted.** V1 fallback replaced by runtime. |
| `litt-intelligence/tool-registry.ts` | **Absorbed** into `litt-runtime/tools/registry.ts` |
| `litt-intelligence/tool-handlers-v2.ts` | **Absorbed** into `litt-runtime/tools/executor.ts` |
| `litt-intelligence/permission-engine.ts` | **Absorbed** into `litt-runtime/permission/engine.ts` |
| `litt-intelligence/permission-gate.ts` | **Absorbed** into `litt-runtime/permission/gate.ts` |
| `litt-intelligence/build-fix-loop.ts` | **Absorbed** into `litt-runtime/verification/build-fix.ts` |
| `litt-intelligence/workspace-transport.ts` | **Absorbed** into `litt-runtime/tools/workspace-transport.ts` |
| `litt-intelligence/progress-events.ts` | **Absorbed** into `litt-runtime/response-stream.ts` |
| `litt-intelligence/paused-run-store.ts` | **Absorbed** into `litt-runtime/state/paused-run-store.ts` |
| `litt-intelligence/canonical-runtime-context.ts` | **Absorbed** into `litt-runtime/context/build-context.ts` |
| `litt-intelligence/llm-tool-calling.ts` | **Absorbed** into `litt-runtime/execution-engine.ts` |
| `litt-intelligence/types.ts` | **Merged** into `litt-runtime/types.ts` |
| `voice/voice-runtime.ts` | **Replaced** by `litt-runtime/adapters/vapi-phone.ts` |

---

## Migration order (8 steps)

### Step 1 — Freeze both runtimes

No new features in either `litt-intelligence` or `litt-runtime`. Both are frozen.

### Step 2 — Define canonical input/output types

Create the new `LiTTExecutionRequest` and `LiTTExecutionResult` types in `litt-runtime/types.ts`.

Extend the existing `LiTTRunRequest` type — don't break it. Add `channel`, `capabilities`, and `metadata` fields. Map old fields to new structure.

```ts
// Migration helper
function toExecutionRequest(req: LiTTRunRequest, channel: Channel): LiTTExecutionRequest {
  return {
    userId: req.userId,
    conversationId: req.conversationId,
    projectId: req.projectId,
    channel,
    input: { type: "text", text: req.message },
    capabilities: resolveCapabilities(req),
    metadata: {
      agentSlug: req.agentSlug,
      agentInstanceId: req.agentInstanceId,
      clientRequestId: req.clientRequestId,
    },
  };
}
```

### Step 3 — Upgrade execution engine with tool calling

Move the core loop from `agent-loop-v2.ts` into `execution-engine.ts`:

```
executionEngine.execute(request)
  → resolve context (user, project, conversation, capabilities)
  → build prompt (prompt-builder)
  → call LLM with tools (from llm-tool-calling.ts)
  → permission check (from permission-engine.ts)
  → execute tools (from tool-handlers-v2.ts via workspace transport)
  → loop detection (from agent-loop-v2.ts)
  → build-fix (from build-fix-loop.ts)
  → checkpoint (from workspace-checkpoint.ts)
  → verify result (from result-verifier.ts)
  → audit (from audit-service.ts)
  → persist memory
  → return LiTTExecutionResult
```

The execution engine now owns:
- Tool selection and execution
- Permission enforcement
- Build-fix loop
- Checkpoints
- Loop detection
- Approval pause/resume
- Progress event emission

### Step 4 — Route Studio text through execution engine

Change the Studio messages route (`messages/route.ts`):

```
OLD:
  → buildStudioContext()
  → buildCanonicalRuntimeContext()
  → buildRunContextFromStudio()
  → buildPrompt()
  → runAgentLoopV2() OR runAgentLoop()

NEW:
  → executionEngine.execute({
      userId,
      conversationId,
      projectId,
      channel: "studio_text",
      input: { type: "text", text: message },
      capabilities: { ... },
      metadata: { executionMode, agentSlug, clientRequestId, expectedRevision },
    })
```

The route still owns:
- Auth (Clerk)
- Revision RPC
- Message persistence (insert user + assistant messages)
- SSE streaming wrapper

But the **brain** is the execution engine.

**Verify text still works before proceeding.**

### Step 5 — Migrate capabilities/tools into runtime

If `agent-loop-v2` has things the runtime doesn't yet support, **move them into the runtime.**

Specifically:
- Tool registry → `litt-runtime/tools/registry.ts`
- Tool handlers → `litt-runtime/tools/executor.ts`
- Workspace transport → `litt-runtime/tools/workspace-transport.ts`
- LLM tool calling → `litt-runtime/execution-engine.ts`
- Permission engine → `litt-runtime/permission/engine.ts`
- Build-fix loop → `litt-runtime/verification/build-fix.ts`
- Progress events → `litt-runtime/response-stream.ts`
- Paused run store → `litt-runtime/state/paused-run-store.ts`
- Canonical runtime context → `litt-runtime/context/build-context.ts`

**Don't have the runtime call back into the old agent architecture.**

### Step 6 — Route web voice through execution engine

Web voice (Inworld STT) currently sends transcript through the **same text API route**. This is already correct architecturally — Inworld is used for STT, and the transcript goes through the same messages route as text.

After Step 4, voice automatically goes through the execution engine.

The TTS side (Inworld speaking the response) is handled client-side by `VoiceSessionContext`. This stays as-is — Inworld TTS is the voice output layer, not a brain.

**Verify:**
- Voice transcript → execution engine → response
- Same conversation as text
- Same project context
- Same memory
- Inworld TTS speaks the response (client-side, unchanged)

### Step 7 — Clean up Vapi adapter

Vapi currently uses `runLiTT` / `runLiTTStream` from `litt-runtime/runtime.ts`. After the execution engine upgrade, `runLiTT` should call `executionEngine.execute()` internally.

**Voice provider setup: Vapi + Inworld + LiTT runtime**

```
Vapi:        telephony, calls, turn handling, STT
Inworld:     TTS (same voice as web — configured via Vapi's Inworld integration)
LiTT runtime: reasoning, tools, memory, approvals, project state
```

Vapi handles STT and telephony. Inworld handles TTS (configured as the voice provider in Vapi). LiTT runtime handles everything else. Vapi supports bringing your own Inworld API key, so Inworld usage bills directly through the Inworld account.

Make Vapi a thin adapter:

```ts
// litt-runtime/adapters/vapi-phone.ts

export async function handleVapiRequest(req: NextRequest): Promise<Response> {
  const body = await req.json();
  const message = extractLatestUserMessage(body.messages);
  const metadata = body.metadata ?? {};

  // Vapi did STT → we get transcript text
  // LiTT runtime does reasoning + tools + memory
  // Vapi will do TTS (via Inworld configured as voice provider) with our response text
  const result = await executionEngine.execute({
    userId: await resolveUserId(req),
    conversationId: metadata.conversationId,
    projectId: metadata.projectId,
    channel: "phone",
    input: { type: "text", text: message },
    capabilities: { canReadRepo: true, canWriteRepo: true, canUseTerminal: true, canDeploy: false },
    metadata: { callId: metadata.callId, agentSlug: metadata.agentSlug },
  });

  // Return OpenAI-format response — Vapi reads response text and speaks it via Inworld TTS
  return formatOpenAIResponse(result);
}
```

**Key principle:** Vapi's Inworld integration handles TTS on the phone side. The web VoiceSessionContext handles TTS on the browser side. Both use the same Inworld voice. The execution engine doesn't know or care about TTS — it just returns text.

### Step 8 — Delete duplicate behavior

Search for and remove:
- `litt-intelligence/agent-loop-v2.ts` — delete
- `litt-intelligence/agent-loop.ts` — delete
- `litt-intelligence/tool-registry.ts` — delete (absorbed)
- `litt-intelligence/tool-handlers-v2.ts` — delete (absorbed)
- `litt-intelligence/permission-engine.ts` — delete (absorbed)
- `litt-intelligence/build-fix-loop.ts` — delete (absorbed)
- `litt-intelligence/workspace-transport.ts` — delete (absorbed)
- `litt-intelligence/progress-events.ts` — delete (absorbed)
- `litt-intelligence/paused-run-store.ts` — delete (absorbed)
- `litt-intelligence/canonical-runtime-context.ts` — delete (absorbed)
- `litt-intelligence/llm-tool-calling.ts` — delete (absorbed)
- `voice/voice-runtime.ts` — delete (replaced by adapter)

**There should be one authoritative implementation of each:**
- Tool registry → `litt-runtime/tools/registry.ts`
- Model routing → `litt-runtime/provider-router.ts`
- Agent loop → `litt-runtime/execution-engine.ts`
- Approval checks → `litt-runtime/permission/engine.ts`
- Project context builder → `litt-runtime/context/build-context.ts`
- Retry handlers → `litt-runtime/execution-engine.ts`
- Conversation loader → `litt-runtime/context/build-context.ts`
- Authorization logic → `litt-runtime/context/build-context.ts`

---

## Shared conversation identity

```
User
  └── Project
       └── Conversation
            ├── Message
            ├── Message
            ├── Execution Run
            ├── Tool Result
            └── Checkpoint
```

Larry can do:

```
Studio:
"Build me the login screen."

Phone 20 minutes later:
"LiTT, that login screen we were working on — make the button purple."

Studio later:
"Show me what you changed."
```

LiTT knows what "that login screen" means because **the interfaces share the same project/conversation/runtime state.**

### How this works

1. Studio text → `executionEngine.execute({ channel: "studio_text", conversationId: X, projectId: Y })`
2. Phone call → `voice-session-service.ts` resolves phone → user → active project → conversation → `executionEngine.execute({ channel: "phone", conversationId: X, projectId: Y })`
3. Same conversation, same project, same memory, same context.

**The execution engine doesn't care about the channel.** It receives one normalized request and produces one normalized result.

---

## Execution result standardization

The engine returns one `LiTTExecutionResult`. Each adapter renders it differently:

### Studio text
- Renders activity events as activity cards
- Renders verification as receipt card
- Renders artifacts as file changes / preview URL

### Phone
- Says: "I updated the login page and verified the build passes."
- Uses TTS to speak the response text
- Omits activity timeline (voice-only)

### Mobile
- Renders same result with mobile-optimized layout

**Same underlying truth. Different presentation.**

---

## First milestone — prove the foundation

Don't try to prove the entire system immediately. Prove this:

```
Typed:
"Remember my test value is BLUE42."

↓ same conversation/project

Phone:
"What was my test value?"

LiTT:
"BLUE42."

↓ then phone

"Create a file called runtime-test.txt containing BLUE42."

↓ Studio

"What did you just do?"

LiTT:
"I created runtime-test.txt..."

↓ verify actual file exists in workspace
```

### What this proves

- **text → phone → tools → state → text** through one LiTT runtime
- Same conversation across channels
- Same memory across channels
- Tools execute through canonical engine
- State persists across channels

### How to test

1. Sign in on web Studio
2. Send text message: "Remember my test value is BLUE42."
3. Verify memory persists (check `studio_memories` table)
4. Call LiTT phone number
5. Ask: "What was my test value?"
6. Verify LiTT responds "BLUE42"
7. Ask phone: "Create a file called runtime-test.txt containing BLUE42"
8. Verify file created in workspace (check workspace files)
9. Return to Studio
10. Ask: "What did you just do?"
11. Verify LiTT references the file creation
12. Verify `runtime-test.txt` exists in workspace

**If this works, the foundation is proven.**

---

## What NOT to do during migration

- **Don't rewrite the whole thing at once.** Follow the 8 steps in order.
- **Don't add new features.** Migration only.
- **Don't change the Studio UI.** Only the backend call changes.
- **Don't change the Vapi UI.** Only the adapter changes.
- **Don't break existing tests.** All current tests must pass after each step.
- **Don't have the runtime call back into old architecture.** One direction: old → new.

---

## Relationship to existing docs

| Doc | Role |
|---|---|
| `CANONICAL_RUNTIME_MAP.md` | Documents current (broken) state — update after migration |
| `P0_CURRENT_STATE.md` | Tracks verification status — update as runtime is unified |
| `PRODUCTION_HARDENING.md` | Phase 1 is this migration — update with progress |
| `PRODUCT_CONTROL_TOWER.md` | Item #1 is runtime unification — update status |
| `LITT_CORE_ARCHITECTURE.md` | References runtime — update to reflect canonical engine |
