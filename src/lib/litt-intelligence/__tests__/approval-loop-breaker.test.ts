// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";

/**
 * Approval-loop breaker tests (§6.1–6.3, §7 of the 2026-11-09 diagnosis).
 *
 * Production defect (2026-11-08, staging re-tests on fe49d59c and
 * 391620db): an approved image.generate that fails to save re-enters
 * its approval gate forever — Approve → "Approved" logged → a fresh
 * identical approval request → loop, no image saved, no error, no
 * files/preview/deploy. Root cause: the permission pause runs before
 * loop detection (R1), the old detector is disabled once any mutation
 * executed (R2), and replay dedupe is exact-input matching on a
 * non-canonical truncated hash (R3).
 *
 * These tests verify the breaker contract on resumeAgentLoopV2:
 *   (a) same gated image.generate re-emitted 3x with a save-failing
 *       result → run settles failed with the loop error, exactly 2
 *       gates created, no third; the tool executes exactly twice.
 *   (a2) same, but the save fails with the real-world shape
 *       (success: true + savedToProject: false) — still counts as a
 *       failed mutation and still trips the breaker.
 *   (b) same but the second call succeeds-and-saves → run continues
 *       (no false trip); the third identical emission replays.
 *   (c) reordered-key identical inputs dedupe via the canonical hash
 *       (no new gate); hashInputs is key-order-insensitive and hashes
 *       (not truncates) long inputs.
 */

vi.mock("../llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import {
  resumeAgentLoopV2,
  seedToolCallRecordsFromHistory,
  countGatedRepeatExecutions,
  gatedRepeatLoopError,
  hashInputs,
  type ResumeInput,
} from "../agent-loop-v2";
import {
  buildAssistantToolCallMessage,
  buildToolResultMessage,
  type LLMMessage,
} from "../llm-tool-calling";
import { callLLMWithTools } from "../llm-tool-calling";
import { toolRegistry } from "../tool-registry";

const IMAGE_INPUTS = {
  prompt: "A cozy coffee shop storefront at golden hour, warm light",
};
const IMAGE_INPUTS_2KEY = {
  prompt: "A cozy coffee shop storefront at golden hour, warm light",
  projectId: "p-test",
};
const IMAGE_INPUTS_2KEY_REORDERED = {
  projectId: "p-test",
  prompt: "A cozy coffee shop storefront at golden hour, warm light",
};

const SAVE_FAILURE = "Failed to save image into project: truncated or corrupt image data";

function makeTransport() {
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn(async () => null),
    stat: vi.fn(async () => ({ kind: "unknown" })),
  } as unknown as WorkspaceTransport;
  return transport;
}

/** Faithful paused state: assistant emitted image.generate, run paused before execution. */
function makePausedInput(overrides?: Partial<ResumeInput>): ResumeInput {
  const inputs = overrides?.inputs ?? IMAGE_INPUTS;
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [{ toolId: "image.generate", toolCallId: "tc-img-1", inputs }],
    "Generating the hero image.",
    undefined,
  );
  const pausedMessages: LLMMessage[] = [
    { role: "user", content: "Build a coffee shop page with an AI-generated hero image" },
    assistantMsg,
  ];
  return {
    pausedMessages,
    toolId: "image.generate",
    toolCallId: "tc-img-1",
    inputs,
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

/** Resume input for the next gate, built from the previous resume's result.
 * The paused messages come from pendingApproval.pausedMessages — the same
 * source the production approvals route persists for the next resume. */
function makeNextGateInput(result: Awaited<ReturnType<typeof resumeAgentLoopV2>>): ResumeInput {
  const gate = result.pendingApproval;
  if (!gate) throw new Error("expected a pending approval gate");
  return {
    pausedMessages: gate.pausedMessages ?? [],
    toolId: gate.toolId,
    toolCallId: gate.toolCallId,
    inputs: gate.inputs as Record<string, unknown>,
    decision: "approved",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    },
    stepsUsedBeforePause: result.stepsUsed,
    hadInterveningMutation: gate.hadInterveningMutationAtPause ?? false,
  };
}

