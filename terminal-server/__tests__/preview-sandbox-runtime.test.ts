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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  startSandboxPreview,
  type SandboxPreviewSupport,
} from "../preview/sandbox-runtime";
import {
  INSTALL_STAMP_PATH,
  readVolumeInstallStamp,
  SANDBOX_INSTALL_TIMEOUT_MS,
} from "../sandbox/install-stamp";
import { PreviewError, type PreviewRuntime } from "../preview/PreviewManager";
import { SANDBOX_HOME_DIR } from "../sandbox/workspace-executor";
import type { SandboxProvider } from "../sandbox/provider";
import type { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import type { WorkspaceDescriptor } from "../workspace/WorkspaceManager";

interface CapturedExecute {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  user?: string;
  timeoutMs?: number;
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
        input: {
          command: string;
          cwd?: string;
          env?: Record<string, string>;
          user?: string;
          timeoutMs?: number;
        },
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

/**
 * Round 8 (2026-11-16 proof): the preview install ran with a 300 s
 * timeoutMs while a cold `pnpm install` of this monorepo at 1 vCPU
 * cannot finish in 300 s — and the freshness stamp is written only
 * after a fully successful install, so every cold preview 502'd and
 * retried the whole install forever. Both install sites now share
 * SANDBOX_INSTALL_TIMEOUT_MS (install-stamp.ts); this pins the
 * preview site to it.
 */
describe("startSandboxPreview — install budget (round 8)", () => {
  it("runs the install with the shared SANDBOX_INSTALL_TIMEOUT_MS budget", async () => {
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
    expect(install!.timeoutMs).toBe(SANDBOX_INSTALL_TIMEOUT_MS);
    expect(SANDBOX_INSTALL_TIMEOUT_MS).toBe(900_000);
  });
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

  // Regression (live failure 2026-11-15): with the HOME pin in place
  // the install got further and died at pnpm's FIRST write into the
  // project root — its store-location probe file
  // `/workspace/_tmp_<pid>_<hash>` — because /workspace is root-owned
  // 755 in the template and the install runs as the non-root command
  // user (EACCES, exit 243). The runtime must open the tree up as
  // root BEFORE the install runs, and the install itself must keep
  // running as the default user.
  it("makes the workspace tree writable as root BEFORE the install execute", async () => {
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

    const chmodIdx = executions.findIndex((e) => e.command.includes("chmod"));
    const installIdx = executions.findIndex((e) => e.command.includes("install"));
    expect(chmodIdx, "a chmod execute call").toBeGreaterThanOrEqual(0);
    expect(installIdx, "an install execute call").toBeGreaterThanOrEqual(0);
    expect(chmodIdx).toBeLessThan(installIdx);
    expect(executions[chmodIdx].command).toContain("chmod -R a+rwX /workspace");
    expect(executions[chmodIdx].user).toBe("root");
    expect(executions[installIdx].user).toBeUndefined();
  });
});

/**
 * Install freshness (preview start fix, 2026-11-14): a sandbox whose
 * node_modules was installed against the volume's current lockfile
 * (matching .litt-install-stamp) must NOT pay a synchronous install
 * on every preview start; a stale or missing stamp must install —
 * and a successful install must write the stamp so the next start
 * can skip.
 */
describe("startSandboxPreview — install freshness stamp", () => {
  let volumeDir: string;
  let expectedStamp: string | null;

  beforeEach(() => {
    volumeDir = mkdtempSync(join(tmpdir(), "litt-preview-volume-"));
    writeFileSync(
      join(volumeDir, "package.json"),
      '{"name":"proj","packageManager":"pnpm@9.15.0"}',
    );
    writeFileSync(join(volumeDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    expectedStamp = readVolumeInstallStamp(volumeDir);
    expect(expectedStamp).toBeTruthy();
  });
  afterEach(() => {
    rmSync(volumeDir, { recursive: true, force: true });
  });

  function makeStampSupport(stampInSandbox: string | null): {
    support: SandboxPreviewSupport;
    executions: CapturedExecute[];
    writes: Map<string, Uint8Array>;
  } {
    const executions: CapturedExecute[] = [];
    const writes = new Map<string, Uint8Array>();
    const provider = {
      name: "stub",
      fileTransfer: {
        // node_modules IS present in this sandbox.
        listDir: vi.fn(async () => [
          { path: "node_modules", name: "node_modules", type: "dir", size: 0, mtimeMs: 0, mode: 0 },
        ]),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async (_id: string, path: string, data: Uint8Array) => {
          writes.set(path, data);
        }),
        readFile: vi.fn(async (_id: string, path: string) => {
          if (path === INSTALL_STAMP_PATH) {
            if (stampInSandbox === null) throw new Error("no stamp file");
            return new TextEncoder().encode(`${stampInSandbox}\n`);
          }
          return new Uint8Array();
        }),
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
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
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
      writes,
    };
  }

  const startWith = (
    support: SandboxPreviewSupport,
    runtime: PreviewRuntime,
  ) =>
    startSandboxPreview({
      support,
      runtime,
      ws: { ...WS, root: volumeDir },
      framework: "custom",
      command: "node server.js --port 3000",
      packageManager: "pnpm",
      travelingEnv: {},
      probe: healthyProbe,
    });

  it("skips the install when node_modules carries the current lockfile's stamp", async () => {
    const { support, executions, writes } = makeStampSupport(expectedStamp);
    await startWith(support, makeRuntime());
    expect(executions.some((e) => e.command.includes("install"))).toBe(false);
    // The dev server still launches.
    expect(executions.some((e) => e.command.includes("setsid nohup"))).toBe(true);
    // No stamp rewrite was needed.
    expect(writes.has(INSTALL_STAMP_PATH)).toBe(false);
  });

  it("re-installs when the stamp is stale, then writes the current stamp", async () => {
    const { support, executions, writes } = makeStampSupport("stale-stamp-value");
    await startWith(support, makeRuntime());
    expect(executions.some((e) => e.command.includes("install"))).toBe(true);
    const stampWrite = writes.get(INSTALL_STAMP_PATH);
    expect(stampWrite, "a stamp write after the install").toBeDefined();
    expect(new TextDecoder().decode(stampWrite!).trim()).toBe(expectedStamp);
  });

  it("re-installs when node_modules exists but no stamp file was ever written", async () => {
    const { support, executions } = makeStampSupport(null);
    await startWith(support, makeRuntime());
    expect(executions.some((e) => e.command.includes("install"))).toBe(true);
  });
});
