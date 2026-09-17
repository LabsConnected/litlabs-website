// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * Regression suite for the 2026-09-17 production P0:
 * "The approved workspace operation failed" after approving image.generate.
 *
 * Root cause: the approval-resume path (and the repair path) called
 * ToolRegistry.execute WITHOUT passing availableCapabilities, while the
 * registry's capability gate fails closed. PermissionEngine.check never
 * checked capabilities either, so the tool was advertised and approved and
 * then rejected at execution — before any provider call.
 *
 * These tests pin the fix:
 *   1. resolveAvailableCapabilities is the single source of truth.
 *   2. PermissionEngine.check fails closed on missing capabilities (and a
 *      capability-gated tool can NEVER be silently approved).
 *   3. toolRegistry.execute fails closed without capabilities, passes with them.
 *   4. resumeAgentLoopV2 executes an approved capability-gated tool when the
 *      capability is advertised (the exact P0 scenario), fails honestly when
 *      it is explicitly absent, and self-heals when the paused record has no
 *      capability set at all (pre-fix runs).
 *   5. runAgentLoopV2 passes capabilities through on the initial loop.
 *   6. A pre-mutation checkpoint exists BEFORE the approval pause, so a later
 *      failure reports truthful workspace-change state instead of "unknown".
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal()) as Record<string, unknown>,
  callLLMWithTools: vi.fn(),
}));

