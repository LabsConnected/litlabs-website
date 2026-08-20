/**
 * Regression: agent tool-call event deduplication.
 *
 * Bug: A single agent tool execution produced DUPLICATE activity entries
 * because three parallel event streams all mapped to tool.started/tool.completed:
 *   (a) agent_tool_call / agent_tool_result  (canonical, has data.tool)
 *   (b) tool_call / tool_result              (CommandExecutor, NO data.tool)
 *   (c) command_start / command_end           (RuntimeStore, suppressed for agent_)
 *
 * (b) was NOT suppressed for agent runs, so the feed showed:
 *     → unknown
 *     ✓ tool · 58ms
 * alongside the correct entries from (a).
 *
 * Fix: SessionEventBridge now suppresses tool_call/tool_result when the
 * runId starts with "agent_", mirroring the command_start/command_end
 * suppression. The canonical tool identity comes from agent_tool_call/
 * agent_tool_result, which always sets data.tool.
 *
 * Additionally, event-bridge.ts now falls back to data.label / data.command
 * when data.tool is missing, so even a stray CommandExecutor event shows
 * a human-readable label instead of "unknown" / "tool".
 */
import { describe, it, expect } from "vitest";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import type { RuntimeEvent } from "@litt/agent-core";
import type { LifecycleEvent } from "../lib/runtime-client.js";

