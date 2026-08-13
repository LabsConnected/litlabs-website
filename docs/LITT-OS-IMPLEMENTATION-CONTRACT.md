# LiTT OS — Locked Implementation Contract

**Version:** 1.0.0  
**Status:** LOCKED — do not reinterpret, redesign, or deviate without explicit approval.  
**Date:** 2026-08-13  

This document is the single source of truth for the next build pass.  
A coding agent working from this contract must implement exactly what is described here — no more, no less.  
If something is ambiguous, ask before building. Do not invent architecture.

---

## 0. Current State — What Already Exists

The canonical repo (`main` at `7027773d`) already has substantial foundation:

| Component | File | Status |
|-----------|------|--------|
| Studio shell | `src/app/studio/components/CommandStudio.tsx` | 2013 lines, functional |
| Studio context | `src/app/studio/context/StudioContext.tsx` | Controlled props, working |
| Workspace stages | `src/app/studio/lib/studio-destinations.ts` | `plan/canvas/code/preview` |
| Creator kinds | `src/app/studio/lib/studio-destinations.ts` | `image/video/music/audio/design/game/environment` |
| LiTT Runtime | `src/lib/litt-runtime/runtime.ts` | `runLiTT()` + `runLiTTStream()` |
| Voice runtime | `src/lib/voice/voice-runtime.ts` | `runLiTTForVoice()` — same pipeline |
| Project tools | `src/lib/project-tools/registry.ts` | 23 tool handlers |
| Intelligence tools | `src/lib/litt-intelligence/tool-registry.ts` | Agent loop tool registry |
| Agent loop v2 | `src/lib/litt-intelligence/agent-loop-v2.ts` | Multi-round tool calling |
| Execution store | `src/app/studio/stores/useExecutionStore.ts` | Phases, events, approvals |
| Resize hook | `src/app/studio/hooks/useResizableWidth.ts` | Pixel-precise, persisted |
| Browser jobs | `src/lib/browser-job-executor.ts` | Job-based browser automation |
| Terminal drawer | `src/app/studio/components/StudioTerminalDrawer.tsx` | Bottom drawer terminal |
| Inspector tabs | `StudioWorkspaceFrame.tsx` | `plan/changes/files/preview/checks/approvals/browser` |
| Drawer tabs | `studio-destinations.ts` | `activity/terminal/media` |

### What does NOT exist yet (the gaps this contract fills)

1. **Chat pane max width is 480px** — needs 55vw.
2. **No "Follow LiTT" toggle** — LiTT can't change the visible station.
3. **No Station Control API** — LiTT can't operate Image/Video/Music/Canvas/Design directly.
4. **No Browser Station** — browser jobs exist but aren't a workspace stage with live view.
5. **No Live View** — no unified "watch what LiTT is doing" surface.
6. **No permission capabilities** — `Writes allowed` is a single switch, not granular.
7. **No ProjectSession object** — context doesn't travel with LiTT across stations.
8. **PLAN/ACT/AUTO modes** — not implemented as execution constraints.
9. **No Canvas→Code→Preview asset flow** — stations are isolated silos.
10. **Execution phases incomplete** — missing `researching`, `creating`, `browsing`, `deploying`.

---

## 1. Architecture — Locked

```
                         ┌─────────────────────┐
                         │        LiTT         │
                         │  PRIMARY OPERATOR   │
                         └──────────┬──────────┘
                                    │
                           LiTT CONTROL KERNEL
                                    │
        ┌─────────────┬─────────────┼─────────────┬──────────────┐
        │             │             │             │              │
      PLAN          BUILD         CREATE        BROWSE         SHIP
        │             │             │             │              │
     Tasks          Canvas         Image        Browser          Git
     Memory         Code           Video        Search           Tests
     Context        Files          Music        Research         Deploy
     Approvals      Terminal       Audio        Chrome           Verify
                    Preview        Design
                                   Game
                                   360°
```

**One LiTT. One task. One project context. Many stations.**

LiTT does NOT become a separate agent when entering Code, Image, Browser, etc.  
LiTT IS the operator. Stations are surfaces LiTT controls.

---

## 2. Layout — Locked (No Redesign)

The current layout hierarchy is correct. Do NOT redesign it:

