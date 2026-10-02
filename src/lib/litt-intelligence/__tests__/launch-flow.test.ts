import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLaunchFlow, type LaunchFlowOptions } from "@/lib/litt-intelligence/launch-flow";
import { registerInternalTools, toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import type { AgentLoopResult } from "@/lib/litt-intelligence/agent-loop-v2";
import type { BuildFixLoopResult } from "@/lib/litt-intelligence/build-fix-loop";
import { recordActionEventActivity } from "@/lib/action-runtime";
import { _resetProviderHealthForTests } from "@/lib/litt-intelligence/provider-registry";

vi.mock("@/lib/action-runtime", () => ({
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
}));

// The real runAgentLoopV2 path (exercised by the paid-fallback tests below)
// fire-and-forgets metering events; keep them hermetic so the test never
// touches the network or DB. Existing tests in this file inject a fake
// runAgentLoop and never trigger metering, so this mock is inert for them.
vi.mock("@/lib/metering", () => ({
  emitUsageEvent: vi.fn(() => Promise.resolve({ usageEventId: null, skipped: "test" })),
  emitLlmMetering: vi.fn(() => Promise.resolve({ usageEventId: null, skipped: "test" })),
  getMeteringContext: vi.fn(() => undefined),
  runWithMeteringContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
  resolveMeteringUserUuid: vi.fn(() => Promise.resolve(null)),
  _clearMeteringUserCache: vi.fn(),
  METERING_FEATURES: ["agent-chat", "browser", "studio", "launch"],
}));

// ─── Mocks ──────────────────────────────────────────────────────────

function createMockTransport(overrides: Partial<WorkspaceTransport> = {}): WorkspaceTransport {
  return {
    workspaceId: "ws-test",
    userId: "user-test",
    workspaceRoot: "/workspace/test",
    projectId: "proj-test",
    listFiles: vi.fn().mockResolvedValue({ entries: [] }),
    readFile: vi.fn().mockResolvedValue({ content: "", size: 0 }),
    writeFile: vi.fn().mockResolvedValue({ saved: true }),
    deleteFile: vi.fn().mockResolvedValue({ deleted: true }),
    mkdir: vi.fn().mockResolvedValue({ created: true }),
    rename: vi.fn().mockResolvedValue({ renamed: true }),
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 100 }),
    gitStatus: vi.fn().mockResolvedValue({
      branch: "main", ahead: 0, behind: 0, staged: [], modified: [], untracked: [], clean: true,
    }),
    gitDiff: vi.fn().mockResolvedValue({ diff: "" }),
    gitLog: vi.fn().mockResolvedValue({ commits: [] }),
    gitCommit: vi.fn().mockResolvedValue({ committed: true, sha: "abc123" }),
    writeBinaryFile: vi.fn().mockResolvedValue({ saved: true }),
    searchCode: vi.fn().mockResolvedValue({ results: [] }),
    discoverPackageInfo: vi.fn().mockResolvedValue({
      packageManager: "pnpm",
      scripts: { build: "next build", dev: "next dev" },
      hasPackageJson: true,
      hasTypecheck: true,
      hasLint: true,
      hasBuild: true,
      hasTest: true,
    }),
    runCheck: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "", durationMs: 100 }),
    applyPatch: vi.fn().mockResolvedValue({ applied: true }),
    createCheckpointBeforeMutation: vi.fn().mockResolvedValue({ checkpointId: "cp-1", label: "pre-launch", gitSha: "abc123" }),
    startPreview: vi.fn().mockResolvedValue({
      workspaceId: "ws-test", status: "starting", port: 4101, framework: "nextjs", command: "pnpm dev", startedAt: Date.now(),
    }),
    getPreviewStatus: vi.fn().mockResolvedValue({
      status: "ready", port: 4101, framework: "nextjs", command: "pnpm dev", startedAt: Date.now(),
      lastHealthCheck: Date.now(), error: null, errorCode: null, logs: [],
    }),
    stopPreview: vi.fn().mockResolvedValue({ workspaceId: "ws-test", status: "stopped" }),
    ...overrides,
  } as WorkspaceTransport;
}

function successAgentResult(overrides: Partial<AgentLoopResult> = {}): AgentLoopResult {
  return {
    finalText: "Done",
    stepsUsed: 3,
    totalDurationMs: 1000,
    toolCalls: [],
    buildFixResult: {
      allPassed: true,
      results: [
        { check: "typecheck", passed: true, exitCode: 0, stdout: "ok", stderr: "" },
        { check: "lint", passed: true, exitCode: 0, stdout: "ok", stderr: "" },
        { check: "test", passed: true, exitCode: 0, stdout: "ok", stderr: "" },
        { check: "build", passed: true, exitCode: 0, stdout: "ok", stderr: "" },
      ],
      repairAttempts: 0,
      finalState: "passed",
    },
    checkpoint: { checkpointId: "cp-1", label: "pre-launch", gitSha: "abc123" },
    cancelled: false,
    events: [],
    ...overrides,
  };
}

function makeOptions(overrides: Partial<LaunchFlowOptions> = {}): LaunchFlowOptions {
  const transport = createMockTransport();
  return {
    userMessage: "Build a simple site",
    projectId: "proj-test",
    userId: "user-test",
    transport,
    systemPrompt: "",
    enableBuildFix: true,
    enableDeploy: false,
    buildPreviewUrl: () => "https://preview.litlabs.net/preview/ws-test",
    runAgentLoop: vi.fn().mockResolvedValue(successAgentResult()),
    ...overrides,
  };
}

// ─── Tests: no-mutation reprompt ─────────────────────────────────

