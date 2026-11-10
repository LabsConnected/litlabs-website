import { describe, it, expect } from "vitest";
import { projectLifecycleToWorkstream } from "../ink/event-bridge.js";
import { WorkstreamStore } from "../ink/workstream-store.js";
import type { LifecycleEvent } from "../lib/runtime-client.js";

/**
 * Regression coverage for the stranded-workstream bug: local chat and
 * mission turns never emit run.completed (that event is remote-runtime
 * only), so overallStatus stayed "running" forever after the turn —
 * the dock could never tell the truth about a finished turn. The fix
 * maps mission.completed/mission.failed (and the controller's direct
 * workstreamPush for chat) onto the store's terminal transitions.
 */

function ev(
  type: LifecycleEvent["type"],
  data: Record<string, unknown> = {},
  toolCallId?: string,
): LifecycleEvent {
  return { type, runId: "run_test", toolCallId, ts: Date.now(), data };
}

describe("projectLifecycleToWorkstream — terminal truth", () => {
  it("tool.started moves overallStatus idle → running", () => {
    const ws = new WorkstreamStore();
    projectLifecycleToWorkstream(ev("tool.started", { tool: "web.search" }, "tc1"), ws);
    expect(ws.snapshot().overallStatus).toBe("running");
    expect(ws.snapshot().hasRunning).toBe(true);
  });

  it("tool.completed alone does NOT end the turn's running status", () => {
    const ws = new WorkstreamStore();
    projectLifecycleToWorkstream(ev("tool.started", { tool: "web.search" }, "tc1"), ws);
    projectLifecycleToWorkstream(
      ev("tool.completed", { tool: "web.search", success: true, durationMs: 5 }, "tc1"),
      ws,
    );
    // The tool finished but the TURN has not — status stays running
    // until a terminal event arrives.
    expect(ws.snapshot().overallStatus).toBe("running");
    expect(ws.snapshot().hasRunning).toBe(false);
  });

  it("mission.completed transitions overallStatus running → complete", () => {
    const ws = new WorkstreamStore();
    projectLifecycleToWorkstream(ev("tool.started", { tool: "project.read_file" }, "tc1"), ws);
    projectLifecycleToWorkstream(ev("mission.completed", { completionReason: "verified" }), ws);
    expect(ws.snapshot().overallStatus).toBe("complete");
  });

  it("mission.failed transitions overallStatus running → failed", () => {
    const ws = new WorkstreamStore();
    projectLifecycleToWorkstream(ev("tool.started", { tool: "project.run" }, "tc1"), ws);
    projectLifecycleToWorkstream(ev("mission.failed", { failureReason: "gate failed" }), ws);
    expect(ws.snapshot().overallStatus).toBe("failed");
  });

  it("run.completed success still completes (remote path unchanged)", () => {
    const ws = new WorkstreamStore();
    projectLifecycleToWorkstream(ev("run.started", { command: "task" }), ws);
    projectLifecycleToWorkstream(ev("run.completed", { status: "success", durationMs: 100 }), ws);
    expect(ws.snapshot().overallStatus).toBe("complete");
  });

  it("run.completed failure still fails (remote path unchanged)", () => {
    const ws = new WorkstreamStore();
    projectLifecycleToWorkstream(ev("run.completed", { status: "error", error: "boom" }), ws);
    expect(ws.snapshot().overallStatus).toBe("failed");
  });
});
