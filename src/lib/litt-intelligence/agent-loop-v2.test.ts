import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2, resumeAgentLoopV2, announcesMoreWork, resolveZeroToolCalls, type ResumeInput } from "./agent-loop-v2";
import type { ProgressEvent } from "./progress-events";
import { callLLMWithTools, AgentBudgetExhaustedError } from "./llm-tool-calling";
import { toolRegistry } from "./tool-registry";

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

    // The third read is the post-write persisted-change verification.
    expect(transportWithFile.readFile).toHaveBeenCalledTimes(3);
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

describe("runAgentLoopV2 — multi-minute run with repeated file patches", () => {
  // Production defect (2026-09-21): a website build ran ~7 minutes into
  // file patch/edit operations, then vanished — "the previous run ended
  // before it produced a result". Tool executions had no deadline, so a
  // single wedged workspace call could strand the run outside every
  // budget check. These tests pin both halves of the fix: a long
  // patch-heavy run completes, and a wedged write fails the TOOL — never
  // the run.
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePatchTransport(initialContent: string) {
    let fileContent = initialContent;
    const appliedPatches: Array<{ search: string; replace: string }> = [];
    const transport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      readFile: vi.fn(async () => ({ content: fileContent, size: fileContent.length })),
      applyPatch: vi.fn(async (_path: string, patches: Array<{ search: string; replace: string }>) => {
        for (const p of patches) {
          if (!fileContent.includes(p.search)) {
            throw new Error(`search text not found`);
          }
          fileContent = fileContent.replace(p.search, p.replace);
          appliedPatches.push(p);
        }
        return { applied: true };
      }),
      writeFile: vi.fn(async (_path: string, content: string) => {
        fileContent = content;
        return { saved: true };
      }),
      createCheckpointBeforeMutation: vi.fn(async () => null),
    } as unknown as WorkspaceTransport;
    return { transport, appliedPatches, getContent: () => fileContent };
  }

  it("completes a run that spends minutes issuing sequential apply_patch calls", async () => {
    const { transport, appliedPatches, getContent } = makePatchTransport(
      "<html><body><h1>v0</h1><p>a</p><p>b</p><p>c</p><p>d</p></body></html>",
    );

    // Each model round "takes" a minute of wall clock — the run's own
    // deadline bookkeeping must see real elapsed time, so Date.now is
    // advanced rather than faked wholesale.
    let fakeNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => fakeNow);

    let step = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => {
      fakeNow += 60_000;
      step += 1;
      if (step <= 4) {
        return {
          text: "",
          toolCalls: [{
            toolCallId: `tc-patch-${step}`,
            toolId: "apply_patch",
            inputs: {
              path: "index.html",
              patches: [{ search: `<p>${"abcd"[step - 1]}</p>`, replace: `<p>patched-${step}</p>` }],
            },
          }],
          finishReason: "tool_calls",
          model: "test-model",
        };
      }
      return {
        text: "All four patches applied — the site is updated.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      };
    });

    const result = await runAgentLoopV2(
      "patch the landing page copy",
      transport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
      },
    );

    expect(result.pendingApproval).toBeUndefined();
    expect(result.cancelled).toBe(false);
    expect(appliedPatches).toHaveLength(4);
    expect(getContent()).toContain("patched-4");
    expect(result.toolCalls.filter((t) => t.toolId === "apply_patch" && t.success)).toHaveLength(4);
    expect(result.finalText).toContain("All four patches applied");
    // The run simulated >4 minutes of work — inside the runtime budget.
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(4 * 60_000);
  });

  it("a wedged workspace write fails the tool, not the run", async () => {
    // files.write declares timeoutMs — enforce a short bound for the test
    // and restore it so the singleton stays clean for other tests.
    const filesWriteDef = toolRegistry.get("files.write")!;
    const originalTimeout = filesWriteDef.timeoutMs;
    filesWriteDef.timeoutMs = 60;

    const wedgedTransport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
      // The exact production shape: the transport call never settles.
      writeFile: vi.fn(() => new Promise<{ saved: boolean }>(() => {})),
      createCheckpointBeforeMutation: vi.fn(async () => null),
    } as unknown as WorkspaceTransport;

    try {
      vi.mocked(callLLMWithTools)
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [{
            toolCallId: "tc-wedged",
            toolId: "files.write",
            inputs: { projectId: "p-test", path: "index.html", content: "<html>fresh</html>" },
          }],
          finishReason: "tool_calls",
          model: "test-model",
        })
        .mockResolvedValueOnce({
          text: "The write timed out — I retried and finished the site.",
          toolCalls: [],
          finishReason: "stop",
          model: "test-model",
        });

      const result = await runAgentLoopV2(
        "write the landing page",
        wedgedTransport,
        {
          model: "test-model",
          systemPrompt: "You are LiTT.",
          executionMode: "auto",
          enableBuildFix: false,
        },
      );

      const writeCall = result.toolCalls.find((t) => t.toolId === "files.write");
      expect(writeCall?.success).toBe(false);
      expect(
        result.events.some(
          (e) => e.type === "tool_result" && e.toolId === "files.write" && e.success === false,
        ),
      ).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(result.finalText).toContain("retried and finished");
      expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(2);
    } finally {
      filesWriteDef.timeoutMs = originalTimeout;
    }
  });
});