describe("Launch Flow: no-mutation reprompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry.clear();
    registerInternalTools();
  });

  it("reprompts once when an execution request applies zero mutations", async () => {
    const runAgentLoop = vi.fn()
      .mockResolvedValueOnce(successAgentResult({
        toolCalls: [{ toolId: "files.list", success: true, summary: "listed", mutating: false }],
      }))
      .mockResolvedValueOnce(successAgentResult({
        toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
      }));
    const options = makeOptions({ requiresExecution: true, runAgentLoop });

    const result = await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    expect(runAgentLoop.mock.calls[0][2]).toMatchObject({ requireToolCallOnFirstStep: true });
    expect(runAgentLoop.mock.calls[1][2]).toMatchObject({ requireToolCallOnFirstStep: true });
    expect(String(runAgentLoop.mock.calls[1][0])).toContain("did not write any project files");
    expect(result.success).toBe(true);
    expect(result.status).toBe("preview_ready");
  });

  it("does not reprompt for non-execution requests (requiresExecution unset)", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({ toolCalls: [] }));
    const options = makeOptions({ runAgentLoop });

    await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(1);
  });

  it("propagates the same trusted parent ActionRun context through reprompts", async () => {
    const actionContext = {
      actionRunId: "run-composite",
      userId: "trusted-user",
      conversationId: "conv-parent",
      projectId: "trusted-project",
    };
    const runAgentLoop = vi.fn()
      .mockResolvedValueOnce(successAgentResult({ toolCalls: [] }))
      .mockResolvedValueOnce(successAgentResult({
        toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
      }));
    const options = makeOptions({
      requiresExecution: true,
      runAgentLoop,
      actionContext,
      conversationId: "conv-parent",
    });

    await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    for (const call of runAgentLoop.mock.calls) {
      expect(call[2]).toMatchObject({
        userId: "user-test",
        conversationId: "conv-parent",
        actionContext: {
          actionRunId: "run-composite",
          userId: "user-test",
          conversationId: "conv-parent",
          projectId: "proj-test",
        },
      });
    }
    expect(recordActionEventActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-composite",
        userId: "user-test",
        type: "preview.started",
      }),
    );
    expect(recordActionEventActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-composite",
        userId: "user-test",
        type: "preview.ready",
      }),
    );
  });

  it("does not provision an untracked preview when the started event cannot persist", async () => {
    const transport = createMockTransport();
    vi.mocked(recordActionEventActivity).mockRejectedValue(new Error("event insert failed"));
    const options = makeOptions({
      transport,
      runAgentLoop: vi.fn().mockResolvedValue(successAgentResult({
        toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
      })),
      actionContext: {
        actionRunId: "run-composite",
        userId: "user-test",
        conversationId: "conv-parent",
        projectId: "proj-test",
      },
    });

    const result = await runLaunchFlow(options);

    expect(transport.startPreview).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toContain("event insert failed");
  });

  it("reprompts at most once even if the second pass also writes nothing", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({ toolCalls: [] }));
    const options = makeOptions({ requiresExecution: true, runAgentLoop });

    const result = await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("TOOL_EXECUTION_UNAVAILABLE");
  });

  it("does not reprompt when the first pass already applied a mutation", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({
      toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
    }));
    const options = makeOptions({ requiresExecution: true, runAgentLoop });

    await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests: reprompt continues the recovery conversation ─────────────
// Regression for the 2026-09-28 acceptance failure: a rejected apply_patch
// builds a recovery (validation error + exact re-read file content) in the
// loop's messages, but the bounded reprompt used to start a FRESH loop and
// deterministically discard it — the weakest fallback models started blind,
// produced no tool calls, and the run died. The reprompt must continue the
// SAME conversation.

describe("Launch Flow: reprompt continues the recovery conversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry.clear();
    registerInternalTools();
  });

  it("re-seeds the previous loop's messages when the first attempt's patch was rejected", async () => {
    const recoveryContent = "CURRENT FILE CONTENT (index.html):\n<html>recovered</html>";
    const runAgentLoop = vi.fn()
      .mockResolvedValueOnce(successAgentResult({
        toolCalls: [{ toolId: "apply_patch", success: false, summary: "search text not found in file", mutating: false }],
        finalMessages: [
          { role: "user", content: "Build a simple site" },
          { role: "user", content: `validation failed\n\nSAFE PATCH RECOVERY ATTEMPT 1\n\n${recoveryContent}` },
        ],
      }))
      .mockResolvedValueOnce(successAgentResult({
        toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
      }));
    const options = makeOptions({ requiresExecution: true, runAgentLoop });

    await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    // The second attempt continues the SAME conversation — the recovery
    // context (re-read file content) survives instead of starting blind.
    const secondConfig = runAgentLoop.mock.calls[1][2];
    expect(secondConfig.initialMessages).toBeDefined();
    expect(JSON.stringify(secondConfig.initialMessages)).toContain("CURRENT FILE CONTENT");
    // The reprompt text describes the rejected patch — it must not claim
    // the model merely "announced changes".
    const repromptMessage = String(runAgentLoop.mock.calls[1][0]);
    expect(repromptMessage).not.toContain("announced changes");
    expect(repromptMessage).toContain("rejected");
  });

  it("keeps the generic reprompt text and no seeded messages when no patch was rejected", async () => {
    const runAgentLoop = vi.fn()
      .mockResolvedValueOnce(successAgentResult({
        toolCalls: [{ toolId: "files.list", success: true, summary: "listed", mutating: false }],
      }))
      .mockResolvedValueOnce(successAgentResult({
        toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
      }));
    const options = makeOptions({ requiresExecution: true, runAgentLoop });

    await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    expect(String(runAgentLoop.mock.calls[1][0])).toContain("did not write any project files");
    // No recovery context existed — nothing to seed, and the first loop's
    // mock result carried no finalMessages.
    expect(runAgentLoop.mock.calls[1][2].initialMessages).toBeUndefined();
  });

  it("reprompts at most once even when the continued attempt also fails", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({
      toolCalls: [{ toolId: "apply_patch", success: false, summary: "rejected again", mutating: false }],
      finalMessages: [{ role: "user", content: "Build a simple site" }],
    }));
    const options = makeOptions({ requiresExecution: true, runAgentLoop });

    const result = await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.error).toBe("TOOL_EXECUTION_UNAVAILABLE");
    expect(result.finalText).toContain("no available model produced a file-writing tool call after two attempts");
  });
});

