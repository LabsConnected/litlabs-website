/**
 * Regression tests — verification evidence reaching the cockpit.
 *
 * Before the fix, SessionEventBridge dropped every
 * verification_check_result event, so the FailureView could only show
 * the generic "NOT VERIFIED — at least one check failed" summary.
 *
 * Pins:
 *   - check results map to tool.* lifecycle events with command/cwd/
 *     exit/stdout/stderr evidence preserved
 *   - the FailureView report surfaces the real stderr excerpt and the
 *     real command — not the mission summary
 *   - timeout recommendation appears only when timeout evidence exists
 */

import { describe, it, expect } from "vitest";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { buildFailureViewReport } from "../ink/overlays/failure-view.js";
import type { RuntimeEvent } from "@litt/agent-core";
import type { LifecycleEvent } from "../lib/runtime-client.js";
import type { MissionState, ActivityEntry } from "../ink/cockpit-store.js";

function collect() {
  const bridge = new SessionEventBridge();
  const events: LifecycleEvent[] = [];
  bridge.subscribe((e) => events.push(e));
  return { bridge, events };
}

function checkResultEvent(overrides: Record<string, unknown>): RuntimeEvent {
  return {
    type: "litt_event",
    subtype: "verification_check_result",
    ts: Date.now(),
    runId: "run_1",
    toolCallId: "vc_1",
    data: {
      check: "build",
      status: "failed",
      success: false,
      exitCode: 1,
      durationMs: 1234,
      command: "pnpm",
      args: ["run", "build"],
      cwd: "C:/fixture/proj",
      message: "pnpm run build — exit 1 (1234ms)",
      stderr: "TSC_FAIL_MARKER at src/bad.ts:7",
      ...overrides,
    },
  } as RuntimeEvent;
}

const FAILED_MISSION = {
  text: "fix things",
  state: "FAILED",
  failureReason: "NOT VERIFIED — at least one check failed. COMPLETE is not honest.",
  commandsExecuted: [],
  runId: "run_1",
} as unknown as MissionState;

describe("SessionEventBridge → verification_check_result", () => {
  it("failed check maps to tool.failed carrying real evidence", () => {
    const { bridge, events } = collect();
    bridge.onEvent(checkResultEvent({}));
    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.type).toBe("tool.failed");
    expect(ev.data.tool).toBe("project.build");
    expect(ev.data.command).toBe("pnpm");
    expect(ev.data.cwd).toBe("C:/fixture/proj");
    expect(ev.data.exitCode).toBe(1);
    expect(String(ev.data.message)).toContain("TSC_FAIL_MARKER");
    expect(String(ev.data.message)).toContain("pnpm run build");
    expect(String(ev.data.message)).toContain("C:/fixture/proj");
  });

  it("timeout maps to tool.timeout (explicit, not generic failed)", () => {
    const { bridge, events } = collect();
    bridge.onEvent(checkResultEvent({ status: "timeout", exitCode: -1 }));
    expect(events[0]!.type).toBe("tool.timeout");
  });

  it("success maps to tool.completed", () => {
    const { bridge, events } = collect();
    bridge.onEvent(checkResultEvent({ status: "success", success: true, exitCode: 0 }));
    expect(events[0]!.type).toBe("tool.completed");
  });

  it("skipped produces no activity entry", () => {
    const { bridge, events } = collect();
    bridge.onEvent(checkResultEvent({ status: "skipped" }));
    expect(events).toHaveLength(0);
  });

  it("check start maps to tool.started with the check tool name", () => {
    const { bridge, events } = collect();
    bridge.onEvent({
      type: "litt_event", subtype: "verification_check_start",
      ts: Date.now(), runId: "run_1", toolCallId: "vc_1",
      data: { check: "build", label: "Build" },
    } as RuntimeEvent);
    expect(events[0]!.type).toBe("tool.started");
    expect(events[0]!.data.tool).toBe("project.build");
  });
});