describe("runAgentLoopV2 — mid-build stall recovery", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("detects announced-but-unstarted work in a zero-tool-call reply", () => {
    expect(
      announcesMoreWork(
        "The Contact form component has been created with validation. Now, I'll create the Footer component.",
      ),
    ).toBe(true);
    expect(announcesMoreWork("Services section done. Next, I'll build the testimonials carousel.")).toBe(true);
    expect(announcesMoreWork("Let me generate the hero images.")).toBe(true);
  });

  it("does not treat plain prose as announced work", () => {
    expect(announcesMoreWork("Done — the site is complete.")).toBe(false);
    expect(announcesMoreWork("I did not run any tools and nothing was changed.")).toBe(false);
    expect(announcesMoreWork("")).toBe(false);
  });

  it("bounds the recovery nudges, then reports a stall instead of finishing", () => {
    const text = "Now, I'll create the Footer component.";
    expect(resolveZeroToolCalls(text, 0).action).toBe("nudge");
    expect(resolveZeroToolCalls(text, 1).action).toBe("nudge");
    expect(resolveZeroToolCalls(text, 2).action).toBe("stall");
    expect(resolveZeroToolCalls("Done.", 0).action).toBe("final");
  });

  it("nudges the model when it announces more work but emits no tool calls", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "The Contact form component has been created with validation. Now, I'll create the Footer component.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const result = await runAgentLoopV2(
      "Build the North Shore Outdoor Co. website",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    // The stall was recovered: the loop asked the model to continue
    // instead of reporting finished with half the build done.
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(2);
    const secondCallMessages = vi.mocked(callLLMWithTools).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      secondCallMessages.some((m) => m.role === "user" && m.content.includes("emitted no tool calls")),
    ).toBe(true);
    expect(result.finalText).toBe("Done.");
    expect(result.cancelled).toBe(false);
    expect(
      result.events.some(
        (e) => e.type === "status" && typeof e.summary === "string" && e.summary.includes("asking it to continue"),
      ),
    ).toBe(true);
  });

  it("fails honestly when the model keeps announcing work it never starts", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Services section done. Next, I'll build the testimonials carousel.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });

    const result = await runAgentLoopV2(
      "Build the North Shore Outdoor Co. website",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        maxSteps: 10,
      },
    );

    // Bounded nudges (2), then an honest stop — never a silent "finished".
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(3);
    expect(result.cancelled).toBe(true);
    expect(result.cancelReason).toContain("no tool calls");
    expect(result.finalText).toContain("stopped mid-build");
    expect(result.events.some((e) => e.type === "cancelled")).toBe(true);
  });

  it("still accepts a plain prose reply as the final answer", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done — the site is complete.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });

    const result = await runAgentLoopV2(
      "Build the North Shore Outdoor Co. website",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(1);
    expect(result.finalText).toBe("Done — the site is complete.");
    expect(result.cancelled).toBe(false);
  });
});

describe("runAgentLoopV2 — prose approval-ask stall guard", () => {
  // The exact #551 failure: the model asked for approval in prose instead
  // of emitting the approval-gated files.write tool call, and the run
  // settled "Complete" with zero mutations.
  const APPROVAL_ASK =
    "I'm ready to update index.html by adding <!-- marker --> as the very first line of the file. " +
    "Since this requires modifying workspace files, please confirm and give approval to apply the change.";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes a prose approval-ask to the nudge path, not final", () => {
    const r = resolveZeroToolCalls(APPROVAL_ASK, 0);
    expect(r.action).toBe("nudge");
    if (r.action === "nudge") {
      expect(r.nudgeMessage).toContain("files.write");
      expect(r.nudgeMessage).toContain("don't create approval cards");
    }
  });

  it("routes present-continuous work claims to the nudge path", () => {
    expect(
      resolveZeroToolCalls("Thanks for the approval. I'm adding the comment as the first line.", 0).action,
    ).toBe("nudge");
    expect(resolveZeroToolCalls("I'm updating the header styles now.", 0).action).toBe("nudge");
  });

  it("fails honestly — never completes — when nudges are exhausted", () => {
    const r = resolveZeroToolCalls(APPROVAL_ASK, 2);
    expect(r.action).toBe("fail");
    if (r.action === "fail") {
      expect(r.failureMessage).toContain("no approval card was created");
      expect(r.failureMessage).toContain("no files were changed");
    }
  });

  it("still treats plain prose as final", () => {
    expect(resolveZeroToolCalls("Done — the site is complete.", 0).action).toBe("final");
    expect(resolveZeroToolCalls("Which file should I update?", 0).action).toBe("final");
  });

  it("routes ACT-mode deferral phrasing to the nudge path (explicit build requests)", () => {
    // The 2026-10-30 Studio regression: an explicit "build my website"
    // request got a plan + a prose approval ask ("...then ask for your
    // approval to write it to the project. How does that sound?") — no
    // tool call, no approval card, run settled "Complete" untouched.
    const deferrals = [
      "I can't create the file on this turn, but if you're ready, I'll draft the initial index.html content with these sections and the base styling, then ask for your approval to write it to the project. How does that sound?",
      "Here's the plan for the landing page. Shall I proceed?",
      "I can write index.html for you — want me to go ahead?",
      "Ready when you are — confirm and I'll create the file.",
    ];
    for (const text of deferrals) {
      expect(resolveZeroToolCalls(text, 0).action, text).toBe("nudge");
    }
    // Exhausted nudges still fail honestly, never complete.
    expect(resolveZeroToolCalls(deferrals[0], 2).action).toBe("fail");
  });

  it("fails the run honestly when the model keeps asking for approval in prose", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: APPROVAL_ASK,
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });

    const result = await runAgentLoopV2(
      "Add an HTML comment as the first line of index.html",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        maxSteps: 10,
      },
    );

    // 1 initial + 2 nudges, then honest failure — never "completed".
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(3);
    expect(result.cancelled).toBe(false);
    expect(result.failedHonestly).toContain("no approval card was created");
    expect(result.finalText).toBe(result.failedHonestly);

    // The nudge told the model exactly what to do: emit the tool call.
    const secondCallMessages = vi.mocked(callLLMWithTools).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      secondCallMessages.some((m) => m.role === "user" && m.content.includes("files.write")),
    ).toBe(true);
  });
});

