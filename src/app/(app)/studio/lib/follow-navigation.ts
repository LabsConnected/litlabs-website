/**
 * Follow-aware station navigation — Station Control Bridge, chunk D.
 *
 * Contract refs:
 *  - §2.2 Follow LiTT Toggle: ON → setWorkspaceMode() switches the
 *    visible station; OFF → "LiTT is working in X / [Show me]"
 *    notification, no auto-navigation.
 *  - §19.2 Headless / Voice Navigation Semantics: navigateToStation()
 *    is OPTIONAL PRESENTATION BEHAVIOR — it must never throw, and it is
 *    a no-op when there is no active UI subscriber.
 *
 * This module does NOT invent a navigation system. The actual workspace
 * switch always goes through the EXISTING setter: the Studio shell's
 * `setWorkspaceMode(WorkspaceStage)` (StudioContext → CommandStudio's
 * routing). The shell registers that setter once via
 * `registerWorkspaceNavigator()`; until it does (or in headless/voice
 * contexts where there is no UI subscriber) navigation is a no-op,
 * exactly as §19.2 requires.
 *
 * `StationId` is owned by chunk A (`src/lib/station-control/types.ts`)
 * and imported type-only here — no local redeclaration.
 */

import type { WorkspaceStage } from "./studio-destinations";
import type { StationId } from "@/lib/station-control/types";
import { useFollowModeStore } from "../stores/useFollowModeStore";

// Chunk A (`src/lib/station-control/types.ts`) owns the contract §3.1
// 21-station union; re-exported here so existing import sites
// (tests, station-context) keep compiling from this module.
export type { StationId } from "@/lib/station-control/types";

/** Contract §3.1 — the 21-station union lives in chunk A
 * (`src/lib/station-control/types.ts`); re-exported above. */

/** Human-readable station labels for follow notifications. */
export const STATION_LABELS: Record<StationId, string> = {
  plan: "Plan",
  canvas: "Canvas",
  code: "Code",
  files: "Files",
  preview: "Preview",
  browser: "Browser",
  terminal: "Terminal",
  image: "Image",
  video: "Video",
  music: "Music",
  audio: "Audio",
  design: "Design",
  game: "Game",
  environment: "360°",
  git: "Git",
  deploy: "Deploy",
  checks: "Checks",
  assets: "Assets",
  memory: "Memory",
  voice: "Voice",
  camera: "Camera",
};

/**
 * StationId → WorkspaceStage mapping. Stations with NO switchable
 * workspace stage map to null and navigateToStation() is an honest
 * no-op for them (documented below, never faked).
 *
 * Rationale per station:
 *  - plan     → "plan"    conversation/planning surface
 *  - canvas   → "canvas"  canvas renders on the files/canvas stage
 *  - code     → "code"    Monaco editor stage
 *  - files    → "canvas"  files render in the files/canvas stage
 *                         (see mapLegacyToolToDestination: canvas → "files")
 *  - preview  → "preview" app preview stage
 *  - browser  → null      browser live views exist (ChatBrowserLiveView /
 *                         BrowserJobLiveView) but there is no browser
 *                         WORKSPACE STAGE switchable via setWorkspaceMode
 *                         — honest no-op, no fake navigation.
 *  - terminal → null      terminal is a bottom-drawer tab, not a
 *                         WorkspaceStage — no-op.
 *  - image/video/music/audio → "media"  the media stage IS the surface
 *                         for generated images, video, music, audio
 *  - design   → null      "design" is a creator/StudioMode, not a
 *                         WorkspaceStage (modeToWorkspaceStage returns
 *                         null) — no-op.
 *  - game     → null      no visible tab until GameCreatorTool is
 *                         functional — no-op.
 *  - environment → null   creator surface only, not a stage — no-op.
 *  - git      → "code"    git acts on code; closest existing stage
 *  - deploy   → "preview" deploys ship the app visible in preview
 *  - checks   → null      check output surfaces in the terminal drawer /
 *                         activity, not a workspace stage — no-op.
 *  - assets   → "media"   generated media + asset library surface
 *  - memory/voice/camera → null  no workspace surface — no-op.
 */
