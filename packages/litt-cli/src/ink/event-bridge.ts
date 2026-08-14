/**
 * EventBridge — translates RuntimeClient lifecycle events into
 * CockpitStore activity entries and Holo state transitions.
 *
 * This is the ONLY place where runtime events are converted to UI state.
 * The bridge reads from canonical runtime events and writes to the
 * CockpitStore. It never invents events or guesses state.
 *
 * Holo state transitions:
 *   run.started       → RUNNING
 *   agent.thinking    → THINKING
 *   approval.required → APPROVAL
 *   run.completed     → SUCCESS
 *   run.failed        → FAILED
 *   tool.cancelled    → CANCELLED
 *   tool.timeout      → TIMEOUT
 *   (idle)            → IDLE
 */

import { useCallback, useEffect } from "react";
import type { RuntimeClient, LifecycleEvent } from "../lib/runtime-client.js";
import type { RuntimeState } from "@litt/agent-core";
import type { CockpitStore, ActivityEntry, HoloState } from "./cockpit-store.js";
import type { SessionEventBridge } from "./session-event-bridge.js";

let entryCounter = 0;

function makeEntry(
  type: string,
  text: string,
  event: LifecycleEvent,
  stream?: "stdout" | "stderr",
  fullText?: string,
): ActivityEntry {
  return {
    id: `act_${++entryCounter}`,
    ts: event.ts,
    type,
    runId: event.runId,
    toolCallId: event.toolCallId,
    text,
    fullText: fullText ?? text,
    stream,
  };
}

function holoFromEvent(event: LifecycleEvent): HoloState | null {
  switch (event.type) {
    case "run.started": return "RUNNING";
    case "tool.started": return "RUNNING";
    case "tool.completed": return "RUNNING"; // still in run
    case "tool.failed": return "FAILED";
    case "tool.cancelled": return "CANCELLED";
    case "tool.timeout": return "TIMEOUT";
    case "run.completed":
      return (event.data.status as string) === "success" ? "COMPLETE" :
             (event.data.status as string) === "cancelled" ? "CANCELLED" :
             (event.data.status as string) === "timeout" ? "TIMEOUT" : "FAILED";
    default: return null;
  }
}

/** Heartbeat TTL — if heartbeat is older than this, runtime is stale */
const HEARTBEAT_TTL_MS = 30_000; // 2x typical 15s interval

/** Check if a runtime state has a fresh heartbeat */
function isHeartbeatFresh(state: RuntimeState | null): boolean {
  if (!state?.heartbeat) return false;
  const age = Date.now() - state.heartbeat.lastHeartbeatAt;
  return age < HEARTBEAT_TTL_MS && state.heartbeat.failures < state.heartbeat.maxFailures;
}