describe("Tool-call deduplication — agent runs produce exactly ONE tool event pair", () => {
  it("agent_tool_call + tool_call (CommandExecutor) → only ONE tool.started with real tool name", () => {
    const bridge = new SessionEventBridge();
    const received: LifecycleEvent[] = [];
    bridge.subscribe((event) => received.push(event));

    const toolCallId = "tc_123";
    const agentRunId = `agent_${toolCallId}`;

    // (a) Canonical agent event — has data.tool
    bridge.onEvent({
      type: "litt_event",
      subtype: "agent_tool_call",
      ts: 1000,
      toolCallId,
      data: { tool: "project.status", toolId: "project.status", inputs: {} },
    } as RuntimeEvent);

    // (b) CommandExecutor event — has command/label but NO data.tool
    bridge.onEvent({
      type: "tool_call",
      ts: 1001,
      runId: agentRunId,
      toolCallId,
      data: { command: "status", args: [], runId: agentRunId, toolCallId, label: "project.status" },
    } as RuntimeEvent);

    // (c) RuntimeStore event — suppressed for agent_ runs (pre-existing)
    bridge.onEvent({
      type: "command_start",
      ts: 1002,
      runId: agentRunId,
      toolCallId,
      data: { runId: agentRunId, command: "status", args: [] },
    } as RuntimeEvent);

    const started = received.filter((e) => e.type === "tool.started");
    expect(started.length).toBe(1);
    expect(started[0].data.tool).toBe("project.status");
  });

  it("agent_tool_result + tool_result (CommandExecutor) → only ONE tool.completed with real tool name", () => {
    const bridge = new SessionEventBridge();
    const received: LifecycleEvent[] = [];
    bridge.subscribe((event) => received.push(event));

    const toolCallId = "tc_456";
    const agentRunId = `agent_${toolCallId}`;

    // (a) Canonical agent result — has data.tool
    bridge.onEvent({
      type: "litt_event",
      subtype: "agent_tool_result",
      ts: 2000,
      toolCallId,
      data: {
        tool: "project.status",
        toolId: "project.status",
        status: "success",
        success: true,
        message: "On branch master, working tree clean",
        durationMs: 58,
      },
    } as RuntimeEvent);

    // (b) CommandExecutor result — NO data.tool
    bridge.onEvent({
      type: "tool_result",
      ts: 2001,
      runId: agentRunId,
      toolCallId,
      data: {
        runId: agentRunId,
        toolCallId,
        status: "success",
        success: true,
        message: "On branch master, working tree clean",
        durationMs: 58,
      },
    } as RuntimeEvent);

    // (c) RuntimeStore command_end — suppressed for agent_ runs (pre-existing)
    bridge.onEvent({
      type: "command_end",
      ts: 2002,
      runId: agentRunId,
      toolCallId,
      data: { runId: agentRunId, success: true, exitCode: 0, durationMs: 58 },
    } as RuntimeEvent);

    const completed = received.filter((e) => e.type === "tool.completed");
    expect(completed.length).toBe(1);
    expect(completed[0].data.tool).toBe("project.status");
    expect(completed[0].data.durationMs).toBe(58);
  });

  it("non-agent tool_call/tool_result (slash /run) are NOT suppressed", () => {
    const bridge = new SessionEventBridge();
    const received: LifecycleEvent[] = [];
    bridge.subscribe((event) => received.push(event));

    // Slash /run commands use a non-agent runId
    bridge.onEvent({
      type: "tool_call",
      ts: 3000,
      runId: "run_abc",
      toolCallId: "tc_789",
      data: { command: "git", args: ["status"], runId: "run_abc", toolCallId: "tc_789", label: "git status" },
    } as RuntimeEvent);

    bridge.onEvent({
      type: "tool_result",
      ts: 3001,
      runId: "run_abc",
      toolCallId: "tc_789",
      data: { runId: "run_abc", toolCallId: "tc_789", status: "success", success: true, message: "clean", durationMs: 30 },
    } as RuntimeEvent);

    const started = received.filter((e) => e.type === "tool.started");
    const completed = received.filter((e) => e.type === "tool.completed");
    expect(started.length).toBe(1);
    expect(completed.length).toBe(1);
  });

  it("agent_tool_call with missing data.tool falls back to 'unknown' (not suppressed)", () => {
    // If the agent loop itself fails to set data.tool, the event should
    // still project (it's the canonical event) but show "unknown".
    // This is an agent-loop bug, not a bridge bug — the bridge must not
    // silently drop canonical events.
    const bridge = new SessionEventBridge();
    const received: LifecycleEvent[] = [];
    bridge.subscribe((event) => received.push(event));

    bridge.onEvent({
      type: "litt_event",
      subtype: "agent_tool_call",
      ts: 4000,
      toolCallId: "tc_broken",
      data: { toolId: "project.status", inputs: {} },
    } as RuntimeEvent);

    const started = received.filter((e) => e.type === "tool.started");
    expect(started.length).toBe(1);
    // SessionEventBridge sets tool to "unknown" when data.tool is missing
    expect(started[0].data.tool).toBe("unknown");
  });

  it("full agent tool execution: exactly ONE started + ONE completed, no 'tool' fallback label", () => {
    const bridge = new SessionEventBridge();
    const received: LifecycleEvent[] = [];
    bridge.subscribe((event) => received.push(event));

    const toolCallId = "tc_full";
    const agentRunId = `agent_${toolCallId}`;

    // Simulate the full triple-stream for a single agent tool execution
    // Stream (a): canonical agent events
    bridge.onEvent({
      type: "litt_event", subtype: "agent_tool_call", ts: 100, toolCallId,
      data: { tool: "project.status", toolId: "project.status", inputs: {} },
    } as RuntimeEvent);
    // Stream (b): CommandExecutor events (should be suppressed)
    bridge.onEvent({
      type: "tool_call", ts: 101, runId: agentRunId, toolCallId,
      data: { command: "status", args: [], runId: agentRunId, toolCallId, label: "project.status" },
    } as RuntimeEvent);
    // Stream (c): RuntimeStore events (should be suppressed — pre-existing)
    bridge.onEvent({
      type: "command_start", ts: 102, runId: agentRunId, toolCallId,
      data: { runId: agentRunId, command: "status", args: [] },
    } as RuntimeEvent);

    // Tool result streams
    bridge.onEvent({
      type: "litt_event", subtype: "agent_tool_result", ts: 200, toolCallId,
      data: { tool: "project.status", toolId: "project.status", status: "success", success: true, message: "clean", durationMs: 42 },
    } as RuntimeEvent);
    bridge.onEvent({
      type: "tool_result", ts: 201, runId: agentRunId, toolCallId,
      data: { runId: agentRunId, toolCallId, status: "success", success: true, message: "clean", durationMs: 42 },
    } as RuntimeEvent);
    bridge.onEvent({
      type: "command_end", ts: 202, runId: agentRunId, toolCallId,
      data: { runId: agentRunId, success: true, exitCode: 0, durationMs: 42 },
    } as RuntimeEvent);

    const started = received.filter((e) => e.type === "tool.started");
    const completed = received.filter((e) => e.type === "tool.completed");
    const runStarted = received.filter((e) => e.type === "run.started");
    const runCompleted = received.filter((e) => e.type === "run.completed");

    // Exactly one of each — no duplicates
    expect(started.length).toBe(1);
    expect(completed.length).toBe(1);
    expect(runStarted.length).toBe(0); // agent_ command_start suppressed
    expect(runCompleted.length).toBe(0); // agent_ command_end suppressed

    // The tool name is the real canonical name, not "unknown" or "tool"
    expect(started[0].data.tool).toBe("project.status");
    expect(completed[0].data.tool).toBe("project.status");
    expect(completed[0].data.durationMs).toBe(42);
  });
});