export const STATION_STAGE_MAP: Record<StationId, WorkspaceStage | null> = {
  plan: "plan",
  canvas: "canvas",
  code: "code",
  files: "canvas",
  preview: "preview",
  browser: null,
  terminal: null,
  image: "media",
  video: "media",
  music: "media",
  audio: "media",
  design: null,
  game: null,
  environment: null,
  git: "code",
  deploy: "preview",
  checks: null,
  assets: "media",
  memory: null,
  voice: null,
  camera: null,
};

// ─── Registered workspace navigator ───────────────────────────────
// The Studio shell registers its real setWorkspaceMode(WorkspaceStage)
// once (hook-free module slot). Absent → headless/voice semantics:
// navigateToStation() is a presentation no-op (§19.2).

type WorkspaceNavigator = (stage: WorkspaceStage) => void;

let workspaceNavigator: WorkspaceNavigator | null = null;

/**
 * Register the shell's existing workspace-stage setter. Returns an
 * unregister function. The shell (not this module) owns the callback.
 */
export function registerWorkspaceNavigator(fn: WorkspaceNavigator): () => void {
  workspaceNavigator = fn;
  return () => {
    if (workspaceNavigator === fn) workspaceNavigator = null;
  };
}

/** For tests and headless teardown. */
export function clearWorkspaceNavigator(): void {
  workspaceNavigator = null;
}

// ─── Follow notification bus ──────────────────────────────────────
// Off-mode (§2.2): instead of switching, emit a "LiTT is working in X
// / [Show me]" notification. There is no global toast system inside
// Studio, so this module exposes a subscription bus + a window
// CustomEvent; the shell renders it (layout frozen — no new panels).

export interface FollowNotification {
  station: StationId;
  /** "LiTT is working in Code" */
  title: string;
  /** Optional second line, e.g. "Editing src/app/page.tsx" */
  detail?: string;
  /** The [Show me] action — performs the deferred workspace switch. */
  showMe: () => void;
}

export const FOLLOW_NOTIFICATION_EVENT = "studio:follow-notification";

type FollowNotificationListener = (notification: FollowNotification) => void;

const notificationListeners = new Set<FollowNotificationListener>();

export function subscribeFollowNotifications(
  listener: FollowNotificationListener,
): () => void {
  notificationListeners.add(listener);
  return () => {
    notificationListeners.delete(listener);
  };
}

function emitFollowNotification(notification: FollowNotification): void {
  for (const listener of notificationListeners) {
    try {
      listener(notification);
    } catch {
      // A failing listener must never break navigation.
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(FOLLOW_NOTIFICATION_EVENT, {
          detail: {
            station: notification.station,
            title: notification.title,
            detail: notification.detail,
            showMe: notification.showMe,
          },
        }),
      );
    } catch {
      // Presentation-only — never throws (§19.2).
    }
  }
}

/** Perform the workspace switch through the registered setter, if any. */
function performSwitch(stage: WorkspaceStage): void {
  try {
    workspaceNavigator?.(stage);
  } catch {
    // Presentation-only — never throws (§19.2).
  }
}

/**
 * Follow-aware navigation to a station's workspace surface.
 *
 * - mode "on":  switch the workspace to the station's stage (through the
 *   shell's existing setter; no-op when no UI subscriber is registered).
 * - mode "off": do NOT switch; emit a "LiTT is working in X / [Show me]"
 *   notification instead.
 * - Station has no stage / unknown station: honest no-op, never throws.
 */
export function navigateToStation(station: StationId, detail?: string): void {
  try {
    const stage = STATION_STAGE_MAP[station] ?? null;
    if (stage === null) return; // no surface — honest no-op, documented above
    const followMode = useFollowModeStore.getState().mode;
    if (followMode === "on") {
      performSwitch(stage);
      return;
    }
    emitFollowNotification({
      station,
      title: `LiTT is working in ${STATION_LABELS[station]}`,
      detail,
      showMe: () => performSwitch(stage),
    });
  } catch {
    // §19.2: navigation is presentation-only and must never throw.
  }
}