```
┌──────────────────────────────────────────────────────────────────┐
│ Top command bar: project / branch / permissions / deployment      │
├────┬─────────────────────┬──────────────────────┬────────────────┤
│ Far│ LiTT Chat Pane      │ Workspace            │ Context Drawer │
│ left│ (resizable)        │ (Plan/Canvas/Code/   │ (resizable)    │
│ nav│                     │  Preview/Files/      │                │
│    │                     │  Browser)            │                │
│    │                     │                      │                │
│    │                     │ Creator subnav:      │                │
│    │                     │ Image/Video/Music/   │                │
│    │                     │ Audio/Design/Game/360│                │
│    │                     │                      │                │
├────┴─────────────────────┴──────────────────────┴────────────────┤
│ Bottom drawer: Activity | Terminal | Media                        │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 Chat Pane Resize — Fix This

**Current:** `minWidth: 280, maxWidth: 480, defaultWidth: 320`  
**Required:**

```typescript
const littResize = useResizableWidth({
  storageKey: "littree:studio:litt-width",
  defaultWidth: 420,
  minWidth: 320,
  maxWidth: Math.floor(window.innerWidth * 0.55), // 55vw
  direction: "left",
});
```

| Setting | Value |
|---------|-------|
| Minimum Chat width | 320px |
| Normal/default | 420px |
| Maximum | 55vw (dynamic) |
| Double-click divider | Reset to 420px |
| Collapse | Chat → 64px icon rail |
| Persistence | Save width per user (localStorage) |
| Mobile | Full-screen Chat/Workspace switching |

**Critical:** When Chat gets wide, the workspace must intelligently reflow — not break. The workspace area uses `flex: 1 1 0` and shrinks. Creator subnav wraps if needed.

### 2.2 Follow LiTT Toggle

Add a toggle in the top command bar or chat header:

```typescript
type FollowMode = "on" | "off";
// Persisted: "littree:studio:follow-litt"
```

- **ON:** LiTT changes the visible station as it works. The workspace follows LiTT's active station.
- **OFF:** LiTT works elsewhere without ripping the user's screen away. Show a notification:

```
LiTT is working in Code
Editing src/app/page.tsx
[Show me]
```

Clicking `[Show me]` jumps to LiTT's current station.

Implementation: `useStudioContext().setWorkspaceMode()` is called by LiTT only when `followMode === "on"`. When off, LiTT still executes — the user just isn't auto-navigated.

### 2.3 Collapse Chat to Icon Rail

When collapsed (64px), show:
- LiTT avatar/status indicator
- Current phase icon (planning/editing/testing/etc.)
- Click to expand back to last width

---

## 3. Station Control API — The Core Abstraction

This is what makes "LiTT can control everything" real.  
Every station exposes a **typed action interface**. Both the UI and LiTT call the same actions.

### 3.1 Station Action Registry

```typescript
// src/lib/station-control/types.ts

export type StationId =
  | "plan"
  | "canvas"
  | "code"
  | "files"
  | "preview"
  | "browser"
  | "terminal"
  | "image"
  | "video"
  | "music"
  | "audio"
  | "design"
  | "game"
  | "environment"
  | "git"
  | "deploy"
  | "checks"
  | "assets"
  | "memory"
  | "voice"
  | "camera";

export interface StationAction<Args extends z.ZodType, Result> {
  /** Unique action id, e.g. "image.setPrompt" */
  id: string;
  /** Which station this belongs to */
  station: StationId;
  /** Human-readable description for LiTT */
  description: string;
  /** Zod schema for arguments */
  argsSchema: Args;
  /** Result type */
  resultType: z.ZodType<Result>;
  /** Whether this action mutates state (subject to permissions) */
  mutating: boolean;
  /** Whether this action requires approval (subject to permissions) */
  requiresApproval?: boolean;
  /** Execute the action */
  execute: (args: z.infer<Args>, ctx: StationExecutionContext) => Promise<Result>;
}

export interface StationExecutionContext {
  projectId: string | null;
  conversationId: string | null;
  userId: string;
  permissions: PermissionSet;
  /** Emit an execution event for the activity feed */
  emitEvent: (event: Omit<ExecutionEvent, "id" | "seq" | "ts">) => void;
  /** Switch the visible station (respects Follow LiTT mode) */
  navigateToStation: (station: StationId) => void;
  /** Report current station state for Live View */
  reportLiveState: (state: LiveStateSnapshot) => void;
}
```

### 3.2 Station Action Catalog

Each station registers its actions. The registry is the single source of truth.

```typescript
// src/lib/station-control/registry.ts

export const STATION_ACTIONS: Record<string, StationAction<any, any>> = {};

export function registerStationAction(action: StationAction<any, any>): void {
  STATION_ACTIONS[action.id] = action;
}

export function getStationAction(id: string): StationAction<any, any> | null {
  return STATION_ACTIONS[id] ?? null;
}

