# LiTT Activity States — Live Execution UX

## The problem

LiTT currently goes from `user sends message → blank/loading → final answer`. That makes him feel dead.

The goal: make LiTT visibly alive and understandable while working, without exposing private chain-of-thought.

## Core principle

**Event-driven only. Never fake progress with timers.**

The canonical LiTT runtime emits real structured activity events. The UI renders them as they arrive.

## Canonical states

```
idle
listening
reading
inspecting
planning
working
generating
running_tool
testing
verifying
waiting_for_approval
preparing_response
speaking
completed
failed
```

These describe **WHAT LiTT is doing**, not hidden reasoning. Never render internal chain-of-thought.

## Event contract

```ts
type LiTTActivityEvent =
  | { type: "run_started"; runId: string }
  | { type: "context_loading"; label: string }
  | { type: "context_loaded"; label: string }
  | { type: "file_read_started"; path: string }
  | { type: "file_read_completed"; path: string }
  | { type: "planning_started" }
  | { type: "tool_started"; tool: string; label: string }
  | { type: "tool_completed"; tool: string; success: boolean }
  | { type: "file_changed"; path: string }
  | { type: "command_started"; command: string }
  | { type: "command_completed"; command: string; success: boolean; exitCode?: number }
  | { type: "generation_started"; kind: "image" | "audio" | "video" | "document"; label: string }
  | { type: "generation_completed"; kind: string; success: boolean }
  | { type: "check_started"; check: string }
  | { type: "check_completed"; check: string; success: boolean; detail?: string }
  | { type: "preview_started" }
  | { type: "preview_ready"; url: string }
  | { type: "approval_required"; label: string }
  | { type: "response_preparing" }
  | { type: "run_completed"; durationMs: number }
  | { type: "run_failed"; message: string };
```

### Event fields

Every event includes:

```ts
interface ActivityEventEnvelope {
  runId: string;
  conversationId: string;
  projectId?: string;
  timestamp: string;        // ISO 8601
  type: LiTTActivityEvent["type"];
  label: string;            // safe user-facing label
  status: "started" | "completed" | "failed";
  metadata?: Record<string, string | number | boolean>;  // safe for UI display
}
```

**Never include:** secrets, API keys, authorization headers, environment values, raw internal prompts, private model reasoning.

## Status vocabulary

Use high-level, factual labels:

| State | Example labels |
|---|---|
| reading | "Loading project context...", "Scanning 4 files..." |
| inspecting | "Inspecting Canvas.tsx", "Checking project structure" |
| planning | "Preparing implementation...", "Planning next steps" |
| working | "Updating Canvas.tsx", "Editing 3 files" |
| running_tool | "Running pnpm typecheck", "Executing build" |
| generating | "Creating artwork", "Generating audio", "Rendering video" |
| testing | "Running tests", "Checking drag/drop" |
| verifying | "Verifying typecheck", "Checking preview" |
| waiting_for_approval | "Waiting for approval to edit files" |
| preparing_response | "Preparing response" |
| completed | "Done · 7 actions · 18s" |
| failed | "Typecheck returned 2 errors" |

**Do NOT show:** "I think the user probably means X because..." or any internal reasoning.

## Chat UX

### Inline activity card

Immediately after the user submits, insert a temporary LiTT activity card in the conversation. Update the **same card** as execution progresses — don't create separate messages per event.

**Normal chat response:**

```
┌─────────────────────────────────────┐
│ 🤖 LiTT · Thinking                  │
│                                     │
│ Reading project context...          │
│ ● ● ●                               │
└─────────────────────────────────────┘
```

Small inline card where the assistant message will appear.

**AUTO run (expanded):**

```
LiTT · Working                                  00:42

✓ Understood request
✓ Inspected repository
✓ Read 6 relevant files
✓ Created implementation plan
→ Editing CanvasTool.tsx
○ Run typecheck
○ Verify preview

[ Show Activity ]                    [ Stop ]
```

### After completion — collapse

