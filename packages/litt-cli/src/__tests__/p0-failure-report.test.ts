/**
 * P0-4: Useful Failure Reporting — regression tests.
 *
 * Proves:
 *   - A failure report shows FAILED + Task + Reason + Last successful step + Next action.
 *   - The reason is the actual error, not blank.
 *   - deriveNextAction maps common patterns to actionable suggestions.
 *   - buildFailureReport produces a complete report.
 */
import { describe, it, expect } from "vitest";
import {
  formatFailureReport,
  deriveNextAction,
  buildFailureReport,
  type FailureReport,
} from "../lib/failure-report.js";

describe("P0-4: Useful Failure Reporting", () => {
  describe("formatFailureReport", () => {
    it("shows FAILED + Task + Reason + Last successful step + Next action", () => {
      const report: FailureReport = {
        task: "Fix the billing bug",
        reason: "TypeError: Cannot read property 'price' of undefined",
        lastSuccessfulStep: "Inspect billing module",
        recommendedNextAction: "Fix the type error, then rebuild: pnpm build",
        runId: "run_abc123",
        failedAt: Date.now(),
      };
      const text = formatFailureReport(report);
      expect(text).toContain("FAILED");
      expect(text).toContain("Task:");
      expect(text).toContain("Fix the billing bug");
      expect(text).toContain("Reason:");
      expect(text).toContain("TypeError: Cannot read property 'price' of undefined");
      expect(text).toContain("Last successful step:");
      expect(text).toContain("Inspect billing module");
      expect(text).toContain("Recommended next action:");
      expect(text).toContain("Fix the type error");
      expect(text).toContain("Run ID: run_abc123");
    });

    it("shows 'none' when there is no last successful step", () => {
      const report: FailureReport = {
        task: "Test task",
        reason: "Error",
        lastSuccessfulStep: null,
        recommendedNextAction: "Try again",
        runId: null,
        failedAt: Date.now(),
      };
      const text = formatFailureReport(report);
      expect(text).toContain("none");
      expect(text).not.toContain("Run ID:");
    });
  });

  describe("deriveNextAction", () => {
    it("suggests switching to ACT mode for PLAN_MODE_REJECTED", () => {
      const action = deriveNextAction("PLAN_MODE_REJECTED: cannot commit in plan mode");
      expect(action).toContain("ACT mode");
    });

    it("suggests increasing timeout for timeout errors", () => {
      const action = deriveNextAction("Command timed out after 30000ms");
      expect(action).toContain("timeout");
    });

    it("suggests checking permissions for EACCES", () => {
      const action = deriveNextAction("EACCES: permission denied");
      expect(action).toContain("permission");
    });

    it("suggests checking network for ECONNREFUSED", () => {
      const action = deriveNextAction("ECONNREFUSED: connection refused");
      expect(action).toContain("network");
    });

    it("suggests fixing type errors for type errors", () => {
      const action = deriveNextAction("TS2345: type error in argument");
      expect(action).toContain("type error");
    });

    it("suggests fixing build for build failures", () => {
      const action = deriveNextAction("Build failed: cannot find module");
      expect(action).toContain("build");
    });

    it("suggests fixing tests for test failures", () => {
      const action = deriveNextAction("Test failed: expected true to be false");
      expect(action).toContain("test");
    });

    it("suggests resolving conflicts for git conflicts", () => {
      const action = deriveNextAction("git: merge conflict in file.ts");
      expect(action).toContain("conflict");
    });

    it("provides a generic suggestion for unknown errors", () => {
      const action = deriveNextAction("Something weird happened");
      expect(action).toContain("run logs");
    });
  });

  describe("buildFailureReport", () => {
    it("builds a complete report from components", () => {
      const report = buildFailureReport(
        "Run audit",
        "ECONNREFUSED: cannot connect to Ollama",
        "Inspect project structure",
        "run_xyz",
      );
      expect(report.task).toBe("Run audit");
      expect(report.reason).toBe("ECONNREFUSED: cannot connect to Ollama");
      expect(report.lastSuccessfulStep).toBe("Inspect project structure");
      expect(report.runId).toBe("run_xyz");
      expect(report.recommendedNextAction).toContain("network");
    });

    it("handles null reason with a fallback", () => {
      const report = buildFailureReport("Task", "", null, null);
      expect(report.reason).toBe("Unknown error");
      expect(report.lastSuccessfulStep).toBe(null);
      expect(report.runId).toBe(null);
    });
  });
});