// ─── Tests: approval pause still runs preview ────────────────────────

describe("Launch Flow: approval pause runs preview", () => {
  it("starts the preview before returning a phase-1 pendingApproval", async () => {
    const progressEvents: Array<{ type: string }> = [];
    const progress = { emit: (e: { type: string }) => progressEvents.push(e) };
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({
      toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
      pendingApproval: {
        toolId: "project.deploy",
        toolCallId: "tc-1",
        inputs: {},
        reason: "Sensitive action — requires explicit approval",
        pausedMessages: [],
      },
    }));
    const transport = createMockTransport();
    const options = makeOptions({
      requiresExecution: true,
      runAgentLoop,
      transport,
      progress: progress as never,
    });

    const result = await runLaunchFlow(options);

    // Preview must have been attempted even though the loop paused.
    expect(progressEvents.some((e) => e.type === "preview_start")).toBe(true);
    expect(progressEvents.some((e) => e.type === "preview_result" )).toBe(true);
    expect(transport.startPreview).toHaveBeenCalled();
    // The pause is preserved and returned with the live preview URL.
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
    expect(result.previewUrl).toBe("https://preview.litlabs.net/preview/ws-test");
    expect(result.status).toBe("preview_ready");
    // The reprompt must not fire while a run is paused for approval.
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests: approval pause before any mutation ────────────────────
// A run that pauses on a gated tool before writing files (e.g.
// image.generate on an empty static workspace) has nothing to serve.
// Starting a preview there fails as preview_no_dev_command and masks the
// pause behind a misleading "Launch failed" — the pause must be returned
// directly. Regression coverage for the golden-acceptance failure where
// the agent's first mutation was approval-gated.

describe("Launch Flow: approval pause before any mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry.clear();
    registerInternalTools();
  });

  it("returns the pause without attempting a preview when no files exist yet", async () => {
    const progressEvents: Array<{ type: string }> = [];
    const progress = { emit: (e: { type: string }) => progressEvents.push(e) };
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({
      toolCalls: [{ toolId: "files.list", success: true, summary: "listed .", mutating: false }],
      pendingApproval: {
        toolId: "image.generate",
        toolCallId: "tc-img",
        inputs: {},
        reason: "Mutation requires approval",
        pausedMessages: [],
      },
    }));
    const transport = createMockTransport();
    const options = makeOptions({
      requiresExecution: true,
      runAgentLoop,
      transport,
      progress: progress as never,
    });

    const result = await runLaunchFlow(options);

    expect(result.pendingApproval?.toolId).toBe("image.generate");
    expect(result.finalText).toContain("approval");
    expect(result.finalText).not.toContain("Launch failed");
    expect(transport.startPreview).not.toHaveBeenCalled();
    expect(progressEvents.some((e) => e.type === "preview_start")).toBe(false);
    // The reprompt must not fire while a run is paused for approval.
    expect(runAgentLoop).toHaveBeenCalledTimes(1);
  });

  it("still attempts the preview when a pause lands after a mutation", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({
      toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
      pendingApproval: {
        toolId: "image.generate",
        toolCallId: "tc-img",
        inputs: {},
        reason: "Mutation requires approval",
        pausedMessages: [],
      },
    }));
    const transport = createMockTransport();
    const options = makeOptions({ requiresExecution: true, runAgentLoop, transport });

    const result = await runLaunchFlow(options);

    expect(transport.startPreview).toHaveBeenCalled();
    expect(result.status).toBe("preview_ready");
    expect(result.pendingApproval?.toolId).toBe("image.generate");
  });
});

// ─── Tests: rejected preview start ────────────────────────────────
// transport.startPreview() rejects when the terminal-server refuses the
// start (500 preview_no_dev_command et al.). That rejection is a normal
// "failed" outcome — it must flow through the runtime-repair loop rather
// than escaping as a generic "Launch failed" that also hides a pending
// approval.

