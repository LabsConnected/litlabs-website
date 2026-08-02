import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ApprovalManager } from "@/lib/litt-intelligence/approval-system";
import type { LiTTActionPlan } from "@/lib/litt-intelligence/types";
import { ActionPlanner } from "@/lib/litt-intelligence/action-loop";

describe("LiTT Intelligence — Approval System", () => {
  let manager: ApprovalManager;
  let planner: ActionPlanner;

  beforeEach(() => {
    manager = new ApprovalManager({ approvalTimeoutMs: 1000 });
    planner = new ActionPlanner();
  });

  afterEach(() => {
    manager.clear();
  });

  // ─── Approval requests ────────────────────────────────────────

  it("requestApproval creates a pending approval request", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Write file", [
      {
        toolId: "files.write",
        inputs: { path: "test.txt", content: "test" },
        expectedOutput: "File written",
        requiredCapability: "filesystem",
        risk: "high",
        rollbackAction: "Delete file",
        verificationAction: "Read file",
        dependencies: [],
        maxAttempts: 3,
      },
    ]);

    const request = manager.requestApproval(plan);

    expect(request.id).toMatch(/^approval-/);
    expect(request.planId).toBe(plan.id);
    expect(request.userId).toBe("user-a");
    expect(request.projectId).toBe("proj-a");
    expect(request.status).toBe("pending");
    expect(request.goal).toBe("Write file");
    expect(request.steps).toHaveLength(1);
    expect(request.risk).toBe("high");
  });

  it("requestApproval includes step details", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Deploy", [
      {
        toolId: "files.write",
        inputs: { path: "config.json", content: "{}" },
        expectedOutput: "Config written",
        requiredCapability: "filesystem",
        risk: "high",
        rollbackAction: "Revert config",
        verificationAction: "Read config",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);

    expect(request.steps[0].toolId).toBe("files.write");
    expect(request.steps[0].risk).toBe("high");
    expect(request.steps[0].inputsSummary).toContain("path=config.json");
  });

  it("requestApproval sets expiry time", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);

    expect(request.expiresAt).toBeTruthy();
    expect(Date.parse(request.expiresAt)).toBeGreaterThan(Date.now());
  });

  // ─── Approve / Deny ───────────────────────────────────────────

  it("approve sets status to approved", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);
    const approved = manager.approve(request.id, "user-a");

    expect(approved).not.toBeNull();
    expect(approved!.status).toBe("approved");
    expect(approved!.decidedBy).toBe("user-a");
    expect(approved!.decidedAt).toBeTruthy();
  });

  it("deny sets status to denied", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);
    const denied = manager.deny(request.id, "user-a");

    expect(denied).not.toBeNull();
    expect(denied!.status).toBe("denied");
  });

  it("approve returns null for non-pending request", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);
    manager.approve(request.id, "user-a");
    const secondApprove = manager.approve(request.id, "user-a");

    expect(secondApprove).toBeNull();
  });

  it("approve returns null for unknown request", () => {
    const result = manager.approve("nonexistent", "user-a");
    expect(result).toBeNull();
  });

  it("isApproved returns true for approved request", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);
    manager.approve(request.id, "user-a");

    expect(manager.isApproved(request.id)).toBe(true);
  });

  it("isApproved returns false for pending request", () => {
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);
    expect(manager.isApproved(request.id)).toBe(false);
  });

  // ─── Expiry ───────────────────────────────────────────────────

  it("expired requests cannot be approved", async () => {
    const managerShortTimeout = new ApprovalManager({ approvalTimeoutMs: 50 });
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = managerShortTimeout.requestApproval(plan);

    // Wait for expiry
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = managerShortTimeout.approve(request.id, "user-a");
    expect(result).toBeNull();
  });

  it("expireOldRequests marks expired requests", async () => {
    const managerShortTimeout = new ApprovalManager({ approvalTimeoutMs: 50 });
    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = managerShortTimeout.requestApproval(plan);

    await new Promise((resolve) => setTimeout(resolve, 100));

    managerShortTimeout.expireOldRequests();

    const updated = managerShortTimeout.getRequest(request.id);
    expect(updated!.status).toBe("expired");
  });

  // ─── List pending ─────────────────────────────────────────────

  it("listPending returns only pending requests for a user", () => {
    const plan1 = planner.createPlan("user-a", "proj-a", "Task 1", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);
    const plan2 = planner.createPlan("user-b", "proj-b", "Task 2", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    manager.requestApproval(plan1);
    manager.requestApproval(plan2);

    const pending = manager.listPending("user-a");
    expect(pending).toHaveLength(1);
    expect(pending[0].userId).toBe("user-a");
  });

  // ─── Never-allowed ────────────────────────────────────────────

  it("isNeverAllowed returns true for terminal.execute", () => {
    expect(manager.isNeverAllowed("terminal.execute")).toBe(true);
  });

  it("isNeverAllowed returns true for secrets.read", () => {
    expect(manager.isNeverAllowed("secrets.read")).toBe(true);
  });

  it("isNeverAllowed returns true for security.disable", () => {
    expect(manager.isNeverAllowed("security.disable")).toBe(true);
  });

  it("isNeverAllowed returns true for cross_user.access", () => {
    expect(manager.isNeverAllowed("cross_user.access")).toBe(true);
  });

  it("isNeverAllowed returns true for mcp.install_arbitrary", () => {
    expect(manager.isNeverAllowed("mcp.install_arbitrary")).toBe(true);
  });

  it("isNeverAllowed returns false for normal tools", () => {
    expect(manager.isNeverAllowed("files.read")).toBe(false);
    expect(manager.isNeverAllowed("web.search")).toBe(false);
  });

  // ─── Permission checks ────────────────────────────────────────

  it("checkPermissions blocks never-allowed actions", () => {
    const result = manager.checkPermissions(
      "terminal.execute",
      ["terminal:execute"],
      ["pty"],
      {
        userId: "user-a",
        projectId: "proj-a",
        permissions: new Set(["terminal:execute"]),
        availableCapabilities: ["pty"],
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("never allowed");
  });

  it("checkPermissions blocks missing permissions", () => {
    const result = manager.checkPermissions(
      "files.write",
      ["files:write"],
      ["filesystem"],
      {
        userId: "user-a",
        projectId: "proj-a",
        permissions: new Set(),
        availableCapabilities: ["filesystem"],
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.missingPermissions).toContain("files:write");
  });

  it("checkPermissions blocks missing capabilities", () => {
    const result = manager.checkPermissions(
      "web.search",
      ["web:search"],
      ["web_search"],
      {
        userId: "user-a",
        projectId: "proj-a",
        permissions: new Set(["web:search"]),
        availableCapabilities: [],
      },
    );

    expect(result.allowed).toBe(false);
    expect(result.missingCapabilities).toContain("web_search");
  });

  it("checkPermissions passes when all checks pass", () => {
    const result = manager.checkPermissions(
      "files.read",
      ["files:read"],
      ["filesystem"],
      {
        userId: "user-a",
        projectId: "proj-a",
        permissions: new Set(["files:read"]),
        availableCapabilities: ["filesystem"],
      },
    );

    expect(result.allowed).toBe(true);
  });

  // ─── Approval requirement ─────────────────────────────────────

  it("requiresApproval returns false for low risk", () => {
    expect(manager.requiresApproval("low")).toBe(false);
  });

  it("requiresApproval returns false for medium risk", () => {
    expect(manager.requiresApproval("medium")).toBe(false);
  });

  it("requiresApproval returns true for high risk", () => {
    expect(manager.requiresApproval("high")).toBe(true);
  });

  it("requiresApproval returns true for critical risk", () => {
    expect(manager.requiresApproval("critical")).toBe(true);
  });

  // ─── Event listener ───────────────────────────────────────────

  it("onRequest fires when a new approval request is created", () => {
    const events: string[] = [];
    manager.onRequest((request) => {
      events.push(request.id);
    });

    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const request = manager.requestApproval(plan);
    expect(events).toContain(request.id);
  });
});
