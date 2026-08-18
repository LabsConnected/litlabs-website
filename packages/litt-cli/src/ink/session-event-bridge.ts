/**
 * SessionEventBridge — connects local RuntimeSession events to the cockpit UI.
 *
 * When terminal-server is unavailable, the local RuntimeSession IS the runtime.
 * This bridge maps RuntimeSession's RuntimeEvents to LifecycleEvents that the
 * EventBridge hook can consume, just like RuntimeClient does for remote events.
 *
 * Architecture:
 *   RuntimeSession.onEvent → SessionEventBridge → EventBridge → CockpitStore
 *
 * This ensures the cockpit always has live events, whether the runtime is
 * local (no terminal-server) or remote (terminal-server connected).
 */

import type { RuntimeEvent, StreamChunk } from "@litt/agent-core";
import type { LifecycleEvent } from "../lib/runtime-client.js";

export type SessionEventListener = (event: LifecycleEvent) => void;

export class SessionEventBridge {
  private listeners = new Set<SessionEventListener>();
  private currentRunId: string | null = null;

  /** Subscribe to lifecycle events. Returns unsubscribe function. */
  subscribe(listener: SessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called by RuntimeSession when a RuntimeEvent is emitted. */
  onEvent = (event: RuntimeEvent): void => {
    const lifecycle = this.mapRuntimeEventToLifecycle(event);
    if (lifecycle) {
      for (const listener of this.listeners) {
        try { listener(lifecycle); } catch { /* listener errors don't crash */ }
      }
    }
  };

  /** Called by RuntimeSession when a stream chunk is emitted. */
  onStream = (chunk: StreamChunk): void => {
    const lifecycle: LifecycleEvent = {
      type: chunk.stream === "stderr" ? "tool.stderr" : "tool.stdout",
      runId: this.currentRunId ?? "",
      toolCallId: "",
      ts: chunk.ts,
      data: { chunk: chunk.text, stream: chunk.stream },
    };
    for (const listener of this.listeners) {
      try { listener(lifecycle); } catch { /* listener errors don't crash */ }
    }
  };

  private mapRuntimeEventToLifecycle(event: RuntimeEvent): LifecycleEvent | null {
    const runId = event.runId ?? this.currentRunId ?? "";
    const toolCallId = event.toolCallId;
    const ts = event.ts;
    const data = event.data ?? {};

    switch (event.type) {
      case "command_start":
        if (this.currentRunId && this.currentRunId !== runId) {
          // new run — old run is done
        }
        this.currentRunId = runId;
        return { type: "run.started", runId, ts, data };

      case "command_end": {
        const success = data.success as boolean;
        const cancelled = data.cancelled as boolean;
        const timedOut = data.timedOut as boolean;

        if (cancelled) {
          return { type: "run.completed", runId, ts, data: { ...data, status: "cancelled" } };
        }
        if (timedOut) {
          return { type: "run.completed", runId, ts, data: { ...data, status: "timeout" } };
        }
        return {
          type: "run.completed",
          runId,
          ts,
          data: { ...data, status: success ? "success" : "failed" },
        };
      }

      case "tool_call":
        return { type: "tool.started", runId, toolCallId, ts, data };

      case "tool_result": {
        const status = data.status as string;
        const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
        switch (status) {
          case "success":
            return { type: "tool.completed", runId, toolCallId: toolCallIdFromData, ts, data };
          case "failed":
            return { type: "tool.failed", runId, toolCallId: toolCallIdFromData, ts, data };
          case "cancelled":
            return { type: "tool.cancelled", runId, toolCallId: toolCallIdFromData, ts, data };
          case "timeout":
            return { type: "tool.timeout", runId, toolCallId: toolCallIdFromData, ts, data };
          default:
            return { type: "tool.completed", runId, toolCallId: toolCallIdFromData, ts, data };
        }
      }

      case "tool_stream": {
        const stream = data.stream as string;
        if (stream === "stdout") {
          return { type: "tool.stdout", runId, toolCallId, ts, data };
        }
        if (stream === "stderr") {
          return { type: "tool.stderr", runId, toolCallId, ts, data };
        }
        return null;
      }

      case "phase_change":
        return null;

      case "litt_event": {
        // Agent loop events — agent_tool_call / agent_tool_result /
        // verification_failed_repair. Map these to LifecycleEvents so
        // the EventBridge can surface them in the cockpit activity feed
        // and drive holo state from canonical runtime truth (not toolId
        // string matching in the controller).
        const subtype = event.subtype;
        if (subtype === "agent_tool_call") {
          const tool = (data.tool as string) ?? "unknown";
          const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
          return { type: "tool.started", runId, toolCallId: toolCallIdFromData, ts, data: { tool, ...data } };
        }
        if (subtype === "agent_tool_result") {
          const success = (data.success as boolean) ?? true;
          const tool = (data.tool as string) ?? "unknown";
          const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
          return {
            type: success ? "tool.completed" : "tool.failed",
            runId,
            toolCallId: toolCallIdFromData,
            ts,
            data: { tool, ...data },
          };
        }

        // Mission lifecycle events — map to mission.* LifecycleEvents
        // so EventBridge can project them into CockpitStore.
        const missionSubtypeMap: Record<string, LifecycleEvent["type"]> = {
          "mission:created": "mission.created",
          "mission:started": "mission.started",
          "mission:step_created": "mission.step_created",
          "mission:step_started": "mission.step_started",
          "mission:step_passed": "mission.step_passed",
          "mission:step_failed": "mission.step_failed",
          "mission:step_working": "mission.step_started",
          "mission:step_verifying": "mission.step_started",
          "mission:step_blocked": "mission.step_failed",
          "mission:verifying": "mission.verifying",
          "mission:completed": "mission.completed",
          "mission:failed": "mission.failed",
          "mission:restored": "mission.restored",
        };
        const mappedType = missionSubtypeMap[subtype ?? ""];
        if (mappedType) {
          return { type: mappedType, runId, ts, data };
        }

        // other litt_event subtypes (verification_failed_repair, etc.)
        return null;
      }

      default:
        return null;
    }
  }
}
