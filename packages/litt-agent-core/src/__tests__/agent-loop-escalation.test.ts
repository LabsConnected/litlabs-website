/**
 * Escalation integration test — proves the full Autopilot reliability path:
 *
 *   model failure → threshold reached → stronger model selected →
 *   loop continues → verification succeeds
 *
 * This is the test the gate report flagged as the remaining functional hole:
 * "EscalationTracker exists, but the actual runAgentLoop never uses it."
 *
 * This test wires a real EscalationTracker (via the EscalationHook adapter)
 * into runAgentLoop and proves the loop escalates mid-mission and continues
 * to a runtime-proven COMPLETE on the stronger model.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runAgentLoop } from "../agent-loop.js";
import { createDefaultRegistry } from "../tools.js";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore } from "../state.js";
import type {
  ModelProvider,
  ModelStreamEvent,
  ChatMessage,
  ModelProfile,
  ModelResult,
  ToolEntry,
  ToolResult,
} from "../types.js";
import type { EscalationHook, AgentFailureKind } from "../agent-loop.js";
import type { VerificationGate, VerificationResult } from "../verification-gate.js";

// ─── Mock model providers ──────────────────────────────────────────

/**
 * A mock model that throws on every stream() call — simulates a weak
 * model that keeps failing (e.g. tool/reasoning failures).
 */
function makeFailingModel(modelId: string, errorMessage: string): ModelProvider {
  return {
    async stream(): Promise<ModelResult> {
      throw new Error(errorMessage);
    },
    async health(): Promise<number> {
      return 0;
    },
  };
}

/**
 * A mock model that returns a scripted sequence of responses.
 * Used for the "strong" model that succeeds after escalation.
 */
function makeScriptedModel(modelId: string, responses: string[]): ModelProvider {
  let callIndex = 0;
  return {
    async stream(
      _messages: ChatMessage[],
      emit: (event: ModelStreamEvent) => void,
    ): Promise<ModelResult> {
      const response = responses[callIndex++] ?? responses[responses.length - 1];
      emit({ type: "meta", provider: "mock", model: modelId, profile: "fast" });
      const words = response.split(" ");
      for (const word of words) {
        emit({ type: "delta", text: word + " " });
      }
      emit({
        type: "done",
        model: modelId,
        usage: { total_tokens: words.length },
        timing: { ttftMs: 10, generationMs: 20, totalMs: 30 },
      });
      return {
        content: response,
        model: modelId,
        provider: "mock",
        usage: { total_tokens: words.length },
        timing: { ttftMs: 10, generationMs: 20, totalMs: 30 },
        profile: "fast" as ModelProfile,
      };
    },
    async health(): Promise<number> {
      return 100;
    },
  };
}

// ─── Mock escalation hook ──────────────────────────────────────────

/**
 * A minimal in-process EscalationHook implementation for the integration
 * test. Mirrors @litt/models EscalationTracker semantics:
 *   - threshold consecutive counted failures → shouldEscalate = true
 *   - pickEscalatedModel returns the next stronger model (excludes tried)
 *   - commitEscalation switches the model and resets the counter
 *
 * This is intentionally self-contained so the test does not depend on
 * litt-models (agent-core stays pure). The real controller adapts the
 * real EscalationTracker to the same EscalationHook interface.
 */
interface MockMission {
  modelId: string;
  consecutiveFailures: number;
  failures: Array<{ kind: AgentFailureKind; message?: string; at: string }>;
  escalations: Array<{ fromModelId: string; toModelId: string; reason: string; at: string }>;
}

const COUNTED_KINDS: AgentFailureKind[] = ["tool", "reasoning", "unknown"];