export function getActionsForStation(station: StationId): StationAction<any, any>[] {
  return Object.values(STATION_ACTIONS).filter((a) => a.station === station);
}
```

### 3.3 Per-Station Actions (Locked List)

| Station | Action ID | Args | Mutating | Description |
|---------|-----------|------|----------|-------------|
| **plan** | `plan.createTask` | `{ title, description?, priority? }` | yes | Create a task |
| **plan** | `plan.updateTask` | `{ taskId, status?, title?, description? }` | yes | Update a task |
| **plan** | `plan.listTasks` | `{ status? }` | no | List tasks |
| **plan** | `plan.setDependencies` | `{ taskId, dependsOn: string[] }` | yes | Set task deps |
| **canvas** | `canvas.addNode` | `{ type, props?, position? }` | yes | Add a node |
| **canvas** | `canvas.removeNode` | `{ nodeId }` | yes | Remove a node |
| **canvas** | `canvas.moveNode` | `{ nodeId, position }` | yes | Move a node |
| **canvas** | `canvas.editNode` | `{ nodeId, props }` | yes | Edit node props |
| **canvas** | `canvas.selectNode` | `{ nodeId }` | no | Select a node |
| **canvas** | `canvas.exportNode` | `{ nodeId, format }` | no | Export a node |
| **code** | `code.search` | `{ query, glob? }` | no | Search code |
| **code** | `code.readFile` | `{ path }` | no | Read a file |
| **code** | `code.writeFile` | `{ path, content }` | yes | Write a file |
| **code** | `code.refactor` | `{ path, instruction }` | yes | Refactor a file |
| **files** | `files.create` | `{ path, type: "file"\|"dir" }` | yes | Create file/dir |
| **files** | `files.move` | `{ from, to }` | yes | Move/rename |
| **files** | `files.delete` | `{ path }` | yes | Delete (approval) |
| **files** | `files.read` | `{ path }` | no | Read a file |
| **preview** | `preview.launch` | `{}` | yes | Launch preview |
| **preview** | `preview.reload` | `{}` | yes | Reload preview |
| **preview** | `preview.inspect` | `{ selector? }` | no | Inspect DOM |
| **preview** | `preview.screenshot` | `{ fullPage? }` | no | Screenshot |
| **terminal** | `terminal.execute` | `{ command, cwd? }` | yes | Execute command |
| **terminal** | `terminal.cancel` | `{ processId }` | yes | Cancel process |
| **terminal** | `terminal.read` | `{ processId }` | no | Read output |
| **browser** | `browser.navigate` | `{ url }` | yes | Navigate to URL |
| **browser** | `browser.search` | `{ query }` | yes | Search the web |
| **browser** | `browser.click` | `{ selector }` | yes | Click element |
| **browser** | `browser.type` | `{ selector, text }` | yes | Type text |
| **browser** | `browser.scroll` | `{ direction, amount? }` | yes | Scroll |
| **browser** | `browser.screenshot` | `{ fullPage? }` | no | Screenshot |
| **browser** | `browser.readDom` | `{ selector? }` | no | Read DOM |
| **browser** | `browser.readAccessibility` | `{}` | no | Read a11y tree |
| **browser** | `browser.goBack` | `{}` | yes | Go back |
| **image** | `image.setPrompt` | `{ prompt }` | yes | Set prompt |
| **image** | `image.setNegativePrompt` | `{ prompt }` | yes | Set negative prompt |
| **image** | `image.setStyle` | `{ style }` | yes | Set style |
| **image** | `image.setAspectRatio` | `{ ratio }` | yes | Set aspect ratio |
| **image** | `image.attachReference` | `{ assetId }` | yes | Attach reference |
| **image** | `image.generate` | `{}` | yes | Generate image |
| **image** | `image.selectResult` | `{ resultId }` | yes | Select a result |
| **image** | `image.upscale` | `{ resultId }` | yes | Upscale |
| **image** | `image.saveAsset` | `{ resultId, name? }` | yes | Save to assets |
| **image** | `image.sendToCanvas` | `{ resultId }` | yes | Send to Canvas |
| **video** | `video.setPrompt` | `{ prompt }` | yes | Set prompt |
| **video** | `video.setModel` | `{ model }` | yes | Set model |
| **video** | `video.setDuration` | `{ seconds }` | yes | Set duration |
| **video** | `video.imageToVideo` | `{ assetId }` | yes | Image to video |
| **video** | `video.generate` | `{}` | yes | Generate video |
| **music** | `music.setStyle` | `{ style }` | yes | Set style |
| **music** | `music.setLyrics` | `{ lyrics }` | yes | Set lyrics |
| **music** | `music.setBpm` | `{ bpm }` | yes | Set BPM |
| **music** | `music.generate` | `{}` | yes | Generate music |
| **music** | `music.remix` | `{ assetId }` | yes | Remix |
| **audio** | `audio.tts` | `{ text, voice? }` | yes | Text to speech |
| **audio** | `audio.sfx` | `{ description }` | yes | Generate SFX |
| **git** | `git.status` | `{}` | no | Git status |
| **git** | `git.diff` | `{ path? }` | no | Git diff |
| **git** | `git.branch` | `{ name }` | yes | Create branch |
| **git** | `git.commit` | `{ message }` | yes | Commit |
| **git** | `git.push` | `{ remote?, branch? }` | yes | Push |
| **git** | `git.createPR` | `{ title, body? }` | yes | Create PR |
| **deploy** | `deploy.preview` | `{}` | yes (approval) | Deploy to preview |
| **deploy** | `deploy.production` | `{}` | yes (approval) | Deploy to production |
| **deploy** | `deploy.status` | `{}` | no | Deployment status |
| **checks** | `checks.typecheck` | `{}` | no | Run typecheck |
| **checks** | `checks.lint` | `{}` | no | Run lint |
| **checks** | `checks.test` | `{ pattern? }` | no | Run tests |
| **checks** | `checks.build` | `{}` | no | Run build |
| **assets** | `assets.search` | `{ query? }` | no | Search assets |
| **assets** | `assets.save` | `{ blob, name, tags? }` | yes | Save asset |
| **assets** | `assets.delete` | `{ assetId }` | yes (approval) | Delete asset |
| **assets** | `assets.useInProject` | `{ assetId, targetPath }` | yes | Use in project |
| **memory** | `memory.read` | `{ namespace? }` | no | Read memory |
| **memory** | `memory.write` | `{ key, value, namespace? }` | yes | Write memory |
| **memory** | `memory.search` | `{ query }` | no | Search memory |

**Note:** `game`, `environment`, `design`, `voice`, `camera` actions follow the same pattern. They are lower priority for Phase 1 but the registry must support them.

### 3.4 How LiTT Calls Station Actions

LiTT does NOT fake mouse clicks. LiTT calls the same typed actions the UI uses.

```typescript
// In the LiTT runtime / agent loop:
const action = getStationAction("image.setPrompt");
if (!action) throw new Error(`Unknown action: image.setPrompt`);

// Check permissions
if (action.mutating && !ctx.permissions.canMutate(action.station)) {
  return { error: "Permission denied: cannot mutate ${action.station}" };
}

if (action.requiresApproval && !ctx.permissions.hasApproval(action.station)) {
  ctx.emitEvent({ type: "approval_required", summary: `Approval needed: ${action.id}` });
  // Pause and wait for approval
  return { error: "Approval required", pending: true };
}

// Validate args
const parsed = action.argsSchema.safeParse(rawArgs);
if (!parsed.success) {
  return { error: "Invalid args", details: parsed.error.format() };
}