describe("FailureView report — real evidence, not the summary", () => {
  it("surfaces the stderr excerpt + command instead of only NOT VERIFIED", () => {
    const { bridge, events } = collect();
    bridge.onEvent(checkResultEvent({}));
    const ev = events[0]!;
    const log: ActivityEntry[] = [{
      id: "a1", ts: ev.ts, type: "tool.failed",
      runId: ev.runId, toolCallId: ev.toolCallId,
      text: `project.build — ${ev.data.error}`,
      fullText: String(ev.data.message),
    } as ActivityEntry];
    const report = buildFailureViewReport(FAILED_MISSION, log);
    expect(report.failedStep).toBe("project.build");
    expect(report.outputExcerpt).toContain("TSC_FAIL_MARKER");
    expect(report.outputExcerpt).toContain("pnpm run build");
    // Non-timeout failure must NOT recommend increasing the timeout.
    expect(report.recommendedNextAction).not.toMatch(/timeout/i);
  });

  it("recommends a timeout increase only on real timeout evidence", () => {
    const { bridge, events } = collect();
    bridge.onEvent(checkResultEvent({
      status: "timeout", exitCode: -1,
      message: "pnpm run build — TIMEOUT after 600000ms (600012ms)",
    }));
    const ev = events[0]!;
    const log: ActivityEntry[] = [{
      id: "a1", ts: ev.ts, type: "tool.timeout",
      runId: ev.runId, toolCallId: ev.toolCallId,
      text: "project.build · 600012ms",
      fullText: String(ev.data.message),
    } as ActivityEntry];
    const mission = {
      ...FAILED_MISSION,
      failureReason: "NOT VERIFIED — at least one check failed. First failure: Build: pnpm run build — TIMEOUT after 600000ms",
    } as unknown as MissionState;
    const report = buildFailureViewReport(mission, log);
    expect(report.recommendedNextAction).toMatch(/timeout/i);
  });
});

describe("SessionEventBridge → gateway_* lifecycle (previously dropped)", () => {
  function gw(subtype: string, data: Record<string, unknown>, runId = "run_2", toolCallId = "tc_1"): RuntimeEvent {
    return { type: "litt_event", subtype, ts: Date.now(), runId, toolCallId, data } as RuntimeEvent;
  }

  it("gateway_execute → tool.started, gateway_result → tool.completed with real message", () => {
    const { bridge, events } = collect();
    bridge.onEvent(gw("gateway_execute", { toolId: "project.inspect_package" }));
    bridge.onEvent(gw("gateway_result", { toolId: "project.inspect_package", status: "success", success: true, durationMs: 12, message: "package.json: evidence-fixture@0.0.0" }));
    expect(events.map(e => e.type)).toEqual(["tool.started", "tool.completed"]);
    expect(events[0]!.data.tool).toBe("project.inspect_package");
    expect(events[1]!.data.tool).toBe("project.inspect_package");
    expect(events[1]!.data.message).toContain("evidence-fixture");
  });

  it("inner tool_call/tool_result for the same toolCallId do not double-report", () => {
    const { bridge, events } = collect();
    bridge.onEvent(gw("gateway_execute", { toolId: "project.run" }));
    bridge.onEvent({ type: "tool_call", ts: Date.now(), runId: "run_2", toolCallId: "tc_1", data: { command: "pnpm", label: "pnpm run build" } } as RuntimeEvent);
    bridge.onEvent({ type: "tool_result", ts: Date.now(), runId: "run_2", toolCallId: "tc_1", data: { status: "success", toolCallId: "tc_1" } } as RuntimeEvent);
    bridge.onEvent(gw("gateway_result", { toolId: "project.run", status: "success", success: true, durationMs: 9, message: "ok" }));
    expect(events.map(e => e.type)).toEqual(["tool.started", "tool.completed"]);
  });

  it("gateway_denied → tool.failed with the denial reason", () => {
    const { bridge, events } = collect();
    bridge.onEvent(gw("gateway_execute", { toolId: "project.write_file" }));
    bridge.onEvent(gw("gateway_denied", { reason: "PLAN mode rejects mutating command", risk: "elevated" }));
    expect(events.at(-1)!.type).toBe("tool.failed");
    expect(String(events.at(-1)!.data.error)).toContain("PLAN mode");
  });

  it("agent-run gateway_* events stay suppressed (agent_tool_* is canonical)", () => {
    const { bridge, events } = collect();
    bridge.onEvent(gw("gateway_execute", { toolId: "project.status" }, "agent_1", "atc_1"));
    bridge.onEvent(gw("gateway_result", { toolId: "project.status", status: "success" }, "agent_1", "atc_1"));
    expect(events).toHaveLength(0);
  });
});
