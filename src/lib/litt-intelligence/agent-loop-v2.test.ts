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
  createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
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

describe("runAgentLoopV2 — invalid apply_patch never reaches the approval gate", () => {
  const transportWithFile = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    readFile: vi.fn(async () => ({
      content: "<footer>Ember Roast · 2024 · Handcrafted coffee.</footer>",
      size: 55,
    })),
    // Required by the WorkspaceTransport contract; the loop creates the
    // pre-mutation checkpoint BEFORE the approval pause.
    createCheckpointBeforeMutation: vi.fn(async () => null),
  } as unknown as WorkspaceTransport;

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("a patch with an unresolved placeholder becomes a tool error, not an approval pause", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-1",
          toolId: "apply_patch",
          inputs: {
            path: "index.html",
            patches: [{
              search: "<footer>[PERSON_NAME] · 2024 · Handcrafted coffee.</footer>",
              replace: "<footer>Ember Roast · Freshly roasted.</footer>",
            }],
          },
        }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Regenerated the patch with literal text.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "change the footer tagline",
      transportWithFile,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    // No approval gate — the loop continued and the model regenerated.
    expect(result.pendingApproval).toBeUndefined();
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe("Regenerated the patch with literal text.");
    expect(result.toolCalls.some((t) => t.toolId === "apply_patch" && !t.success)).toBe(true);
  });

  it("a patch whose search string cannot match becomes a tool error, not an approval pause", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-2",
          toolId: "apply_patch",
          inputs: {
            path: "index.html",
            patches: [{
              search: "<footer>Hallucinated content that was never written</footer>",
              replace: "<footer>new</footer>",
            }],
          },
        }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Fixed the patch after re-reading the file.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "change the footer tagline",
      transportWithFile,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.pendingApproval).toBeUndefined();
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(2);
    expect(result.finalText).toContain("Fixed the patch");
  });

  it("a valid patch still pauses for approval normally", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "",
      toolCalls: [{
        toolCallId: "tc-3",
        toolId: "apply_patch",
        inputs: {
          path: "index.html",
          patches: [{
            search: "Handcrafted coffee.",
            replace: "Freshly roasted, delivered daily.",
          }],
        },
      }],
      finishReason: "tool_calls",
      model: "test-model",
    });

    const result = await runAgentLoopV2(
      "change the footer tagline",
      transportWithFile,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.pendingApproval?.toolId).toBe("apply_patch");
    expect(result.pendingApproval?.toolCallId).toBe("tc-3");
  });

  it("re-reads a rejected patch and safely falls back to files.write", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    vi.mocked(transportWithFile.readFile).mockClear();
    const transport = {
      ...transportWithFile,
      writeFile,
      createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-recovery-1",
          toolId: "apply_patch",
          inputs: { path: "index.html", patches: [{ search: "stale content", replace: "new content" }] },
        }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-recovery-2",
          toolId: "files.write",
          inputs: {
            projectId: "p-test",
            path: "index.html",
            content: "<footer>Ember Roast · Freshly roasted.</footer>",
          },
        }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({ text: "The file was updated safely.", toolCalls: [], finishReason: "stop", model: "test-model" });

    const result = await runAgentLoopV2("change the footer", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    expect(transportWithFile.readFile).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledWith("index.html", "<footer>Ember Roast · Freshly roasted.</footer>");
    expect(result.pendingApproval).toBeUndefined();
    expect(result.finalText).toContain("updated safely");
    expect(result.toolCalls.some((tool) => tool.toolId === "apply_patch" && !tool.success)).toBe(true);
    expect(result.toolCalls.some((tool) => tool.toolId === "files.write" && tool.success)).toBe(true);
  });

  it("stops truthfully when the model repeats the rejected patch", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "",
      toolCalls: [{
        toolCallId: "tc-repeat",
        toolId: "apply_patch",
        inputs: { path: "index.html", patches: [{ search: "stale content", replace: "new content" }] },
      }],
      finishReason: "tool_calls",
      model: "test-model",
    });

    const result = await runAgentLoopV2("change the footer", transportWithFile, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    expect(result.cancelled).toBe(true);
    expect(result.finalText).toContain("No mutation was executed");
    expect(result.toolCalls.filter((tool) => tool.toolId === "apply_patch")).toHaveLength(2);
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(2);
  });
});

describe("runAgentLoopV2 — files.write placeholder content never reaches the approval gate", () => {
  // Production defect: a full-file rewrite of index.html shipped
  // `<title>[PERSON_NAME] — Premium Coffee Roasters</title>` — the model
  // substituted a template slot for the literal brand name, and the
  // placeholder guard only covered apply_patch, so files.write persisted
  // the token verbatim.
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("a write containing an unresolved placeholder becomes a tool error, not an approval pause", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-w1",
          toolId: "files.write",
          inputs: {
            projectId: "p-test",
            path: "index.html",
            content: "<html><title>[PERSON_NAME] — Premium Coffee Roasters</title></html>",
          },
        }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Rewrote the file with the literal brand name.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "rewrite index.html for Ember Roast",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.pendingApproval).toBeUndefined();
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(2);
    expect(result.finalText).toContain("literal brand name");
    expect(result.toolCalls.some((t) => t.toolId === "files.write" && !t.success)).toBe(true);
  });

  it("a clean files.write still pauses for approval normally", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "",
      toolCalls: [{
        toolCallId: "tc-w2",
        toolId: "files.write",
        inputs: {
          projectId: "p-test",
          path: "index.html",
          content: "<html><title>Ember Roast — Premium Coffee Roasters</title></html>",
        },
      }],
      finishReason: "tool_calls",
      model: "test-model",
    });

    const result = await runAgentLoopV2(
      "rewrite index.html for Ember Roast",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(result.pendingApproval?.toolCallId).toBe("tc-w2");
  });

  it("does not report a handler-level write failure as a successful mutation", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-w3",
          toolId: "files.write",
          inputs: {
            projectId: "p-test",
            path: "index.html",
            content: "<html><body>Fresh site</body></html>",
          },
        }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "The workspace write failed and the site is not complete.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "Create the website files",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
      },
    );

    const writeLog = result.toolCalls.find((tool) => tool.toolId === "files.write");
    expect(writeLog?.success).toBe(false);
    expect(writeLog?.mutating).toBe(true);
    expect(result.finalText).toContain("write failed");
  });
});
