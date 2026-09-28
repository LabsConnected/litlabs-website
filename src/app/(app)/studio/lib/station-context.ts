"use client";

/**
 * UI-side StationExecutionContext builder — Station Control Bridge, chunk D.
 *
 * Gives UI-invoked station actions (chunk E wires the agent-loop side) the
 * same event stream the agent loop uses: emitEvent appends to the activity
 * store, navigateToStation goes through the follow-aware navigator, and
 * reportLiveState always emits (§19.2: NOT a no-op in any context).
 *
 * Client-safe: no server imports. `StationExecutionContext` here is the
 * UI-side variant of the contract §3.1 shape (chunk A's
 * `StationExecutionContext` adds permissions/transport for the agent-loop
 * side; the UI builder does not need them).
 * (Named `ExecutionEvent` per the contract; distinct from the execution
 * store's SSE-shaped ExecutionEvent — reconciliation is chunk A's call.)
 */

import { useActivityStore } from "../stores/useActivityStore";
import type { ExecutionPhase } from "../stores/useExecutionStore";
import type { StationId } from "@/lib/station-control/types";
import {
  navigateToStation,
  STATION_LABELS,
} from "./follow-navigation";

/** Contract §3.1 station-execution event envelope.
 *
 * Chunk A (`src/lib/station-control/types.ts`) owns the transport-level
 * `ExecutionEvent` (`type`/`actionId`-shaped). This UI-side envelope is
 * deliberately distinct (`kind`-shaped, optional actionId, phase
 * overrides) — it feeds the activity store, not the executor.
 * Reconciliation of the two shapes is chunk A's call.
 */
export type StationEventKind =
  | "action_started"
  | "action_completed"
  | "action_failed"
  | "approval_required"
  | "live_state";

export interface ExecutionEvent {
  kind: StationEventKind;
  station: StationId;
  /** Human-readable summary, e.g. "Editing checkout/route.ts" */
  summary: string;
  /** Station action id, e.g. "image.generate" */
  actionId?: string;
  /** Explicit phase override — beats the kind/station defaults below */
  phase?: ExecutionPhase;
  timestamp?: number;
}

/** Contract §3.1 / §19.3 StationExecutionContext (mirrored; see chunk A note). */
export interface StationExecutionContext {
  projectId: string;
  conversationId: string;
  userId: string;
  /** §19.3 — the explicit actor/owner identity for this execution. */
  actorUserId: string;
  emitEvent: (event: ExecutionEvent) => void;
  navigateToStation: (station: StationId, detail?: string) => void;
  reportLiveState: (state: {
    station: StationId;
    phase: ExecutionPhase;
    summary?: string;
  }) => void;
}

/**
 * Default phase when an action starts, per station. Contract-driven:
 * image/video/music/audio → "creating", browser → "browsing",
 * terminal/checks → "running", deploy → "deploying", code/files → "editing",
 * preview → "verifying". Sensible extensions for the rest (documented).
 */
const STATION_START_PHASE: Record<StationId, ExecutionPhase> = {
  plan: "planning",
  canvas: "creating",
  code: "editing",
  files: "editing",
  preview: "verifying",
  browser: "browsing",
  terminal: "running",
  image: "creating",
  video: "creating",
  music: "creating",
  audio: "creating",
  design: "creating",
  game: "creating",
  environment: "creating",
  git: "editing",
  deploy: "deploying",
  checks: "running",
  assets: "creating",
  memory: "editing",
  voice: "running",
  camera: "running",
};

function resolvePhase(event: ExecutionEvent): ExecutionPhase {
  switch (event.kind) {
    case "approval_required":
      return "awaiting_approval";
    case "action_failed":
      return "failed";
    case "action_completed":
      // Keep an explicit prior phase when provided; otherwise the
      // completed action leaves the run in verification.
      return event.phase ?? "verifying";
    case "action_started":
      return event.phase ?? STATION_START_PHASE[event.station] ?? "editing";
    case "live_state":
      return event.phase ?? "editing";
  }
}

export interface BuildUiStationContextOpts {
  projectId: string;
  conversationId: string;
  userId: string;
}

/**
 * Build a StationExecutionContext for UI-invoked station actions.
 * Headless-safe: reportLiveState emits in ALL paths (contract §19.2);
 * navigateToStation degrades to the presentation no-op when no UI
 * subscriber is registered (contract §19.2).
 */
export function buildUiStationContext(
  opts: BuildUiStationContextOpts,
): StationExecutionContext {
  const emitEvent = (event: ExecutionEvent): void => {
    try {
      const phase = resolvePhase(event);
      useActivityStore.getState().addEvent({
        id: `station-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "agent",
        source: "litt",
        category: event.station,
        label: event.summary,
        detail: event.actionId,
        timestamp: event.timestamp ?? Date.now(),
        status:
          event.kind === "action_failed"
            ? "error"
            : event.kind === "action_completed"
              ? "success"
              : "info",
        conversationId: opts.conversationId,
        station: event.station,
        summary: event.summary,
        phase,
      });
    } catch {
      // Event emission must never break the action itself.
    }
  };

  return {
    projectId: opts.projectId,
    conversationId: opts.conversationId,
    userId: opts.userId,
    actorUserId: opts.userId,
    emitEvent,
    navigateToStation: (station, detail) => navigateToStation(station, detail),
    reportLiveState: (state) => {
      // §19.2: reportLiveState is NOT a no-op in any context — it must
      // emit runtime/activity state in ALL execution paths.
      emitEvent({
        kind: "live_state",
        station: state.station,
        summary:
          state.summary ??
          `LiTT ${state.phase} in ${STATION_LABELS[state.station]}`,
        phase: state.phase,
      });
    },
  };
}
