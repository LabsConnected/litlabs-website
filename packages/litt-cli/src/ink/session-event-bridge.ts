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
  /** toolCallIds already projected as tool.started — one start per tool call. */
  private startedTools = new Set<string>();
  /** toolCallIds already projected to a terminal state — one result per tool call. */
  private finishedTools = new Set<string>();

  /** Dedup guard: a single tool execution can emit up to three parallel
   *  event streams (agent_tool_*, gateway_*, tool_call/tool_result).
   *  Project at most one start and one terminal event per toolCallId. */
  private claimStart(toolCallId: string | undefined): boolean {
    if (!toolCallId) return true;
    if (this.startedTools.has(toolCallId)) return false;
    this.startedTools.add(toolCallId);
    if (this.startedTools.size > 2000) this.startedTools.clear();
    return true;
  }
  private claimFinish(toolCallId: string | undefined): boolean {
    if (!toolCallId) return true;
    if (this.finishedTools.has(toolCallId)) return false;
    this.finishedTools.add(toolCallId);
    if (this.finishedTools.size > 2000) this.finishedTools.clear();
    return true;
  }

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
      // ─── Exactly-once contract ─────────────────────────────────────────
      // The agent loop (runAgentLoop) emits THREE parallel event streams for a
      // single tool execution:
      //   (a) agent_tool_call / agent_tool_result  via the `emitter` callback
      //   (b) command_start / command_end           via store.commandStart/End
      //   (c) tool_call / tool_result               via CommandExecutor.emit
      //	All three are legitimate internal events — (a) carries the tool
      //	identity (toolCallId + data.tool), (b) carries the run identity
      //	(runId "agent_<toolCallId>"), (c) carries command/args/label but
      //	NOT a `tool` field. If we projected ALL THREE, one tool would yield
      //	three STARTs and three results (observed live as `RUN RUN → unknown
      //	/ DONE PASS ✓ tool`).
      //
      //	The canonical UI START/RESULT for an agent execution is the TOOL-level
      //	event (agent_tool_call → tool.started, agent_tool_result →
      //	tool.completed). The agent-loop command_start/command_end are internal
      //	RuntimeStore bookkeeping (phase, activeCommand, heartbeat, lastResult)
      //	and must NOT also project. The CommandExecutor's tool_call/tool_result
      //	are internal execution-layer events and must NOT project either —
      //	they lack the `tool` name and would show as `→ unknown` / `✓ tool`.
      //	We still track the run identity.
      //
      //	Non-agent executions (slash /run shell commands, direct store.command*)
      //	do not carry the "agent_" runId prefix, so their run.started/run.completed
      //	AND tool.started/tool.completed projections are preserved.
      case "command_start": {
        const runnerRunId = (data.runId as string) ?? event.runId ?? "";
        if (runnerRunId) this.currentRunId = runnerRunId;
        // Agent-loop command_start is bookkeeping — the paired agent_tool_call
        // has already emitted the canonical `tool.started`. Do not project.
        if (runnerRunId.startsWith("agent_")) return null;
        return { type: "run.started", runId: runnerRunId || this.currentRunId || "", ts, data };
      }

      case "command_end": {
        const runnerRunId = (data.runId as string) ?? event.runId ?? this.currentRunId ?? "";
        if (runnerRunId) this.currentRunId = runnerRunId;
        // Agent-loop command_end is bookkeeping — the paired agent_tool_result
        // emits the canonical result projection. Do not project.
        if (runnerRunId.startsWith("agent_")) return null;

        const success = data.success as boolean;
        const cancelled = data.cancelled as boolean;
        const timedOut = data.timedOut as boolean;

        if (cancelled) {
          return { type: "run.completed", runId: runnerRunId, ts, data: { ...data, status: "cancelled" } };
        }
        if (timedOut) {
          return { type: "run.completed", runId: runnerRunId, ts, data: { ...data, status: "timeout" } };
        }
        return {
          type: "run.completed",
          runId: runnerRunId,
          ts,
          data: { ...data, status: success ? "success" : "failed" },
        };
      }

      case "tool_call": {
        // Agent-loop tool_call is bookkeeping — the paired agent_tool_call
        // has already emitted the canonical `tool.started` WITH the real
        // tool name. The CommandExecutor's tool_call event carries
        // { command, args, label } but NOT a `tool` field, so projecting
        // it would produce a duplicate `→ unknown` entry. Suppress for
        // agent runs (runId starts with "agent_"), same as command_start.
        const runnerRunId = (data.runId as string) ?? runId;
        if (runnerRunId.startsWith("agent_")) return null;
        const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
        if (!this.claimStart(toolCallIdFromData)) return null;
        return { type: "tool.started", runId, toolCallId: toolCallIdFromData, ts, data };
      }

      case "tool_result": {
        // Agent-loop tool_result is bookkeeping — the paired
        // agent_tool_result emitted the canonical result WITH the real
        // tool name. The CommandExecutor's tool_result event lacks a
        // `tool` field, so projecting it would produce a duplicate
        // `✓ tool · Xms` entry. Suppress for agent runs.
        const runnerRunId = (data.runId as string) ?? runId;
        if (runnerRunId.startsWith("agent_")) return null;
        const status = data.status as string;
        const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
        if (!this.claimFinish(toolCallIdFromData)) return null;
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
          this.claimStart(toolCallIdFromData);
          return { type: "tool.started", runId, toolCallId: toolCallIdFromData, ts, data: { tool, ...data } };
        }
        if (subtype === "agent_tool_result") {
          const success = (data.success as boolean) ?? true;
          const tool = (data.tool as string) ?? "unknown";
          const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
          if (!this.claimFinish(toolCallIdFromData)) return null;
          return {
            type: success ? "tool.completed" : "tool.failed",
            runId,
            toolCallId: toolCallIdFromData,
            ts,
            data: { tool, ...data },
          };
        }

        // Gateway lifecycle — for tools routed through ExecutionGateway
        // WITHOUT an agent_tool_* pair (local-tool missions, direct
        // gateway executions, plan-denied calls). gateway_* events were
        // previously dropped: the tool showed started-but-never-finished
        // and its real output never reached the UI. In agent runs the
        // agent_tool_* pair is canonical (runId "agent_…" — suppressed).
        if (subtype === "gateway_execute") {
          if (runId.startsWith("agent_")) return null;
          const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
          if (!this.claimStart(toolCallIdFromData)) return null;
          const tool = (data.toolId as string) ?? "tool";
          return { type: "tool.started", runId, toolCallId: toolCallIdFromData, ts, data: { tool, ...data } };
        }
        if (subtype === "gateway_result") {
          if (runId.startsWith("agent_")) return null;
          const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
          if (!this.claimFinish(toolCallIdFromData)) return null;
          const status = (data.status as string) ?? "failed";
          const tool = (data.toolId as string) ?? "tool";
          const detail = { tool, ...data, error: data.message, timeoutMs: data.durationMs };
          const type =
            status === "success" ? "tool.completed"
            : status === "timeout" ? "tool.timeout"
            : status === "cancelled" ? "tool.cancelled"
            : "tool.failed";
          return { type, runId, toolCallId: toolCallIdFromData, ts, data: detail };
        }
        if (subtype === "gateway_denied") {
          const toolCallIdFromData = (data.toolCallId as string) ?? toolCallId;
          if (!this.claimFinish(toolCallIdFromData)) return null;
          return {
            type: "tool.failed",
            runId,
            toolCallId: toolCallIdFromData,
            ts,
            data: { tool: (data.toolId as string) ?? "tool", error: (data.reason as string) ?? "denied", message: (data.reason as string) ?? "denied" },
          };
        }

        // Verification-gate lifecycle — a failed check must surface the
        // REAL subprocess evidence (command, cwd, exit, stderr), not a
        // generic summary. These were previously dropped entirely.
        if (subtype === "verification_check_start") {
          const check = (data.check as string) ?? "check";
          return {
            type: "tool.started",
            runId,
            toolCallId,
            ts,
            data: { tool: `project.${check}`, check, label: data.label },
          };
        }
        if (subtype === "verification_check_result") {
          const status = (data.status as string) ?? "failed";
          if (status === "skipped") return null;
          const check = (data.check as string) ?? "check";
          const tool = (data.tool as string) ?? `project.${check}`;
          const shortMessage = (data.message as string) ?? `${tool} ${status}`;
          const cmdLine = [data.command, ...(Array.isArray(data.args) ? (data.args as string[]) : [])]
            .filter(Boolean)
            .join(" ");
          const evidenceLines = [
            shortMessage,
            `command: ${cmdLine || "?"}`,
            `cwd: ${(data.cwd as string) ?? "?"}`,
            `exit: ${data.exitCode ?? "?"} · ${data.durationMs ?? 0}ms`,
            data.stderr ? `stderr:\n${data.stderr}` : null,
            data.stdout ? `stdout:\n${data.stdout}` : null,
          ].filter((l): l is string => typeof l === "string");
          const detail = {
            ...data,
            tool,
            check,
            error: shortMessage,
            message: evidenceLines.join("\n"),
            timeoutMs: data.durationMs,
          };
          const type =
            status === "success" ? "tool.completed"
            : status === "timeout" ? "tool.timeout"
            : status === "cancelled" ? "tool.cancelled"
            : "tool.failed";
          return { type, runId, toolCallId, ts, data: detail };
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
