import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ActionPlanner, ActionExecutor, verifyStepResult, verifyPlanCompletion } from "@/lib/litt-intelligence/action-loop";
import { toolRegistry, registerInternalTools } from "@/lib/litt-intelligence/tool-registry";
import type { LiTTActionPlan, LiTTActionStep } from "@/lib/litt-intelligence/types";

describe("LiTT Intelligence — Action Loop", () => {
  beforeEach(() => {
    toolRegistry.clear();
    registerInternalTools();
  });

  afterEach(() => {
    toolRegistry.clear();
  });

  // ─── ActionPlanner ────────────────────────────────────────────

  it("createPlan generates a plan with IDs and timestamps", () => {
    const planner = new ActionPlanner();
    const plan = planner.createPlan("user-a", "proj-a", "Deploy the app", [
      {
        toolId: "files.write",
        inputs: { path: "test.txt", content: "test" },
        expectedOutput: "File written",
        requiredCapability: "filesystem",
        risk: "high",
        rollbackAction: "Delete test.txt",
        verificationAction: "Read test.txt",
        dependencies: [],
        maxAttempts: 3,
      },
    ]);

    expect(plan.id).toMatch(/^plan-/);
    expect(plan.userId).toBe("user-a");
    expect(plan.projectId).toBe("proj-a");
    expect(plan.goal).toBe("Deploy the app");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].id).toMatch(/^step-/);
    expect(plan.steps[0].approvalStatus).toBe("pending");
    expect(plan.createdAt).toBeTruthy();
  });

  it("createPlan marks low-risk steps as not_required for approval", () => {
    const planner = new ActionPlanner();
    const plan = planner.createPlan("user-a", "proj-a", "Read a file", [
      {
        toolId: "files.read",
        inputs: { path: "test.txt" },
        expectedOutput: "File content",
        requiredCapability: "filesystem",
        risk: "low",
        rollbackAction: "none",
        verificationAction: "none",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    expect(plan.steps[0].approvalStatus).toBe("not_required");
  });

  it("createPlan calculates plan risk from steps", () => {
    const planner = new ActionPlanner();
    const plan = planner.createPlan("user-a", "proj-a", "Complex task", [
      {
        toolId: "files.read",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "filesystem",
        risk: "low",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
      {
        toolId: "files.write",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "filesystem",
        risk: "high",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    expect(plan.risk).toBe("high");
    expect(plan.approvalRequired).toBe(true);
  });

  it("createPlan records assumptions", () => {
    const planner = new ActionPlanner();
    const plan = planner.createPlan(
      "user-a",
      "proj-a",
      "Test",
      [],
      [{ text: "The file exists", confidence: 0.8, verificationRequired: true }],
    );

    expect(plan.assumptions).toHaveLength(1);
    expect(plan.assumptions[0].id).toMatch(/^assume-/);
    expect(plan.assumptions[0].text).toBe("The file exists");
  });

  it("createPlan sets initial phase to plan", () => {
    const planner = new ActionPlanner();
    const plan = planner.createPlan("user-a", "proj-a", "Test", []);
    expect(plan.phase).toBe("plan");
  });

  // ─── ActionExecutor ───────────────────────────────────────────

  it("execute pauses at awaiting_approval when approval required but not given", async () => {
    const planner = new ActionPlanner();
    const executor = new ActionExecutor();

    const plan = planner.createPlan("user-a", "proj-a", "Write file", [
      {
        toolId: "files.write",
        inputs: { projectId: "p1", path: "test.txt", content: "test" },
        expectedOutput: "File written",
        requiredCapability: "filesystem",
        risk: "high",
        rollbackAction: "Delete file",
        verificationAction: "Read file",
        dependencies: [],
        maxAttempts: 3,
      },
    ]);

    const result = await executor.execute(plan, { hasApproval: false });

    expect(result.plan.phase).toBe("awaiting_approval");
    expect(result.events).toHaveLength(1);
    expect(result.events[0].phase).toBe("awaiting_approval");
  });

  it("execute proceeds when approval is given", async () => {
    const planner = new ActionPlanner();
    const executor = new ActionExecutor();

    // Register a handler for files.write
    toolRegistry.register(
      {
        id: "files.write",
        name: "Write File",
        description: "Write a file",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: ["filesystem"],
        requiredPermissions: ["files:write"],
        risk: "high",
        permissionLevel: "workspace-write",
        approvalPolicy: { required: true, autoApproveReadOnly: false, requireExplicitForMutations: true, neverAllow: false },
        timeoutMs: 5000,
        idempotent: false,
        readOnly: false,
        enabled: true,
      },
      async (_inputs) => ({ success: true }),
    );

    const plan = planner.createPlan("user-a", "proj-a", "Write file", [
      {
        toolId: "files.write",
        inputs: { projectId: "p1", path: "test.txt", content: "test" },
        expectedOutput: "File written",
        requiredCapability: "filesystem",
        risk: "high",
        rollbackAction: "Delete file",
        verificationAction: "Read file",
        dependencies: [],
        maxAttempts: 3,
      },
    ]);

    const result = await executor.execute(plan, {
      hasApproval: true,
      availableCapabilities: ["filesystem"],
    });

    expect(result.plan.phase).toBe("completed");
    expect(result.plan.steps[0].actualStatus).toBe("success");
  });

  it("execute handles step failures", async () => {
    const planner = new ActionPlanner();
    const executor = new ActionExecutor();

    // Register a handler that fails
    toolRegistry.register(
      {
        id: "test.failing",
        name: "Failing Tool",
        description: "Always fails",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: [],
        risk: "low",
        permissionLevel: "read",
        approvalPolicy: { required: false, autoApproveReadOnly: true, requireExplicitForMutations: false, neverAllow: false },
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        enabled: true,
      },
      async (_inputs) => { throw new Error("Intentional failure"); },
    );

    const plan = planner.createPlan("user-a", "proj-a", "Test failure", [
      {
        toolId: "test.failing",
        inputs: {},
        expectedOutput: "Should not reach",
        requiredCapability: "",
        risk: "low",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    const result = await executor.execute(plan, {});

    expect(result.plan.steps[0].actualStatus).toBe("failed");
    expect(result.plan.phase).toBe("failed");
  });

  it("execute respects step dependencies", async () => {
    const planner = new ActionPlanner();
    const executor = new ActionExecutor();

    const callOrder: string[] = [];

    toolRegistry.register(
      {
        id: "test.step_a",
        name: "Step A",
        description: "First step",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: [],
        risk: "low",
        permissionLevel: "read",
        approvalPolicy: { required: false, autoApproveReadOnly: true, requireExplicitForMutations: false, neverAllow: false },
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        enabled: true,
      },
      async (_inputs) => { callOrder.push("a"); return { ok: true }; },
    );

    toolRegistry.register(
      {
        id: "test.step_b",
        name: "Step B",
        description: "Second step, depends on A",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: [],
        risk: "low",
        permissionLevel: "read",
        approvalPolicy: { required: false, autoApproveReadOnly: true, requireExplicitForMutations: false, neverAllow: false },
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        enabled: true,
      },
      async (_inputs) => { callOrder.push("b"); return { ok: true }; },
    );

    const plan = planner.createPlan("user-a", "proj-a", "Dependency test", [
      {
        toolId: "test.step_b",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "low",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [], // Will be set below
        maxAttempts: 1,
      },
      {
        toolId: "test.step_a",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "low",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    // Set step B to depend on step A
    plan.steps[0].dependencies = [plan.steps[1].id];

    const result = await executor.execute(plan, {});

    expect(result.plan.phase).toBe("completed");
    expect(callOrder).toEqual(["a", "b"]);
  });

  it("execute emits events via onEvent listener", async () => {
    const planner = new ActionPlanner();
    const executor = new ActionExecutor();
    const events: string[] = [];

    executor.onEvent((event) => {
      events.push(event.stepId);
    });

    toolRegistry.register(
      {
        id: "test.simple",
        name: "Simple",
        description: "Simple tool",
        source: "internal",
        version: "1.0.0",
        inputSchema: { type: "object", properties: {}, required: [] },
        outputSchema: { type: "object" },
        requiredCapabilities: [],
        requiredPermissions: [],
        risk: "low",
        permissionLevel: "read",
        approvalPolicy: { required: false, autoApproveReadOnly: true, requireExplicitForMutations: false, neverAllow: false },
        timeoutMs: 5000,
        idempotent: true,
        readOnly: true,
        enabled: true,
      },
      async (_inputs) => ({ done: true }),
    );

    const plan = planner.createPlan("user-a", "proj-a", "Test", [
      {
        toolId: "test.simple",
        inputs: {},
        expectedOutput: "",
        requiredCapability: "",
        risk: "low",
        rollbackAction: "",
        verificationAction: "",
        dependencies: [],
        maxAttempts: 1,
      },
    ]);

    await executor.execute(plan, {});

    expect(events.length).toBeGreaterThan(0);
  });

  // ─── Verification ─────────────────────────────────────────────

  it("verifyStepResult returns false for non-success status", () => {
    const step: LiTTActionStep = {
      id: "step-1",
      toolId: "test",
      inputs: {},
      expectedOutput: "test",
      requiredCapability: "",
      risk: "low",
      approvalStatus: "not_required",
      rollbackAction: "",
      verificationAction: "",
      dependencies: [],
      maxAttempts: 1,
      actualStatus: "failed",
    };

    const result = verifyStepResult(step);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("failed");
  });

  it("verifyStepResult returns false when no output recorded", () => {
    const step: LiTTActionStep = {
      id: "step-1",
      toolId: "test",
      inputs: {},
      expectedOutput: "test",
      requiredCapability: "",
      risk: "low",
      approvalStatus: "not_required",
      rollbackAction: "",
      verificationAction: "",
      dependencies: [],
      maxAttempts: 1,
      actualStatus: "success",
    };

    const result = verifyStepResult(step);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("No output");
  });

  it("verifyStepResult returns true for successful step with output", () => {
    const step: LiTTActionStep = {
      id: "step-1",
      toolId: "test",
      inputs: {},
      expectedOutput: "test",
      requiredCapability: "",
      risk: "low",
      approvalStatus: "not_required",
      rollbackAction: "",
      verificationAction: "",
      dependencies: [],
      maxAttempts: 1,
      actualStatus: "success",
      actualOutput: '{"result": "ok"}',
    };

    const result = verifyStepResult(step);
    expect(result.verified).toBe(true);
  });

  it("verifyStepResult checks output against expected pattern", () => {
    const step: LiTTActionStep = {
      id: "step-1",
      toolId: "test",
      inputs: {},
      expectedOutput: "test",
      requiredCapability: "",
      risk: "low",
      approvalStatus: "not_required",
      rollbackAction: "",
      verificationAction: "",
      dependencies: [],
      maxAttempts: 1,
      actualStatus: "success",
      actualOutput: '{"url": "https://example.com"}',
    };

    const result = verifyStepResult(step, /https?:\/\/.+/);
    expect(result.verified).toBe(true);
  });

  it("verifyStepResult returns false when pattern doesn't match", () => {
    const step: LiTTActionStep = {
      id: "step-1",
      toolId: "test",
      inputs: {},
      expectedOutput: "test",
      requiredCapability: "",
      risk: "low",
      approvalStatus: "not_required",
      rollbackAction: "",
      verificationAction: "",
      dependencies: [],
      maxAttempts: 1,
      actualStatus: "success",
      actualOutput: "no url here",
    };

    const result = verifyStepResult(step, /https?:\/\/.+/);
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("pattern");
  });

  it("verifyPlanCompletion returns true when all steps succeed", () => {
    const plan: LiTTActionPlan = {
      id: "plan-1",
      userId: "user-a",
      projectId: "proj-a",
      goal: "Test",
      assumptions: [],
      steps: [
        { id: "s1", toolId: "t", inputs: {}, expectedOutput: "", requiredCapability: "", risk: "low", approvalStatus: "not_required", rollbackAction: "", verificationAction: "", dependencies: [], maxAttempts: 1, actualStatus: "success", actualOutput: "{}" },
        { id: "s2", toolId: "t", inputs: {}, expectedOutput: "", requiredCapability: "", risk: "low", approvalStatus: "not_required", rollbackAction: "", verificationAction: "", dependencies: [], maxAttempts: 1, actualStatus: "success", actualOutput: "{}" },
      ],
      risk: "low",
      approvalRequired: false,
      createdAt: new Date().toISOString(),
      phase: "completed",
    };

    const result = verifyPlanCompletion(plan);
    expect(result.verified).toBe(true);
    expect(result.completedSteps).toBe(2);
    expect(result.failedSteps).toBe(0);
  });

  it("verifyPlanCompletion returns false when steps failed", () => {
    const plan: LiTTActionPlan = {
      id: "plan-1",
      userId: "user-a",
      projectId: "proj-a",
      goal: "Test",
      assumptions: [],
      steps: [
        { id: "s1", toolId: "t", inputs: {}, expectedOutput: "", requiredCapability: "", risk: "low", approvalStatus: "not_required", rollbackAction: "", verificationAction: "", dependencies: [], maxAttempts: 1, actualStatus: "success", actualOutput: "{}" },
        { id: "s2", toolId: "t", inputs: {}, expectedOutput: "", requiredCapability: "", risk: "low", approvalStatus: "not_required", rollbackAction: "", verificationAction: "", dependencies: [], maxAttempts: 1, actualStatus: "failed" },
      ],
      risk: "low",
      approvalRequired: false,
      createdAt: new Date().toISOString(),
      phase: "failed",
    };

    const result = verifyPlanCompletion(plan);
    expect(result.verified).toBe(false);
    expect(result.failedSteps).toBe(1);
    expect(result.reason).toContain("failed");
  });

  it("verifyPlanCompletion returns false when steps are pending", () => {
    const plan: LiTTActionPlan = {
      id: "plan-1",
      userId: "user-a",
      projectId: "proj-a",
      goal: "Test",
      assumptions: [],
      steps: [
        { id: "s1", toolId: "t", inputs: {}, expectedOutput: "", requiredCapability: "", risk: "low", approvalStatus: "not_required", rollbackAction: "", verificationAction: "", dependencies: [], maxAttempts: 1, actualStatus: "success", actualOutput: "{}" },
        { id: "s2", toolId: "t", inputs: {}, expectedOutput: "", requiredCapability: "", risk: "low", approvalStatus: "not_required", rollbackAction: "", verificationAction: "", dependencies: [], maxAttempts: 1 },
      ],
      risk: "low",
      approvalRequired: false,
      createdAt: new Date().toISOString(),
      phase: "executing",
    };

    const result = verifyPlanCompletion(plan);
    expect(result.verified).toBe(false);
    expect(result.pendingSteps).toBe(1);
    expect(result.reason).toContain("pending");
  });
});
