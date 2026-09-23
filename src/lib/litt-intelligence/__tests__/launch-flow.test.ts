import { describe, it, expect, vi, beforeEach } from "vitest";
import { runLaunchFlow, type LaunchFlowOptions } from "@/lib/litt-intelligence/launch-flow";
import { registerInternalTools, toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import type { AgentLoopResult } from "@/lib/litt-intelligence/agent-loop-v2";
import type { BuildFixLoopResult } from "@/lib/litt-intelligence/build-fix-loop";

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
