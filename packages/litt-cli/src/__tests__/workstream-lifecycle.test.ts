/**
 * Workstream mission lifecycle — the dock must give the centre back.
 *
 * Bug (2026-10-18, real cockpit run against local Ollama): a mission
 * completed (mission JSON status=complete, tool project.inspect_package
 * passed, answer finalized into the chat store) but the WorkstreamDock kept
 * rendering "◉ RUNNING" and the answer never appeared. The event bridge
 * only completed the workstream on run.completed — agent-loop missions emit
 * mission.completed — and nothing ever cleared it, so once any mission ran
 * the dock replaced the transcript for the rest of the session.
 */

import { describe, it, expect } from "vitest";
import { WorkstreamStore } from "../ink/workstream-store.js";
import { applyMissionLifecycle, isWorkstreamLive } from "../ink/workstream-lifecycle.js";

function runningMission(goal = "Read package.json"): WorkstreamStore {
  const ws = new WorkstreamStore();
  applyMissionLifecycle(ws, "mission.created", { goal });
  const id = ws.begin("inspect", null, "Inspect Package", "Inspect Package");
  ws.complete(id, { success: true });
  return ws;
}

describe("applyMissionLifecycle", () => {
  it("mission.created starts a live workstream with the goal as objective", () => {
    const ws = new WorkstreamStore();
    applyMissionLifecycle(ws, "mission.created", { goal: "Read package.json" });
    const s = ws.snapshot();
    expect(s.overallStatus).toBe("running");
    expect(s.objective).toBe("Read package.json");
  });

  it("mission.completed marks the workstream complete", () => {
    const ws = runningMission();
    applyMissionLifecycle(ws, "mission.completed", {});
    expect(ws.snapshot().overallStatus).toBe("complete");
  });

  it("mission.failed marks the workstream failed", () => {
    const ws = runningMission();
    applyMissionLifecycle(ws, "mission.failed", { failureReason: "boom" });
    expect(ws.snapshot().overallStatus).toBe("failed");
  });

  it("a new mission after a finished one starts fresh instead of inheriting the old state", () => {
    const ws = runningMission("first");
    applyMissionLifecycle(ws, "mission.completed", {});
    applyMissionLifecycle(ws, "mission.created", { goal: "second" });
    const s = ws.snapshot();
    expect(s.overallStatus).toBe("running");
    expect(s.objective).toBe("second");
    expect(s.activities).toHaveLength(0);
  });

  it("ignores unrelated events", () => {
    const ws = runningMission();
    expect(applyMissionLifecycle(ws, "tool.started", {})).toBe(false);
    expect(ws.snapshot().overallStatus).toBe("running");
  });
});

describe("isWorkstreamLive — who owns the centre of the shell", () => {
  it("a running mission owns the centre", () => {
    expect(isWorkstreamLive(runningMission().snapshot())).toBe(true);
  });

  it("a mission blocked on approval keeps the centre", () => {
    const ws = runningMission();
    ws.setBlocked();
    expect(isWorkstreamLive(ws.snapshot())).toBe(true);
  });

  it("a completed mission returns the centre to the transcript so the answer is visible", () => {
    const ws = runningMission();
    applyMissionLifecycle(ws, "mission.completed", {});
    expect(isWorkstreamLive(ws.snapshot())).toBe(false);
  });

  it("a failed mission returns the centre to the transcript so the error is visible", () => {
    const ws = runningMission();
    applyMissionLifecycle(ws, "mission.failed", {});
    expect(isWorkstreamLive(ws.snapshot())).toBe(false);
  });

  it("an empty workstream never owns the centre", () => {
    expect(isWorkstreamLive(new WorkstreamStore().snapshot())).toBe(false);
  });
});

describe("run.started after a finished mission", () => {
  it("starts from a clean workstream instead of inheriting the terminal state", () => {
    const ws = runningMission("first");
    applyMissionLifecycle(ws, "mission.completed", {});
    expect(applyMissionLifecycle(ws, "run.started", { command: "npm test" })).toBe(false);
    expect(ws.snapshot().overallStatus).toBe("idle");
    expect(ws.snapshot().activities).toHaveLength(0);
    ws.setObjective("npm test"); // what the bridge does next
    expect(ws.snapshot().overallStatus).toBe("running");
  });

  it("does not clear a workstream that is still running", () => {
    const ws = runningMission("live");
    applyMissionLifecycle(ws, "run.started", { command: "npm test" });
    expect(ws.snapshot().activities.length).toBeGreaterThan(0);
  });
});