describe("runAgentLoopV2 — required first tool call (immediate execution)", () => {
  // Release-blocker regression (2026-10-29): an execution-required Studio
  // build opened with a text-only QUALITY-marker reply and toolCalls:[] —
  // the Gemini adapter never received the "required" tool choice, and the
  // loop accepted the stage declaration as the final answer. The run must
  // hold "required" until a tool call is actually emitted, and a
  // text-only reply before the first call can never resolve "final".
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  const execCfg = {
    model: "gemini-2.5-flash",
    systemPrompt: "You are LiTT.",
    executionMode: "auto" as const,
    enableBuildFix: false,
    requireToolCallOnFirstStep: true,
  };

  function callToolChoice(index: number): string | undefined {
    const opts = vi.mocked(callLLMWithTools).mock.calls[index]?.[3] as
      | { toolChoice?: string }
      | undefined;
    return opts?.toolChoice;
  }

  it("resolveZeroToolCalls: pending required call nudges then fails — never 'final'", () => {
    expect(
      resolveZeroToolCalls("QUALITY: understand — captured the brief.", 0, {
        requiredToolCallPending: true,
      }).action,
    ).toBe("nudge");
    expect(
      resolveZeroToolCalls("Done — the site is complete.", 1, {
        requiredToolCallPending: true,
      }).action,
    ).toBe("nudge");
    const exhausted = resolveZeroToolCalls("Done.", 2, { requiredToolCallPending: true });
    expect(exhausted.action).toBe("fail");
    // Without the flag the same plain prose stays a final answer.
    expect(resolveZeroToolCalls("Done.", 0).action).toBe("final");
    expect(resolveZeroToolCalls("QUALITY: understand — noted.", 0).action).toBe("final");
  });

  it("a text-only QUALITY-marker first reply is nudged back to execution, then a real write lands", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const transport = {
      ...fakeTransport,
      writeFile,
      readFile: vi.fn(async () => ({ content: "<html>Built.</html>", size: 18 })),
      createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    } as unknown as WorkspaceTransport;

    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "QUALITY: understand — a landing page for the coffee brand.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-2.5-flash",
      })
      .mockResolvedValueOnce({
        text: "QUALITY: build — writing index.html",
        toolCalls: [{
          toolCallId: "tc-exec-1",
          toolId: "files.write",
          inputs: { projectId: "p-test", path: "index.html", content: "<html>Built.</html>" },
        }],
        finishReason: "tool_calls",
        model: "gemini-2.5-flash",
      })
      .mockResolvedValueOnce({
        text: "Built the landing page.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-2.5-flash",
      });

    const result = await runAgentLoopV2("build my coffee landing page", transport, execCfg);

    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(3);
    // "required" is held until a tool call is actually emitted, then "auto".
    expect(callToolChoice(0)).toBe("required");
    expect(callToolChoice(1)).toBe("required");
    expect(callToolChoice(2)).toBe("auto");

    // The text-only reply produced a nudge, not a final answer.
    const secondCallMessages = vi.mocked(callLLMWithTools).mock.calls[1][1] as Array<{
      role: string;
      content: string;
    }>;
    expect(
      secondCallMessages.some((m) => m.role === "user" && m.content.includes("emit the tool calls")),
    ).toBe(true);

    // One explicit build prompt → one real file write.
    expect(writeFile).toHaveBeenCalledWith("index.html", "<html>Built.</html>");
    expect(result.toolCalls.some((t) => t.toolId === "files.write" && t.success)).toBe(true);
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toBe("Built the landing page.");
  });

  it("fails honestly — never 'final' — when the model never emits a tool call", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "QUALITY: understand — planning the site structure.",
      toolCalls: [],
      finishReason: "stop",
      model: "gemini-2.5-flash",
    });

    const result = await runAgentLoopV2("build my landing page", fakeTransport, {
      ...execCfg,
      maxSteps: 10,
    });

    // 1 initial + 2 bounded nudges, then an honest failure.
    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) expect(callToolChoice(i)).toBe("required");
    expect(result.cancelled).toBe(false);
    expect(result.failedHonestly).toContain("no files were changed");
    expect(result.finalText).toBe(result.failedHonestly);
  });

  it("still accepts plain prose as final when the flag is off", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done — the site is complete.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });

    const result = await runAgentLoopV2("build a tiny landing page", fakeTransport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    });

    expect(vi.mocked(callLLMWithTools)).toHaveBeenCalledTimes(1);
    expect(callToolChoice(0)).toBe("auto");
    expect(result.finalText).toBe("Done — the site is complete.");
  });
});