// Execute
const result = await action.execute(parsed.data, ctx);
return { result };
```

### 3.5 How the UI Calls Station Actions

The UI calls the exact same registry:

```typescript
// In a React component:
const setPrompt = useCallback((prompt: string) => {
  const action = getStationAction("image.setPrompt");
  action?.execute({ prompt }, stationCtx);
}, [stationCtx]);
```

Or via a hook:

```typescript
const { setPrompt } = useStationAction("image.setPrompt");
```

---

## 4. Browser Station — New Workspace Stage

Add `browser` as a new `WorkspaceStage`:

```typescript
// Update studio-destinations.ts
export type WorkspaceStage = "plan" | "canvas" | "code" | "preview" | "files" | "browser";
```

### 4.1 Browser Station UI

```
┌─────────────────────────────────────────────────────┐
│ ← → ↻ │ https://example.com                  ⋮      │
├─────────────────────────────────────────────────────┤
│                                                     │
│                 LIVE WEBSITE                        │
│                                                     │
│                LiTT has control                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

- Uses Playwright/CDP underneath (extend existing `browser-job-executor.ts`)
- Streams live browser view into Studio
- LiTT capabilities: navigate, search, click, type, scroll, select, hover, read DOM, inspect a11y tree, screenshot, download, upload, open/close tabs, go back
- NOT screen-coordinate automation — use CDP selectors

### 4.2 Two Browser Modes

**A. LiTT-controlled browser inside Studio (Phase 1):**
```
LiTT → Browser Tool → Playwright/CDP → Chromium → Live stream → Studio
```

**B. Desktop Chrome takeover (Phase 2 — not in this contract):**
```
LiTT Studio → LiTT Companion / Desktop Bridge → Chrome extension → User's Chrome
```

Phase 1 implements only mode A.

---

## 5. Live View — Unified Observation Surface

### 5.1 Live View Modes

| Mode | Shows |
|------|-------|
| Camera | What LiTT sees through camera |
| Browser | LiTT surfing/testing |
| Preview | Your app being tested |
| Terminal | Active command execution |
| Creation | Image/video generation |
| Voice | Voice session visualization |

### 5.2 Implementation

Live View is a panel that can replace or overlay the workspace area. It shows whatever LiTT is actively interacting with.

```typescript
// src/app/studio/stores/useLiveViewStore.ts

export type LiveViewMode = "camera" | "browser" | "preview" | "terminal" | "creation" | "voice" | null;

interface LiveViewStore {
  mode: LiveViewMode;
  station: StationId | null;
  summary: string;       // "LiTT is editing src/app/page.tsx"
  setMode: (mode: LiveViewMode) => void;
  setStation: (station: StationId) => void;
  setSummary: (summary: string) => void;
}
```

When `followMode === "on"`, Live View auto-switches to LiTT's active station.  
When `followMode === "off"`, Live View shows a summary notification with `[Show me]`.

---

## 6. PLAN / ACT / AUTO Modes

### 6.1 Type Definition

```typescript
export type MissionMode = "plan" | "act" | "auto";
// Persisted: "littree:studio:mission-mode"
```

### 6.2 Permission Matrix

| Capability | PLAN | ACT | AUTO |
|-------------|------|-----|------|
| Read files | ✅ | ✅ | ✅ |
| Search web | ✅ | ✅ | ✅ |
| Inspect app | ✅ | ✅ | ✅ |
| Plan | ✅ | ✅ | ✅ |
| Write files | ❌ | ✅ | ✅ |
| Terminal mutation | ❌ | ✅ | ✅ |
| Generate assets | ❌ | ✅ | ✅ |
| Browser | ❌ | ✅ | ✅ |
| Tests | ❌ | ✅ | ✅ |
| Production deploy | ❌ | ASK | ASK |
| Payment | ❌ | ASK | ASK |
| Delete critical data | ❌ | ASK | ASK |
| External post | ❌ | ASK | ASK |
| Secrets | ❌ | ❌ | ❌ |

### 6.3 Enforcement

The Station Action executor checks `missionMode` before executing:

```typescript
function canExecute(action: StationAction<any, any>, mode: MissionMode, permissions: PermissionSet): boolean {
  if (!action.mutating) return true;  // Read actions always allowed
  if (mode === "plan") return false;  // PLAN: no mutations
  if (action.requiresApproval && !permissions.hasApproval(action.station)) return false;
  if (action.station === "deploy" && action.id === "deploy.production") {
    return mode !== "plan"; // Always asks unless AUTO with pre-approval
  }
  return true;
}
```

---

## 7. Permission Capabilities

```typescript
// src/lib/station-control/permissions.ts

export type PermissionLevel = "allow" | "ask" | "deny";

export interface PermissionSet {
  files: PermissionLevel;
  terminal: PermissionLevel;
  browser: PermissionLevel;
  git: PermissionLevel;
  create: PermissionLevel;     // image/video/music/audio/design
  preview: PermissionLevel;
  deploy: PermissionLevel;
  production: PermissionLevel;
  payments: PermissionLevel;
  externalPost: PermissionLevel;
  secrets: PermissionLevel;    // Always "deny" — cannot be overridden
}

export const DEFAULT_PERMISSIONS: PermissionSet = {
  files: "allow",
  terminal: "allow",
  browser: "allow",
  git: "allow",
  create: "allow",
  preview: "allow",
  deploy: "ask",
  production: "ask",
  payments: "ask",
  externalPost: "ask",
  secrets: "deny",
};

export function canMutate(permissions: PermissionSet, station: StationId): boolean {
  const level = permissions[stationToPermissionKey(station)];
  return level === "allow";
}
```

UI: Expand the existing `Writes allowed` toggle into a permissions panel accessible from the top command bar.