```
✓ Completed · 7 actions · 18s
```

Click to expand the full factual activity log.

### Activity log (expanded)

```
ACTIVITY

✓ Project context loaded
✓ Read src/app/studio/Canvas.tsx
✓ Read useCanvasStore.ts
✓ Found drop-state bug
→ Updating Canvas.tsx
○ Run typecheck
○ Test drag/drop
```

After completion:

```
✓ Completed · 7 actions · 18s

✓ Project context loaded
✓ Read src/app/studio/Canvas.tsx
✓ Read useCanvasStore.ts
✓ Found drop-state bug
✓ Updated Canvas.tsx
✓ Typecheck clean
✓ Drag/drop verified
```

## Example flows

### Coding task (ACT mode)

```
LiTT · Reading
Loading project context...
```

↓

```
LiTT · Inspecting

✓ Canvas.tsx
✓ useCanvasStore.ts
→ DropZone.tsx
```

↓

```
LiTT · Planning

Preparing implementation...
```

↓

```
LiTT · Working

→ Updating DropZone.tsx
```

↓

```
LiTT · Checking

→ pnpm typecheck
```

↓

```
LiTT · Verifying

✓ Typecheck
✓ Drag/drop state
✓ Preview
```

↓ (final answer appears, activity collapses)

```
✓ Completed · 7 actions · 18s
```

### AUTO run with error recovery

```
LiTT · Working

✓ Diagnosed issue
✓ Updated 2 files
✗ Typecheck failed (2 errors)
→ Fixing 2 errors
✓ Typecheck clean
→ Testing preview
```

### Image generation in chat

```
LiTT · Creating image

✓ Understanding request
✓ Applying project branding
→ Generating artwork
○ Saving asset
```

↓ (image renders in conversation)

```
✓ Completed · 4 actions · 12s

[ IMAGE ]
[ Edit ] [ Variation ] [ Add to Project ]
```

### Music generation

```
LiTT · Creating track

✓ Style parsed
→ Generating audio
○ Saving result
```

### Voice

Same canonical states, same event infrastructure:

```
🎙 LiTT · Listening
```

↓

```
🧠 LiTT · Processing
```

↓

```
🔧 LiTT · Checking your project
```

↓

```
🔊 LiTT · Speaking
```

Text and voice use the **same LiTT run/event infrastructure**. Voice transport (Vapi, Inworld, etc.) must not maintain a separate activity-state model.

## PLAN / ACT / AUTO patterns

### PLAN (read-only, no mutations)

```
✓ Loaded project context
✓ Inspected 6 files
→ Preparing plan
```

No mutation events are allowed. No `file_changed`, no `command_started`.

### ACT (approval for mutations)

```
✓ Read files
→ Editing Canvas.tsx
○ Run typecheck
```

Pauses at `approval_required` before mutations.

### AUTO (autonomous)

```
✓ Diagnosed issue
✓ Updated 2 files
✗ Typecheck failed
→ Fixing 2 errors
✓ Typecheck clean
→ Testing preview
```

Continues autonomously, including error recovery.

## LiTT mascot states

Connect LiTT mascot animation to canonical activity state:

| State | Animation |
|---|---|
| idle | Slow vertical hover |
| reading | Subtle scanning animation |
| planning | Slow halo pulse |
| working | Slightly faster halo movement |
| generating | Creative purple/green particle state |
| testing | Small repeated status pulse |
| waiting_for_approval | Yellow/amber restrained pulse |
| completed | Small success bounce + green glow |
| failed | Soft red status accent, no aggressive animation |
| listening | Voice-responsive halo (where supported) |
| speaking | Subtle audio-reactive ring |

**Respect `prefers-reduced-motion`.** When reduced motion is preferred, replace animations with static state indicators.

## Error handling

If an action fails:

```
LiTT · Hit a problem

Typecheck returned 2 errors.
Attempting a fix...
```

- If recovery succeeds → continue run, show recovery in activity log
- If truly blocked → show useful blocking reason + available actions

