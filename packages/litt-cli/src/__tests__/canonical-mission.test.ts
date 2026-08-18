/**
 * Live acceptance proof — exercises the full mission lifecycle
 * without requiring a TTY/Ink cockpit.
 *
 * This test proves the P0 criteria:
 *   P0A: 0 duplicate RUN events (exactly-once)
 *   P0B: semantic steps advance through >= 3 distinct steps
 *   P0C: tool/action history is truthful (pending → success/failed)
 *   P0D: COMPLETE requires all steps passed + verification proven
 *   P0E: verification failure triggers repair/revalidation
 *   P0F: restart/checkpoint recovery restores the mission
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  RuntimeStore,
  runAgentLoop,
  planMission,
  resolveStepForTool,
  attachToolToStep,
  updateToolResultOnStep,
  progressMissionStepAfterTool,
  toolToEvidenceType,
  isStepEvidenceSatisfied,
  createShellExecutor,
  createDefaultRegistry,
  ExecutionGateway,
  VerificationGate,
  type RuntimeEvent,
  type ToolResult,
  type ChatMessage,
  type ModelProvider,
  type ModelStreamEvent,
} from "@litt/agent-core";

function createTempDir(): string {
  const tmp = path.join(os.tmpdir(), `litt-live-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function cleanupTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
}

/** Mock model that follows a scripted sequence of tool calls. */
function createScriptedModel(responses: string[]): ModelProvider {
  let callIdx = 0;
  return {
    stream: async (
      _messages: ChatMessage[],
      onEvent: (event: ModelStreamEvent) => void,
    ) => {
      const response = responses[callIdx++] ?? "Done.";
      onEvent({ type: "delta", text: response });
      onEvent({
        type: "done",
        model: "test-model",
        usage: { total_tokens: response.length },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
      });
    },
  };
}

