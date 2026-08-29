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

/** Maps a toolCallId → live workstream activity id so a tool.started can
 *  be completed/failed by its matching terminal event. */
const toolWsIds = new Map<string, string>();

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

/**
 * Resolve a human-readable tool label from event data.
 *
 * Priority: data.tool (canonical agent event) > data.label
 * (CommandExecutor human-readable label) > data.command
 * (CommandExecutor command name) > "tool" (last resort).
 *
 * This ensures the activity feed NEVER shows `→ unknown` or `✓ tool`
 * when a real tool name or command is available in the event payload.
 * The canonical path (agent_tool_call/agent_tool_result) always sets
 * data.tool; this fallback covers CommandExecutor-level events that
 * carry label/command instead.
 */
/**
 * Build the activity-feed text for a mission step lifecycle event.
 *
 * CONTRACT: returns ICON-FREE text. The transcript renderer owns the
 * semantic glyph (semanticOf() → SEMANTIC_GLYPH). Baking "→"/"✓"/"✗"
 * here caused the observed `→ → Run static validation` /
 * `✓ ✓ Run automated tests` duplicate-marker bug. Exported so the
 * icon-free contract can be locked by regression tests.
 */
export function missionStepText(data: Record<string, unknown>): string {
  const title = data.title ?? data.stepId ?? "";
  return typeof title === "string" ? title : String(title ?? "");
}