describe("runAgentLoopV2 — persistEvent hook (item 5a)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });
  });

  it("offers loop events to persistEvent in emit order", async () => {
    const seen: ProgressEvent[] = [];
    const result = await runAgentLoopV2(
      "build a tiny landing page",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        persistEvent: async (event) => {
          seen.push(event);
        },
      },
    );

    expect(result.cancelled).toBe(false);
    // The persistence chain drains asynchronously after the loop returns —
    // wait for the final event rather than assuming it already landed.
    const deadline = Date.now() + 10_000;
    while (!seen.some((e) => e.type === "finished") && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // The hook is offered the loop's full event stream in emit order.
    // (Filtering stream noise is the mapping layer's job — see
    // progress-event-persistence.test.ts.)
    expect(seen.map((e) => e.type)).toEqual(result.events.map((e) => e.type));
  });

  it("a rejecting persistEvent never breaks the run", async () => {
    const errors: unknown[] = [];
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      const result = await runAgentLoopV2(
        "build a tiny landing page",
        fakeTransport,
        {
          model: "test-model",
          systemPrompt: "You are LiTT.",
          executionMode: "act",
          enableBuildFix: false,
          persistEvent: async () => {
            throw new Error("db down");
          },
        },
      );
      expect(result.cancelled).toBe(false);
      expect(result.events.some((e) => e.type === "finished")).toBe(true);
      // The failure was logged, not thrown.
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("is optional — the loop behaves identically without it", async () => {
    const result = await runAgentLoopV2(
      "build a tiny landing page",
      fakeTransport,
      {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );
    expect(result.cancelled).toBe(false);
    expect(result.events.some((e) => e.type === "finished")).toBe(true);
  });
});

describe("runAgentLoopV2 — build capability guard", () => {
  const transportWithRead = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    readFile: vi.fn(async () => ({ content: "hello", size: 5 })),
    createCheckpointBeforeMutation: vi.fn(async () => null),
  } as unknown as WorkspaceTransport;

  beforeEach(async () => {
    vi.mocked(callLLMWithTools).mockReset();
    // Reset registry learning so the guard test starts from seed state.
    const { _resetModelRegistryForTests } = await import("./model-registry");
    const { _resetProviderHealthForTests } = await import("./provider-registry");
    _resetModelRegistryForTests();
    _resetProviderHealthForTests();
  });

  function readOnlyStep(model: string, provider: string, n: number) {
    return {
      text: "",
      toolCalls: [{
        toolCallId: `tc-read-${n}`,
        toolId: "files.read",
        inputs: { projectId: "p-test", path: "index.html" },
      }],
      finishReason: "tool_calls",
      model,
      provider,
    };
  }

  it("rules out a read-only model after 3 zero-write steps and switches the build model", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(readOnlyStep("cohere/north-mini-code:free", "openrouter", 1))
      .mockResolvedValueOnce(readOnlyStep("cohere/north-mini-code:free", "openrouter", 2))
      .mockResolvedValueOnce(readOnlyStep("cohere/north-mini-code:free", "openrouter", 3))
      .mockResolvedValueOnce({
        text: "Done — wrote the files.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-flash-latest",
        provider: "gemini",
      });

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      transportWithRead,
      {
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        maxSteps: 10,
        buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
      },
    );

    // Guard fired: structured evidence event naming the incompatible model.
    const incompatible = result.events.filter((e) => e.type === "build_model_incompatible");
    expect(incompatible).toHaveLength(1);
    expect(incompatible[0]).toMatchObject({
      canonicalId: "openrouter-north-mini-code",
      provider: "openrouter",
      stepsObserved: 3,
      zeroWriteSteps: 3,
      reason: "no_file_write_calls_in_window",
    });

    // The 4th step was routed to the next eligible registry build model.
    const fourthCall = vi.mocked(callLLMWithTools).mock.calls[3];
    expect(fourthCall[3]).toMatchObject({ model: "gemini-flash-latest" });

    // The run continued the same conversation instead of failing.
    expect(result.failedHonestly).toContain("no successful file-writing operation");
    expect(result.modelFailed).toBeUndefined();
  });

  it("fails with NO_BUILD_CAPABLE_MODEL when the build-model chain is exhausted", async () => {
    // The mock honors the model hint: whatever the guard switches to, that
    // model serves the next window — still read-only. The guard walks the
    // whole registry build chain until nothing remains.
    // Vary the read path per step: the loop's repeated-tool-call circuit
    // breaker cancels identical calls with no intervening mutation.
    let stepNo = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async (_systemPrompt, _messages, _tools, opts) => {
      const hinted = (opts as { model?: string } | undefined)?.model;
      const model = hinted ?? "cohere/north-mini-code:free";
      const provider = model.startsWith("gemini") ? "gemini" : "openrouter";
      stepNo += 1;
      return {
        text: "",
        toolCalls: [{ toolCallId: `tc-step-${stepNo}`, toolId: "files.read", inputs: { projectId: "p-test", path: `file-${stepNo}.html` } }],
        finishReason: "tool_calls",
        model,
        provider,
      };
    });

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      transportWithRead,
      {
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        maxSteps: 40,
        buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
      },
    );

    expect(result.modelFailed).toBe("NO_BUILD_CAPABLE_MODEL");
    expect(result.modelFailureText).toContain("No build-capable model is available");
    // Chain: north-mini-code → gemini-flash → gemini-2.5-flash →
    // nemotron-3-super → laguna-s-2.1 → nemotron-3-ultra → gemma-4-31b →
    // exhausted. 7 windows × 3 steps = 21 calls, bounded far below
    // maxSteps. (qwen3.8-27b:free is tool-capable but not run-proven as
    // a file writer, so it never enters the build chain.)
    expect(vi.mocked(callLLMWithTools).mock.calls.length).toBe(21);
  });

  it("resets the window when the model finally writes", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(readOnlyStep("gemini-flash-latest", "gemini", 1))
      .mockResolvedValueOnce(readOnlyStep("gemini-flash-latest", "gemini", 2))
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-write-1",
          toolId: "files.write",
          inputs: { projectId: "p-test", path: "index.html", content: "<h1>hi</h1>" },
        }],
        finishReason: "tool_calls",
        model: "gemini-flash-latest",
        provider: "gemini",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-flash-latest",
        provider: "gemini",
      });

    const writeFile = vi.fn(async () => undefined);
    const transport = {
      ...transportWithRead,
      writeFile,
    } as unknown as WorkspaceTransport;

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      transport,
      {
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxSteps: 10,
        buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
      },
    );

    // Two read-only steps then a write: guard never fired, no model switch.
    expect(result.events.some((e) => e.type === "build_model_incompatible")).toBe(false);
    expect(writeFile).toHaveBeenCalled();
    expect(result.finalText).toBe("Done.");
  });

  it("the switched build model writes files — guard triggers, next model writes, files land", async () => {
    const writeFile = vi.fn(async () => undefined);
    const transport = {
      ...transportWithRead,
      writeFile,
    } as unknown as WorkspaceTransport;

    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(readOnlyStep("cohere/north-mini-code:free", "openrouter", 1))
      .mockResolvedValueOnce(readOnlyStep("cohere/north-mini-code:free", "openrouter", 2))
      .mockResolvedValueOnce(readOnlyStep("cohere/north-mini-code:free", "openrouter", 3))
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{
          toolCallId: "tc-write-1",
          toolId: "files.write",
          inputs: { projectId: "p-test", path: "index.html", content: "<h1>hi</h1>" },
        }],
        finishReason: "tool_calls",
        model: "gemini-flash-latest",
        provider: "gemini",
      })
      .mockResolvedValue({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "gemini-flash-latest",
        provider: "gemini",
      });

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      transport,
      {
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxSteps: 10,
        buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
      },
    );

    // The guard fired on the read-only model and switched the build model.
    const incompatible = result.events.filter((e) => e.type === "build_model_incompatible");
    expect(incompatible).toHaveLength(1);
    expect(incompatible[0]).toMatchObject({ canonicalId: "openrouter-north-mini-code" });
    const fourthCall = vi.mocked(callLLMWithTools).mock.calls[3];
    expect(fourthCall[3]).toMatchObject({ model: "gemini-flash-latest" });

    // The switched model emitted a file write and it actually executed.
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("index.html", "<h1>hi</h1>");
    expect(result.toolCalls.some((t) => t.toolId === "files.write" && t.success)).toBe(true);
    expect(result.modelFailed).toBeUndefined();
    expect(result.finalText).toBe("Done.");
  });

  it("NO_BUILD_CAPABLE_MODEL carries per-model evidence for every model tried", async () => {
    // Same hint-honoring mock as the exhaustion test: whatever model the
    // guard switches to serves the next window, still read-only.
    let stepNo = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async (_systemPrompt, _messages, _tools, opts) => {
      const hinted = (opts as { model?: string } | undefined)?.model;
      const model = hinted ?? "cohere/north-mini-code:free";
      const provider = model.startsWith("gemini") ? "gemini" : "openrouter";
      stepNo += 1;
      return {
        text: "",
        toolCalls: [{ toolCallId: `tc-ev-${stepNo}`, toolId: "files.read", inputs: { projectId: "p-test", path: `ev-${stepNo}.html` } }],
        finishReason: "tool_calls",
        model,
        provider,
      };
    });

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      transportWithRead,
      {
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        maxSteps: 40,
        buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 },
      },
    );

    expect(result.modelFailed).toBe("NO_BUILD_CAPABLE_MODEL");
    // Per-model evidence: every ruled-out model named with its reason —
    // the failure text must not be a bare "no models available".
    for (const id of [
      "openrouter-north-mini-code",
      "gemini-flash",
      "gemini-2.5-flash",
      "openrouter-gemma-4-31b",
    ]) {
      expect(result.modelFailureText).toContain(id);
    }
    expect(result.modelFailureText).toContain("zero file-writing calls");
    // Structured events back the text: one per ruled-out window.
    const incompatible = result.events.filter((e) => e.type === "build_model_incompatible");
    expect(incompatible.length).toBeGreaterThanOrEqual(4);
  });
});

