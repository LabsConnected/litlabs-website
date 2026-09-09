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

import { useCallback, useEffect, useRef } from "react";
import type { RuntimeClient, LifecycleEvent } from "../lib/runtime-client.js";
import type { RuntimeState } from "@litt/agent-core";
import type { CockpitStore, ActivityEntry, HoloState } from "./cockpit-store.js";
import type { SessionEventBridge } from "./session-event-bridge.js";
import { toolKind, toolPhase, humanizeToolLabel } from "./workstream-normalizer.js";

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
  tag?: string,
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
    tag,
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
  const toolName = String(data.tool ?? data.toolId ?? data.label ?? data.command ?? "");
  if (toolName.length === 0) return "tool";
  return humanizeToolLabel(toolName, data);
}

function toolTag(data: Record<string, unknown>): string | undefined {
  const toolName = String(data.tool ?? data.toolId ?? data.label ?? data.command ?? "");
  if (toolName.length === 0) return undefined;
  const kind = toolKind(toolName);
  switch (kind) {
    case "inspect": return "READ";
    case "edit": return "EDIT";
    case "command": return "RUN";
    case "test": return "TEST";
    case "verify": return "VERIFY";
    case "reason": return "THINK";
    case "warning": return "WARN";
    case "retry": return "RETRY";
    case "failure": return "FAIL";
    case "success": return "PASS";
    case "tool":
    default: return undefined;
  }
}

function resultMessage(data: Record<string, unknown>): string | undefined {
  const msg = data.message ?? data.output ?? data.error ?? data.result;
  if (typeof msg === "string" && msg.length > 0) return msg;
  return undefined;
}

