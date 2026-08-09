# LiTT Core Architecture

## The problem this solves

Currently LiTT exists as fragmented per-surface instances:

```
Chat LiTT    Image LiTT    Code LiTT    Canvas LiTT    Voice LiTT
```

Each has its own context, its own conversation, its own memory. The user has to know which tool to navigate to. Context is lost on surface switches.

## The solution: Universal LiTT

```
                       LITT CORE
             ┌────────────────────────┐
             │ identity               │
             │ conversation           │
             │ project                │
             │ memory                 │
             │ tools                  │
             │ permissions            │
             │ model routing          │
             │ truth/verification     │
             └────────────┬───────────┘
                          │
    ┌──────────┬──────────┼─────────┬──────────┐
    ▼          ▼          ▼         ▼          ▼
  Chat       Voice      Canvas     IDE       Mobile
    │
    ├─ image
    ├─ music
    ├─ video
    ├─ document
    ├─ code
    └─ preview
```

**Everywhere is LiTT. The surface changes, not the brain.**

## LITT CORE — canonical state

The core maintains canonical state that every surface reads from and writes to:

### Identity
- User ID (Clerk auth)
- User name, preferences, plan
- Onboarding persona (builder / learner / developer / creator)
- Skill graph (see `LEARNING_SYSTEM.md`)

### Conversation
- Single canonical conversation per project (or multi-conversation, all linked to the same project)
- Messages support universal artifacts (see `UNIVERSAL_ARTIFACTS.md`)
- Conversation persists across surfaces — start in web chat, continue in VS Code

### Project
- Project ID
- Repository (GitHub connection or LiTTree-managed)
- Framework detection
- File tree
- Deployment target
- Workspace type: `PROJECT | TUTORIAL_SANDBOX | PLAYGROUND`

### Memory
- Project-level instructions (LITT.md, AGENTS.md)
- Conversation summary / recent context
- User learning profile (skill graph, struggles, preferred explanation level)
- Checkpoints / rollback history

### Tools
- Tool registry (centralized, not per-surface)
- Tool routing is **invisible** — user talks to LiTT, LiTT routes to the right tool
- Tools include: image.generate, music.generate, video.generate, code.edit, code.read, terminal.execute, preview.refresh, deploy.publish, etc.

### Permissions
- Execution mode: PLAN (read-only) | ACT (approval for mutations) | AUTO (autonomous)
- Write access
- Terminal access
- Deployment access
- Per-tool approval gates

### Model Routing
- Provider health tracking (available / degraded / unavailable / locked)
- BYOK support (see `PROVIDER_BYOK.md`)
- Fallback chains
- Model selection persists in conversation metadata

### Truth / Verification
- Evidence ledger (see `TRUTH_LAYER.md`)
- Every claim has a verification status: VERIFIED | OBSERVED | INFERRED | UNKNOWN
- Build receipts generated after every meaningful run

## Surface Adapters

Each surface is a thin adapter that connects to LITT CORE:

### Web Chat (Studio)
- Primary surface
- Full Studio: Chat, Canvas, Code, Preview, Files, Terminal
- Progressive disclosure based on user persona
- Glass OS design system

### Voice
- Same conversation, voice modality
- Push-to-talk or live session
- Transcripts flow back to canonical conversation
- Tool results are summarized for voice output

### Canvas
- Visual editing surface
- Selects DOM nodes / React components
- Changes route through LITT CORE → code tools
- Voice + text can drive Canvas changes

### IDE (VS Code / Windsurf — LiTT Bridge)
- Extension connects local workspace to LITT CORE
- Selected code flows to canonical conversation
- Commands: Ask, Explain, Fix, Refactor, Add Tests
- See `LITT_BRIDGE_EXTENSION.md`

### Mobile
- Simplified surface
- Chat + preview + voice
- Same project, same conversation

## Tool routing — invisible to the user

The user never has to think "which tool do I need?"

```
User: "Make me a logo"
→ intent detection: image_generation
→ tool: image.generate
→ result: ImagePart in conversation
→ actions: [Edit] [Variation] [Upscale] [Add to Project] [Open in Image Studio]

User: "Fix the mobile navbar"
→ intent detection: code_edit
→ tool: code.edit + preview.refresh
→ result: DiffPart + VerificationPart

User: "Make the logo bigger"
→ context: selected Canvas node
→ intent detection: canvas_edit
→ tool: canvas.update_node
→ result: CanvasPart + PreviewPart
```

## Existing codebase mapping

Current architecture already has pieces of this:

| LITT CORE concept | Current implementation |
|---|---|
| Identity | Clerk auth, `resolveRequestContext` |
| Conversation | `useConversationStore`, `studio_conversations` table |
| Project | `ResolvedStudioContext`, `StudioCapabilities` |
| Memory | `LITT.md`, conversation summaries |
| Tools | `executeBusinessTool`, tool registry |
| Permissions | `pendingApproval`, PLAN/ACT/AUTO |
| Model routing | `useStudioModelStore`, provider health |
| Truth | `useConnectionSummary` (partial — needs expansion) |
| Voice | `VoiceSessionContext`, `LiTTRealtimeSessionController` |
| Canvas | `CanvasPanel`, `CanvasNode` |
| Activity events | Not built — see `LITT_ACTIVITY_STATES.md` |

### What needs to change

1. **Unify the turn loop** — `runLiTTTurn` should be the single entry point for all user input, regardless of surface (text, voice, canvas action). Currently text and voice have separate paths.

2. **Universal artifacts in messages** — `ConversationMessage` needs to support structured parts (ImagePart, DiffPart, VerificationPart, etc.), not just `content: string`.

3. **Tool routing layer** — Add an intent classifier that routes user input to the appropriate tool(s) without requiring the user to select a tool mode.

4. **Evidence ledger** — Add a verification system that collects evidence after every tool execution and attaches it to the message.

5. **Surface adapter protocol** — Define a standard interface that all surfaces implement to connect to LITT CORE.

6. **Activity event emitter** — `runLiTTTurn` must emit structured `LiTTActivityEvent`s at each stage (reading, planning, working, verifying, etc.). Stream via SSE. See `LITT_ACTIVITY_STATES.md`.

## API surface

```
POST /api/litt/turn
  Body: { conversationId, input, inputType, context, executionMode }
  Returns: SSE stream of ActivityEventEnvelope[]
           → final event includes { message, artifacts, verification }

POST /api/litt/voice/turn
  Body: { conversationId, transcript, context }
  Returns: SSE stream of ActivityEventEnvelope[]
           → final event includes { reply, artifacts, verification }

GET  /api/litt/project/:id/state
  Returns: { project, conversation, capabilities, memory }

POST /api/litt/project/:id/checkpoint
  Returns: { checkpointId }

POST /api/litt/project/:id/rollback
  Body: { checkpointId }
  Returns: { restored }

GET  /api/litt/conversation/:id/artifacts
  Returns: { artifacts[] }
```

## Key principle

**The user talks to LiTT, not to the feature architecture.**

Tool selection, surface switching, and capability routing should be invisible. The user's intent flows in, LiTT's response flows out, and the appropriate tools execute in between.