describe("BUILD resume completion evidence", () => {
  beforeEach(() => vi.mocked(callLLMWithTools).mockReset());

  function resumeInput(): ResumeInput {
    return {
      pausedMessages: [{ role: "user", content: "Build a site" }],
      toolId: "files.mkdir", toolCallId: "mkdir-1", inputs: { path: "assets" }, decision: "approved",
      stepsUsedBeforePause: 1, hadInterveningMutation: false,
      config: { systemPrompt: "Build the site", userId: "u-test", executionMode: "auto", enableBuildFix: false, isStaticWorkspace: true, buildCapabilityGuard: { maxStepsWithoutFileWrite: 3 } },
    };
  }

  it("does not accept a completion claim after only creating a directory", async () => {
    vi.mocked(callLLMWithTools).mockResolvedValue({ text: "Done.", toolCalls: [], finishReason: "stop", model: "test" });
    const transport = { ...fakeTransport, mkdir: vi.fn(async () => ({ created: true })) } as unknown as WorkspaceTransport;
    const result = await resumeAgentLoopV2(resumeInput(), transport);
    expect(result.failedHonestly).toContain("no successful file-writing operation");
  });

  it("bounds a resumed read-only run at three steps", async () => {
    let step = 0;
    vi.mocked(callLLMWithTools).mockImplementation(async () => ({ text: "", toolCalls: [{ toolId: "files.read", toolCallId: `read-${++step}`, inputs: { projectId: "p-test", path: `page-${step}.html` } }], finishReason: "tool_calls", model: "test" }));
    const transport = { ...fakeTransport, mkdir: vi.fn(async () => ({ created: true })), readFile: vi.fn(async () => ({ content: "<html/>", size: 7 })) } as unknown as WorkspaceTransport;
    const result = await resumeAgentLoopV2(resumeInput(), transport);
    expect(callLLMWithTools).toHaveBeenCalledTimes(3);
    expect(result.failedHonestly).toContain("3 steps");
  });
});