function makeMockEscalationHook(
  threshold: number,
  /** Ordered list of model ids to escalate to (strongest first). */
  escalationChain: string[],
): EscalationHook {
  const missions = new Map<string, MockMission>();

  return {
    startMission(missionId, modelId) {
      missions.set(missionId, {
        modelId,
        consecutiveFailures: 0,
        failures: [],
        escalations: [],
      });
    },
    recordFailure(missionId, kind, message) {
      const m = missions.get(missionId);
      if (!m) return;
      m.failures.push({ kind, message, at: new Date().toISOString() });
      if (COUNTED_KINDS.includes(kind)) m.consecutiveFailures += 1;
    },
    recordSuccess(missionId) {
      const m = missions.get(missionId);
      if (m) m.consecutiveFailures = 0;
    },
    shouldEscalate(missionId) {
      const m = missions.get(missionId);
      return m ? m.consecutiveFailures >= threshold : false;
    },
    pickEscalatedModel(missionId) {
      const m = missions.get(missionId);
      if (!m) return null;
      const tried = new Set<string>([m.modelId, ...m.escalations.map((e) => e.toModelId)]);
      for (const candidate of escalationChain) {
        if (!tried.has(candidate)) {
          return {
            modelId: candidate,
            reason: `Escalated from ${m.modelId} after ${m.consecutiveFailures} consecutive failures → ${candidate}`,
          };
        }
      }
      return null;
    },
    commitEscalation(missionId, toModelId, reason) {
      const m = missions.get(missionId);
      if (!m) return null;
      const event = {
        fromModelId: m.modelId,
        toModelId,
        reason,
        at: new Date().toISOString(),
      };
      m.escalations.push(event);
      m.modelId = toModelId;
      m.consecutiveFailures = 0;
      return event;
    },
    currentModel(missionId) {
      return missions.get(missionId)?.modelId ?? null;
    },
    endMission(missionId) {
      missions.delete(missionId);
    },
  };
}

// ─── Mock verification gate ────────────────────────────────────────

/**
 * A gate that fails the first N calls, then passes. Simulates the
 * "repair → revalidate → prove" cycle: the weak model can't get the
 * gate to pass, the strong model does.
 */
function makeMockVerificationGate(failFirstN: number): VerificationGate {
  let calls = 0;
  return {
    async verify(): Promise<VerificationResult> {
      calls++;
      const proven = calls > failFirstN;
      const checks = [{
        id: "typecheck" as const,
        status: (proven ? "success" : "failed") as "success" | "failed",
        success: proven,
        exitCode: proven ? 0 : 1,
        message: proven ? "Typecheck passed" : "Typecheck failed",
        durationMs: 10,
        stdout: "",
        stderr: proven ? "" : "error TS1234: mock type error",
        runId: `verify_mock_${calls}`,
        toolCallId: `tc_mock_${calls}`,
      }];
      return {
        proven,
        status: proven ? "proven" : "failed",
        checks,
        totalDurationMs: 10,
        message: proven
          ? "VERIFIED — runtime proved all checks passed."
          : "NOT VERIFIED — at least one check failed. COMPLETE is not honest.",
        runId: `verify_mock_${calls}`,
        ranChecks: ["typecheck"],
        skippedChecks: [],
      };
    },
  } as VerificationGate;
}

// ─── Mock tool that always succeeds ────────────────────────────────