function holoFromEvent(event: LifecycleEvent): HoloState | null {
  switch (event.type) {
    case "run.started": return "RUNNING";
    case "tool.started": return "RUNNING";
    case "tool.completed": return "RUNNING"; // still in run
    // Per-tool failures/cancellations/timeouts do NOT set the global
    // mission state. The agent loop continues after a recoverable tool
    // failure — the model can retry, use a different tool, or report
    // the failure. Only a TERMINAL run/mission event may mark the whole
    // mission as FAILED/CANCELLED/TIMEOUT. The activity feed still
    // records the per-tool failure with a FAIL tag (red row).
    case "tool.failed": return null;
    case "tool.cancelled": return null;
    case "tool.timeout": return null;
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
  // ─── Store ref — breaks the render loop ──────────────────────────
  // `store` is a new object every render (useCockpitStore returns a
  // fresh {state, actions} literal). Without this ref, every callback
  // below depends on `store` → gets a new identity every render → the
  // subscription effect re-runs every render → subscriptions are torn
  // down and recreated → setLocalRuntime("ready")/setConnected(true)
  // fire every render → render loop ("Maximum update depth exceeded").
  //
  // The ref holds the LATEST store; callbacks read from it at event
  // time (not capture time). The ref is updated synchronously every
  // render so the callbacks always see current state. The callbacks
  // themselves are stable (empty deps) so the effect only re-runs when
  // `client` or `sessionBridge` actually change.
  const storeRef = useRef(store);
  storeRef.current = store;

  // ─── Tool progress — drive the structured per-tool view ──────────
  // Maps lifecycle events to ToolProgressStore mutations. This is the
  // canonical wiring: tool.started → startTool, tool.completed →
  // completeTool, tool.stdout/stderr → appendChunk, mission.* →
  // mission lifecycle. The renderer reads from store.state.toolProgress.
  const updateToolProgress = useCallback((event: LifecycleEvent) => {
    const s = storeRef.current;
    switch (event.type) {
      case "mission.created":
      case "mission.started":
        s.actions.startToolProgressMission();
        break;
      case "mission.completed":
        s.actions.completeToolProgressMission();
        break;
      case "mission.failed":
        s.actions.failToolProgressMission();
        break;
      case "tool.started": {
        const toolId = (event.data.toolId as string) ?? (event.data.tool as string) ?? "";
        const toolName = (event.data.tool as string) ?? toolId;
        s.actions.startToolProgress(event.toolCallId ?? "", toolId, toolName);
        break;
      }
      case "tool.completed": {
        const success = (event.data.success as boolean) ?? true;
        const message = (event.data.message as string) ?? "";
        const durationMs = event.data.durationMs as number | undefined;
        s.actions.completeToolProgress(event.toolCallId ?? "", success, message, durationMs);
        break;
      }
      case "tool.failed": {
        const message = (event.data.error as string) ?? (event.data.message as string) ?? "error";
        const durationMs = event.data.durationMs as number | undefined;
        s.actions.failToolProgress(event.toolCallId ?? "", message, durationMs);
        break;
      }
      case "tool.cancelled": {
        const message = (event.data.message as string) ?? "cancelled";
        s.actions.terminalToolProgress(event.toolCallId ?? "", "cancelled", message);
        break;
      }
      case "tool.timeout": {
        const message = (event.data.message as string) ?? "timed out";
        s.actions.terminalToolProgress(event.toolCallId ?? "", "timeout", message);
        break;
      }
      case "tool.stdout":
      case "tool.stderr": {
        const chunk = String(event.data.chunk ?? "");
        if (chunk) s.actions.appendToolProgressChunk(event.toolCallId ?? "", chunk);
        break;
      }
      default:
        break;
    }
  }, []);

  const onLifecycle = useCallback((event: LifecycleEvent) => {
    const s = storeRef.current;
    // Map event to activity entry
    let entry: ActivityEntry | null = null;

    switch (event.type) {
      case "run.started":
        entry = makeEntry("run.started", `${event.data.command ?? "command"}`, event, undefined, undefined, "RUN");
        s.actions.setCurrentRunId(event.runId);
        break;
      case "tool.started":
        entry = makeEntry("tool.started", toolLabel(event.data), event, undefined, undefined, toolTag(event.data) ?? "RUN");
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
        entry = makeEntry("tool.completed", `${toolLabel(event.data)} · ${event.data.durationMs ?? 0}ms`, event, undefined, resultMessage(event.data), "PASS");
        break;
      case "tool.failed":
        entry = makeEntry("tool.failed", `${toolLabel(event.data)} — ${event.data.error ?? "error"}`, event, undefined, resultMessage(event.data), "FAIL");
        break;
      case "tool.cancelled":
        entry = makeEntry("tool.cancelled", `${toolLabel(event.data)}`, event, undefined, resultMessage(event.data), "FAIL");
        break;
      case "tool.timeout":
        entry = makeEntry("tool.timeout", `${toolLabel(event.data)} · ${event.data.timeoutMs ?? 0}ms`, event, undefined, resultMessage(event.data), "FAIL");
        break;
      case "run.completed": {
        const status = event.data.status as string ?? "unknown";
        const seconds = ((event.data.durationMs as number ?? 0) / 1000).toFixed(1);
        entry = makeEntry(
          status === "success" ? "run.completed" : "run.failed",
          `${status} · ${seconds}s`,
          event,
          undefined,
          resultMessage(event.data),
          status === "success" ? "DONE" : "FAIL",
        );
        s.actions.setCurrentRunId(null);
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
          : "Mission created", event, undefined, undefined, "MISSION");
        // Project canonical mission into cockpit
        s.actions.setCanonicalMission({
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
        entry = makeEntry("mission.started", "Mission started", event, undefined, undefined, "MISSION");
        break;
      case "mission.step_created":
        entry = makeEntry("mission.step_created", `Step: ${event.data.title ?? event.data.stepId ?? ""}`, event, undefined, undefined, "STEP");
        break;
      case "mission.step_started":
        // Icon-free text: the transcript renderer owns the semantic glyph
        // (semanticOf() → SEMANTIC_GLYPH). Baking "→" here caused the
        // observed `→ → Run static validation` duplicate-marker bug.
        entry = makeEntry("mission.step_started", missionStepText(event.data), event, undefined, undefined, "STEP");
        break;
      case "mission.step_passed":
        // Icon-free text — renderer prepends ✓ via SEMANTIC_GLYPH.success.
        entry = makeEntry("mission.step_passed", missionStepText(event.data), event, undefined, undefined, "PASS");
        break;
      case "mission.step_failed":
        // Icon-free text — renderer prepends × via SEMANTIC_GLYPH.failed.
        entry = makeEntry("mission.step_failed", missionStepText(event.data), event, undefined, undefined, "FAIL");
        break;
      case "mission.verifying":
        entry = makeEntry("mission.verifying", "Verifying mission", event, undefined, undefined, "VERIFY");
        break;
      case "mission.completed":
        entry = makeEntry("mission.completed", `Mission COMPLETE: ${event.data.completionReason ?? ""}`, event, undefined, undefined, "DONE");
        break;
      case "mission.failed":
        entry = makeEntry("mission.failed", `Mission FAILED: ${event.data.failureReason ?? ""}`, event, undefined, undefined, "FAIL");
        break;
      case "mission.restored":
        entry = makeEntry("mission.restored", "Mission restored", event, undefined, undefined, "MISSION");
        break;
      default:
        return;
    }

    if (entry) {
      s.actions.addActivity(entry);
    }

    // ─── Live workstream feed (observable intent, NO chain-of-thought) ──
    // Map lifecycle events onto structured workstream activities so the
    // operator WATCHES what LiTT is doing. `reason` entries are concise
    // conclusions only. Failures stay visible even when retried later.
    // The normalization layer (workstream-normalizer.ts) maps raw tool
    // names to semantic kinds + human-readable labels.
    s.actions.workstreamPush((ws) => {
      switch (event.type) {
        case "run.started": {
          const cmd = String(event.data.command ?? "task");
          ws.setObjective(cmd);
          ws.setWorkstreamPhase("understanding");
          ws.addReason(`Working on ${cmd}`);
          break;
        }
        case "tool.started": {
          const toolName = String(event.data.tool ?? event.data.label ?? event.data.command ?? "tool");
          const kind = toolKind(toolName);
          const phase = toolPhase(toolName);
          const label = humanizeToolLabel(toolName, event.data as Record<string, unknown>);
          ws.setWorkstreamPhase(phase);
          const wsId = ws.begin(kind, null, label, label);
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
          if (status === "success") {
            ws.addVerify(`Run complete`, true, dur);
            ws.setComplete();
          } else {
            const id = ws.begin("failure", "FAILED", `Run ${status}`);
            ws.fail(id, String(event.data.error ?? status));
            ws.setFailed();
          }
          break;
        }
        case "mission.step_started": {
          // Identity-based upsert: the same stepId may arrive multiple
          // times (mission:step_started, mission:step_working,
          // mission:step_verifying all map to this event type, and the
          // dual sessionBridge + client subscription can redeliver).
          // beginSource is a no-op if an activity with this sourceId
          // already exists — one logical step = one workstream row.
          const stepId = (event.data.stepId as string) ?? "";
          const title = missionStepText(event.data);
          ws.beginSource("reason", "WORKING", title, undefined, stepId || undefined);
          break;
        }
        case "mission.step_passed": {
          // Complete the existing step activity (don't create a new
          // "verify" row). This is the same logical operation — the
          // step transitioned from running to passed.
          const stepId = (event.data.stepId as string) ?? "";
          const title = missionStepText(event.data);
          ws.completeSource(stepId, { success: true, label: title });
          break;
        }
        case "mission.step_failed": {
          // Fail the existing step activity (don't create a new
          // "failure" row). Same logical operation — the step failed.
          const stepId = (event.data.stepId as string) ?? "";
          const title = missionStepText(event.data);
          ws.failSource(stepId, "Step failed", title);
          break;
        }
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
      const isVerifying = s.state.holoState === "VERIFYING";
      if (!(holo === "RUNNING" && isVerifying)) {
        s.actions.setHoloState(holo);
        // Auto-return to IDLE after terminal states — use the race-safe
        // scheduleIdle() instead of a fire-and-forget setTimeout. The old
        // pattern scheduled multiple competing timers that could override
        // a new run's state back to IDLE (the exact bug scheduleIdle was
        // created to fix). scheduleIdle clears any pending timer and uses
        // a functional updater that only transitions from terminal states.
        if (holo === "COMPLETE" || holo === "FAILED" || holo === "CANCELLED" || holo === "TIMEOUT") {
          s.actions.scheduleIdle(2000);
        }
      }
    }
  }, [updateToolProgress]);
  // the cockpit's remoteRuntime field. This is INDEPENDENT of local runtime.
  // Local runtime readiness is set once on mount — it does not flap.
  const onConnection = useCallback((state: string) => {
    const s = storeRef.current;
    // Map ConnectionState → RemoteRuntimeState
    switch (state) {
      case "connected":
        // Socket connected — also check heartbeat freshness
        s.actions.setRemoteRuntime("connected");
        // Update legacy connected flag for backward compat
        s.actions.setConnected(isHeartbeatFresh(client?.getState() ?? null));
        break;
      case "connecting":
        s.actions.setRemoteRuntime("connecting");
        s.actions.setConnected(false);
        break;
      case "reconnecting":
        s.actions.setRemoteRuntime("reconnecting");
        s.actions.setConnected(false);
        break;
      case "error":
        s.actions.setRemoteRuntime("error");
        s.actions.setConnected(false);
        break;
      default:
        s.actions.setRemoteRuntime("offline");
        s.actions.setConnected(false);
    }
  }, [client]);

  // Re-evaluate remote connection when runtime state updates (heartbeat may go stale)
  const onState = useCallback((state: RuntimeState) => {
    const s = storeRef.current;
    if (client?.is_connected()) {
      s.actions.setConnected(isHeartbeatFresh(state));
      if (!isHeartbeatFresh(state)) {
        s.actions.setRemoteRuntime("error");
      }
    }
  }, [client]);

  useEffect(() => {
    const s = storeRef.current;
    const cleanups: Array<() => void> = [];

    // Local runtime: the RuntimeSession is always available.
    // This proves LOCAL readiness only — it does NOT fabricate remote connectivity.
    if (sessionBridge) {
      cleanups.push(sessionBridge.subscribe(onLifecycle));
      s.actions.setLocalRuntime("ready");
      // Legacy connected flag: true only because local runtime is ready.
      // Remote connectivity is tracked separately in remoteRuntime.
      s.actions.setConnected(true);
    }

    // Remote runtime: subscribe to terminal-server events if available.
    // This is INDEPENDENT — remote being offline does not affect local readiness.
    if (client) {
      cleanups.push(client.onLifecycle(onLifecycle));
      cleanups.push(client.onConnectionChange(onConnection as (conn: import("../lib/runtime-client.js").ConnectionState) => void));
      cleanups.push(client.onState(onState));
    } else {
      // No remote client — explicitly mark remote as offline
      s.actions.setRemoteRuntime("offline");
    }

    return () => {
      for (const cleanup of cleanups) {
        try { cleanup(); } catch { /* ignore */ }
      }
    };
  }, [client, sessionBridge, onLifecycle, onConnection, onState]);
}