describe("Launch Flow: rejected preview start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry.clear();
    registerInternalTools();
  });

  it("routes a rejected preview start through the repair loop instead of crashing the launch", async () => {
    const startPreview = vi.fn()
      .mockRejectedValueOnce(new Error('Preview start failed (500): {"errorCode":"preview_no_dev_command"}'))
      .mockResolvedValue({
        workspaceId: "ws-test", status: "starting", port: 4101, framework: "static", command: "npx serve", startedAt: Date.now(),
      });
    const transport = createMockTransport({ startPreview });
    let callCount = 0;
    const runAgentLoop = vi.fn().mockImplementation(async (message: string) => {
      callCount++;
      if (callCount > 1) expect(message).toContain("preview server failed");
      return successAgentResult();
    });
    const options = makeOptions({ transport, runAgentLoop, maxRuntimeRepairAttempts: 2 });

    const result = await runLaunchFlow(options);

    expect(result.status).toBe("preview_ready");
    expect(result.runtimeRepairAttempts).toBe(1);
    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    expect(startPreview).toHaveBeenCalledTimes(2);
  });

  it("surfaces the pending approval — not a launch crash — when preview start rejects while paused", async () => {
    const startPreview = vi.fn().mockRejectedValue(
      new Error('Preview start failed (500): {"errorCode":"preview_dev_server_failed"}'),
    );
    const getPreviewStatus = vi.fn().mockResolvedValue({
      status: "failed", port: null, framework: null, command: null, startedAt: null,
      lastHealthCheck: null, error: "dev server crashed", errorCode: "preview_dev_server_failed", logs: [],
    });
    const transport = createMockTransport({ startPreview, getPreviewStatus });
    // Pause after a mutation so the preview phase still runs; the repair
    // pass returns a normal result but the re-start still rejects, so the
    // repair budget exhausts and the pending approval must surface.
    let callCount = 0;
    const runAgentLoop = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return successAgentResult({
          toolCalls: [{ toolId: "files.write", success: true, summary: "wrote index.html", mutating: true }],
          pendingApproval: {
            toolId: "project.deploy",
            toolCallId: "tc-deploy",
            inputs: {},
            reason: "Sensitive action — requires explicit approval",
            pausedMessages: [],
          },
        });
      }
      return successAgentResult({
        toolCalls: [{ toolId: "files.write", success: true, summary: "fixed", mutating: true }],
      });
    });
    const options = makeOptions({ transport, runAgentLoop, maxRuntimeRepairAttempts: 1 });

    const result = await runLaunchFlow(options);

    expect(result.pendingApproval?.toolId).toBe("project.deploy");
    expect(result.finalText).toContain("approval");
    expect(result.finalText).not.toContain("Launch failed");
  });
});

// ─── Tests: prompt → preview ──────────────────────────────────────

describe("Launch Flow: prompt → preview", () => {
  it("returns a verified preview URL when all checks pass", async () => {
    const options = makeOptions();
    const result = await runLaunchFlow(options);

    expect(result.success).toBe(true);
    expect(result.status).toBe("preview_ready");
    expect(result.previewUrl).toBe("https://preview.litlabs.net/preview/ws-test");
    expect(result.finalText).toContain("preview is ready");
    expect(options.transport.startPreview).toHaveBeenCalled();
    expect(options.transport.getPreviewStatus).toHaveBeenCalled();
  });

  it("creates a checkpoint before mutation to preserve work", async () => {
    const options = makeOptions();
    await runLaunchFlow(options);

    expect(options.transport.createCheckpointBeforeMutation).toHaveBeenCalled();
  });
});

// ─── Tests: failed build → repair → preview ───────────────────────

describe("Launch Flow: failed build → repair → preview", () => {
  it("returns failure when build-fix loop exhausts without passing", async () => {
    const buildFixResult: BuildFixLoopResult = {
      allPassed: false,
      results: [
        { check: "build", passed: false, exitCode: 1, stdout: "", stderr: "Module not found: './missing'", errorCount: 1 },
      ],
      repairAttempts: 3,
      finalState: "failed",
    };

    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({ buildFixResult }));
    const options = makeOptions({ runAgentLoop });
    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.repairAttempts).toBe(3);
    expect(result.finalText).toContain("did not pass all checks");
    expect(result.finalText).toContain("Module not found");
    expect(options.transport.startPreview).not.toHaveBeenCalled();
  });
});

// ─── Tests: model failure ─────────────────────────────────────────

describe("Launch Flow: model failure", () => {
  it("fails fast and surfaces the model error instead of previewing/deploying an ungenerated project", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({
      modelFailed: "All tool-calling models failed. Attempts: gemini-2.5-flash(http_402)",
      buildFixResult: undefined,
      stepsUsed: 1,
    }));
    const options = makeOptions({ enableDeploy: true, runAgentLoop });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.finalText).toContain("http_402");
    expect(result.error).toContain("http_402");
    expect(options.transport.startPreview).not.toHaveBeenCalled();
    // A model failure must not reach the deploy gate either.
    expect(result.pendingApproval).toBeUndefined();
  });

  it("fails when the runtime-repair loop's model fails, instead of masking it as a preview error", async () => {
    let callCount = 0;
    const runAgentLoop = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return successAgentResult();
      return successAgentResult({
        modelFailed: "All tool-calling models failed (http_402)",
        buildFixResult: undefined,
      });
    });
    const getPreviewStatus = vi.fn().mockResolvedValue({
      status: "failed", port: null, framework: null, command: null, startedAt: null,
      lastHealthCheck: null, error: "Cannot find module 'react'", errorCode: "preview_dev_server_failed", logs: [],
    });

    const transport = createMockTransport({ getPreviewStatus });
    const options = makeOptions({ transport, runAgentLoop, maxRuntimeRepairAttempts: 2 });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.finalText).toContain("could not complete the repair");
    expect(result.finalText).toContain("http_402");
    expect(runAgentLoop).toHaveBeenCalledTimes(2); // initial + first repair only
  });
});

// ─── Tests: runtime failure → repair ──────────────────────────────