function reemit(toolCallId: string, inputs: Record<string, unknown>) {
  return {
    text: "Generating the hero image.",
    toolCalls: [{ toolId: "image.generate", toolCallId, inputs }],
    finishReason: "tool_calls",
    model: "test-model",
  };
}

describe("approval-loop breaker — resume flow", () => {
  let executeSpy: MockInstance<typeof toolRegistry.execute>;

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    executeSpy = vi.spyOn(toolRegistry, "execute");
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  it("(a) settles failed with the loop error after the 3rd identical gated image.generate (loop-level failure)", async () => {
    // Every generation fails to save at the loop level.
    executeSpy.mockImplementation(async (toolId: string) => {
      expect(toolId).toBe("image.generate");
      return {
        ok: true,
        result: { success: false, error: SAVE_FAILURE },
      };
    });
    // R1: the model re-emits the identical call after the failed save.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(reemit("tc-img-2", IMAGE_INPUTS));

    const transport = makeTransport();
    const r1 = await resumeAgentLoopV2(makePausedInput(), transport);

    // Exactly one new gate (gate 2) — the run paused again, it did not fail yet.
    expect(r1.pendingApproval).toBeDefined();
    expect(r1.pendingApproval?.toolId).toBe("image.generate");
    expect(r1.pendingApproval?.toolCallId).toBe("tc-img-2");
    expect(r1.failedHonestly).toBeUndefined();
    expect(executeSpy).toHaveBeenCalledTimes(1);

    // R2: the model re-emits the identical call a third time.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(reemit("tc-img-3", IMAGE_INPUTS));
    const r2 = await resumeAgentLoopV2(makeNextGateInput(r1), transport);

    // No third gate — the run settles failed with the truthful loop error.
    expect(r2.pendingApproval).toBeUndefined();
    expect(r2.failedHonestly).toBe(gatedRepeatLoopError("image.generate"));
    expect(r2.finalText).toContain("requested 3 times without a successful save");
    // The tool executed exactly twice — the third request never ran.
    // (executeSpy counts across both resumes; r2.toolCalls only holds
    // this resume's calls — the approved #2 — so it has length 1.)
    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(r2.toolCalls.filter((c) => c.toolId === "image.generate")).toHaveLength(1);
  });

  it("(a2) treats success:true + savedToProject:false as a failed mutation (real-world save shape)", async () => {
    // The 2026-11-08 staging loop: generation succeeded but the save
    // failed — the handler preserves success: true and only marks
    // savedToProject: false. That is still a failed mutation.
    executeSpy.mockImplementation(async (toolId: string) => {
      expect(toolId).toBe("image.generate");
      return {
        ok: true,
        result: {
          success: true,
          downloadUrl: "data:image/jpeg;base64,/9j/4AAQ",
          savedToProject: false,
          error: SAVE_FAILURE,
        },
      };
    });
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(reemit("tc-img-2", IMAGE_INPUTS));

    const transport = makeTransport();
    const r1 = await resumeAgentLoopV2(makePausedInput(), transport);

    // The failed save must NOT replay via dedupe (it is not in
    // executedMutations) — the identical re-emission gates again.
    expect(r1.pendingApproval).toBeDefined();
    expect(r1.pendingApproval?.toolCallId).toBe("tc-img-2");
    expect(executeSpy).toHaveBeenCalledTimes(1);

    vi.mocked(callLLMWithTools).mockResolvedValueOnce(reemit("tc-img-3", IMAGE_INPUTS));
    const r2 = await resumeAgentLoopV2(makeNextGateInput(r1), transport);

    expect(r2.pendingApproval).toBeUndefined();
    expect(r2.failedHonestly).toBe(gatedRepeatLoopError("image.generate"));
    expect(executeSpy).toHaveBeenCalledTimes(2);
  });

  it("(b) does NOT trip when the second call succeeds-and-saves — the third identical emission replays", async () => {
    // First generation fails to save; the second succeeds and saves.
    executeSpy
      .mockResolvedValueOnce({
        ok: true,
        result: { success: false, error: SAVE_FAILURE },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: {
          success: true,
          downloadUrl: "data:image/jpeg;base64,/9j/4AAQ",
          savedToProject: true,
          sitePath: "/assets/images/hero.jpg",
        },
      });
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(reemit("tc-img-2", IMAGE_INPUTS));

    const transport = makeTransport();
    const r1 = await resumeAgentLoopV2(makePausedInput(), transport);
    expect(r1.pendingApproval).toBeDefined();
    expect(executeSpy).toHaveBeenCalledTimes(1);

    // The model re-emits the identical call a third time — but the
    // second call saved, so the replay dedupe answers it and the run
    // continues instead of gating or failing.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(reemit("tc-img-3", IMAGE_INPUTS))
      .mockResolvedValueOnce({
        text: "Image saved. Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });
    const r2 = await resumeAgentLoopV2(makeNextGateInput(r1), transport);

    expect(r2.pendingApproval).toBeUndefined();
    expect(r2.failedHonestly).toBeUndefined();
    expect(r2.finalText).toBe("Image saved. Done.");
    // Only two real executions — the third emission replayed, never ran.
    expect(executeSpy).toHaveBeenCalledTimes(2);
  });

  it("(c) reordered-key identical inputs dedupe via the canonical hash (no new gate)", async () => {
    executeSpy.mockImplementation(async (toolId: string) => {
      expect(toolId).toBe("image.generate");
      return {
        ok: true,
        result: {
          success: true,
          downloadUrl: "data:image/jpeg;base64,/9j/4AAQ",
          savedToProject: true,
          sitePath: "/assets/images/hero.jpg",
        },
      };
    });
    // The model re-emits the same call with the keys in a different
    // order. Before canonicalization this hashed differently, defeated
    // the replay dedupe, and re-paused. Now it replays.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(reemit("tc-img-2", IMAGE_INPUTS_2KEY_REORDERED))
      .mockResolvedValueOnce({
        text: "Image saved. Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const transport = makeTransport();
    const r1 = await resumeAgentLoopV2(
      makePausedInput({ inputs: IMAGE_INPUTS_2KEY }),
      transport,
    );

    expect(r1.pendingApproval).toBeUndefined();
    expect(r1.failedHonestly).toBeUndefined();
    expect(r1.finalText).toBe("Image saved. Done.");
    // Only one real execution — the reordered re-emission replayed.
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("hashInputs canonicalization", () => {
  it("is insensitive to object key order, including nested objects", () => {
    expect(hashInputs({ prompt: "x", projectId: "p" })).toBe(
      hashInputs({ projectId: "p", prompt: "x" }),
    );
    expect(hashInputs({ a: { b: 1, c: 2 }, d: 3 })).toBe(
      hashInputs({ d: 3, a: { c: 2, b: 1 } }),
    );
    expect(hashInputs({ prompt: "x" })).not.toBe(hashInputs({ prompt: "y" }));
  });

  it("hashes (not truncates) inputs longer than 500 chars", () => {
    const long = hashInputs({ prompt: "x".repeat(1000) });
    expect(long).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(long).toBe(hashInputs({ prompt: "x".repeat(1000) }));
    // Two long inputs that share a 500-char prefix must not collide.
    expect(long).not.toBe(hashInputs({ prompt: "x".repeat(999) + "y" }));
    // Short inputs stay literal JSON.
    expect(hashInputs({ prompt: "x" })).toBe(JSON.stringify({ prompt: "x" }));
  });
});

describe("seedToolCallRecordsFromHistory — breaker outcomes", () => {
  function historyWithResult(
    callId: string,
    toolId: string,
    inputs: Record<string, unknown>,
    result: { success: boolean; error?: string } | { success: boolean; savedToProject: boolean },
  ): LLMMessage[] {
    const assistantMsg = buildAssistantToolCallMessage(
      [{ toolId, toolCallId: callId, inputs }],
      "Calling the tool.",
      undefined,
    );
    const toolMsg = buildToolResultMessage({
      toolCallId: callId,
      toolId,
      result,
      success: (result as { success: boolean }).success,
    });
    return [
      { role: "user", content: "Build it" },
      assistantMsg,
      toolMsg,
    ];
  }

  it("flags a loop-level failure (success:false) as success:false, mutating:true", () => {
    const records = seedToolCallRecordsFromHistory(
      historyWithResult("tc-1", "image.generate", IMAGE_INPUTS, { success: false, error: SAVE_FAILURE }),
    );
    expect(records).toHaveLength(1);
    expect(records[0].success).toBe(false);
    expect(records[0].mutating).toBe(true);
  });

  it("flags success:true + savedToProject:false as success:false", () => {
    const records = seedToolCallRecordsFromHistory(
      historyWithResult("tc-1", "image.generate", IMAGE_INPUTS, { success: true, savedToProject: false }),
    );
    expect(records).toHaveLength(1);
    expect(records[0].success).toBe(false);
    expect(records[0].mutating).toBe(true);
  });

  it("flags a successful save as success:true and a read-only tool as mutating:false", () => {
    const imageRecords = seedToolCallRecordsFromHistory(
      historyWithResult("tc-1", "image.generate", IMAGE_INPUTS, { success: true, savedToProject: true }),
    );
    expect(imageRecords[0].success).toBe(true);
    expect(imageRecords[0].mutating).toBe(true);

    const assistantMsg = buildAssistantToolCallMessage(
      [{ toolId: "files.read", toolCallId: "tc-2", inputs: { path: "index.html" } }],
      "Reading the file.",
      undefined,
    );
    const toolMsg = buildToolResultMessage({
      toolCallId: "tc-2",
      toolId: "files.read",
      result: { success: true, content: "<h1>hi</h1>" },
      success: true,
    });
    const readRecords = seedToolCallRecordsFromHistory([
      { role: "user", content: "Read it" },
      assistantMsg,
      toolMsg,
    ]);
    expect(readRecords[0].success).toBe(true);
    expect(readRecords[0].mutating).toBe(false);
  });
});

describe("countGatedRepeatExecutions", () => {
  const h = hashInputs(IMAGE_INPUTS);
  const failedImage = {
    toolId: "image.generate",
    inputsHash: h,
    resultHash: "",
    step: 0,
    success: false,
    mutating: true,
  };
  const failedImage2 = { ...failedImage, step: 1 };

  it("counts trailing same-tool same-hash failures and trips at 2", () => {
    expect(countGatedRepeatExecutions([], "image.generate", h)).toBe(0);
    expect(countGatedRepeatExecutions([failedImage], "image.generate", h)).toBe(1);
    expect(
      countGatedRepeatExecutions([failedImage, failedImage2], "image.generate", h),
    ).toBe(2);
  });

  it("resets at the most recent successful mutation of a different tool", () => {
    const writeOk = {
      toolId: "files.write",
      inputsHash: hashInputs({ path: "index.html" }),
      resultHash: "",
      step: 1,
      success: true,
      mutating: true,
    };
    // write between the two image failures → only the later one counts.
    expect(
      countGatedRepeatExecutions([failedImage, writeOk, failedImage2], "image.generate", h),
    ).toBe(1);
    // write after both failures → streak is over.
    expect(
      countGatedRepeatExecutions([failedImage, failedImage2, writeOk], "image.generate", h),
    ).toBe(0);
  });

  it("does not reset on an unknown-outcome or failed different-tool record", () => {
    const writeUnknown = {
      toolId: "files.write",
      inputsHash: hashInputs({ path: "index.html" }),
      resultHash: "",
      step: 1,
      success: undefined,
      mutating: true,
    };
    const writeFailed = { ...writeUnknown, success: false };
    expect(
      countGatedRepeatExecutions([failedImage, writeUnknown, failedImage2], "image.generate", h),
    ).toBe(2);
    expect(
      countGatedRepeatExecutions([failedImage, writeFailed, failedImage2], "image.generate", h),
    ).toBe(2);
  });

  it("a successful same-tool execution ends the streak", () => {
    const imageOk = { ...failedImage, success: true };
    expect(
      countGatedRepeatExecutions([imageOk, failedImage2], "image.generate", h),
    ).toBe(1);
    expect(countGatedRepeatExecutions([imageOk], "image.generate", h)).toBe(0);
  });
});
