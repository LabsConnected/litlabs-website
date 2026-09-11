import { describe, it, expect, vi } from "vitest";
import {
  handlePreviewStart,
  handlePreviewStatus,
  handlePreviewStop,
} from "@/lib/litt-intelligence/tool-handlers-v2";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

function makeTransport(overrides: Partial<WorkspaceTransport> = {}): WorkspaceTransport {
  return {
    workspaceId: "ws-test",
    userId: "user-test",
    workspaceRoot: "/workspace/test",
    projectId: "proj-test",
    listFiles: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteFile: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    exec: vi.fn(),
    gitStatus: vi.fn(),
    gitDiff: vi.fn(),
    gitLog: vi.fn(),
    gitCommit: vi.fn(),
    searchCode: vi.fn(),
    discoverPackageInfo: vi.fn(),
    runCheck: vi.fn(),
    applyPatch: vi.fn(),
    createCheckpointBeforeMutation: vi.fn(),
    startPreview: vi.fn().mockResolvedValue({
      workspaceId: "ws-test",
      status: "starting",
      port: 4101,
      framework: "nextjs",
      command: "pnpm dev",
      startedAt: Date.now(),
    }),
    getPreviewStatus: vi.fn().mockResolvedValue({
      status: "ready",
      port: 4101,
      framework: "nextjs",
      command: "pnpm dev",
      startedAt: Date.now(),
      lastHealthCheck: Date.now(),
      error: null,
      errorCode: null,
      logs: [],
    }),
    stopPreview: vi.fn().mockResolvedValue({ workspaceId: "ws-test", status: "stopped" }),
    ...overrides,
  } as WorkspaceTransport;
}

describe("Preview tool handlers", () => {
  it("preview.start succeeds when start returns starting", async () => {
    const transport = makeTransport();
    const result = await handlePreviewStart({}, transport);
    expect(result.success).toBe(true);
    expect(result.status).toBe("starting");
    expect(transport.startPreview).toHaveBeenCalled();
  });

  it("preview.start fails truthfully when start throws", async () => {
    const transport = makeTransport({
      startPreview: vi.fn().mockRejectedValue(new Error("package manager missing")),
    });
    const result = await handlePreviewStart({}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toContain("package manager missing");
  });

  it("preview.status returns running", async () => {
    const transport = makeTransport({
      getPreviewStatus: vi.fn().mockResolvedValue({
        status: "starting",
        port: 4101,
        framework: "nextjs",
        command: "pnpm dev",
        startedAt: Date.now(),
        lastHealthCheck: Date.now(),
        error: null,
        errorCode: null,
        logs: [],
      }),
    });
    const result = await handlePreviewStatus({}, transport);
    expect(result.success).toBe(true);
    expect(result.status).toBe("starting");
  });

  it("preview.status returns ready", async () => {
    const transport = makeTransport();
    const result = await handlePreviewStatus({}, transport);
    expect(result.success).toBe(true);
    expect(result.status).toBe("ready");
  });

  it("preview.status returns failed truthfully", async () => {
    const transport = makeTransport({
      getPreviewStatus: vi.fn().mockResolvedValue({
        status: "failed",
        port: null,
        framework: null,
        command: null,
        startedAt: null,
        lastHealthCheck: null,
        error: "Cannot find module 'react'",
        errorCode: "preview_dev_server_failed",
        logs: ["Error: Cannot find module 'react'"],
      }),
    });
    const result = await handlePreviewStatus({}, transport);
    expect(result.success).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Cannot find module");
    expect(result.errorCode).toBe("preview_dev_server_failed");
    expect(result.logs).toContain("Error: Cannot find module 'react'");
  });

  it("preview.stop succeeds", async () => {
    const transport = makeTransport();
    const result = await handlePreviewStop({}, transport);
    expect(result.success).toBe(true);
    expect(result.status).toBe("stopped");
    expect(transport.stopPreview).toHaveBeenCalled();
  });

  it("preview.stop when already stopped is still successful", async () => {
    const transport = makeTransport({
      stopPreview: vi.fn().mockResolvedValue({ workspaceId: "ws-test", status: "stopped" }),
    });
    const result = await handlePreviewStop({}, transport);
    expect(result.success).toBe(true);
    expect(result.status).toBe("stopped");
  });

  it("preview.stop fails truthfully when stop throws", async () => {
    const transport = makeTransport({
      stopPreview: vi.fn().mockRejectedValue(new Error("workspace not found")),
    });
    const result = await handlePreviewStop({}, transport);
    expect(result.success).toBe(false);
    expect(result.error).toContain("workspace not found");
  });
});