describe("Launch Flow: runtime failure → repair", () => {
  it("feeds the runtime error into the agent, repairs, and reaches preview", async () => {
    let callCount = 0;
    const runAgentLoop = vi.fn().mockImplementation(async (message: string) => {
      callCount++;
      if (callCount === 1) {
        return successAgentResult();
      }
      // Repair call
      expect(message).toContain("preview server failed");
      return successAgentResult();
    });

    let statusCall = 0;
    const getPreviewStatus = vi.fn().mockImplementation(async () => {
      statusCall++;
      if (statusCall === 1) {
        return { status: "failed", port: null, framework: null, command: null, startedAt: null, lastHealthCheck: null, error: "Cannot find module 'react'", errorCode: "preview_dev_server_failed", logs: [] };
      }
      return { status: "ready", port: 4101, framework: "nextjs", command: "pnpm dev", startedAt: Date.now(), lastHealthCheck: Date.now(), error: null, errorCode: null, logs: [] };
    });

    const transport = createMockTransport({ getPreviewStatus });
    const options = makeOptions({ transport, runAgentLoop, maxRuntimeRepairAttempts: 2 });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(true);
    expect(result.status).toBe("preview_ready");
    expect(result.runtimeRepairAttempts).toBe(1);
    expect(runAgentLoop).toHaveBeenCalledTimes(2);
  });
});

// ─── Tests: bounded repair retry exhaustion ─────────────────────────

describe("Launch Flow: bounded repair retry exhaustion", () => {
  it("gives up after max runtime repair attempts and reports the real error", async () => {
    const getPreviewStatus = vi.fn().mockResolvedValue({
      status: "failed", port: null, framework: null, command: null, startedAt: null,
      lastHealthCheck: null, error: "Cannot find module 'react'", errorCode: "preview_dev_server_failed", logs: [],
    });

    const transport = createMockTransport({ getPreviewStatus });
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult());
    const options = makeOptions({ transport, runAgentLoop, maxRuntimeRepairAttempts: 2 });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.runtimeRepairAttempts).toBe(2);
    expect(result.error).toContain("Cannot find module");
    expect(runAgentLoop).toHaveBeenCalledTimes(3); // initial + 2 repairs
  });
});

// ─── Tests: preview timeout and stale state ─────────────────────────

describe("Launch Flow: preview timeout", () => {
  it("fails when preview never becomes ready within the configured timeout", async () => {
    const getPreviewStatus = vi.fn().mockResolvedValue({
      status: "starting", port: 4101, framework: "nextjs", command: "pnpm dev", startedAt: Date.now(),
      lastHealthCheck: Date.now(), error: null, errorCode: null, logs: [],
    });

    const transport = createMockTransport({ getPreviewStatus });
    const options = makeOptions({ transport, maxPreviewWaitMs: 50, previewPollIntervalMs: 20 });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("timeout");
    expect(getPreviewStatus).toHaveBeenCalled();
  });

  it("does not report a stale preview as ready when status reports ready but contains an error", async () => {
    const getPreviewStatus = vi.fn().mockResolvedValue({
      status: "ready", port: 4101, framework: "nextjs", command: "pnpm dev", startedAt: Date.now(),
      lastHealthCheck: Date.now(), error: "stale process", errorCode: "preview_dev_server_failed", logs: [],
    });

    const transport = createMockTransport({ getPreviewStatus });
    const options = makeOptions({ transport });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("stale process");
  });
});

// ─── Tests: deploy approval gate ─────────────────────────────────
// Ship-mode deploys must NEVER run inline — the flow pauses for explicit
// approval on `project.deploy`, and the approvals endpoint resumes it via
// the real tool pipeline (deployUserProject → verified /sites/<id> URL).
// An inline deploy would bypass the sensitive-action gate entirely.

describe("Launch Flow: deploy approval gate", () => {
  it("pauses for project.deploy approval instead of deploying inline", async () => {
    const progressEvents: Array<{ type: string; toolId?: string }> = [];
    const progress = { emit: (e: { type: string; toolId?: string }) => progressEvents.push(e) };
    const options = makeOptions({ enableDeploy: true, progress: progress as never });

    const result = await runLaunchFlow(options);

    expect(result.status).toBe("preview_ready");
    expect(result.previewUrl).toBe("https://preview.litlabs.net/preview/ws-test");
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
    expect(result.pendingApproval?.reason).toContain("approval");
    expect(result.pendingApproval?.toolCallId).toBeTruthy();
    expect(result.pendingApproval?.inputs).toEqual({});
    // The messages route persists the paused run off agentLoopResult —
    // without it the approval card would have no pausedRunId to resume.
    expect(result.agentLoopResult?.pendingApproval?.toolId).toBe("project.deploy");
    // Resume context carries the original request so the continued loop
    // can report the deploy result truthfully.
    expect(result.pendingApproval?.pausedMessages).toEqual([
      { role: "user", content: "Build a simple site" },
    ]);
    expect(progressEvents.some((e) => e.type === "approval_required" && e.toolId === "project.deploy")).toBe(true);
  });

  it("never reports a production URL before approval", async () => {
    const options = makeOptions({ enableDeploy: true });

    const result = await runLaunchFlow(options);

    expect(result.productionUrl).toBeFalsy();
    expect(result.finalText).toContain("approval");
    expect(result.finalText).not.toContain("Deployed and verified");
  });

  it("does not pause for deploy when enableDeploy is off", async () => {
    const options = makeOptions({ enableDeploy: false });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(true);
    expect(result.status).toBe("preview_ready");
    expect(result.pendingApproval).toBeUndefined();
  });
});

// ─── Tests: cancellation during build/repair ─────────────────────────