---

## 8. ProjectSession — Context That Survives Every Jump

```typescript
// src/lib/station-control/project-session.ts

export interface ProjectSession {
  // Identity
  userId: string;
  projectId: string | null;
  conversationId: string | null;

  // Repository
  repository: string | null;
  branch: string | null;

  // Workspace
  workspace: {
    station: StationId;
    activeFile: string | null;
    activeAssetId: string | null;
    selectedCanvasNode: string | null;
  };

  // Mission
  mission: {
    mode: MissionMode;
    currentGoal: string | null;
    plan: Task[];
    currentTaskId: string | null;
  };

  // Creator state
  creator: {
    activeCreator: CreatorKind | null;
    prompt: string | null;
    negativePrompt: string | null;
    style: string | null;
    aspectRatio: string | null;
    referenceAssetId: string | null;
    lastResults: { id: string; url: string }[];
  };

  // Sessions
  browserSession: { url: string; tabs: { id: string; url: string }[] } | null;
  terminalSessions: { id: string; command: string; status: "running" | "done" }[];
  preview: { url: string; status: "launching" | "ready" | "error" } | null;

  // Memory
  memory: { key: string; value: string; namespace: string }[];

  // Permissions
  permissions: PermissionSet;

  // Approvals
  pendingApprovals: PendingApproval[];

  // Generated assets (this conversation)
  generatedAssets: { id: string; type: string; url: string; prompt: string }[];
}
```

This object is the single context that follows LiTT everywhere. It is stored in a Zustand store and accessible from any station.

```typescript
// src/app/studio/stores/useProjectSessionStore.ts
export const useProjectSessionStore = create<ProjectSessionStore>((set, get) => ({
  ...initialSession,
  updateWorkspace: (partial) => set((s) => ({ workspace: { ...s.workspace, ...partial } })),
  updateCreator: (partial) => set((s) => ({ creator: { ...s.creator, ...partial } })),
  // ... etc
}));
```

---

## 9. Execution Phases — Complete Set

Update `useExecutionStore.ts`:

```typescript
export type ExecutionPhase =
  | "idle"
  | "thinking"
  | "planning"
  | "researching"    // NEW
  | "creating"       // NEW
  | "editing"
  | "browsing"       // NEW
  | "running"        // NEW (terminal commands)
  | "testing"
  | "verifying"
  | "deploying"      // NEW
  | "awaiting_approval"
  | "complete"       // Renamed from "done"
  | "failed"         // NEW
  | "cancelled";
```

### Activity Log Format

```
19:02:11  Browser    Opened Stripe documentation
19:02:18  Code       Editing checkout/route.ts
19:02:31  Terminal   pnpm type-check
19:02:38  Check      TypeScript PASS
19:02:44  Preview    Restarted application
19:02:51  Browser    Testing checkout
```

Each entry: `{ timestamp, station, summary, phase }`.

---

## 10. Canvas as Visual Bridge

Canvas is the interchange between stations:

```
Browser research → Asset → Canvas → { Image | Code | Video } → Preview → Deploy
```

Any generated asset can be:
- **Open in Canvas** — drop onto canvas as a node
- **Send to Code** — insert as a component/asset reference
- **Use in Project** — save to project assets directory
- **Create variation** — send back to creator with modified prompt
- **Save Asset** — persist to asset library
- **Ask LiTT** — send to LiTT with context

Implementation: Add a context menu / action bar on every asset and canvas node with these options. Each option calls a station action.

---

## 11. Terminal — Background Execution

Terminal stays in the bottom drawer. LiTT runs commands in the background.

When LiTT runs a command:
1. Activity drawer surfaces it: `● pnpm type-check`
2. Clicking it expands Terminal
3. Terminal shows live output
4. When done, Activity shows result: `✓ pnpm type-check PASS` or `✗ pnpm type-check FAIL`

LiTT does NOT need to "open Terminal" to run a command. It calls `terminal.execute` and the result appears in Activity.

---

## 12. Voice — Same Kernel

Voice already routes through `runLiTTForVoice()` which calls the same pipeline. Verify and enforce:

```text
Studio Chat ──┐
Live Voice ───┤
Phone/Vapi ───┼── LiTT Kernel ── Station Actions
Mobile ───────┤
CLI ──────────┘
```

All interfaces call the same Station Action registry. Voice just has a different transport (Vapi → `/api/vapi/turn` → `runLiTTForVoice()` → same kernel).

**Critical:** Voice must be able to trigger the same station actions as chat. If a user says "fix that image creator issue" via phone, LiTT uses `code.search`, `code.readFile`, `code.writeFile`, `checks.typecheck` — the exact same actions as Studio chat.

---

## 13. Implementation Phases

### Phase 1: Foundation (Must complete first)

**1.1 Chat pane resize fix**
- Update `useResizableWidth` config: min 320, default 420, max 55vw
- Verify workspace reflows correctly when chat is wide
- Add collapse-to-icon-rail (64px)
- Double-click reset to 420px

**1.2 Station Action Registry**
- Create `src/lib/station-control/types.ts`
- Create `src/lib/station-control/registry.ts`
- Create `src/lib/station-control/permissions.ts`
- Create `src/lib/station-control/project-session.ts`
- Wire existing project-tools handlers as station actions
- Wire existing browser-job-executor as browser station actions

**1.3 ProjectSession store**
- Create `src/app/studio/stores/useProjectSessionStore.ts`
- Migrate `StudioContext` to use it
- Ensure context survives station switches

**1.4 Permission system**
- Create `PermissionSet` type and defaults
- Add permissions panel to top command bar
- Wire permission checks into station action executor

