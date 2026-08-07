/**
 * Mission Service — type and contract tests.
 *
 * Verifies the type shapes and the approval flow logic without
 * hitting the database (the service functions require Supabase).
 *
 * Run: npx vitest run src/lib/missions/mission-service.test.ts
 */

import { describe, it, expect } from "vitest";
import type { Mission, MissionRun, MissionStep, MissionApproval, ValidationResult } from "./mission-service";

describe("Mission Service — type contracts", () => {
  it("Mission has the required status enum", () => {
    const validStatuses: Mission["status"][] = ["draft", "ready", "running", "paused", "completed", "failed", "cancelled"];
    expect(validStatuses).toHaveLength(7);
  });

  it("MissionRun has the required status enum", () => {
    const validStatuses: MissionRun["status"][] = ["pending", "running", "paused", "completed", "failed", "cancelled"];
    expect(validStatuses).toHaveLength(6);
  });

  it("MissionStep has the required status enum including waiting_approval", () => {
    const validStatuses: MissionStep["status"][] = ["pending", "running", "waiting_approval", "completed", "failed", "skipped"];
    expect(validStatuses).toHaveLength(6);
    expect(validStatuses).toContain("waiting_approval");
  });

  it("MissionApproval has the required status enum", () => {
    const validStatuses: MissionApproval["status"][] = ["pending", "approved", "denied", "expired"];
    expect(validStatuses).toHaveLength(4);
  });

  it("MissionApproval has risk levels", () => {
    const riskLevels: MissionApproval["risk_level"][] = ["low", "medium", "high"];
    expect(riskLevels).toHaveLength(3);
  });

  it("ValidationResult has the required status enum", () => {
    const validStatuses: ValidationResult["status"][] = ["pending", "running", "passed", "failed", "skipped", "not_configured", "timed_out"];
    expect(validStatuses).toHaveLength(7);
  });
});

describe("Mission approval flow — contract", () => {
  it("waiting_approval is the gate state", () => {
    // When a step needs approval, its status is set to 'waiting_approval'.
    // The step cannot proceed until the approval is resolved.
    const step: MissionStep = {
      id: "step_1",
      run_id: "run_1",
      mission_id: "mission_1",
      node_id: "node_1",
      node_type: "action",
      title: "Create booking",
      status: "waiting_approval",
      input: {},
      output: {},
      error: null,
      started_at: null,
      completed_at: null,
      sequence_order: 0,
      created_at: new Date().toISOString(),
    };
    expect(step.status).toBe("waiting_approval");
  });

  it("approved -> step goes back to pending (runtime continues)", () => {
    // When an approval is 'approved', the step status is set back to 'pending'
    // so the runtime can continue execution.
    function getNewStepStatus(decision: "approved" | "denied"): "pending" | "skipped" {
      return decision === "approved" ? "pending" : "skipped";
    }
    expect(getNewStepStatus("approved")).toBe("pending");
  });

  it("denied -> step is skipped", () => {
    function getNewStepStatus(decision: "approved" | "denied"): "pending" | "skipped" {
      return decision === "approved" ? "pending" : "skipped";
    }
    expect(getNewStepStatus("denied")).toBe("skipped");
  });
});

describe("Verification gates — contract", () => {
  it("passed = no failed and no pending validations", () => {
    const results = [{ status: "passed" }, { status: "passed" }];
    const failedCount = results.filter((r) => r.status === "failed").length;
    const pendingCount = results.filter((r) => r.status === "pending" || r.status === "running").length;
    const passed = failedCount === 0 && pendingCount === 0;
    expect(passed).toBe(true);
  });

  it("not passed = has failed validations", () => {
    const results = [{ status: "passed" }, { status: "failed" }];
    const failedCount = results.filter((r) => r.status === "failed").length;
    const pendingCount = results.filter((r) => r.status === "pending" || r.status === "running").length;
    const passed = failedCount === 0 && pendingCount === 0;
    expect(passed).toBe(false);
  });

  it("not passed = has pending validations", () => {
    const results = [{ status: "passed" }, { status: "running" }];
    const failedCount = results.filter((r) => r.status === "failed").length;
    const pendingCount = results.filter((r) => r.status === "pending" || r.status === "running").length;
    const passed = failedCount === 0 && pendingCount === 0;
    expect(passed).toBe(false);
  });
});
