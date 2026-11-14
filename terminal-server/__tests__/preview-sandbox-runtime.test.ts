/**
 * Sandbox preview runtime — per-command HOME pin (2026-11-14).
 *
 * Live failure: starting a sandbox preview died at dependency
 * install with "EACCES: permission denied, mkdir
 * '/workspace/.cache/node/corepack/v1'". startSandboxPreview calls
 * provider.execute DIRECTLY for the install and the dev-server
 * launch, bypassing the workspace executor — so neither call carried
 * the executor's per-command HOME pin, and the composed base env's
 * Phase 1 default (HOME=/workspace) sent corepack's cache into the
 * root-owned, 755 workspace root, which the non-root command user
 * cannot write. The executor's own exec and prepare-install paths
 * already pin HOME to SANDBOX_HOME_DIR (/home/litt — the template's
 * chmod-777 home, outside the synced tree); these tests pin that the
 * preview runtime's two direct execute calls do the same.
 */

import { describe, it, expect, vi } from "vitest";
import {
  startSandboxPreview,
  type SandboxPreviewSupport,
} from "../preview/sandbox-runtime";
import { PreviewError, type PreviewRuntime } from "../preview/PreviewManager";
import { SANDBOX_HOME_DIR } from "../sandbox/workspace-executor";
import type { SandboxProvider } from "../sandbox/provider";
import type { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import type { WorkspaceDescriptor } from "../workspace/WorkspaceManager";

interface CapturedExecute {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

function makeRuntime(): PreviewRuntime {
  return {
    workspaceId: "ws-preview-home",
    userId: "user-1",
    projectId: "proj-1",
    process: null,
    port: 0,
    framework: "custom",
    command: "node server.js --port 3000",
    status: "starting",
    startedAt: Date.now(),
    lastHealthCheck: null,
    error: null,
    errorCode: null,
    logs: [],
    clerkEnvFingerprint: null,
    clerkProjectEnv: null,
    upstream: undefined,
  } as PreviewRuntime;
}

function makeSupport(installExitCode = 0): {
  support: SandboxPreviewSupport;
  executions: CapturedExecute[];
} {
  const executions: CapturedExecute[] = [];
  const provider = {
    name: "stub",
    fileTransfer: {
      // Empty root listing: no node_modules in the sandbox, so the
      // install branch runs.
      listDir: vi.fn(async () => []),
      makeDir: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () => new Uint8Array()),
      listTree: vi.fn(async () => []),
      removePath: vi.fn(async () => {}),
      renamePath: vi.fn(async () => {}),
    },
    execute: vi.fn(
      async (
        _sandboxId: string,
        input: { command: string; cwd?: string; env?: Record<string, string> },
      ) => {
        executions.push(input);
        const isInstall = input.command.includes("install");
        return {
          exitCode: isInstall ? installExitCode : 0,
          stdout: "",
          stderr: isInstall && installExitCode !== 0 ? "install blew up" : "",
          durationMs: 1,
        };
      },
    ),
    exposePort: vi.fn(async () => ({
      url: "https://stub-preview.invalid",
      previewToken: "stub-token",
    })),
    extendTimeout: vi.fn(async () => true),
  };
  const executor = {
    ensureSandboxForPreview: vi.fn(async () => ({ sandboxId: "sbx-1" })),
    notePreviewPort: vi.fn(),
  };
  return {
    support: {
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    },
    executions,
  };
}

const WS = {
  workspaceId: "ws-preview-home",
  userId: "user-1",
  projectId: "proj-1",
  root: "/volume/ws-preview-home",
  branch: "main",
  commitSha: "",
  ready: true,
} as WorkspaceDescriptor;

const healthyProbe = async () => ({
  healthy: true,
  authConfigError: false,
  rootRouteMissing: false,
  status: 200,
});

describe("startSandboxPreview — HOME pin", () => {
  it("pins HOME to the writable sandbox home on BOTH the install and the launch execute calls", async () => {
    const { support, executions } = makeSupport();
    const runtime = makeRuntime();

    await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "custom",
      command: "node server.js --port 3000",
      packageManager: "pnpm",
      travelingEnv: {},
      probe: healthyProbe,
    });

    const install = executions.find((e) => e.command.includes("install"));
    expect(install, "an install execute call").toBeDefined();
    expect(install!.env?.HOME).toBe(SANDBOX_HOME_DIR);
    expect(install!.env?.HOME).toBe("/home/litt");
    expect(install!.env?.NODE_ENV).toBe("development");

    const launch = executions.find((e) => e.command.includes("setsid nohup"));
    expect(launch, "a launch execute call").toBeDefined();
    expect(launch!.env?.HOME).toBe(SANDBOX_HOME_DIR);
    // The rest of the launch env contract is unchanged.
    expect(launch!.env?.PORT).toBe("3000");
    expect(launch!.env?.NODE_ENV).toBe("development");
  });

  it("a project traveling env cannot re-point HOME away from the sandbox home on launch", async () => {
    const { support, executions } = makeSupport();
    const runtime = makeRuntime();

    await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "custom",
      command: "node server.js --port 3000",
      packageManager: "pnpm",
      travelingEnv: { HOME: "/workspace", CLERK_SECRET_KEY: "sk_test_stub" },
      probe: healthyProbe,
    });

    const launch = executions.find((e) => e.command.includes("setsid nohup"));
    expect(launch!.env?.HOME).toBe(SANDBOX_HOME_DIR);
  });

  it("install failure still reports preview_dependency_install_failed, with the HOME pin on the attempt", async () => {
    const { support, executions } = makeSupport(1);
    const runtime = makeRuntime();

    await expect(
      startSandboxPreview({
        support,
        runtime,
        ws: WS,
        framework: "custom",
        command: "node server.js --port 3000",
        packageManager: "pnpm",
        travelingEnv: {},
        probe: healthyProbe,
      }),
    ).rejects.toBeInstanceOf(PreviewError);

    expect(runtime.status).toBe("failed");
    expect(runtime.errorCode).toBe("preview_dependency_install_failed");
    const install = executions.find((e) => e.command.includes("install"));
    expect(install!.env?.HOME).toBe(SANDBOX_HOME_DIR);
    // No launch is attempted after a failed install.
    expect(executions.some((e) => e.command.includes("setsid nohup"))).toBe(false);
  });
});