**1.5 PLAN/ACT/AUTO modes**
- Add mode toggle to UI
- Wire mode checks into station action executor
- Verify PLAN mode blocks all mutations

**Acceptance tests for Phase 1:**
- [ ] Chat pane can be dragged to 55vw without breaking workspace
- [ ] Chat pane collapses to 64px icon rail and expands back
- [ ] Chat pane width persists across page reloads
- [ ] Station action registry returns correct actions per station
- [ ] Permission checks block mutations in PLAN mode
- [ ] ProjectSession survives switching from Code to Image to Browser
- [ ] PLAN mode: LiTT cannot write files
- [ ] ACT mode: LiTT can write files but deploy asks approval
- [ ] AUTO mode: LiTT can deploy if pre-approved

### Phase 2: Station Control APIs

**2.1 Image station actions**
- Wire `image.setPrompt`, `image.setNegativePrompt`, `image.setStyle`, `image.setAspectRatio`
- Wire `image.attachReference`, `image.generate`, `image.selectResult`
- Wire `image.upscale`, `image.saveAsset`, `image.sendToCanvas`
- Verify: LiTT can generate an image by calling actions (not clicking UI)
- Verify: UI and LiTT produce same result for same action

**2.2 Code station actions**
- Wire `code.search`, `code.readFile`, `code.writeFile`, `code.refactor`
- These mostly wrap existing project-tools handlers
- Verify: LiTT can read, edit, and search files

**2.3 Terminal station actions**
- Wire `terminal.execute`, `terminal.cancel`, `terminal.read`
- Verify: LiTT can run `pnpm typecheck` and see output

**2.4 Preview station actions**
- Wire `preview.launch`, `preview.reload`, `preview.inspect`, `preview.screenshot`
- Verify: LiTT can launch preview and inspect the result

**2.5 Git station actions**
- Wire `git.status`, `git.diff`, `git.branch`, `git.commit`, `git.push`, `git.createPR`
- These wrap existing project-tools handlers
- Verify: LiTT can create a branch, commit, and push

**2.6 Checks station actions**
- Wire `checks.typecheck`, `checks.lint`, `checks.test`, `checks.build`
- Verify: LiTT can run all checks and see pass/fail

**Acceptance tests for Phase 2:**
- [ ] LiTT can set an image prompt and generate an image via actions only
- [ ] LiTT can read a file, edit it, and run typecheck via actions only
- [ ] LiTT can launch preview and take a screenshot via actions only
- [ ] LiTT can create a branch, commit, and push via actions only
- [ ] UI and LiTT calling the same action produce identical results

### Phase 3: Browser Station

**3.1 Browser workspace stage**
- Add `browser` to `WorkspaceStage`
- Create `BrowserStation.tsx` component
- Extend `browser-job-executor.ts` for live streaming
- Wire browser station actions

**3.2 Live browser view**
- Stream Chromium view into Studio
- Show URL bar with back/forward/refresh
- Show LiTT's actions in real-time

**3.3 Follow LiTT integration**
- When LiTT navigates, switch to Browser station (if follow is on)
- When follow is off, show notification with `[Show me]`

**Acceptance tests for Phase 3:**
- [ ] Browser station shows a live Chromium view
- [ ] LiTT can navigate to a URL and the view updates
- [ ] LiTT can search, click, type, and scroll
- [ ] LiTT can take a screenshot and it appears in assets
- [ ] Follow LiTT ON: workspace switches to Browser when LiTT navigates
- [ ] Follow LiTT OFF: notification appears, workspace doesn't switch

### Phase 4: Live View + Activity

**4.1 Live View panel**
- Create `useLiveViewStore.ts`
- Implement Live View modes: browser, preview, terminal, creation
- Wire to execution store events

**4.2 Activity log enhancement**
- Update execution phases (add researching, creating, browsing, deploying, etc.)
- Format activity entries with station + summary
- Surface terminal commands in activity drawer

**4.3 Observable execution status**
- Show current phase in chat header / top bar
- Show step-by-step activity in activity drawer
- Show "LiTT is working in [station]" when follow is off

**Acceptance tests for Phase 4:**
- [ ] Live View shows browser when LiTT is browsing
- [ ] Live View shows preview when LiTT is testing
- [ ] Activity log shows station + summary for each event
- [ ] Execution status shows correct phase (researching, creating, etc.)
- [ ] "LiTT is working in Code" notification appears when follow is off

### Phase 5: Canvas Bridge + Asset Flow

**5.1 Asset context menu**
- Add "Open in Canvas", "Send to Code", "Use in Project", "Create variation", "Save Asset", "Ask LiTT"
- Each calls the appropriate station action

**5.2 Canvas node actions**
- Wire `canvas.addNode`, `canvas.removeNode`, `canvas.moveNode`, `canvas.editNode`, `canvas.selectNode`
- Verify LiTT can compose on canvas via actions

**5.3 Cross-station asset flow**
- Image generated → can be sent to Canvas → can be sent to Code as component
- Browser screenshot → can be saved as asset → can be sent to Canvas
- Video generated → can be saved as asset → can be used in project

**Acceptance tests for Phase 5:**
- [ ] Generated image can be sent to Canvas via action
- [ ] Canvas node can be sent to Code as a component reference
- [ ] Browser screenshot can be saved as an asset
- [ ] LiTT can orchestrate: generate image → send to canvas → send to code

### Phase 6: Voice Integration

**6.1 Verify voice uses same kernel**
- Confirm `runLiTTForVoice()` calls the same Station Action registry
- Voice can trigger any station action that chat can