describe("Launch Flow: cancellation", () => {
  it("cancels during the agent loop and reports the reason", async () => {
    const controller = new AbortController();
    const runAgentLoop = vi.fn().mockImplementation(async () => {
      controller.abort("user cancelled");
      throw new Error("user cancelled");
    });

    const options = makeOptions({ signal: controller.signal, runAgentLoop });
    const result = await runLaunchFlow(options);

    expect(result.cancelled).toBe(true);
    expect(result.success).toBe(false);
    expect(result.status).toBe("cancelled");
  });

  it("cancels during runtime repair", async () => {
    const controller = new AbortController();
    const getPreviewStatus = vi.fn().mockImplementation(async () => {
      controller.abort("stopped by user");
      return { status: "failed", port: null, framework: null, command: null, startedAt: null, lastHealthCheck: null, error: "nope", errorCode: "preview_dev_server_failed", logs: [] };
    });

    const transport = createMockTransport({ getPreviewStatus });
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult());
    const options = makeOptions({ transport, signal: controller.signal, runAgentLoop, maxRuntimeRepairAttempts: 2 });

    const result = await runLaunchFlow(options);

    expect(result.cancelled).toBe(true);
    expect(result.status).toBe("cancelled");
  });
});

// ─── Tests: no false completion state ───────────────────────────────

describe("Launch Flow: no false completion", () => {
  it("does not claim success when build-fix fails", async () => {
    const buildFixResult: BuildFixLoopResult = {
      allPassed: false,
      results: [{ check: "build", passed: false, exitCode: 1, stdout: "", stderr: "Syntax error" }],
      repairAttempts: 3,
      finalState: "failed",
    };
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult({ buildFixResult }));
    const options = makeOptions({ runAgentLoop });
    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.finalText).not.toContain("completed");
    expect(result.finalText).toContain("did not pass");
  });

  it("does not claim a deploy succeeded before it has run — ship mode pauses for approval", async () => {
    const options = makeOptions({ enableDeploy: true });
    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).not.toBe("deployed");
    expect(result.productionUrl).toBeFalsy();
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
  });
});

// ─── Tests: budget limits adequate for full build+preview+deploy ───

describe("Launch Flow: budget limits", () => {
  it("passes maxOutputChars and maxSteps large enough for a full build to the main agent loop", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult());
    const options = makeOptions({ runAgentLoop });
    await runLaunchFlow(options);

    const config = runAgentLoop.mock.calls[0][2] as Record<string, unknown>;
    expect(config.maxOutputChars).toBe(200_000);
    expect(config.maxSteps).toBe(40);
    // Runtime budget must still be the real bound (allow 1ms timing slack
    // for the elapsed-time subtraction before the agent loop starts).
    // Budget is 30 minutes (was 10) — a real multi-file build needs the room.
    expect(config.maxRuntimeMs).toBeGreaterThanOrEqual(1_799_000);
    expect(config.maxRuntimeMs).toBeLessThanOrEqual(1_800_000);
  });

  it("passes maxOutputChars to the repair agent loop too", async () => {
    let agentCallCount = 0;
    const runAgentLoop = vi.fn().mockImplementation(async () => {
      agentCallCount++;
      return successAgentResult();
    });
    let statusCallCount = 0;
    const getPreviewStatus = vi.fn().mockImplementation(async () => {
      statusCallCount++;
      if (statusCallCount === 1) return { status: "failed", port: null, framework: null, command: null, startedAt: null, lastHealthCheck: null, error: "Cannot find module 'react'", errorCode: "preview_dev_server_failed", logs: [] };
      return { status: "ready", port: 4101, framework: "nextjs", command: "pnpm dev", startedAt: Date.now(), lastHealthCheck: Date.now(), error: null, errorCode: null, logs: [] };
    });
    const transport = createMockTransport({ getPreviewStatus });
    const options = makeOptions({ transport, runAgentLoop, maxRuntimeRepairAttempts: 2 });
    await runLaunchFlow(options);

    // Second call is the repair call
    expect(runAgentLoop.mock.calls.length).toBeGreaterThanOrEqual(2);
    const repairConfig = runAgentLoop.mock.calls[1][2] as Record<string, unknown>;
    expect(repairConfig.maxOutputChars).toBe(200_000);
    // Repair must not restart the global runtime budget (30 minutes)
    expect(repairConfig.maxRuntimeMs).toBeLessThanOrEqual(1_800_000);
  });
});

// ─── Tests: preservation of existing project work ───────────────────

describe("Launch Flow: preservation of existing project work", () => {
  it("creates a checkpoint before mutating the workspace", async () => {
    const runAgentLoop = vi.fn().mockImplementation(async (_message, _transport, _config, progress) => {
      progress?.emit({ type: "checkpoint", label: "pre-launch", gitSha: "abc" });
      return successAgentResult();
    });

    const transport = createMockTransport();
    const options = makeOptions({ transport, runAgentLoop });
    await runLaunchFlow(options);

    expect(transport.createCheckpointBeforeMutation).toHaveBeenCalled();
  });
});

// ─── Tests: quality-loop pass-through ───────────────────────────────

describe("Launch Flow: quality-loop pass-through", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry.clear();
    registerInternalTools();
  });

  it("passes the qualityLoop opt-in to the main agent-loop phase", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult());
    const qualityLoop = {
      enabled: true,
      runId: "run-ql",
      projectId: "proj-test",
      userId: "user-test",
      userRequest: "Build a site",
    };
    const options = makeOptions({ runAgentLoop, qualityLoop });
    await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalled();
    const mainConfig = runAgentLoop.mock.calls[0][2] as Record<string, unknown>;
    expect(mainConfig.qualityLoop).toEqual(qualityLoop);
  });

  it("leaves qualityLoop unset on the agent loop when not opted in", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(successAgentResult());
    const options = makeOptions({ runAgentLoop });
    await runLaunchFlow(options);

    const mainConfig = runAgentLoop.mock.calls[0][2] as Record<string, unknown>;
    expect(mainConfig.qualityLoop).toBeUndefined();
  });
});