function toolLabel(data: Record<string, unknown>): string {
  const tool = data.tool;
  if (typeof tool === "string" && tool.length > 0) return tool;
  const label = data.label;
  if (typeof label === "string" && label.length > 0) return label;
  const command = data.command;
  if (typeof command === "string" && command.length > 0) return command;
  return "tool";
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
  // ─── Tool progress — drive the structured per-tool view ──────────
  // Maps lifecycle events to ToolProgressStore mutations. This is the
  // canonical wiring: tool.started → startTool, tool.completed →
  // completeTool, tool.stdout/stderr → appendChunk, mission.* →
  // mission lifecycle. The renderer reads from store.state.toolProgress.
  const updateToolProgress = useCallback((event: LifecycleEvent) => {
    switch (event.type) {
      case "mission.created":
      case "mission.started":
        store.actions.startToolProgressMission();
        break;
      case "mission.completed":
        store.actions.completeToolProgressMission();
        break;
      case "mission.failed":
        store.actions.failToolProgressMission();
        break;
      case "tool.started": {
        const toolId = (event.data.toolId as string) ?? (event.data.tool as string) ?? "";
        const toolName = (event.data.tool as string) ?? toolId;
        store.actions.startToolProgress(event.toolCallId ?? "", toolId, toolName);
        break;
      }
      case "tool.completed": {
        const success = (event.data.success as boolean) ?? true;
        const message = (event.data.message as string) ?? "";
        const durationMs = event.data.durationMs as number | undefined;
        store.actions.completeToolProgress(event.toolCallId ?? "", success, message, durationMs);
        break;
      }
      case "tool.failed": {
        const message = (event.data.error as string) ?? (event.data.message as string) ?? "error";
        const durationMs = event.data.durationMs as number | undefined;
        store.actions.failToolProgress(event.toolCallId ?? "", message, durationMs);
        break;
      }
      case "tool.cancelled": {
        const message = (event.data.message as string) ?? "cancelled";
        store.actions.terminalToolProgress(event.toolCallId ?? "", "cancelled", message);
        break;
      }
      case "tool.timeout": {
        const message = (event.data.message as string) ?? "timed out";
        store.actions.terminalToolProgress(event.toolCallId ?? "", "timeout", message);
        break;
      }
      case "tool.stdout":
      case "tool.stderr": {
        const chunk = String(event.data.chunk ?? "");
        if (chunk) store.actions.appendToolProgressChunk(event.toolCallId ?? "", chunk);
        break;
      }
      default:
        break;
    }
  }, [store]);

  const onLifecycle = useCallback((event: LifecycleEvent) => {
    // Map event to activity entry
    let entry: ActivityEntry | null = null;

    switch (event.type) {
      case "run.started":
        entry = makeEntry("run.started", `${event.data.command ?? "command"}`, event);
        store.actions.setCurrentRunId(event.runId);
        break;
      case "tool.started":
        entry = makeEntry("tool.started", toolLabel(event.data), event);
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
        entry = makeEntry("tool.completed", `${toolLabel(event.data)} · ${event.data.durationMs ?? 0}ms`, event);
        break;
      case "tool.failed":
        entry = makeEntry("tool.failed", `${toolLabel(event.data)} — ${event.data.error ?? "error"}`, event);
        break;
      case "tool.cancelled":
        entry = makeEntry("tool.cancelled", `${toolLabel(event.data)}`, event);
        break;
      case "tool.timeout":
        entry = makeEntry("tool.timeout", `${toolLabel(event.data)} · ${event.data.timeoutMs ?? 0}ms`, event);
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

      // ─── Mission lifecycle events — project from RuntimeStore.mission ───
      // These come from SessionEventBridge mapping mission:* subtypes.
      // The controller also sets holo/missionState directly, but these
      // events ensure the cockpit reflects canonical runtime truth.
      case "mission.created":
        // The mission goal is the human-readable identity; the raw
        // mission ID is debug detail (/status, /activity) — never the feed.
        entry = makeEntry("mission.created", event.data.goal
          ? `Mission: ${String(event.data.goal).slice(0, 80)}`
          : "Mission created", event);
        // Project canonical mission into cockpit
        store.actions.setCanonicalMission({
          id: (event.data.missionId as string) ?? "",
          goal: (event.data.goal as string) ?? "",
          status: "planning",
          currentStepId: null,
          steps: [],
          verificationProven: null,
          restored: false,
          completionReason: null,
          failureReason: null,
        });
        break;
      case "mission.started":
        entry = makeEntry("mission.started", "Mission started", event);
        break;
      case "mission.step_created":
        entry = makeEntry("mission.step_created", `Step: ${event.data.title ?? event.data.stepId ?? ""}`, event);
        break;
      case "mission.step_started":
        // Icon-free text: the transcript renderer owns the semantic glyph
        // (semanticOf() → SEMANTIC_GLYPH). Baking "→" here caused the
        // observed `→ → Run static validation` duplicate-marker bug.
        entry = makeEntry("mission.step_started", missionStepText(event.data), event);
        break;
      case "mission.step_passed":
        // Icon-free text — renderer prepends ✓ via SEMANTIC_GLYPH.success.
        entry = makeEntry("mission.step_passed", missionStepText(event.data), event);
        break;
      case "mission.step_failed":
        // Icon-free text — renderer prepends × via SEMANTIC_GLYPH.failed.
        entry = makeEntry("mission.step_failed", missionStepText(event.data), event);
        break;
      case "mission.verifying":
        entry = makeEntry("mission.verifying", "Verifying mission", event);
        break;
      case "mission.completed":
        entry = makeEntry("mission.completed", `Mission COMPLETE: ${event.data.completionReason ?? ""}`, event);
        break;
      case "mission.failed":
        entry = makeEntry("mission.failed", `Mission FAILED: ${event.data.failureReason ?? ""}`, event);
        break;
      case "mission.restored":
        entry = makeEntry("mission.restored", "Mission restored", event);
        break;
      default:
        return;
    }

    if (entry) {
      store.actions.addActivity(entry);
    }

    // ─── Live workstream feed (observable intent, NO chain-of-thought) ──
    // Map lifecycle events onto structured workstream activities so the
    // operator WATCHES what LiTT is doing. `reason` entries are concise
    // conclusions only. Failures stay visible even when retried later.
    store.actions.workstreamPush((ws) => {
      switch (event.type) {
        case "run.started":
          ws.addReason(`Working on ${String(event.data.command ?? "task")}`);
          break;
        case "tool.started": {
          const label = toolLabel(event.data);
          const wsId = ws.begin("tool", "EXECUTING", "EXECUTING", label);
          if (event.toolCallId) toolWsIds.set(event.toolCallId, wsId);
          break;
        }
        case "tool.completed": {
          const wsId = event.toolCallId ? toolWsIds.get(event.toolCallId) : undefined;
          if (wsId) {
            ws.complete(wsId, {
              elapsedMs: event.data.durationMs as number | undefined,
              success: (event.data.success as boolean) ?? true,
              command: event.data.command as string | undefined,
            });
          }
          if (event.toolCallId) toolWsIds.delete(event.toolCallId);
          break;
        }
        case "tool.failed": {
          const wsId = event.toolCallId ? toolWsIds.get(event.toolCallId) : undefined;
          if (wsId) ws.fail(wsId, String(event.data.error ?? "error"));
          if (event.toolCallId) toolWsIds.delete(event.toolCallId);
          break;
        }
        case "tool.cancelled": {
          const wsId = event.toolCallId ? toolWsIds.get(event.toolCallId) : undefined;
          if (wsId) ws.fail(wsId, "Cancelled");
          if (event.toolCallId) toolWsIds.delete(event.toolCallId);
          break;
        }
        case "tool.timeout": {
          const wsId = event.toolCallId ? toolWsIds.get(event.toolCallId) : undefined;
          if (wsId) ws.fail(wsId, `Timed out after ${String(event.data.timeoutMs ?? 0)}ms`);
          if (event.toolCallId) toolWsIds.delete(event.toolCallId);
          break;
        }
        case "run.completed": {
          const status = (event.data.status as string) ?? "unknown";
          const dur = event.data.durationMs as number | undefined;
          if (status === "success") ws.addVerify(`Run complete`, true, dur);
          else {
            const id = ws.begin("failure", "FAILED", `Run ${status}`);
            ws.fail(id, String(event.data.error ?? status));
          }
          break;
        }
        case "mission.step_started":
          ws.addReason(missionStepText(event.data));
          break;
        case "mission.step_passed":
          ws.addVerify(missionStepText(event.data), true);
          break;
        case "mission.step_failed":
          {
            const id = ws.begin("failure", "FAILED", missionStepText(event.data));
            ws.fail(id, "Step failed");
          }
          break;
        default:
          break;
      }
    });

    // ─── Tool progress updates ────────────────────────────────────
    // Drive the structured ToolProgressStore from the same lifecycle
    // events. This fills the main content area during tool execution
    // with friendly per-tool blocks instead of an empty streaming area.
    updateToolProgress(event);

    // Map event to Holo state
    const holo = holoFromEvent(event);
    if (holo) {
      // During VERIFYING, tool events emitted by the verification gate's
      // checks must not regress the display back to RUNNING — the mission
      // has finished executing and the runtime is proving it. Terminal
      // states (FAILED etc.) still apply.
      const isVerifying = store.state.holoState === "VERIFYING";
      if (!(holo === "RUNNING" && isVerifying)) {
        store.actions.setHoloState(holo);
        // Auto-return to IDLE after terminal states (except APPROVAL which stays)
        if (holo === "COMPLETE" || holo === "FAILED" || holo === "CANCELLED" || holo === "TIMEOUT") {
          setTimeout(() => store.actions.setHoloState("IDLE"), 2000);
        }
      }
    }
  }, [store, updateToolProgress]);
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