**6.2 Voice → station action bridge**
- Voice says "fix that image bug" → LiTT calls `code.search`, `code.readFile`, `code.writeFile`
- Voice says "generate a hero image" → LiTT calls `image.setPrompt`, `image.generate`
- Voice says "run the tests" → LiTT calls `checks.test`

**Acceptance tests for Phase 6:**
- [ ] Voice can trigger code search and file editing
- [ ] Voice can trigger image generation
- [ ] Voice can trigger checks (typecheck, lint, test)
- [ ] Voice and chat produce identical results for same request

---

## 14. Definition of DONE

This contract is complete when this real-world test works end-to-end:

> **"LiTT, build a premium website for an AI music startup. Research competitors, create the visual assets, build the page, make it responsive, test it, fix anything broken, and give me the production preview."**

LiTT autonomously executes:

```
 1. Understand request
 2. Build plan (plan.createTask × N)
 3. Browser research (browser.search, browser.navigate, browser.readDom)
 4. Image generation (image.setPrompt, image.generate, image.selectResult, image.saveAsset)
 5. Asset storage (assets.save)
 6. Canvas composition (canvas.addNode, canvas.editNode)
 7. Code implementation (code.search, code.readFile, code.writeFile)
 8. File modifications (files.create, files.move)
 9. Terminal checks (terminal.execute: pnpm typecheck, pnpm lint, pnpm test)
10. Preview (preview.launch, preview.screenshot, preview.inspect)
11. Browser visual/interaction testing (browser.navigate, browser.click, browser.screenshot)
12. Detect problem (checks.test → FAIL)
13. Fix code (code.readFile, code.writeFile)
14. Retest (checks.test → PASS)
15. Ask deployment approval (deploy.preview → awaiting_approval)
16. Deploy (deploy.preview)
17. Open production URL (browser.navigate)
18. Verify production (browser.screenshot, browser.readDom)
19. Save project knowledge (memory.write)
20. Report exactly what happened
```

While:
- [ ] User can watch the relevant station in Live View
- [ ] User can jump into any station themselves
- [ ] User can resize Chat as far as 55vw
- [ ] User can take control away from LiTT at any point
- [ ] User can switch Follow LiTT ON/OFF
- [ ] User can switch PLAN/ACT/AUTO at any time
- [ ] All actions appear in the Activity log
- [ ] Context survives every station jump
- [ ] Voice can trigger the same actions as chat

---

## 15. Files to Create

```
src/lib/station-control/
├── types.ts                    # StationAction, StationId, StationExecutionContext
├── registry.ts                 # STATION_ACTIONS, registerStationAction, getStationAction
├── permissions.ts              # PermissionSet, canMutate, DEFAULT_PERMISSIONS
├── project-session.ts          # ProjectSession type
├── executor.ts                 # Action executor with permission/mode checks
└── actions/
    ├── plan.ts                 # plan.* actions
    ├── canvas.ts               # canvas.* actions
    ├── code.ts                 # code.* actions (wraps project-tools)
    ├── files.ts                # files.* actions (wraps project-tools)
    ├── preview.ts              # preview.* actions
    ├── terminal.ts             # terminal.* actions
    ├── browser.ts              # browser.* actions (wraps browser-job-executor)
    ├── image.ts                # image.* actions
    ├── video.ts                # video.* actions
    ├── music.ts                # music.* actions
    ├── audio.ts                # audio.* actions
    ├── git.ts                  # git.* actions (wraps project-tools)
    ├── deploy.ts               # deploy.* actions
    ├── checks.ts               # checks.* actions (wraps project-tools)
    ├── assets.ts               # assets.* actions
    └── memory.ts               # memory.* actions

src/app/studio/
├── stores/
│   ├── useProjectSessionStore.ts   # ProjectSession Zustand store
│   └── useLiveViewStore.ts         # Live View mode store
├── components/
│   ├── BrowserStation.tsx          # Browser workspace stage
│   ├── LiveViewPanel.tsx           # Live View overlay/panel
│   ├── FollowLiTTToggle.tsx        # Follow mode toggle
│   ├── MissionModeToggle.tsx       # PLAN/ACT/AUTO toggle
│   ├── PermissionsPanel.tsx        # Granular permissions
│   └── ChatCollapseRail.tsx        # 64px collapsed chat rail
```

## 16. Files to Modify

```
src/app/studio/components/CommandStudio.tsx
  - Update littResize: min 320, default 420, max 55vw
  - Add Follow LiTT toggle
  - Add Mission Mode toggle
  - Add Browser station routing
  - Wire Live View panel
  - Add chat collapse rail

src/app/studio/lib/studio-destinations.ts
  - Add "browser" to WorkspaceStage
  - Add browser to mapLegacyToolToDestination
  - Update workspaceStageToMode / modeToWorkspaceStage

src/app/studio/stores/useExecutionStore.ts
  - Add new ExecutionPhase values: researching, creating, browsing, running, deploying, complete, failed
  - Update mapPhase() for new phases

src/app/studio/context/StudioContext.tsx
  - Integrate with useProjectSessionStore
  - Add station navigation via StationId

src/lib/litt-runtime/runtime.ts
  - Wire station action registry into execution pipeline
  - Replace direct tool dispatch with station action calls

src/lib/voice/voice-runtime.ts
  - Verify same station action dispatch as chat
  - Ensure voice can trigger all station actions

src/lib/litt-intelligence/agent-loop-v2.ts
  - Replace tool registry calls with station action registry
  - Add station action advertisement to LLM
```

---

## 17. Constraints

