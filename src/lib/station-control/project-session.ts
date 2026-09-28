/**
 * Station Control Bridge — ProjectSession + context construction (server-only).
 *
 * ProjectSession is the single context that follows LiTT across every
 * station jump. Contract: docs/LITT-OS-IMPLEMENTATION-CONTRACT.md §8.
 * Headless navigation/reporting semantics: contract §19.2.
 */
import "server-only";
import type {
  MissionMode,
  PermissionSet,
  StationExecutionContext,
  StationId,
} from "./types";
import { DEFAULT_PERMISSIONS } from "./permissions";

/** Canonical creator taxonomy (mirrors studio-destinations.ts CreatorKind). */
export type CreatorKind = "image" | "video" | "music" | "audio" | "design" | "game" | "environment";

/** A mission plan task. Shape is intentionally loose — chunks may narrow it. */
export interface SessionTask {
  id: string;
  title: string;
  status: "todo" | "doing" | "done" | "blocked";
  [k: string]: unknown;
}

/** A paused approval gate captured in the session. */
export interface SessionPendingApproval {
  actionId: string;
  station: StationId;
  summary: string;
  requestedAt: number;
  [k: string]: unknown;
}

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
    plan: SessionTask[];
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
  pendingApprovals: SessionPendingApproval[];

  // Generated assets (this conversation)
  generatedAssets: { id: string; type: string; url: string; prompt: string }[];
}

/** Fresh ProjectSession with safe defaults. */
export function createProjectSession(opts: {
  userId: string;
  projectId?: string | null;
  conversationId?: string | null;
}): ProjectSession {
  return {
    userId: opts.userId,
    projectId: opts.projectId ?? null,
    conversationId: opts.conversationId ?? null,
    repository: null,
    branch: null,
    workspace: { station: "plan", activeFile: null, activeAssetId: null, selectedCanvasNode: null },
    mission: { mode: "act", currentGoal: null, plan: [], currentTaskId: null },
    creator: {
      activeCreator: null,
      prompt: null,
      negativePrompt: null,
      style: null,
      aspectRatio: null,
      referenceAssetId: null,
      lastResults: [],
    },
    browserSession: null,
    terminalSessions: [],
    preview: null,
    memory: [],
    permissions: { ...DEFAULT_PERMISSIONS },
    pendingApprovals: [],
    generatedAssets: [],
  };
}

export interface BuildStationContextOpts {
  projectId?: string | null;
  conversationId?: string | null;
  userId: string;
  transport?: unknown;
  actionContext?: { userId?: string; projectId?: string; actionRunId?: string };
  hasApproval?: boolean;
  signal?: AbortSignal;
  permissions?: PermissionSet;
  missionMode?: MissionMode;
  /** Station reported on fallback events (defaults to "plan"). */
  station?: StationId;
  emitEvent?: StationExecutionContext["emitEvent"];
  navigateToStation?: StationExecutionContext["navigateToStation"];
  reportLiveState?: StationExecutionContext["reportLiveState"];
}

/**
 * Build a StationExecutionContext with safe defaults.
 *
 * - emitEvent default: structured console.warn-level log (never throws).
 * - navigateToStation default: no-op per contract §19.2 headless semantics.
 * - reportLiveState default: MUST NOT be a no-op per contract §19.2 — it
 *   emits a `live_state` event through emitEvent so state still flows to
 *   logging/audit (and optional TTS) sinks in voice/headless contexts.
 */
export function buildStationContext(opts: BuildStationContextOpts): StationExecutionContext {
  const station: StationId = opts.station ?? "plan";

  const emitEvent: StationExecutionContext["emitEvent"] =
    opts.emitEvent ??
    ((event) => {
      try {
        console.warn(
          "[station-control] event",
          JSON.stringify({
            type: event.type,
            actionId: event.actionId,
            station: event.station,
            summary: event.summary,
            ...(event.error ? { error: event.error } : null),
            ...(event.errorCode ? { errorCode: event.errorCode } : null),
            ...(event.resultSummary ? { resultSummary: event.resultSummary } : null),
          }),
        );
      } catch {
        // emitEvent must never throw — execution depends on it.
      }
    });

  return {
    projectId: opts.projectId ?? null,
    conversationId: opts.conversationId ?? null,
    userId: opts.userId,
    permissions: opts.permissions ?? { ...DEFAULT_PERMISSIONS },
    missionMode: opts.missionMode ?? "act",
    emitEvent,
    // Headless default: navigation is optional presentation behavior (§19.2).
    navigateToStation: opts.navigateToStation ?? (() => undefined),
    // §19.2: reportLiveState is NOT a no-op in any context.
    reportLiveState:
      opts.reportLiveState ??
      ((state) => {
        emitEvent({
          type: "live_state",
          actionId: "live-state",
          station,
          summary: "Live state update",
          resultSummary:
            typeof state === "string"
              ? state.slice(0, 2000)
              : (() => {
                  try {
                    return JSON.stringify(state).slice(0, 2000);
                  } catch {
                    return String(state).slice(0, 2000);
                  }
                })(),
        });
      }),
    transport: opts.transport,
    actionContext: opts.actionContext,
    hasApproval: opts.hasApproval ?? false,
    signal: opts.signal,
  };
}
