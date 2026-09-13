import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { callLLMWithTools, AgentBudgetExhaustedError } from "./llm-tool-calling";

const fakeTransport = {
  workspaceId: "ws-test",
  userId: "u-test",
  workspaceRoot: "/tmp/test",
  projectId: "p-test",
} as unknown as WorkspaceTransport;

describe("runAgentLoopV2 — provider exhaustion", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockRejectedValue(
      new Error("All tool-calling models failed. Attempts: gemini-2.5-flash(timeout, 60000ms)"),
    );
  });

  it("emits model_failed + finished and returns deterministically when every provider fails", async () => {
    const result = await runAgentLoopV2(
      "build a tiny landing page",
      fakeTransport,
      {
        model: "gemini-2.5-flash",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.modelFailed).toBeTruthy();
    expect(result.cancelled).toBe(false);
    expect(result.events.some((e) => e.type === "phase" && e.phase === "call_llm")).toBe(true);
    expect(result.events.some((e) => e.type === "status")).toBe(true);
    expect(result.events.some((e) => e.type === "model_failed")).toBe(true);
    expect(result.events.some((e) => e.type === "finished")).toBe(true);
  });
});

describe("runAgentLoopV2 — deadline and abort propagation", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "google/gemini-2.5-flash",
      provider: "openrouter-free",
    });
  });

  it("passes the same absolute deadline and upstream signal to callLLMWithTools", async () => {
    const controller = new AbortController();
    const before = Date.now();

    await runAgentLoopV2(
      "build a tiny landing page",
      fakeTransport,
      {
        model: "gemini-2.5-flash",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        maxRuntimeMs: 120_000,
        signal: controller.signal,
      },
    );

    const after = Date.now();
    const call = vi.mocked(callLLMWithTools).mock.calls[0];
    const options = call[3] as { deadlineMs: number; signal: AbortSignal } | undefined;

    expect(options).toBeDefined();
    expect(options!.deadlineMs).toBeGreaterThanOrEqual(before + 120_000);
    expect(options!.deadlineMs).toBeLessThanOrEqual(after + 120_000);
    expect(options!.signal).toBe(controller.signal);
  });

  it("resumeAgentLoopV2 reuses the config signal and the absolute runtime deadline", async () => {
    const controller = new AbortController();
    const before = Date.now();

    const resume: ResumeInput = {
      pausedMessages: [{ role: "user" as const, content: "continue" }],
      toolId: "write_file",
      toolCallId: "call_1",
      inputs: { path: "test.txt" },
      decision: "rejected",
      rejectionReason: "user rejected",
      config: {
        model: "gemini-2.5-flash",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        maxRuntimeMs: 90_000,
        signal: controller.signal,
      },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
    };

    await resumeAgentLoopV2(resume, fakeTransport);

    const after = Date.now();
    const call = vi.mocked(callLLMWithTools).mock.calls[0];
    const options = call[3] as { deadlineMs: number; signal: AbortSignal } | undefined;

    expect(options).toBeDefined();
    expect(options!.deadlineMs).toBeGreaterThanOrEqual(before + 90_000);
    expect(options!.deadlineMs).toBeLessThanOrEqual(after + 90_000);
    expect(options!.signal).toBe(controller.signal);
  });
});

describe("runAgentLoopV2 — duplicate mutation suppression across provider failover", () => {
  it("executes a mutation exactly once when the next provider re-issues the same tool call", async () => {
    // Scenario: provider A returns a mutating tool call → it executes and its
    // result is recorded → the next model request is served by provider B →
    // B re-issues the identical mutation → the recorded result is replayed
    // and the mutation must NOT execute again.
    const mkdir = vi.fn().mockResolvedValue({ created: true });
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      mkdir,
      createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    } as unknown as WorkspaceTransport;

    const inputs = { path: "new-dir" };
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "Creating the directory.",
        toolCalls: [{ toolCallId: "call_a1", toolId: "files.mkdir", inputs }],
        finishReason: "tool_calls",
        model: "openrouter/free",
        provider: "openrouter-free",
      })
      // Provider B (gemini-direct) continues the transcript and re-issues the
      // identical mutation — it must be suppressed.
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolCallId: "call_b1", toolId: "files.mkdir", inputs }],
        finishReason: "tool_calls",
        model: "gemini-3.6-flash",
        provider: "gemini-direct",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-3.6-flash",
        provider: "gemini-direct",
      });

    const result = await runAgentLoopV2(
      "create a new directory",
      transport,
      {
        model: "openrouter/free",
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxSteps: 6,
        maxRuntimeMs: 60_000,
      },
    );

    // The mutation ran exactly once despite being issued by two providers.
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(mkdir).toHaveBeenCalledWith("new-dir");

    // The suppressed duplicate was reported truthfully as a replayed result.
    expect(
      result.events.some(
        (e) => e.type === "tool_result" && e.summary === "Already completed; duplicate mutation suppressed",
      ),
    ).toBe(true);

    expect(result.finalText).toBe("Done.");
    expect(result.modelFailed).toBeUndefined();
  });

  it("does not suppress a mutation issued with different inputs", async () => {
    const mkdir = vi.fn().mockResolvedValue({ created: true });
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      mkdir,
      createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    } as unknown as WorkspaceTransport;

    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "Creating the first directory.",
        toolCalls: [{ toolCallId: "call_1", toolId: "files.mkdir", inputs: { path: "dir-a" } }],
        finishReason: "tool_calls",
        model: "openrouter/free",
        provider: "openrouter-free",
      })
      .mockResolvedValueOnce({
        text: "Creating the second directory.",
        toolCalls: [{ toolCallId: "call_2", toolId: "files.mkdir", inputs: { path: "dir-b" } }],
        finishReason: "tool_calls",
        model: "openrouter/free",
        provider: "openrouter-free",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "openrouter/free",
        provider: "openrouter-free",
      });

    const result = await runAgentLoopV2(
      "create two directories",
      transport,
      {
        model: "openrouter/free",
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxSteps: 6,
        maxRuntimeMs: 60_000,
      },
    );

    // Distinct inputs → both are legitimate mutations, both execute.
    expect(mkdir).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe("Done.");
  });
});

describe("runAgentLoopV2 — deterministic failure reasons", () => {
  it("emits model_failed with the canonical budget-exhaustion message", async () => {
    vi.mocked(callLLMWithTools).mockRejectedValueOnce(
      new AgentBudgetExhaustedError(0, "test"),
    );

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      fakeTransport,
      {
        model: "gemini-2.5-flash",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.modelFailed).toContain("Agent budget exhausted");
    expect(result.cancelled).toBe(false);
    expect(result.events.some((e) => e.type === "model_failed")).toBe(true);
    expect(result.events.some((e) => e.type === "finished")).toBe(true);
  });

  it("emits model_failed for an upstream abort and does not report as cancelled", async () => {
    vi.mocked(callLLMWithTools).mockRejectedValueOnce(
      new Error("OpenRouter request aborted by upstream"),
    );

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      fakeTransport,
      {
        model: "gemini-2.5-flash",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.modelFailed).toContain("aborted by upstream");
    expect(result.cancelled).toBe(false);
    expect(result.events.some((e) => e.type === "model_failed")).toBe(true);
    expect(result.events.some((e) => e.type === "finished")).toBe(true);
  });
});