```
LiTT · Blocked

Cannot connect to GitHub.
Repository access expired.

[ Reconnect GitHub ]  [ Continue without Git ]  [ Cancel ]
```

## Streaming

Stream activity events to Studio using existing real-time/streaming infrastructure (SSE or WebSocket).

- UI must update without waiting for the entire request to finish
- Long-running AUTO jobs must continue streaming beyond 30 seconds
- If browser reconnects, restore the latest run state via `GET /api/litt/run/:runId/state`

### Reconnection

```ts
GET /api/litt/run/:runId/state
Returns: {
  runId: string;
  status: "running" | "completed" | "failed";
  events: ActivityEventEnvelope[];
  currentActivity: { state: string; label: string };
  durationMs: number;
}
```

## Database

Activity events are stored for receipt generation and audit:

```sql
CREATE TABLE studio_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  conversation_id UUID NOT NULL,
  project_id TEXT,
  event_type TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_run ON studio_activity_events(run_id);
CREATE INDEX idx_activity_conversation ON studio_activity_events(conversation_id);
```

## API surface

```
POST /api/litt/turn
  Body: { conversationId, input, inputType, context, executionMode }
  Returns: SSE stream of ActivityEventEnvelope[]
           → final event includes { message, artifacts, verification }

GET  /api/litt/run/:runId/state
  Returns: { runId, status, events, currentActivity, durationMs }

POST /api/litt/run/:runId/stop
  Returns: { stopped: boolean }

POST /api/litt/run/:runId/approve
  Body: { approved: boolean }
  Returns: { resumed: boolean }
```

## Existing codebase mapping

| Concept | Current |
|---|---|
| Message streaming | Messages route streams text chunks |
| Tool activity | `ConversationMessage.toolActivity: JSONB` |
| Work log | "Work log · 1 of 1 steps complete" (too generic) |
| Voice states | `VoiceState` in `VoiceSessionContext` |
| Live session states | `LiveSessionState` in `LiTTLiveSessionContext` |
| Agent reasoning | `ConversationMessage.reasoning` (private, not for UI) |
| Busy state | `useConversationStore.busy` |

### What needs to change

1. **Activity event emitter** — Add to `runLiTTTurn` / messages route. Emit events at each stage.
2. **SSE streaming** — Stream activity events alongside text chunks. Currently only text is streamed.
3. **Activity card component** — New React component that renders the live activity timeline. Updates in place.
4. **Activity collapse/expand** — After completion, collapse to summary. Click to expand.
5. **Mascot state binding** — Connect LiTT mascot animation to current activity state.
6. **Run state persistence** — Store events in `studio_activity_events` table for reconnection.
7. **Reconnection API** — `GET /api/litt/run/:runId/state` for browser reconnect.
8. **Stop/approve API** — `POST /api/litt/run/:runId/stop` and `/approve`.
9. **Voice state unification** — Map `VoiceState` to canonical activity states. Same event stream.
10. **Replace work log** — Current "Work log · N steps" → live execution timeline.
11. **Prefers-reduced-motion** — Static fallbacks for mascot animations.

## Acceptance tests

1. Send simple chat message. LiTT activity appears immediately.
2. State changes before final answer.
3. Send coding task. Actual file/tool/check activity streams live.
4. No private chain-of-thought is displayed.
5. Run lasts over 30 seconds. UI continues updating.
6. Refresh during AUTO run. Run state reconnects.
7. Generate image from normal Chat. Image-generation activity is displayed.
8. Image renders in conversation.
9. Start voice. Listening/processing/tool/speaking states update.
10. PLAN/ACT/AUTO produce correct activity patterns.
11. Completed activity collapses into a concise receipt.
12. Expand receipt to see full factual activity log.
13. Error during run shows error state + recovery attempt.
14. Stop button cancels an AUTO run.
15. Approval gate pauses ACT run until approved.
16. `prefers-reduced-motion` disables mascot animations.

**Do not call complete until activity is driven by real runtime events, not decorative loading text.**