export function useEventBridge(
  client: RuntimeClient | null,
  store: CockpitStore,
  sessionBridge: SessionEventBridge | null,
): void {
  const onLifecycle = useCallback((event: LifecycleEvent) => {
    // Map event to activity entry
    let entry: ActivityEntry | null = null;

    switch (event.type) {
      case "run.started":
        entry = makeEntry("run.started", `${event.data.command ?? "command"}`, event);
        store.actions.setCurrentRunId(event.runId);
        break;
      case "tool.started":
        entry = makeEntry("tool.started", `${event.data.tool ?? "unknown"}`, event);
        break;
      case "tool.stdout": {
        const chunk = String(event.data.chunk ?? "");
        entry = makeEntry("tool.stdout", chunk.length > 60 ? chunk.slice(0, 59) + "…" : chunk, event, "stdout", chunk);
        break;
      }
      case "tool.stderr": {
        const chunk = String(event.data.chunk ?? "");
        entry = makeEntry("tool.stderr", chunk.length > 60 ? chunk.slice(0, 59) + "…" : chunk, event, "stderr", chunk);
        break;
      }
      case "tool.completed":
        entry = makeEntry("tool.completed", `${event.data.tool ?? "tool"} · ${event.data.durationMs ?? 0}ms`, event);
        break;
      case "tool.failed":
        entry = makeEntry("tool.failed", `${event.data.tool ?? "tool"} — ${event.data.error ?? "error"}`, event);
        break;
      case "tool.cancelled":
        entry = makeEntry("tool.cancelled", `${event.data.tool ?? "tool"}`, event);
        break;
      case "tool.timeout":
        entry = makeEntry("tool.timeout", `${event.data.tool ?? "tool"} · ${event.data.timeoutMs ?? 0}ms`, event);
        break;
      case "run.completed": {
        const status = event.data.status as string ?? "unknown";
        const seconds = ((event.data.durationMs as number ?? 0) / 1000).toFixed(1);
        entry = makeEntry(
          status === "success" ? "run.completed" : "run.failed",
          `${status} · ${seconds}s`,
          event,
        );
        store.actions.setCurrentRunId(null);
        break;
      }
      default:
        return;
    }

    if (entry) {
      store.actions.addActivity(entry);
    }

    // Map event to Holo state
    const holo = holoFromEvent(event);
    if (holo) {
      store.actions.setHoloState(holo);
      // Auto-return to IDLE after terminal states (except APPROVAL which stays)
      if (holo === "COMPLETE" || holo === "FAILED" || holo === "CANCELLED" || holo === "TIMEOUT") {
        setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
      }
    }
  }, [store]);

  // Remote connection state: maps RuntimeClient ConnectionState to
  // the cockpit's remoteRuntime field. This is INDEPENDENT of local runtime.
  // Local runtime readiness is set once on mount — it does not flap.
  const onConnection = useCallback((state: string) => {
    // Map ConnectionState → RemoteRuntimeState
    switch (state) {
      case "connected":
        // Socket connected — also check heartbeat freshness
        store.actions.setRemoteRuntime("connected");
        // Update legacy connected flag for backward compat
        store.actions.setConnected(isHeartbeatFresh(client?.getState() ?? null));
        break;
      case "connecting":
        store.actions.setRemoteRuntime("connecting");
        store.actions.setConnected(false);
        break;
      case "reconnecting":
        store.actions.setRemoteRuntime("reconnecting");
        store.actions.setConnected(false);
        break;
      case "error":
        store.actions.setRemoteRuntime("error");
        store.actions.setConnected(false);
        break;
      default:
        store.actions.setRemoteRuntime("offline");
        store.actions.setConnected(false);
    }
  }, [store, client]);

  // Re-evaluate remote connection when runtime state updates (heartbeat may go stale)
  const onState = useCallback((state: RuntimeState) => {
    if (client?.is_connected()) {
      store.actions.setConnected(isHeartbeatFresh(state));
      if (!isHeartbeatFresh(state)) {
        store.actions.setRemoteRuntime("error");
      }
    }
  }, [store, client]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];

    // Local runtime: the RuntimeSession is always available.
    // This proves LOCAL readiness only — it does NOT fabricate remote connectivity.
    if (sessionBridge) {
      cleanups.push(sessionBridge.subscribe(onLifecycle));
      store.actions.setLocalRuntime("ready");
      // Legacy connected flag: true only because local runtime is ready.
      // Remote connectivity is tracked separately in remoteRuntime.
      store.actions.setConnected(true);
    }

    // Remote runtime: subscribe to terminal-server events if available.
    // This is INDEPENDENT — remote being offline does not affect local readiness.
    if (client) {
      cleanups.push(client.onLifecycle(onLifecycle));
      cleanups.push(client.onConnectionChange(onConnection as (conn: import("../lib/runtime-client.js").ConnectionState) => void));
      cleanups.push(client.onState(onState));
    } else {
      // No remote client — explicitly mark remote as offline
      store.actions.setRemoteRuntime("offline");
    }

    return () => {
      for (const cleanup of cleanups) {
        try { cleanup(); } catch { /* ignore */ }
      }
    };
  }, [client, sessionBridge, onLifecycle, onConnection, onState, store]);
}
