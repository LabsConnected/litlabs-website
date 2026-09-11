import { describe, it, expect, vi } from "vitest";
import { runLaunchFlow, type LaunchFlowOptions } from "@/lib/litt-intelligence/launch-flow";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import type { AgentLoopResult } from "@/lib/litt-intelligence/agent-loop-v2";
import type { DeployResult } from "@/lib/litt-intelligence/deploy";
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
    searchCode: vi.fn().mockResolvedValue({ results: [] }),
    discoverPackageInfo: vi.fn().mockResolvedValue({
      packageManager: "pnpm",
      scripts: { build: "next build", dev: "next dev" },
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

function successDeployResult(overrides: Partial<DeployResult> = {}): DeployResult {
  return {
    success: true,
    provider: "railway",
    deploymentId: "dep-123",
    status: "SUCCESS",
    productionUrl: "https://example.litlabs.net",
    verification: { url: "https://example.litlabs.net", success: true, detail: "HTTP 200" },
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
    runDeployFlow: vi.fn().mockResolvedValue(successDeployResult()),
    resolveDeployConfig: vi.fn().mockReturnValue({
      ok: true,
      config: { provider: "railway" as const, token: "test-token", projectId: "svc-123", productionUrl: "https://example.litlabs.net" },
    }),
    ...overrides,
  };
}

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

// ─── Tests: deploy success ─────────────────────────────────────────

describe("Launch Flow: deploy success", () => {
  it("deploys and verifies the production URL after a successful preview", async () => {
    const runDeployFlow = vi.fn().mockResolvedValue(successDeployResult({ productionUrl: "https://example.litlabs.net" }));
    const options = makeOptions({ enableDeploy: true, runDeployFlow });

    const result = await runLaunchFlow(options);

    expect(result.success).toBe(true);
    expect(result.status).toBe("deployed");
    expect(result.productionUrl).toBe("https://example.litlabs.net");
    expect(result.finalText).toContain("Deployed and verified");
    expect(runDeployFlow).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({ provider: "railway", projectId: "svc-123" }),
    }));
  });
});

// ─── Tests: deploy failure with truthful error ──────────────────────

describe("Launch Flow: deploy failure with truthful error", () => {
  it("returns a failed status with the real deploy error", async () => {
    const runDeployFlow = vi.fn().mockResolvedValue({
      success: false,
      provider: "railway",
      error: "RAILWAY_API_TOKEN is invalid",
    } as DeployResult);

    const options = makeOptions({ enableDeploy: true, runDeployFlow });
    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toBe("RAILWAY_API_TOKEN is invalid");
    expect(result.finalText).toContain("RAILWAY_API_TOKEN is invalid");
    expect(result.previewUrl).toBe("https://preview.litlabs.net/preview/ws-test");
  });
});

// ─── Tests: production URL verification ─────────────────────────────

describe("Launch Flow: production URL verification", () => {
  it("fails when deploy succeeds but verification fails", async () => {
    const runDeployFlow = vi.fn().mockResolvedValue(successDeployResult({
      productionUrl: "https://down.litlabs.net",
      verification: { url: "https://down.litlabs.net", success: false, detail: "Connection refused" },
    }));

    const options = makeOptions({ enableDeploy: true, runDeployFlow });
    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Connection refused");
    expect(result.finalText).toContain("could not be verified");
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

  it("does not claim success when deploy verification fails", async () => {
    const runDeployFlow = vi.fn().mockResolvedValue(successDeployResult({
      productionUrl: "https://bad.litlabs.net",
      verification: { url: "https://bad.litlabs.net", success: false, detail: "HTTP 500" },
    }));
    const options = makeOptions({ enableDeploy: true, runDeployFlow });
    const result = await runLaunchFlow(options);

    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.finalText).toContain("could not be verified");
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