describe("Launch Flow: artifact gate rejects the blank welcome screen", () => {
  function welcomeTransport(): WorkspaceTransport {
    return createMockTransport({
      listFiles: vi.fn().mockResolvedValue({
        entries: [{ name: "index.html", type: "file" }],
      }),
      readFile: vi.fn().mockResolvedValue({
        content:
          "<!-- LITT-WELCOME-SCREEN: blank-state of the LiTT builder. Not a project, not project content. -->\n<html><body>Welcome to LiTT</body></html>",
        size: 128,
      }),
    });
  }

  it("fails when the only entry file still carries the welcome-screen marker", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(welcomeTransport());
    expect(check.ok).toBe(false);
    expect(check.error).toContain("blank starter screen");
  });

  it("passes when the entry file is a real project file", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const transport = createMockTransport({
      listFiles: vi.fn().mockResolvedValue({
        entries: [{ name: "index.html", type: "file" }],
      }),
      readFile: vi.fn().mockResolvedValue({
        content: "<html><body><h1>North Shore Outdoor Co.</h1></body></html>",
        size: 64,
      }),
    });
    const check = await verifyProjectArtifacts(transport);
    expect(check.ok).toBe(true);
  });

  it("passes when the entry file cannot be read (filename signal preserved)", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const transport = createMockTransport({
      listFiles: vi.fn().mockResolvedValue({
        entries: [{ name: "index.html", type: "file" }],
      }),
      readFile: vi.fn().mockRejectedValue(new Error("read failed")),
    });
    const check = await verifyProjectArtifacts(transport);
    expect(check.ok).toBe(true);
  });

  it("still fails when no entry file exists at all", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(createMockTransport());
    expect(check.ok).toBe(false);
    expect(check.error).toContain("No runnable website entry file");
  });
});

describe("Launch Flow: artifact gate honors workspace-change evidence (#551)", () => {
  // The #551 acceptance failure: an approved edit to index.html (adding a
  // comment) legitimately leaves the LITT-WELCOME-SCREEN marker in place.
  // The resumed run's own workspace diff proves files changed — the marker
  // gate must not report "no real project files were created" for it.
  const MARKER_EDIT =
    "<!-- PR551-acceptance-edit-marker -->\n<!-- LITT-WELCOME-SCREEN: blank-state of the LiTT builder. Not a project, not project content. -->\n<html><body>Welcome to LiTT</body></html>";

  function markerEditTransport(): WorkspaceTransport {
    return createMockTransport({
      listFiles: vi.fn().mockResolvedValue({
        entries: [{ name: "index.html", type: "file" }],
      }),
      readFile: vi.fn().mockResolvedValue({ content: MARKER_EDIT, size: 256 }),
    });
  }

  it("passes a marker-bearing entry when workspace evidence shows the run changed files", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport(), {
      workspaceChange: { status: "changed", files: ["index.html"] },
    });
    expect(check.ok).toBe(true);
  });

  it("still fails the same workspace without evidence — launch stalls stay caught", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport());
    expect(check.ok).toBe(false);
    expect(check.error).toContain("blank starter screen");
  });

  it("still fails when evidence says the workspace is unchanged", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport(), {
      workspaceChange: { status: "unchanged", files: [] },
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("blank starter screen");
  });

  it("still fails when evidence is unknown — an unverifiable workspace keeps the strict gate", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport(), {
      workspaceChange: { status: "unknown", files: [] },
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("blank starter screen");
  });

  it("still fails when no entry file exists at all, even with changed evidence", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(createMockTransport(), {
      workspaceChange: { status: "changed", files: ["other.txt"] },
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("No runnable website entry file");
  });
});

// ─── Tests: honest loop failure propagation ─────────────────────────

describe("Launch Flow: honest loop failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry.clear();
    registerInternalTools();
  });

  it("reports the run as failed — never completed — when the loop fails honestly", async () => {
    const runAgentLoop = vi.fn().mockResolvedValue(
      successAgentResult({
        failedHonestly:
          "I couldn't apply the requested file change: I asked for approval in words " +
          "instead of emitting the file tool call, so no approval card was created " +
          "and no files were changed. Nothing was modified — please try again.",
        toolCalls: [],
      }),
    );
    const options = makeOptions({ requiresExecution: true, runAgentLoop });

    const result = await runLaunchFlow(options);

    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.finalText).toContain("no approval card was created");
    expect(result.error).toBe("HONEST_LOOP_FAILURE");
    expect(result.agentLoopResult?.failedHonestly).toBeDefined();
  });
});