function makeSucceedingTool(): ToolEntry {
  return {
    definition: {
      id: "test.echo",
      name: "echo",
      description: "Echo tool for testing — always succeeds",
      inputSchema: { type: "object", properties: {} },
      readOnly: true,
    },
    handler: async (_ctx, _args): Promise<ToolResult> => ({
      status: "success",
      success: true,
      message: "echo ok",
      data: { ok: true },
    }),
    metadata: { projectScoped: false, mutating: false, readOnly: true },
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("Agent Loop Escalation", () => {

  it("model failure → threshold → stronger model → loop continues → verification succeeds", async () => {
    // The weak model throws a tool error on every call.
    // After `threshold` failures, the hook escalates to the strong model.
    // The strong model calls the echo tool, then claims done.
    // The gate passes → termination === "complete".
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    tools.register(makeSucceedingTool());

    const weakModel = makeFailingModel("weak-model", "tool call failed: invalid arguments");
    const strongModel = makeScriptedModel("strong-model", [
      '```tool_call\n{ "tool": "test.echo", "inputs": {} }\n```',
      "Done — the typecheck passes and the project is verified.",
    ]);

    const modelResolver = (id: string): ModelProvider | null => {
      if (id === "weak-model") return weakModel;
      if (id === "strong-model") return strongModel;
      return null;
    };

    const hook = makeMockEscalationHook(2, ["strong-model"]);
    const gate = makeMockVerificationGate(0); // passes immediately once strong model claims done

    const result = await runAgentLoop("Fix the typecheck error and verify", {
      model: weakModel,
      modelId: "weak-model",
      modelResolver,
      tools,
      shell,
      store,
      cwd: process.cwd(),
      maxRounds: 10,
      escalation: hook,
      missionId: "m-escalate-1",
      verificationGate: gate,
    });

    // The loop must reach runtime-proven COMPLETE on the strong model.
    assert.equal(result.termination, "complete", `expected complete, got ${result.termination} (${result.content})`);
    assert.equal(result.verification?.proven, true, "gate must be proven");
    assert.ok(result.escalations && result.escalations.length >= 1, "at least one escalation must be recorded");
    assert.equal(result.escalations![0].fromModelId, "weak-model");
    assert.equal(result.escalations![0].toModelId, "strong-model");
    assert.match(result.escalations![0].reason, /Escalated from weak-model/);
    // The strong model actually executed (tool call + final answer).
    assert.ok(result.toolCalls.length >= 1, "strong model must have called a tool");
    assert.ok(result.content.length > 0, "final content must be non-empty");
  });

  it("does NOT escalate when failures are below threshold", async () => {
    // One failure, threshold=3 → no escalation. The loop should
    // terminate with "error" (the model keeps throwing).
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();

    const weakModel = makeFailingModel("weak-model", "tool call failed: invalid arguments");
    const strongModel = makeScriptedModel("strong-model", ["Done."]);

    const modelResolver = (id: string): ModelProvider | null => {
      if (id === "weak-model") return weakModel;
      if (id === "strong-model") return strongModel;
      return null;
    };

    const hook = makeMockEscalationHook(3, ["strong-model"]); // threshold 3

    const result = await runAgentLoop("Do something", {
      model: weakModel,
      modelId: "weak-model",
      modelResolver,
      tools,
      shell,
      store,
      cwd: process.cwd(),
      maxRounds: 2, // only 2 rounds → can't reach threshold 3
      escalation: hook,
      missionId: "m-no-escalate",
    });

    // With escalation configured, the loop continues through rounds
    // (accumulating failures) instead of returning "error" immediately.
    // With maxRounds=2 and threshold=3, it runs out of rounds before
    // escalating → termination is "max_rounds", not "error".
    assert.equal(result.termination, "max_rounds");
    assert.ok(!result.escalations || result.escalations.length === 0, "no escalation should occur below threshold");
  });

  it("does NOT escalate when no escalation hook is provided (backward compat)", async () => {
    // No escalation → original behavior: model error terminates the loop.
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();

    const weakModel = makeFailingModel("weak-model", "tool call failed");

    const result = await runAgentLoop("Do something", {
      model: weakModel,
      tools,
      shell,
      store,
      cwd: process.cwd(),
      maxRounds: 5,
      // no escalation, missionId, modelId, or modelResolver
    });

    assert.equal(result.termination, "error");
    assert.ok(!result.escalations, "no escalations field when escalation not configured");
  });

  it("tool failures trigger escalation to a stronger model", async () => {
    // The weak model calls a tool, but the tool keeps failing (the
    // model is too weak to call it correctly). After threshold tool
    // failures, escalate to the strong model which calls it correctly.
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();

    // A tool that always fails — simulates the weak model calling it wrong.
    const failingTool: ToolEntry = {
      definition: {
        id: "test.failing",
        name: "failing",
        description: "A tool that always fails",
        inputSchema: { type: "object", properties: {} },
        readOnly: true,
      },
      handler: async (_ctx, _args): Promise<ToolResult> => ({
        status: "failed",
        success: false,
        message: "tool execution failed: invalid arguments supplied by model",
        data: {},
      }),
      metadata: { projectScoped: false, mutating: false, readOnly: true },
    };
    tools.register(failingTool);
    tools.register(makeSucceedingTool());

    // Weak model: keeps calling the failing tool.
    // Strong model: calls the succeeding tool, then claims done.
    const weakModel = makeScriptedModel("weak-model", [
      '```tool_call\n{ "tool": "test.failing", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "test.failing", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "test.failing", "inputs": {} }\n```',
    ]);
    const strongModel = makeScriptedModel("strong-model", [
      '```tool_call\n{ "tool": "test.echo", "inputs": {} }\n```',
      "Done — the task is complete.",
    ]);

    const modelResolver = (id: string): ModelProvider | null => {
      if (id === "weak-model") return weakModel;
      if (id === "strong-model") return strongModel;
      return null;
    };

    const hook = makeMockEscalationHook(3, ["strong-model"]);
    const gate = makeMockVerificationGate(0);

    const result = await runAgentLoop("Run the tool and verify", {
      model: weakModel,
      modelId: "weak-model",
      modelResolver,
      tools,
      shell,
      store,
      cwd: process.cwd(),
      maxRounds: 12,
      escalation: hook,
      missionId: "m-tool-escalate",
      verificationGate: gate,
    });

    assert.equal(result.termination, "complete", `expected complete, got ${result.termination} (${result.content})`);
    assert.equal(result.verification?.proven, true);
    assert.ok(result.escalations && result.escalations.length >= 1, "tool failures must trigger escalation");
    assert.equal(result.escalations![0].fromModelId, "weak-model");
    assert.equal(result.escalations![0].toModelId, "strong-model");
  });

  it("escalation preserves mission context (same missionId, new model)", async () => {
    // After escalation, the mission id is unchanged — only the model
    // swapped. The conversation history is preserved (the new model
    // sees what the old model tried).
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    tools.register(makeSucceedingTool());

    const weakModel = makeFailingModel("weak-model", "tool call failed: invalid arguments");
    const strongModel = makeScriptedModel("strong-model", [
      '```tool_call\n{ "tool": "test.echo", "inputs": {} }\n```',
      "Done.",
    ]);

    const modelResolver = (id: string): ModelProvider | null => {
      if (id === "weak-model") return weakModel;
      if (id === "strong-model") return strongModel;
      return null;
    };

    const hook = makeMockEscalationHook(2, ["strong-model"]);

    const result = await runAgentLoop("Fix it", {
      model: weakModel,
      modelId: "weak-model",
      modelResolver,
      tools,
      shell,
      store,
      cwd: process.cwd(),
      maxRounds: 10,
      escalation: hook,
      missionId: "m-preserve-context",
    });

    // The hook's currentModel should now be the strong model.
    assert.equal(hook.currentModel("m-preserve-context"), "strong-model");
    assert.ok(result.escalations && result.escalations.length === 1);
    // The loop ran more than 1 round (failures + escalation + success).
    assert.ok(result.rounds > 1, "loop must have run multiple rounds across the escalation");
  });

  it("emits model_escalated event via the emitter", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    tools.register(makeSucceedingTool());

    const weakModel = makeFailingModel("weak-model", "tool call failed: invalid arguments");
    const strongModel = makeScriptedModel("strong-model", [
      '```tool_call\n{ "tool": "test.echo", "inputs": {} }\n```',
      "Done.",
    ]);

    const modelResolver = (id: string): ModelProvider | null => {
      if (id === "weak-model") return weakModel;
      if (id === "strong-model") return strongModel;
      return null;
    };

    const hook = makeMockEscalationHook(2, ["strong-model"]);
    const events: Array<{ subtype?: string; data: Record<string, unknown> }> = [];

    const result = await runAgentLoop("Fix it", {
      model: weakModel,
      modelId: "weak-model",
      modelResolver,
      tools,
      shell,
      store,
      cwd: process.cwd(),
      maxRounds: 10,
      escalation: hook,
      missionId: "m-emit-event",
      emitter: (event) => {
        events.push({ subtype: event.subtype, data: event.data });
      },
    });

    const escalatedEvents = events.filter((e) => e.subtype === "model_escalated");
    assert.ok(escalatedEvents.length >= 1, "a model_escalated event must be emitted");
    assert.equal(escalatedEvents[0].data.fromModelId, "weak-model");
    assert.equal(escalatedEvents[0].data.toModelId, "strong-model");
    assert.equal(escalatedEvents[0].data.missionId, "m-emit-event");
    assert.ok(result.escalations && result.escalations.length >= 1);
  });
});