describe("runAgentLoopV2 — model routing evidence", () => {
  beforeEach(async () => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.unstubAllEnvs();
    const { _resetModelRegistryForTests } = await import("./model-registry");
    const { _resetProviderHealthForTests } = await import("./provider-registry");
    _resetModelRegistryForTests();
    _resetProviderHealthForTests();
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "gemini-flash-latest",
      provider: "gemini",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits model_routing with canonicalId + provider and no secret material", async () => {
    vi.stubEnv("GEMINI_API_KEY", "sk-fake-gemini-secret-abc123");

    const result = await runAgentLoopV2(
      "say hi",
      fakeTransport,
      {
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        maxSteps: 5,
      },
    );

    const routing = result.events.filter((e) => e.type === "model_routing");
    expect(routing).toHaveLength(1);
    expect(routing[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-flash-latest",
      canonicalId: "gemini-flash",
      configSource: "registry",
    });
    expect(typeof (routing[0] as { latencyMs?: unknown }).latencyMs).toBe("number");
    // No secrets in the run evidence payload.
    const payload = JSON.stringify(routing[0]);
    expect(payload).not.toContain("sk-fake-gemini-secret-abc123");
  });
});

/**
 * Persisted-truth read-back coverage for the mutators issue #703 named:
 * files.mkdir, project.insert_asset, image.generate's saved asset, and
 * preview.* — plus the per-claim evidence multi-file builds need. On a
 * gitless (static) workspace this read-back is the ONLY channel that can
 * verify a claimed mutation, so each claim must produce it.
 */