describe("LIVE ACCEPTANCE: Full mission lifecycle", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = createTempDir();
    // Create a minimal package.json so project detection works
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      name: "test-project",
      version: "1.0.0",
      scripts: { test: "echo test-pass", build: "echo build-pass" },
    }));
  });

  afterAll(() => cleanupTempDir(tmpDir));

  // ─── P0A: Exactly-once event lifecycle ──────────────────────────

  it("P0A: agent tool produces exactly 1 RUN + 1 result (no duplicates)", async () => {
    const shell = createShellExecutor(tmpDir);
    const store = new RuntimeStore({ projectRoot: tmpDir });
    const tools = createDefaultRegistry();
    const model = createScriptedModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Done.",
    ]);

    const events: { type: string; subtype?: string; runId?: string }[] = [];
    const result = await runAgentLoop("Check status", {
      model, tools, shell, store, cwd: tmpDir,
      emitter: (event: RuntimeEvent) => {
        events.push({ type: event.type, subtype: event.subtype, runId: event.runId });
      },
    });

    // Count agent_tool_call and agent_tool_result events
    const toolCalls = events.filter((e) => e.subtype === "agent_tool_call");
    const toolResults = events.filter((e) => e.subtype === "agent_tool_result");

    expect(toolCalls.length).toBe(1); // exactly 1 RUN
    expect(toolResults.length).toBe(1); // exactly 1 result
    expect(result.toolCalls.length).toBe(1);
  });

  // ─── P0B: Semantic mission progression ──────────────────────────

  it("P0B: semantic steps advance through >= 3 distinct steps", async () => {
    const stepStatuses: string[] = [];
    const store = new RuntimeStore({
      projectRoot: tmpDir,
      emitter: (event: RuntimeEvent) => {
        if (event.subtype === "mission:step_passed") {
          stepStatuses.push("passed");
        }
        if (event.subtype === "mission:step_started") {
          stepStatuses.push("working");
        }
      },
    });
    await store.createMission({ goal: "stabilize and verify", mode: "act", projectRoot: tmpDir });

    // Plan with fallback (no model needed)
    const { steps } = await planMission({
      model: createScriptedModel(["[]"]), // force fallback
      store,
      goal: "stabilize and verify",
    });

    expect(steps.length).toBeGreaterThanOrEqual(4);

    // Mission transitions to "working" when setCurrentStep is called
    // Start the first step
    await store.setCurrentStep(steps[0].id);

    // Simulate tool results that satisfy each step's required evidence
    // Step 1: Inspect (repository_status)
    await store.addMissionEvidence({
      stepId: steps[0].id,
      type: "repository_status",
      source: "project.status",
      summary: "clean tree",
      success: true,
    });
    await progressMissionStepAfterTool(store, { success: true, toolId: "project.status" });

    // Step 2: Typecheck (typecheck_result)
    await store.addMissionEvidence({
      stepId: steps[1].id,
      type: "typecheck_result",
      source: "project.typecheck",
      summary: "typecheck passed",
      success: true,
    });
    await progressMissionStepAfterTool(store, { success: true, toolId: "project.typecheck" });

    // Step 3: Test (test_result)
    await store.addMissionEvidence({
      stepId: steps[2].id,
      type: "test_result",
      source: "project.test",
      summary: "tests passed",
      success: true,
    });
    await progressMissionStepAfterTool(store, { success: true, toolId: "project.test" });

    // At least 3 steps should have advanced
    const mission = store.getMission();
    const passedSteps = mission!.steps.filter((s) => s.status === "passed");
    expect(passedSteps.length).toBeGreaterThanOrEqual(3);

    // The step transitions should show progression
    expect(stepStatuses.length).toBeGreaterThanOrEqual(6); // 3 passed + 3 working
  });

  // ─── P0C: Truthful tool/action history ──────────────────────────

  it("P0C: tool history records pending → success truthfully", async () => {
    const store = new RuntimeStore({ projectRoot: tmpDir });
    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    const step = await store.addMissionStep({ title: "Test step" });

    // Attach tool call — status is pending
    await attachToolToStep(store, step!.id, {
      toolId: "project.test",
      toolName: "test",
      toolCallId: "tc_truth_1",
      toolRunId: "agent_tc_truth_1",
    });

    let mission = store.getMission();
    let record = mission!.steps[0].actionHistory[0];
    expect(record.status).toBe("pending");
    expect(record.toolCallId).toBe("tc_truth_1");
    expect(record.toolRunId).toBe("agent_tc_truth_1");
    expect(record.startedAt).toBeDefined();

    // Update with success
    await updateToolResultOnStep(store, step!.id, "tc_truth_1", {
      success: true,
      message: "Tests passed",
    });

    mission = store.getMission();
    record = mission!.steps[0].actionHistory[0];
    expect(record.status).toBe("success");
    expect(record.completedAt).toBeDefined();
    expect(record.result?.success).toBe(true);
  });

  it("P0C: a failed tool stays failed in history", async () => {
    const store = new RuntimeStore({ projectRoot: tmpDir });
    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    const step = await store.addMissionStep({ title: "Test step" });

    await attachToolToStep(store, step!.id, {
      toolId: "project.test",
      toolName: "test",
      toolCallId: "tc_truth_2",
    });

    // Record failure
    await updateToolResultOnStep(store, step!.id, "tc_truth_2", {
      success: false,
      message: "Tests failed",
    });

    // Try to update with success — should NOT change
    await updateToolResultOnStep(store, step!.id, "tc_truth_2", {
      success: true,
      message: "Tests passed",
    });

    const mission = store.getMission();
    const record = mission!.steps[0].actionHistory[0];
    expect(record.status).toBe("failed");
    expect(record.result?.success).toBe(false);
  });

  // ─── P0D: Truthful COMPLETE contract ────────────────────────────

  it("P0D: completeMission refuses when steps are not all passed", async () => {
    const store = new RuntimeStore({ projectRoot: tmpDir });
    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    await store.addMissionStep({ title: "Step 1", requiredEvidence: ["test_result"] });
    await store.addMissionStep({ title: "Step 2", requiredEvidence: ["build_result"] });

    // Try to complete without any steps passed
    await store.completeMission("claimed done", "verification passed");

    const mission = store.getMission();
    expect(mission!.status).not.toBe("complete");
  });

  it("P0D: completeMission succeeds when all steps are passed", async () => {
    const store = new RuntimeStore({ projectRoot: tmpDir });
    await store.createMission({ goal: "test", mode: "act", projectRoot: tmpDir });
    const s1 = await store.addMissionStep({ title: "Step 1" });
    const s2 = await store.addMissionStep({ title: "Step 2" });

    // setCurrentStep transitions the mission to "working"
    await store.setCurrentStep(s1!.id);
    await store.updateMissionStepStatus(s1!.id, "passed");
    await store.setCurrentStep(s2!.id);
    await store.updateMissionStepStatus(s2!.id, "passed");

    // Mission must go through "verifying" → "complete"
    await store.setMissionVerifying();
    await store.completeMission("all steps passed + verified", "gate proven");

    const mission = store.getMission();
    expect(mission!.status).toBe("complete");
  });

  // ─── P0E: Repair/revalidation ───────────────────────────────────

  it("P0E: agent loop with gate feeds failures back for repair", async () => {
    const shell = createShellExecutor(tmpDir);
    const store = new RuntimeStore({ projectRoot: tmpDir });
    const tools = createDefaultRegistry();

    // Model that calls a tool, then says done, then says done again
    // (simulating repair attempt)
    const model = createScriptedModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "I checked the project. Done.",
      "I verified everything is fixed. Done.",
    ]);

    // Gate that fails first time, passes second time
    let gateCallCount = 0;
    const gate: VerificationGate = {
      verify: async () => {
        gateCallCount++;
        if (gateCallCount === 1) {
          return {
            proven: false,
            message: "Tests failed",
            ranChecks: ["test"],
            skippedChecks: [],
            totalDurationMs: 100,
            runId: "verify_1",
            checks: [{
              id: "test",
              status: "failed" as const,
              exitCode: 1,
              message: "Tests failed",
              stdout: "",
              stderr: "test failure",
              durationMs: 100,
            }],
          };
        }
        return {
          proven: true,
          message: "All checks passed",
          ranChecks: ["test"],
          skippedChecks: [],
          totalDurationMs: 100,
          runId: "verify_2",
          checks: [{
            id: "test",
            status: "success" as const,
            exitCode: 0,
            message: "Tests passed",
            stdout: "",
            stderr: "",
            durationMs: 100,
          }],
        };
      },
    } as any;

    const repairEvents: string[] = [];
    const result = await runAgentLoop("Test and verify", {
      model, tools, shell, store, cwd: tmpDir,
      verificationGate: gate,
      maxRounds: 10,
      emitter: (event: RuntimeEvent) => {
        if (event.subtype === "verification_failed_repair") {
          repairEvents.push("repair_requested");
        }
      },
    });

    // The gate should have been called at least twice (fail then pass)
    expect(gateCallCount).toBeGreaterThanOrEqual(2);
    // The repair event should have been emitted
    expect(repairEvents.length).toBeGreaterThanOrEqual(1);
    // The loop should have terminated with "complete" (gate proved)
    expect(result.termination).toBe("complete");
    expect(result.verification?.proven).toBe(true);
  });

  // ─── P0F: Restart/checkpoint recovery ───────────────────────────

  it("P0F: loadWithRecovery restores a non-terminal mission", async () => {
    const store1 = new RuntimeStore({ projectRoot: tmpDir });
    await store1.createMission({ goal: "restart test", mode: "act", projectRoot: tmpDir });
    await store1.addMissionStep({ title: "Step 1" });
    await store1.setCurrentStep(store1.getMission()!.steps[0].id);

    // The mission is now "working" — persist it
    await store1.persistMissionNow();

    // Create a new store (simulating restart) and load
    const store2 = new RuntimeStore({ projectRoot: tmpDir });
    const result = await store2.loadWithRecovery();

    expect(result.recovered).toBe(true);
    expect(result.mission).not.toBeNull();
    expect(result.mission!.goal).toBe("restart test");
    expect(result.mission!.status).toBe("working");
  });

  it("P0F: terminal missions are NOT restored", async () => {
    const store1 = new RuntimeStore({ projectRoot: tmpDir });
    await store1.createMission({ goal: "completed test", mode: "act", projectRoot: tmpDir });
    const step = await store1.addMissionStep({ title: "Step 1" });
    // setCurrentStep transitions mission to "working"
    await store1.setCurrentStep(step!.id);
    await store1.updateMissionStepStatus(step!.id, "passed");
    // Mission must go through "verifying" → "complete"
    await store1.setMissionVerifying();
    await store1.completeMission("done", "verified");

    await store1.persistMissionNow();

    // Create a new store and try to load
    const store2 = new RuntimeStore({ projectRoot: tmpDir });
    const result = await store2.loadWithRecovery();

    // Complete missions should NOT be restored
    expect(result.recovered).toBe(false);
  });
});