describe("Launch Flow: artifact gate mutation-aware marker skip (#551b2)", () => {
  // #551 acceptance re-run #3: an approved additive edit to index.html
  // legitimately keeps the LITT-WELCOME-SCREEN marker. The resumed run's
  // own tool-call log (a successful file mutation) is passed as defense
  // in depth for when the workspace diff could not run ("unknown").
  const MARKER_EDIT =
    "<!-- PR551-acceptance-edit-marker -->\n<!-- LITT-WELCOME-SCREEN: blank-state of the LiTT builder. Not a project, not project content. -->\n<html><body>Welcome to LiTT</body></html>";

  function markerEditTransport(): WorkspaceTransport {
    return createMockTransport({
      listFiles: vi.fn().mockResolvedValue({
        entries: [{ name: "index.html", type: "file" }],
      }),
      readFile: vi.fn().mockResolvedValue({ content: MARKER_EDIT, size: 256 }),
    });
  }

  it("passes a marker-bearing entry when the run's tool log shows a successful mutation and the diff is unknown", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport(), {
      workspaceChange: { status: "unknown", files: [] },
      hadSuccessfulMutation: true,
    });
    expect(check.ok).toBe(true);
  });

  it("passes a marker-bearing entry when the run's tool log shows a successful mutation and no evidence exists", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport(), {
      hadSuccessfulMutation: true,
    });
    expect(check.ok).toBe(true);
  });

  it("still fails when the diff affirmatively proves the workspace untouched — a lying tool must not pass", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport(), {
      workspaceChange: { status: "unchanged", files: [] },
      hadSuccessfulMutation: true,
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("blank starter screen");
  });

  it("still fails without a successful mutation — launch stalls stay caught", async () => {
    const { verifyProjectArtifacts } = await import("@/lib/litt-intelligence/launch-flow");
    const check = await verifyProjectArtifacts(markerEditTransport(), {
      workspaceChange: { status: "unknown", files: [] },
      hadSuccessfulMutation: false,
    });
    expect(check.ok).toBe(false);
    expect(check.error).toContain("blank starter screen");
  });

  it("threads hadSuccessfulMutation through ensureProjectPreviewReady", async () => {
    const { ensureProjectPreviewReady } = await import("@/lib/litt-intelligence/launch-flow");
    const transport = createMockTransport({
      listFiles: vi.fn().mockResolvedValue({
        entries: [{ name: "index.html", type: "file" }],
      }),
      readFile: vi.fn().mockResolvedValue({ content: MARKER_EDIT, size: 256 }),
      startPreview: vi.fn().mockResolvedValue({ status: "ready" }),
      getPreviewStatus: vi.fn().mockResolvedValue({ status: "ready" }),
    });
    const result = await ensureProjectPreviewReady(
      transport as any,
      { workspaceChange: { status: "unknown", files: [] }, hadSuccessfulMutation: true },
      undefined,
      undefined,
    );
    expect(result.ok).toBe(true);
  });
});

// ─── Tests: entitled paid fallback through the REAL runLaunchFlow path ───

/**
 * P0 regression: the V1 streamText lane routes through defaultChain and never
 * calls planBasicRoutes, so PR #610's V2 wiring never fired there — an
 * entitled user whose pinned provider was filtered out (GEMINI_DISABLED) got
 * an empty provider chain and failed with zero attempts.
 *
 * These tests exercise the REAL runLaunchFlow (no injected runAgentLoop):
 * runLaunchFlow → runAgentLoopV2 → callLLMWithTools → planBasicRoutes.
 * Only the network boundary (fetch) is mocked. First OpenAI call returns a
 * native tool call to files.write; the second returns final text so the loop
 * terminates. files.write runs in executionMode "auto" so the
 * auto-approve-safe mutation policy executes it without an approval pause.
 */
describe("Launch Flow: entitled paid fallback (real runLaunchFlow path)", () => {
  const OPENAI_HOST = "api.openai.com";

  function openAiToolCallResponse() {
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test-1",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    // Wire naming per buildToolIdReverseMap: files.write → files_write
                    name: "files_write",
                    arguments: JSON.stringify({
                      projectId: "proj-test",
                      path: "hello.txt",
                      content: "hello world",
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  function openAiFinalResponse() {
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test-2",
        object: "chat.completion",
        created: 2,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Done — hello.txt is written." },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 60, completion_tokens: 8, total_tokens: 68 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  function stubFetchForPaidFallback() {
    let openAiCalls = 0;
    const fetchMock = vi.fn(async (url: unknown, _init?: RequestInit) => {
      const u = String(url);
      if (!u.includes(OPENAI_HOST)) {
        // Every free provider is down for this test.
        return new Response("upstream error", { status: 500 });
      }
      openAiCalls++;
      return openAiCalls === 1 ? openAiToolCallResponse() : openAiFinalResponse();
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function makeRealLoopOptions(overrides: Partial<LaunchFlowOptions> = {}) {
    const transport = createMockTransport();
    const options: LaunchFlowOptions = {
      userMessage: "Write hello.txt",
      projectId: "proj-test",
      userId: "user-test",
      transport,
      systemPrompt: "",
      enableBuildFix: false,
      enableDeploy: false,
      // files.write is auto-approve-safe in AUTO mode — in "act" the loop
      // would pause for approval and the tool would never execute.
      executionMode: "auto",
      buildPreviewUrl: () => "https://preview.litlabs.net/preview/ws-test",
      allowLittPaidProviders: true,
      ...overrides,
    };
    return { options, transport };
  }

  beforeEach(() => {
    toolRegistry.clear();
    registerInternalTools();
    _resetProviderHealthForTests();
    vi.stubEnv("GEMINI_DISABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    vi.stubEnv("MISTRAL_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    // Keep the plan deterministic: only the managed OpenAI route survives.
    vi.stubEnv("LITT_DISABLE_OLLAMA", "true");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reaches the paid fallback through the genuine path and executes the tool call", async () => {
    const fetchMock = stubFetchForPaidFallback();
    const { options, transport } = makeRealLoopOptions();

    const result = await runLaunchFlow(options);

    // (1) Paid fallback attempted through the genuine orchestration path
    // (runLaunchFlow → runAgentLoopV2 → callLLMWithTools → planBasicRoutes),
    // not a direct router call.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(OPENAI_HOST))).toBe(true);
    // (2) The OpenAI-returned tool call really executed against the transport.
    expect(transport.writeFile).toHaveBeenCalled();
    expect(transport.writeFile).toHaveBeenCalledWith("hello.txt", "hello world");
    expect(result.status).toBe("preview_ready");
  });

  it("unentitled → no paid route attempted; run reports model failure (negative control)", async () => {
    const fetchMock = stubFetchForPaidFallback();
    const { options, transport } = makeRealLoopOptions({ allowLittPaidProviders: false });

    const result = await runLaunchFlow(options);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes(OPENAI_HOST))).toBe(false);
    expect(transport.writeFile).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });
});