1. **Do NOT redesign the layout.** The current hierarchy is locked.
2. **Do NOT create a new agent per station.** LiTT is the single operator.
3. **Do NOT use screen-coordinate automation.** Use typed actions and CDP.
4. **Do NOT add chain-of-thought to the activity log.** Actionable summaries only.
5. **Do NOT let stations drift.** ProjectSession is the single context.
6. **Do NOT skip permission checks.** Every mutating action checks permissions + mode.
7. **Do NOT auto-deploy without approval.** Deploy is always ASK unless pre-approved in AUTO.
8. **Do NOT expose secrets.** The `secrets` permission is always `deny`.
9. **Do NOT break existing URLs.** Legacy `?tool=` values must keep working.
10. **Do NOT remove existing functionality.** This is additive — wire existing tools as station actions.

---

## 18. Testing Strategy

- **Unit tests:** Every station action has a unit test with mocked execution context.
- **Integration tests:** Station action registry → executor → permission check → result.
- **E2E test:** The Definition of DONE scenario (Phase 6+).
- **Permission tests:** PLAN mode blocks mutations, ACT mode allows with approval, AUTO mode allows pre-approved.
- **Context survival test:** Switch stations and verify ProjectSession is intact.
- **Voice parity test:** Same request via chat and voice produces same station action calls.

---

## 19. Implementation Clarifications (Locked 2026-08-13)

These four clarifications are part of the contract. They resolve ambiguities an
implementation agent would otherwise have to guess. They do **not** change the
architecture, phases, locked UI requirements, or acceptance goal.

### 19.1 Creator / Canvas Handler Clarification

Some Station Actions have existing backing handlers and some do not.

- When an existing handler/provider exists, **adapt it** behind the Station
  Action interface.
- When no handler exists — particularly `image.generate`, `video.generate`,
  `music.generate`, `audio.*`, `canvas.*` and other creator/canvas actions
  identified by the capability audit — treat the capability as a **NEW
  IMPLEMENTATION** behind the Station Action interface.
- **Do not** create placeholder actions that report success without a real
  provider/handler. A station action with no backing implementation must either
  fail explicitly (`{ success: false, errorCode: "not_implemented" }`) or be
  omitted from the registry until its handler is built.

This means Phase 2.1 (Image station actions) and the canvas/music/video/audio
actions are **new capability builds**, not pure wire-ups of existing
`project-tools/registry.ts` handlers. Plan accordingly.

### 19.2 Headless / Voice Navigation Semantics

`StationExecutionContext.navigateToStation()` is **optional presentation
behavior**, not a required side effect of executing an action.

| Execution context | `navigateToStation()` behavior |
|-------------------|-------------------------------|
| Studio with active UI subscriber | Navigate / follow LiTT normally (respects Follow mode) |
| Voice / phone / headless | **No-op** for navigation; the underlying station action still executes |

`StationExecutionContext.reportLiveState()` is **NOT a no-op** in any context.

- It must continue emitting runtime/activity state in all execution paths.
- In voice/phone contexts, meaningful state changes **may** be translated into
  spoken status updates (TTS), e.g. "Switching to the browser now." This is
  optional per state change but the emission itself is mandatory.
- Headless callers that have no TTS sink still receive the emitted state for
  logging/audit.

### 19.3 Execution Identity

**Do not** use `LITTLABS_VAPI_OWNER_CLERK_ID` as the universal LiTT AUTO
identity. Baking a single-owner environment variable into the architecture
breaks the moment LiTT acts for another user or project.

Every execution must carry an explicit **actor/owner identity** derived from the
`ProjectSession` or execution grant:

```text
ProjectSession.userId / ownerUserId
    ↓
StationExecutionContext.actorUserId
```

| Channel | Actor identity |
|---------|---------------|
| Authenticated Studio | The current authenticated session user |
| Voice / Vapi | Resolved configured voice owner; `LITTLABS_VAPI_OWNER_CLERK_ID` may be used as the **voice-channel fallback only** |
| Unattended AUTO | The owner/user that granted the automation for that project/session |

All permission, project, memory, file, deployment, and approval checks use this
explicit execution identity — never a global env var as the implicit actor.

`StationExecutionContext` is amended to include:

```typescript
export interface StationExecutionContext {
  // ...existing fields...
  /** The explicit actor/owner identity for this execution. */
  actorUserId: string;
}
```

### 19.4 Browser Live View Implementation Gate

The existing job-based browser executor (`browser-job-executor.ts`) does **not**
by itself satisfy Browser Station Live View (§4, §5).

Browser Live View requires:

- **Persistent Playwright/CDP browser session** (not a one-shot job that
  returns a snapshot and closes)
- **Realtime session lifecycle** — open, keep-alive, user takeover/release,
  clean teardown
- **Streamed visual/state updates** into Studio (frames or DOM snapshots via
  WebSocket / equivalent realtime transport)
- **User takeover/release controls** where supported
- **DOM/accessibility actions remain authoritative** over coordinate clicking
  (per §4.1 — use CDP selectors, not screen coordinates)

Treat this as a **dedicated implementation/spike gate** before Phase 3 Browser
Station is considered complete. If the persistent-session + realtime-transport
spike does not pass, Phase 3 is blocked regardless of other Phase 3 work.

**Phase 3 acceptance gate (additional):**
- [ ] Persistent CDP session stays open across multiple LiTT actions without
      re-launching the browser
- [ ] Visual updates stream into Studio at usable latency (<1s perceived)
- [ ] User can take over the browser from LiTT and release it back
- [ ] Session tears down cleanly on station exit / project switch

---

This contract is LOCKED. Implement exactly what is described. Ask before deviating.