describe("runAgentLoopV2 — mutation read-back coverage (gitless/static workspaces)", () => {
  const PNG_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [{ toolCallId, toolId, inputs }],
      finishReason: "tool_calls",
      model: "test-model",
    };
  }
  const doneReply = { text: "Done.", toolCalls: [], finishReason: "stop", model: "test-model" };

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("files.mkdir records persisted:true when the directory is really there", async () => {
    const transport = {
      ...fakeTransport,
      mkdir: vi.fn(async () => ({ created: true })),
      listFiles: vi.fn(async (p: string) =>
        p === "." ? { entries: [{ name: "assets", type: "folder" }] } : { entries: [] }),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-mkdir", "files.mkdir", { path: "assets" }))
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2("make an assets folder", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    const call = result.toolCalls.find((t) => t.toolId === "files.mkdir");
    expect(call?.success).toBe(true);
    expect(call?.persisted).toBe(true);
    expect(call?.paths).toContain("assets");
  });

  it("files.mkdir records persisted:false when the directory is not there", async () => {
    const transport = {
      ...fakeTransport,
      mkdir: vi.fn(async () => ({ created: true })),
      listFiles: vi.fn(async () => ({ entries: [] })),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-mkdir2", "files.mkdir", { path: "assets" }))
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2("make an assets folder", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    expect(result.toolCalls.find((t) => t.toolId === "files.mkdir")?.persisted).toBe(false);
  });

  // project.insert_asset and preview.start sit outside the AUTO
  // auto-approve set — they pause at a gate, then the approved resume
  // executes them (exercising the resume lane's read-back too).
  async function approveGate(
    paused: Awaited<ReturnType<typeof runAgentLoopV2>>,
    transport: WorkspaceTransport,
  ) {
    const gate = paused.pendingApproval;
    expect(gate).toBeDefined();
    return resumeAgentLoopV2({
      pausedMessages: gate!.pausedMessages,
      toolId: gate!.toolId,
      toolCallId: gate!.toolCallId,
      inputs: gate!.inputs,
      decision: "approved",
      config: {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
      },
      stepsUsedBeforePause: gate!.stepsUsedAtPause ?? 1,
      hadInterveningMutation: gate!.hadInterveningMutationAtPause ?? false,
      priorToolCalls: gate!.priorToolCalls,
    }, transport);
  }

  it("an approval pause carries the pre-pause mutation history into the resumed run's evidence", async () => {
    // files.write auto-approves and runs FIRST; preview.start then pauses.
    // The pre-pause write's read-back evidence must survive the boundary —
    // otherwise a contradicted pre-pause claim can be masked post-resume.
    const disk = new Map<string, string>();
    const transport = {
      ...fakeTransport,
      writeFile: vi.fn(async (path: string, content: string) => {
        disk.set(path, content);
        return { saved: true };
      }),
      readFile: vi.fn(async (path: string) => {
        const content = disk.get(path);
        if (content === undefined) throw new Error("readFile failed (404): not found");
        return { content, size: content.length };
      }),
      startPreview: vi.fn(async () => ({
        workspaceId: "ws-test", status: "ready", port: 3000,
        framework: "static", command: "serve", startedAt: Date.now(),
      })),
      getPreviewStatus: vi.fn(async () => ({
        status: "ready", port: 3000, framework: "static", command: "serve",
        startedAt: Date.now(), lastHealthCheck: Date.now(),
        error: null, errorCode: null, logs: [],
      })),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-w", "files.write", { projectId: "p-test", path: "index.html", content: "<html>ok</html>" }))
      .mockResolvedValueOnce(toolCallReply("tc-p", "preview.start", { projectId: "p-test" }))
      .mockResolvedValueOnce(doneReply);

    const paused = await runAgentLoopV2("write the file then start preview", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    // The paused run's own log has the pre-pause write; the gate record
    // must carry it across the boundary for the resumed run.
    expect(paused.toolCalls.some((t) => t.toolId === "files.write" && t.persisted === true)).toBe(true);
    expect(paused.pendingApproval?.priorToolCalls?.some((t) => t.toolId === "files.write")).toBe(true);

    const resumed = await approveGate(paused, transport);

    // The resumed run's evidence covers the WHOLE run — the pre-pause
    // verified write AND the resumed-lane preview claim are both visible.
    expect(resumed.toolCalls.some((t) => t.toolId === "files.write" && t.persisted === true)).toBe(true);
    expect(resumed.toolCalls.some((t) => t.toolId === "preview.start" && t.persisted === true)).toBe(true);
  });

  it("project.insert_asset records persisted:true via the returned asset path — binary-safe", async () => {
    let written = "";
    const transport = {
      ...fakeTransport,
      writeBinaryFile: vi.fn(async (path: string) => {
        written = path;
        return { saved: true };
      }),
      listFiles: vi.fn(async (p: string) => {
        if (p === "assets" && written) {
          return { entries: [{ name: written.slice("assets/".length), type: "file" }] };
        }
        return { entries: [] };
      }),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-asset", "project.insert_asset", {
        projectId: "p-test",
        url: `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
        name: "hero",
        directory: "assets",
      }))
      .mockResolvedValueOnce(doneReply);

    const paused = await runAgentLoopV2("put this image in the site", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    const result = await approveGate(paused, transport);

    const call = result.toolCalls.find((t) => t.toolId === "project.insert_asset");
    expect(call?.success).toBe(true);
    expect(written).toMatch(/^assets\/hero-.+\.png$/);
    expect(call?.persisted).toBe(true);
    // The real output path — not just the declared directory — is what
    // the diff attribution can corroborate against.
    expect(call?.paths).toContain(written);
  });

  it("preview.start records persisted:true when the status probe reports ready", async () => {
    const transport = {
      ...fakeTransport,
      startPreview: vi.fn(async () => ({
        workspaceId: "ws-test", status: "ready", port: 3000,
        framework: "static", command: "serve", startedAt: Date.now(),
      })),
      getPreviewStatus: vi.fn(async () => ({
        status: "ready", port: 3000, framework: "static", command: "serve",
        startedAt: Date.now(), lastHealthCheck: Date.now(),
        error: null, errorCode: null, logs: [],
      })),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-prev", "preview.start", { projectId: "p-test" }))
      .mockResolvedValueOnce(doneReply);

    const paused = await runAgentLoopV2("start the preview", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    const result = await approveGate(paused, transport);

    const call = result.toolCalls.find((t) => t.toolId === "preview.start");
    expect(call?.success).toBe(true);
    expect(call?.persisted).toBe(true);
  });

  it("preview.start records persisted:false when the status probe reports failed", async () => {
    const transport = {
      ...fakeTransport,
      startPreview: vi.fn(async () => ({
        workspaceId: "ws-test", status: "starting", port: 3000,
        framework: "static", command: "serve", startedAt: Date.now(),
      })),
      getPreviewStatus: vi.fn(async () => ({
        status: "failed", port: null, framework: null, command: null,
        startedAt: null, lastHealthCheck: null,
        error: "port closed", errorCode: null, logs: [],
      })),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-prev2", "preview.start", { projectId: "p-test" }))
      .mockResolvedValueOnce(doneReply);

    const paused = await runAgentLoopV2("start the preview", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });
    const result = await approveGate(paused, transport);

    const call = result.toolCalls.find((t) => t.toolId === "preview.start");
    expect(call?.success).toBe(true);
    expect(call?.persisted).toBe(false);
  });

  it("a multi-file build records per-claim persisted evidence — verified and contradicted independently", async () => {
    const disk = new Map<string, string>([
      ["index.html", "<html>ok</html>"],
      ["style.css", "body{}"],
      // The third write claimed bytes that never landed.
      ["app.js", "stale();"],
    ]);
    const transport = {
      ...fakeTransport,
      writeFile: vi.fn(async (path: string, content: string) => {
        if (path !== "app.js") disk.set(path, content);
        return { saved: true };
      }),
      readFile: vi.fn(async (path: string) => {
        const content = disk.get(path);
        if (content === undefined) throw new Error("readFile failed (404): not found");
        return { content, size: content.length };
      }),
    } as unknown as WorkspaceTransport;
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolCallReply("tc-a", "files.write", { projectId: "p-test", path: "index.html", content: "<html>ok</html>" }))
      .mockResolvedValueOnce(toolCallReply("tc-b", "files.write", { projectId: "p-test", path: "style.css", content: "body{}" }))
      .mockResolvedValueOnce(toolCallReply("tc-c", "files.write", { projectId: "p-test", path: "app.js", content: "fresh();" }))
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2("build the three files", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    const writes = result.toolCalls.filter((t) => t.toolId === "files.write");
    expect(writes).toHaveLength(3);
    expect(writes.find((t) => t.paths?.includes("index.html"))?.persisted).toBe(true);
    expect(writes.find((t) => t.paths?.includes("style.css"))?.persisted).toBe(true);
    // app.js never landed — the claim must be contradicted, not masked.
    expect(writes.find((t) => t.paths?.includes("app.js"))?.persisted).toBe(false);
  });
});

// ─── Read-back regression: replay + sequential patches ─────────────

describe("runAgentLoopV2 — replay carries the original persisted verdict", () => {
  function reply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return { text: "", toolCalls: [{ toolCallId, toolId, inputs }], finishReason: "tool_calls", model: "test-model" };
  }
  const doneReply = { text: "Done.", toolCalls: [], finishReason: "stop", model: "test-model" };

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("a failover replay logs persisted:true, not an unverifiable claim", async () => {
    // Gitless (static) workspace: the ONLY evidence a mutation persisted
    // is the post-call read-back — the replayed entry used to carry no
    // persisted flag at all, so the run was saved as failed despite the
    // verified write.
    const disk = new Map<string, string>();
    const transport = {
      ...fakeTransport,
      writeFile: vi.fn(async (path: string, content: string) => {
        disk.set(path, content);
        return { saved: true };
      }),
      readFile: vi.fn(async (path: string) => {
        const content = disk.get(path);
        if (content === undefined) throw new Error("readFile failed (404): not found");
        return { content, size: content.length };
      }),
    } as unknown as WorkspaceTransport;

    const inputs = { projectId: "p-test", path: "index.html", content: "<html>ok</html>" };
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(reply("tc-1", "files.write", inputs))
      // A replacement provider re-emits the identical call after failover.
      .mockResolvedValueOnce(reply("tc-2", "files.write", inputs))
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2("write index.html", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    const writes = result.toolCalls.filter((t) => t.toolId === "files.write");
    expect(writes).toHaveLength(2);
    // The mutation really executed once — the second was a replay.
    expect(transport.writeFile).toHaveBeenCalledTimes(1);
    expect(writes[0].persisted).toBe(true);
    expect(writes[1].summary).toContain("skipped");
    // The replay must carry the original read-back verdict — this was
    // undefined before the fix, leaving a successful mutation unverifiable.
    expect(writes[1].persisted).toBe(true);
    // The replayed message must carry the RESULT PAYLOAD, not the
    // ToolCallResult wrapper (would contain toolCallId/success fields).
    const thirdCallMessages = JSON.stringify(vi.mocked(callLLMWithTools).mock.calls[2][2] ?? []);
    expect(thirdCallMessages).toContain("saved");
    expect(thirdCallMessages).not.toContain("tc-2");
  });
});

describe("runAgentLoopV2 — sequential apply_patch read-back", () => {
  function reply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return { text: "", toolCalls: [{ toolCallId, toolId, inputs }], finishReason: "tool_calls", model: "test-model" };
  }
  const doneReply = { text: "Done.", toolCalls: [], finishReason: "stop", model: "test-model" };

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  function patchTransport(finalContent: string) {
    return {
      ...fakeTransport,
      applyPatch: vi.fn(async (path: string) => {
        // The call reports success; finalContent is what ACTUALLY landed.
        disk.set(path, finalContent);
        return { applied: true };
      }),
      readFile: vi.fn(async (path: string) => {
        const content = disk.get(path);
        if (content === undefined) throw new Error("readFile failed (404): not found");
        return { content, size: content.length };
      }),
    } as unknown as WorkspaceTransport;
  }

  let disk: Map<string, string>;
  beforeEach(() => { disk = new Map([["f.txt", "A B"]]); });

  it("verifies A→B, B→C, B→D as persisted when the terminal strings landed", async () => {
    const transport = patchTransport("C D");
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(reply("tc-1", "apply_patch", {
        path: "f.txt",
        patches: [
          { search: "A", replace: "B" },
          { search: "B", replace: "C" },
          { search: "B", replace: "D" },
        ],
      }))
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2("patch f.txt", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    const patch = result.toolCalls.find((t) => t.toolId === "apply_patch");
    expect(patch?.success).toBe(true);
    // Before the fix every intermediate replacement had to survive —
    // "B" is gone from "C D", so a correct patch read back as failed.
    expect(patch?.persisted).toBe(true);
  });

  it("still contradicts a patch whose terminal replacement never landed", async () => {
    const transport = patchTransport("C B"); // the B→D step never persisted
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(reply("tc-1", "apply_patch", {
        path: "f.txt",
        patches: [
          { search: "A", replace: "B" },
          { search: "B", replace: "C" },
          { search: "B", replace: "D" },
        ],
      }))
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2("patch f.txt", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "auto",
      enableBuildFix: false,
    });

    const patch = result.toolCalls.find((t) => t.toolId === "apply_patch");
    expect(patch?.persisted).toBe(false);
  });
});