import { resolveAvailableCapabilities } from "./capabilities";
import { PermissionEngine } from "./permission-engine";
import { toolRegistry } from "./tool-registry";
import { runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";
import type { LLMMessage } from "./llm-tool-calling";
import type { LiTTToolDefinition } from "./types";

const GATED_TOOL_ID = "test.image_generate";
const IMAGE_CAP = "image_generation";

const handlerCalls: string[] = [];

function fakeToolDef(id: string, readOnly: boolean): LiTTToolDefinition {
  return {
    id,
    name: id,
    description: `${id} (test double for a capability-gated tool)`,
    source: "internal",
    version: "1.0.0",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    // Mirrors image.generate: requires the image_generation capability.
    requiredCapabilities: [IMAGE_CAP],
    requiredPermissions: [],
    risk: "low",
    approvalPolicy: {
      required: false,
      autoApproveReadOnly: false,
      requireExplicitForMutations: false,
      neverAllow: false,
    },
    timeoutMs: 5000,
    idempotent: true,
    readOnly,
    permissionLevel: "read",
    enabled: true,
  };
}

function makeTransport(checkpointResult: unknown = null) {
  return {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn(async () => checkpointResult),
  } as unknown as WorkspaceTransport;
}

beforeEach(() => {
  vi.mocked(callLLMWithTools).mockReset();
  vi.mocked(callLLMWithTools).mockResolvedValue({
    text: "Continuing.",
    toolCalls: [],
    finishReason: "stop",
    model: "test-model",
  });
  handlerCalls.length = 0;
  toolRegistry.clear();
  const handler = async (inputs: Record<string, unknown>) => {
    handlerCalls.push(JSON.stringify(inputs));
    return { success: true };
  };
  toolRegistry.register(fakeToolDef(GATED_TOOL_ID, true), handler);
  toolRegistry.register(fakeToolDef("test.mutate", false), handler);
});

describe("resolveAvailableCapabilities", () => {
  it("always advertises web_search and image_generation (free, no-key provider)", () => {
    const caps = resolveAvailableCapabilities();
    expect(caps).toContain("web_search");
    expect(caps).toContain("image_generation");
  });

  it("advertises filesystem only when a transport is present", () => {
    expect(resolveAvailableCapabilities({ transport: makeTransport() })).toContain("filesystem");
    expect(resolveAvailableCapabilities()).not.toContain("filesystem");
  });
});

describe("PermissionEngine.check — capability gate", () => {
  const engine = new PermissionEngine();

  function permInfo() {
    return {
      toolId: GATED_TOOL_ID,
      permissionLevel: "read" as const,
      isReadOnly: true,
      isMutation: false,
      enabled: true,
      requiredCapabilities: [IMAGE_CAP],
    };
  }

  it("allows the tool when the capability is available", () => {
    const r = engine.check(permInfo(), {}, "act", [IMAGE_CAP]);
    expect(r.allowed).toBe(true);
  });

  it("fails closed when the capability is missing — and never approves it", () => {
    const r = engine.check(permInfo(), {}, "act", []);
    expect(r.allowed).toBe(false);
    expect(r.requiresApproval).toBe(false);
    expect(r.reason).toContain(`capability "${IMAGE_CAP}"`);
  });

  it("leaves capability-free tools untouched", () => {
    const r = engine.check(
      {
        toolId: GATED_TOOL_ID,
        permissionLevel: "read",
        isReadOnly: true,
        isMutation: false,
        enabled: true,
        requiredCapabilities: [],
      },
      {},
      "act",
      [],
    );
    expect(r.allowed).toBe(true);
  });
});

describe("toolRegistry.execute — capability gate", () => {
  it("fails closed when the capability is not provided", async () => {
    const result = await toolRegistry.execute(GATED_TOOL_ID, {}, { hasApproval: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain(`requires capability "${IMAGE_CAP}"`);
    }
    expect(handlerCalls).toEqual([]);
  });

  it("executes when the capability is provided", async () => {
    const result = await toolRegistry.execute(
      GATED_TOOL_ID,
      {},
      { hasApproval: true, availableCapabilities: [IMAGE_CAP] },
    );
    expect(result.ok).toBe(true);
    expect(handlerCalls).toHaveLength(1);
  });
});

function makePausedResumeInput(overrides?: Partial<ResumeInput>): ResumeInput {
  return {
    pausedMessages: [{ role: "user", content: "Generate an image" }],
    toolId: GATED_TOOL_ID,
    toolCallId: "tc-img-1",
    inputs: { prompt: "a lighthouse" },
    decision: "approved",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    },
    stepsUsedBeforePause: 2,
    hadInterveningMutation: false,
    ...overrides,
  };
}

describe("resumeAgentLoopV2 — approved capability-gated tool (the P0 scenario)", () => {
  it("executes the approved tool when the capability is advertised", async () => {
    const result = await resumeAgentLoopV2(
      makePausedResumeInput({ availableCapabilities: [IMAGE_CAP] }),
      makeTransport(),
    );
    expect(handlerCalls).toHaveLength(1);
    const log = result.toolCalls.filter((c) => c.toolId === GATED_TOOL_ID);
    expect(log).toHaveLength(1);
    expect(log[0].success).toBe(true);
    expect(result.cancelled).toBe(false);
  });

  it("fails honestly when the capability set is explicitly empty", async () => {
    const result = await resumeAgentLoopV2(
      makePausedResumeInput({ availableCapabilities: [] }),
      makeTransport(),
    );
    expect(handlerCalls).toEqual([]);
    const log = result.toolCalls.filter((c) => c.toolId === GATED_TOOL_ID);
    expect(log).toHaveLength(1);
    expect(log[0].success).toBe(false);
    // The failure is injected into the resumed conversation as an Error tool
    // message, so the model sees exactly why the approved call did not run.
    const [, messages] = vi.mocked(callLLMWithTools).mock.calls[0];
    const toolMsg = (messages as LLMMessage[]).find((m) => m.role === "tool");
    expect(toolMsg?.content).toMatch(/^Error:/);
    expect(toolMsg?.content).toContain(`requires capability "${IMAGE_CAP}"`);
  });

  it("self-heals pre-fix paused runs that carry no capability set", async () => {
    const result = await resumeAgentLoopV2(makePausedResumeInput(), makeTransport());
    expect(handlerCalls).toHaveLength(1);
    const log = result.toolCalls.filter((c) => c.toolId === GATED_TOOL_ID);
    expect(log).toHaveLength(1);
    expect(log[0].success).toBe(true);
  });
});

describe("runAgentLoopV2 — initial loop passes capabilities through", () => {
  it("executes a capability-gated tool the model is allowed to call", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolId: GATED_TOOL_ID, toolCallId: "tc-g1", inputs: {} }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValue({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const result = await runAgentLoopV2("Generate an image", makeTransport(), {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    });

    expect(handlerCalls).toHaveLength(1);
    const log = result.toolCalls.filter((c) => c.toolId === GATED_TOOL_ID);
    expect(log).toHaveLength(1);
    expect(log[0].success).toBe(true);
  });
});

describe("runAgentLoopV2 — checkpoint exists before the approval pause", () => {
  it("creates the pre-mutation checkpoint before pausing for approval", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "",
      toolCalls: [{ toolId: "test.mutate", toolCallId: "tc-m1", inputs: {} }],
      finishReason: "tool_calls",
      model: "test-model",
    });

    const transport = makeTransport({
      checkpointId: "cp-test-1",
      label: "Before mutation",
      gitSha: "abc123",
    });

    const result = await runAgentLoopV2("Mutate something", transport, {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    });

    expect(result.pendingApproval).toBeDefined();
    expect(result.pendingApproval?.toolId).toBe("test.mutate");
    expect(result.checkpoint?.checkpointId).toBe("cp-test-1");
    expect(
      (transport.createCheckpointBeforeMutation as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(1);
  });
});
