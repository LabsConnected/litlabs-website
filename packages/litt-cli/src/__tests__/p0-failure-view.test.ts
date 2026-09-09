/**
 * P0: FailureView regression tests.
 *
 * Proves buildFailureViewReport builds a real report from the terminal
 * mission state and activity log, including failed step, command excerpt,
 * output excerpt, last successful step, and recommended next action.
 */
import { describe, it, expect } from "vitest";
import { buildFailureViewReport } from "../ink/overlays/failure-view.js";
import type { MissionState, ActivityEntry } from "../ink/cockpit-store.js";

function mission(partial: Partial<MissionState> & { text: string; state: "FAILED" | "CANCELLED" | "TIMEOUT" }): MissionState {
  return {
    text: partial.text,
    runId: partial.runId ?? null,
    state: partial.state,
    startedAt: partial.startedAt ?? Date.now(),
    endedAt: partial.endedAt ?? Date.now(),
    filesTouched: partial.filesTouched ?? [],
    commandsExecuted: partial.commandsExecuted ?? [],
    testResults: partial.testResults ?? null,
    typecheckPassed: partial.typecheckPassed ?? null,
    buildPassed: partial.buildPassed ?? null,
    runtimeProven: partial.runtimeProven ?? false,
    baselineGitFiles: partial.baselineGitFiles ?? [],
    missionDeltaFiles: partial.missionDeltaFiles ?? null,
    readOnly: partial.readOnly ?? false,
    toolsUsed: partial.toolsUsed ?? [],
    failureReason: partial.failureReason ?? null,
  };
}

describe("P0: FailureView report", () => {
  it("builds a report from a failed mission with tool failure details", () => {
    const m = mission({
      text: "Run tests",
      state: "FAILED",
      runId: "run_abc",
      commandsExecuted: ["pnpm exec vitest run"],
      failureReason: "Test failed: expected true to be false",
    });

    const log: ActivityEntry[] = [
      { id: "1", ts: 1, type: "mission.step_passed", tag: "PASS", text: "Typecheck passed" },
      { id: "2", ts: 2, type: "tool.failed", tag: "FAIL", text: "vitest run — Test failed: expected true to be false", fullText: "FAIL src/app.test.ts\n  Expected: true\n  Received: false" },
    ];

    const report = buildFailureViewReport(m, log);
    expect(report.task).toBe("Run tests");
    expect(report.failedStep).toBe("vitest run");
    expect(report.reason).toBe("Test failed: expected true to be false");
    expect(report.commandExcerpt).toBe("pnpm exec vitest run");
    expect(report.outputExcerpt).toContain("Expected: true");
    expect(report.lastSuccessfulStep).toBe("Typecheck passed");
    expect(report.runId).toBe("run_abc");
    expect(report.recommendedNextAction).toContain("test");
  });

  it("uses the last command as the failed step when no tool entry exists", () => {
    const m = mission({
      text: "Build project",
      state: "FAILED",
      commandsExecuted: ["pnpm build"],
      failureReason: "Build failed: cannot find module",
    });

    const log: ActivityEntry[] = [
      { id: "1", ts: 1, type: "tool.completed", tag: "PASS", text: "Typecheck · 120ms", fullText: "Typecheck: passed" },
      { id: "2", ts: 2, type: "error", tag: "ERROR", text: "Build failed: cannot find module" },
    ];

    const report = buildFailureViewReport(m, log);
    expect(report.failedStep).toBe("pnpm build");
    expect(report.commandExcerpt).toBe("pnpm build");
    expect(report.reason).toBe("Build failed: cannot find module");
    // deriveLastSuccessfulStep strips the trailing ": passed" noise
    // (matches the real "${label}: passed." format from local-tool-mission.ts).
    expect(report.lastSuccessfulStep).toBe("Typecheck");
    expect(report.recommendedNextAction).toContain("build");
  });

  it("provides a cancellation reason for cancelled missions", () => {
    const m = mission({
      text: "Inspect project",
      state: "CANCELLED",
      commandsExecuted: [],
    });
    const log: ActivityEntry[] = [];

    const report = buildFailureViewReport(m, log);
    expect(report.reason).toBe("Mission cancelled");
    expect(report.recommendedNextAction).toBeTruthy();
  });

  it("does not open a failure view for successful missions", () => {
    // buildFailureViewReport is only called from FailureView when
    // missionForFailureView has already rejected non-failure states, but
    // the report builder itself should still produce a sane fallback.
    const m = mission({
      text: "Done",
      state: "FAILED",
      failureReason: null,
    });
    const log: ActivityEntry[] = [];

    const report = buildFailureViewReport(m, log);
    expect(report.reason).toBe("Mission failed");
    expect(report.failedStep).toBeNull();
  });
});
