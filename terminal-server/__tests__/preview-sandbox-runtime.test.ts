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
  checkSandboxPreviewGroundTruth,
  checkSandboxPreviewLiveness,
  previewRecreationPromise,
  startSandboxPreview,
  verifySandboxPreviewHealth,
  PREVIEW_LIVENESS_UNREADABLE_ESCALATION_ROUNDS,
  PREVIEW_RECREATION_COOLDOWN_MS,
  PREVIEW_RECREATION_FAILURE_THRESHOLD,
  PREVIEW_RECREATION_FAILURE_WINDOW_MS,
  PREVIEW_RECREATION_MAX_PER_SESSION,
  PREVIEW_VERIFY_FAILURE_THRESHOLD,
  PREVIEW_VERIFY_FAILURE_WINDOW_MS,
  PREVIEW_VERIFY_PROBE_TIMEOUT_MS,
  type SandboxPreviewSupport,
  type SandboxProbeResult,
} from "../preview/sandbox-runtime";
import {
  INSTALL_STAMP_PATH,
  readVolumeInstallStamp,
  SANDBOX_INSTALL_TIMEOUT_MS,
} from "../sandbox/install-stamp";
import {
  PreviewError,
  pushPreviewLog,
  type PreviewRuntime,
} from "../preview/PreviewManager";
import {
  buildSandboxInstallEnv,
  SANDBOX_PREVIEW_NODE_HEAP_MB,
  runSandboxInstallOnce,
} from "../sandbox/install-flight";
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

/**
 * Round 12 (2026-11-16): the preview install exec carries the shared
 * SHAPED install env (heap cap + pnpm concurrency bounds from
 * install-flight.ts) — the same builder the executor's background
 * install uses — and the install shaping does NOT leak into the
 * dev-server launch exec.
 *
 * Round 13 repair: this test originally also pinned the launch env
 * as carrying NO NODE_OPTIONS at all ("shaping is install-only").
 * That premise is the defect round 13 fixes — the unshaped launch
 * inherited the tree .npmrc's 4 GB heap allowance in a 2048 MB box.
 * The launch now carries its OWN shaping
 * (buildSandboxPreviewLaunchEnv: heap bound only, sized for a dev
 * server), and this test pins the separation in its new form: the
 * install env never reaches the launch, and the launch's bound is
 * the preview bound, not the install's 768.
 */
describe("startSandboxPreview — install memory shaping (round 12)", () => {
  it("runs the install with the shared shaped env, and the launch with only its own shaping", async () => {
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
    expect(install!.env).toEqual(buildSandboxInstallEnv(SANDBOX_HOME_DIR));
    expect(install!.env?.NODE_OPTIONS).toBe("--max-old-space-size=768");
    expect(install!.env?.npm_config_network_concurrency).toBe("4");
    expect(install!.env?.npm_config_child_concurrency).toBe("2");

    const launch = executions.find((e) => e.command.includes("setsid nohup"));
    expect(launch, "a launch execute call").toBeDefined();
    // Round 13: the launch's own heap bound — not the install's.
    expect(launch!.env?.NODE_OPTIONS).toBe(
      `--max-old-space-size=${SANDBOX_PREVIEW_NODE_HEAP_MB}`,
    );
    expect(launch!.env?.NODE_OPTIONS).not.toBe("--max-old-space-size=768");
    expect(SANDBOX_PREVIEW_NODE_HEAP_MB).toBe(1280);
    // Install-only concurrency semantics never reach the launch.
    expect(launch!.env?.npm_config_network_concurrency).toBeUndefined();
    expect(launch!.env?.npm_config_child_concurrency).toBeUndefined();
  });
});

/**
 * Round 12 (2026-11-16): after the preview install attempt, the
 * sandbox's memory peak is logged through the sandbox-lifecycle
 * logger — on success AND on a signal kill (where the log must
 * happen before the failure surfaces) — and a broken evidence read
 * changes nothing about the start's outcome.
 */
describe("startSandboxPreview — install memory evidence (round 12)", () => {
  function withEvidence(
    support: SandboxPreviewSupport,
    executions: CapturedExecute[],
    evidenceStdout: string,
  ) {
    const provider = support.provider as unknown as {
      execute: (
        id: string,
        input: CapturedExecute,
      ) => Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }>;
    };
    const original = provider.execute.bind(provider);
    provider.execute = async (id, input) => {
      if (input.command.includes("memory.peak")) {
        executions.push(input);
        return { exitCode: 0, stdout: evidenceStdout, stderr: "", durationMs: 1 };
      }
      return original(id, input);
    };
  }

  it("logs the peak after a successful install and the start proceeds", async () => {
    const { support, executions } = makeSupport();
    withEvidence(support, executions, "LITT_MEMORY_PEAK=1048576000\n");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
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
      const evidence = executions.find((e) => e.command.includes("memory.peak"));
      expect(evidence, "an evidence execute call").toBeDefined();
      const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes("install memory evidence"));
      expect(line).toContain("sandbox=sbx-1");
      expect(line).toContain("exit=0");
      expect(line).toContain("memory.peak=1048576000");
      expect(line).toContain("limit=4294967296");
    } finally {
      info.mockRestore();
    }
  });

  it("logs the peak and kernel lines on a signal-killed install, before the failure surfaces", async () => {
    const { support, executions } = makeSupport(-1);
    withEvidence(
      support,
      executions,
      "LITT_MEMORY_PEAK=1073741824\n[9.9] Memory cgroup out of memory: Killed process 4242 (node)\n",
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
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

      const evidence = executions.find((e) => e.command.includes("memory.peak"));
      expect(evidence, "an evidence execute call").toBeDefined();
      expect(evidence!.command).toContain("dmesg");
      const lines = info.mock.calls.map((c) => String(c[0]));
      const peak = lines.find((l) => l.includes("install memory evidence") && l.includes("memory.peak="));
      expect(peak).toContain("exit=-1");
      expect(peak).toContain("memory.peak=1073741824");
      expect(lines.some((l) => l.includes("kernel:") && l.includes("Killed process 4242"))).toBe(true);
    } finally {
      info.mockRestore();
    }
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

/**
 * Round 10 (2026-11-16 proof): prepare's background install and
 * preview start's inline install ran CONCURRENTLY in the same
 * sandbox — two pnpm installs against one store at 1 vCPU / 1024 MB —
 * and the inline install was signal-killed mid-flight (exit -1).
 * Installs are now single-flight per sandbox (install-flight.ts):
 * the second caller adopts the in-flight install, then re-validates
 * against the freshness stamp.
 */
describe("startSandboxPreview — install single-flight (round 10)", () => {
  function makeDeferredInstallSupport(): {
    support: SandboxPreviewSupport;
    executions: CapturedExecute[];
    releaseInstall: (exitCode: number) => void;
    installCount: () => number;
  } {
    const executions: CapturedExecute[] = [];
    let release!: (exitCode: number) => void;
    const gate = new Promise<number>((resolve) => {
      release = resolve;
    });
    const provider = {
      name: "stub",
      fileTransfer: {
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
          if (input.command.includes("install")) {
            const exitCode = await gate;
            return {
              exitCode,
              stdout: "",
              stderr: exitCode !== 0 ? "install blew up" : "",
              durationMs: 1,
            };
          }
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
      releaseInstall: release,
      installCount: () => executions.filter((e) => e.command.includes("install")).length,
    };
  }

  const startArgs = (support: SandboxPreviewSupport, runtime: PreviewRuntime) => ({
    support,
    runtime,
    ws: WS,
    framework: "custom",
    command: "node server.js --port 3000",
    packageManager: "pnpm",
    travelingEnv: {},
    probe: healthyProbe,
  });

  it("two concurrent preview starts share ONE install in the sandbox", async () => {
    const { support, releaseInstall, installCount } = makeDeferredInstallSupport();
    const first = startSandboxPreview(startArgs(support, makeRuntime()));
    const second = startSandboxPreview(startArgs(support, makeRuntime()));

    // Let both starts reach the install; exactly one may launch it.
    await vi.waitFor(() => expect(installCount()).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(installCount()).toBe(1);

    releaseInstall(0);
    await Promise.all([first, second]);
    expect(installCount()).toBe(1);
  });

  it("logs the envd signal-kill explanation when the install dies with exit -1", async () => {
    const { support } = makeSupport(-1);
    const runtime = makeRuntime();
    await expect(startSandboxPreview(startArgs(support, runtime))).rejects.toMatchObject({
      code: "preview_dependency_install_failed",
    });
    expect(runtime.errorCode).toBe("preview_dependency_install_failed");
    expect(
      runtime.logs.some((line) => line.includes("killed by a signal")),
      "the preview log names the signal kill",
    ).toBe(true);
  });

  it("an adopted install's failure is overridden by a fresh stamp (freshness is ground truth)", async () => {
    // Real volume so readVolumeInstallStamp produces a stamp; the
    // sandbox's stamp reads STALE on the first check (→ install
    // branch) and CURRENT on the post-adoption re-check.
    const volumeDir = mkdtempSync(join(tmpdir(), "litt-preview-adopt-"));
    try {
      writeFileSync(
        join(volumeDir, "package.json"),
        '{"name":"proj","packageManager":"pnpm@9.15.0"}',
      );
      writeFileSync(join(volumeDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
      const expectedStamp = readVolumeInstallStamp(volumeDir);
      expect(expectedStamp).toBeTruthy();

      let stampReads = 0;
      const executions: CapturedExecute[] = [];
      const provider = {
        name: "stub",
        fileTransfer: {
          listDir: vi.fn(async () => [
            { path: "node_modules", name: "node_modules", type: "dir", size: 0, mtimeMs: 0, mode: 0 },
          ]),
          makeDir: vi.fn(async () => {}),
          writeFile: vi.fn(async () => {}),
          readFile: vi.fn(async (_id: string, path: string) => {
            if (path === INSTALL_STAMP_PATH) {
              stampReads += 1;
              return new TextEncoder().encode(
                `${stampReads === 1 ? "stale-stamp" : expectedStamp}\n`,
              );
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
      const support = {
        executor: executor as unknown as SandboxWorkspaceExecutor,
        provider: provider as unknown as SandboxProvider,
      };

      // Occupy the sandbox's install flight with a failing install
      // (the "prepare background install" that loses the race).
      let releaseFlight!: (code: number) => void;
      const flightGate = new Promise<number>((resolve) => {
        releaseFlight = resolve;
      });
      const manualFlight = runSandboxInstallOnce("sbx-1", async () => ({
        exitCode: await flightGate,
        stdout: "",
        stderr: "boom",
        durationMs: 1,
      }));

      const started = startSandboxPreview({
        support,
        runtime: makeRuntime(),
        ws: { ...WS, root: volumeDir },
        framework: "custom",
        command: "node server.js --port 3000",
        packageManager: "pnpm",
        travelingEnv: {},
        probe: healthyProbe,
      });
      // Give the start time to adopt the occupied flight, then fail it.
      await new Promise((r) => setTimeout(r, 50));
      releaseFlight(1);

      // The adopted failure must NOT fail the start: the re-check
      // finds the deps fresh, and the dev server launches — with no
      // install execute of the preview's own at all.
      await started;
      await manualFlight;
      expect(executions.some((e) => e.command.includes("install"))).toBe(false);
      expect(executions.some((e) => e.command.includes("setsid nohup"))).toBe(true);
    } finally {
      rmSync(volumeDir, { recursive: true, force: true });
    }
  });
});

/**
 * Round 13 (2026-11-17): the live verify must EARN a "crashed"
 * verdict. Before this fix, verifySandboxPreviewHealth flipped a
 * ready runtime to failed on a SINGLE probe fetch returning
 * anything non-healthy — including a 3 s timeout while the dev
 * server was busy compiling (the 2026-11-17 proof: runtimes passed
 * real upstream fetches, then a later single fetch failed and the
 * preview was declared crashed). The verify now requires sustained
 * failure across a window AND a dead preview pid; a live pid blocks
 * the flip outright, and a confirmed-dead pid convicts at once.
 *
 * Round 15 (C1) amendment, applied to the tests below: the
 * sustained-failure-with-unreadable-liveness conviction is RETIRED
 * (an unreadable verdict is not evidence), alive rounds reset the
 * accounting instead of banking it, and a confirmed-dead pid now
 * convicts only when the in-sandbox ground-truth check does not
 * find the server answering locally.
 */
describe("verifySandboxPreviewHealth — earned crash verdict (round 13)", () => {
  const failingProbe = async (): Promise<SandboxProbeResult> => ({
    healthy: false,
    authConfigError: false,
    rootRouteMissing: false,
    status: null,
  });

  type LivenessMode = "alive" | "dead" | "unreadable";

  function makeVerifySupport(mode: LivenessMode, logText = ""): SandboxPreviewSupport {
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async (_id: string, path: string) => {
          if (path === "/tmp/litt-preview/preview.log") {
            return new TextEncoder().encode(logText);
          }
          return new Uint8Array();
        }),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(async (_sandboxId: string, input: { command: string }) => {
        if (input.command.includes("LITT_PREVIEW_LIVENESS")) {
          if (mode === "unreadable") throw new Error("envd unreachable");
          return {
            exitCode: 0,
            stdout:
              mode === "alive"
                ? "LITT_PREVIEW_LIVENESS=alive pid=4242\n"
                : "LITT_PREVIEW_LIVENESS=dead pid=4242\n",
            stderr: "",
            durationMs: 1,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      }),
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
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    };
  }

  function makeReadyRuntime(): PreviewRuntime {
    const runtime = makeRuntime();
    runtime.status = "ready";
    runtime.upstream = {
      kind: "sandbox",
      sandboxId: "sbx-1",
      origin: "https://stub-preview.invalid",
      headers: { "e2b-traffic-access-token": "stub-token" },
    };
    return runtime;
  }

  it("a single failed probe does NOT flip a ready runtime whose pid is alive", async () => {
    const support = makeVerifySupport("alive");
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(runtime.errorCode).toBeNull();
    // Round 15 (C1): an alive-but-failing round RESETS the failure
    // accounting — round 13/14 banked it (this asserted 1), which
    // let early patience be spent by a later conviction.
    expect(runtime.healthFailureCount).toBe(0);
    expect(runtime.healthFailureSince).toBeNull();
    expect(
      runtime.logs.some((l) => l.includes("is alive in the sandbox — staying ready")),
    ).toBe(true);
  });

  it("repeated failed probes across the whole window still do NOT flip while the pid is alive", async () => {
    const support = makeVerifySupport("alive");
    const runtime = makeReadyRuntime();

    for (let i = 0; i < PREVIEW_VERIFY_FAILURE_THRESHOLD + 2; i++) {
      // Age the window past the conviction span before each call —
      // even sustained failure cannot convict a living process.
      runtime.healthFailureSince = Date.now() - PREVIEW_VERIFY_FAILURE_WINDOW_MS - 1000;
      const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });
      expect(ok).toBe(true);
      expect(runtime.status).toBe("ready");
    }
    // Round 15 (C1): every alive round resets the accounting, so
    // the count never banks up across living-process rounds.
    expect(runtime.healthFailureCount).toBe(0);
    expect(runtime.healthFailureSince).toBeNull();
  });

  it("a confirmed-dead pid flips on the FIRST failed probe, with the log tail in the error", async () => {
    const support = makeVerifySupport(
      "dead",
      "dev server booting\nError: JavaScript heap out of memory\n",
    );
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });

    expect(ok).toBe(false);
    expect(runtime.status).toBe("failed");
    expect(runtime.errorCode).toBe("preview_dev_server_failed");
    expect(runtime.error).toContain("pid 4242");
    expect(runtime.error).toContain("no longer running");
    // The diagnostic carries the server's own last words, not a guess.
    expect(runtime.error).toContain("JavaScript heap out of memory");
    expect(runtime.error).not.toContain("may have crashed");
  });

  it("sustained failure with liveness unreadable NEVER flips (round 15 C1: an unreadable verdict is not evidence)", async () => {
    // Round 13/14 convicted here — failures past the threshold
    // across the window with liveness unreadable flipped the
    // runtime to "stopped responding". That is the exact
    // combination that killed the 2026-11-17 re-proof: a saturated
    // guest starved BOTH the probes and the liveness exec. Round
    // 15 (C1) retires it: unreadable rounds record nothing.
    const support = makeVerifySupport("unreadable", "last words from the server\n");
    const runtime = makeReadyRuntime();

    for (let i = 0; i < PREVIEW_VERIFY_FAILURE_THRESHOLD + 3; i++) {
      runtime.healthFailureSince = Date.now() - PREVIEW_VERIFY_FAILURE_WINDOW_MS - 1000;
      const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });
      expect(ok).toBe(true);
      expect(runtime.status).toBe("ready");
      expect(runtime.errorCode).toBeNull();
    }
    expect(runtime.healthFailureCount ?? 0).toBe(0);
    expect(runtime.healthLivenessUnreadableCount).toBe(
      PREVIEW_VERIFY_FAILURE_THRESHOLD + 3,
    );
  });

  it("failures below the threshold with liveness unreadable do NOT flip, even across the window", async () => {
    const support = makeVerifySupport("unreadable");
    const runtime = makeReadyRuntime();
    runtime.healthFailureSince = Date.now() - PREVIEW_VERIFY_FAILURE_WINDOW_MS - 1000;

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    // Round 15 (C1): the unreadable round recorded no failure.
    expect(runtime.healthFailureCount ?? 0).toBe(0);
    expect(runtime.healthLivenessUnreadableCount).toBe(1);
  });

  it("a healthy probe resets the failure accounting", async () => {
    const support = makeVerifySupport("unreadable");
    const runtime = makeReadyRuntime();
    // Seed the accounting as earlier rounds could have left it;
    // one healthy probe must clear all of it.
    runtime.healthFailureCount = 2;
    runtime.healthFailureSince = Date.now() - 1000;
    runtime.healthLivenessUnreadableCount = 3;

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe: healthyProbe });
    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(runtime.healthFailureCount).toBe(0);
    expect(runtime.healthFailureSince).toBeNull();
    expect(runtime.healthLivenessUnreadableCount).toBe(0);
  });

  it("a non-ready runtime is never probed", async () => {
    const support = makeVerifySupport("dead");
    const runtime = makeReadyRuntime();
    runtime.status = "starting";
    const probe = vi.fn(failingProbe);

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe });

    expect(ok).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(runtime.status).toBe("starting");
  });
});

/**
 * Round 14 (2026-11-17 re-proof on the round-13 build): the verify
 * could prove the dev server alive (pid + log tail) while every
 * probe through the public preview address got NO response — the
 * stored E2B endpoint, minted once at start and never refreshed,
 * had died underneath a healthy guest, and the code had no repair
 * path, only a conviction round 13 rightly refuses for a live pid.
 * The verify now re-exposes the port and re-probes BEFORE judging:
 * recovery precedes conviction, and round 13's conviction rules are
 * untouched for a genuinely dead server.
 *
 * Round 15 test-contract correction: the original round-14 tests
 * mocked exposePort returning a DIFFERENT origin ("fresh-preview")
 * and a "fresh-token" for the same sandboxId. The production E2B
 * provider can never do that — getHost(port) is a deterministic
 * function of (sandboxId, port) and the traffic token belongs to
 * the sandbox (e2b-provider.ts) — so the suite proved the swap
 * logic against a provider that does not exist, which is how the
 * repair verified 892/892 locally and changed nothing live. The
 * mocks below model the real contract: re-exposure returns the
 * SAME origin and the SAME token, with only a fresh (synthetic)
 * expiry. Recovery in these tests therefore comes from the
 * re-probe itself (a transient miss clearing), never from a new
 * address.
 */
describe("verifySandboxPreviewHealth — upstream repair (round 14)", () => {
  const OLD_ORIGIN = "https://old-preview.invalid";
  // The deterministic provider contract: re-exposing the same
  // sandbox returns this same origin and the stored token.
  const SAME_ORIGIN = OLD_ORIGIN;

  const failing: SandboxProbeResult = {
    healthy: false,
    authConfigError: false,
    rootRouteMissing: false,
    status: null,
  };
  const healthy: SandboxProbeResult = {
    healthy: true,
    authConfigError: false,
    rootRouteMissing: false,
    status: 200,
  };
  const probeByOrigin =
    (healthyOrigins: ReadonlySet<string>) =>
    async (origin: string): Promise<SandboxProbeResult> =>
      healthyOrigins.has(origin) ? healthy : failing;

  /**
   * First probe fails, every later probe is healthy — a transient
   * miss clearing on the repair's re-probe. Under the deterministic
   * provider contract this is the ONLY way re-exposure recovers a
   * runtime: the address never changes, the miss does.
   */
  const failFirstThenHealthy = () => {
    let calls = 0;
    return async (): Promise<SandboxProbeResult> => {
      calls += 1;
      return calls === 1 ? failing : healthy;
    };
  };

  type LivenessMode = "alive" | "dead" | "unreadable";

  function makeRepairSupport(
    mode: LivenessMode,
    exposeImpl?: () => Promise<{ url: string; previewToken: string; expiresAt?: string }>,
  ): { support: SandboxPreviewSupport; exposePort: ReturnType<typeof vi.fn> } {
    const exposePort = vi.fn(
      exposeImpl ??
        (async () => ({
          // Deterministic reality (round 15): same sandbox → same
          // origin, same sandbox-owned token; only the synthetic
          // expiry is fresh.
          url: SAME_ORIGIN,
          previewToken: "stub-token",
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        })),
    );
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => new Uint8Array()),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(async (_sandboxId: string, input: { command: string }) => {
        if (input.command.includes("LITT_PREVIEW_LIVENESS")) {
          if (mode === "unreadable") throw new Error("envd unreachable");
          return {
            exitCode: 0,
            stdout:
              mode === "alive"
                ? "LITT_PREVIEW_LIVENESS=alive pid=4242\n"
                : "LITT_PREVIEW_LIVENESS=dead pid=4242\n",
            stderr: "",
            durationMs: 1,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      }),
      exposePort,
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
      exposePort,
    };
  }

  function makeReadyRuntime(expiresAt?: number | null): PreviewRuntime {
    const runtime = makeRuntime();
    runtime.status = "ready";
    runtime.upstream = {
      kind: "sandbox",
      sandboxId: "sbx-1",
      origin: OLD_ORIGIN,
      headers: { "e2b-traffic-access-token": "stub-token" },
      expiresAt: expiresAt ?? null,
    };
    return runtime;
  }

  it("repairs a missed probe under a live pid: re-exposure returns the SAME address (deterministic provider) and the re-probe recovers", async () => {
    const { support, exposePort } = makeRepairSupport("alive");
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: failFirstThenHealthy(),
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(exposePort).toHaveBeenCalledTimes(1);
    expect(exposePort).toHaveBeenCalledWith("sbx-1", 3000);
    // Round 15 contract: the stored upstream still points at the
    // SAME origin with the SAME sandbox token — re-exposure cannot
    // mint a new address for the same sandbox. Only the synthetic
    // expiry is fresh.
    expect(runtime.upstream).toMatchObject({
      kind: "sandbox",
      origin: SAME_ORIGIN,
      headers: { "e2b-traffic-access-token": "stub-token" },
    });
    expect(
      (runtime.upstream as { expiresAt?: number | null }).expiresAt,
    ).toBeGreaterThan(Date.now());
    expect(runtime.healthFailureCount).toBe(0);
    expect(runtime.healthFailureSince).toBeNull();
    expect(runtime.logs.some((l) => l.includes("Re-exposed the preview port"))).toBe(true);
    expect(runtime.logs.some((l) => l.includes("Preview address recovered"))).toBe(true);
  });

  it("a re-probe that also fails under a live pid stays ready — no conviction — and the alive round resets the failure count", async () => {
    const { support, exposePort } = makeRepairSupport("alive");
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(runtime.errorCode).toBeNull();
    expect(exposePort).toHaveBeenCalledTimes(1);
    // Round 15 (C1): alive-but-failing rounds reset, not bank.
    expect(runtime.healthFailureCount).toBe(0);
    expect(runtime.healthFailureSince).toBeNull();
    // The failure line names the address that was actually probed —
    // the discriminator the round-14 diagnosis was starved of.
    expect(
      runtime.logs.some((l) => l.includes(`probed ${OLD_ORIGIN}`)),
    ).toBe(true);
  });

  it("an expired endpoint triggers re-exposure even when liveness is unreadable, and a healthy re-probe recovers", async () => {
    const { support, exposePort } = makeRepairSupport("unreadable");
    const runtime = makeReadyRuntime(Date.now() - 1_000); // lapsed

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: failFirstThenHealthy(),
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(exposePort).toHaveBeenCalledTimes(1);
    expect(runtime.healthFailureCount).toBe(0);
  });

  it("an unexpired endpoint with unreadable liveness does NOT trigger re-exposure below the conviction threshold", async () => {
    const { support, exposePort } = makeRepairSupport("unreadable");
    const runtime = makeReadyRuntime(Date.now() + 10 * 60_000);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(exposePort).not.toHaveBeenCalled();
  });

  it("a confirmed-dead pid convicts on the first probe WITHOUT re-exposure when the endpoint is unexpired", async () => {
    const { support, exposePort } = makeRepairSupport("dead");
    const runtime = makeReadyRuntime(Date.now() + 10 * 60_000);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
    });

    expect(ok).toBe(false);
    expect(runtime.status).toBe("failed");
    expect(runtime.errorCode).toBe("preview_dev_server_failed");
    expect(exposePort).not.toHaveBeenCalled();
  });

  it("when re-exposure itself fails, a live pid still stays ready under the round-13 rules", async () => {
    const { support } = makeRepairSupport("alive", async () => {
      throw new Error("provider unavailable");
    });
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    // Round 15 (C1): the alive round resets the accounting.
    expect(runtime.healthFailureCount).toBe(0);
  });

  it("the start path stores the endpoint expiry on the runtime upstream", async () => {
    const { support } = makeSupport();
    const provider = support.provider as unknown as {
      exposePort: ReturnType<typeof vi.fn>;
    };
    const expiryIso = new Date(1_893_456_000_000).toISOString();
    provider.exposePort.mockResolvedValue({
      url: "https://stub-preview.invalid",
      previewToken: "stub-token",
      expiresAt: expiryIso,
    });
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

    expect(runtime.upstream).toMatchObject({
      kind: "sandbox",
      origin: "https://stub-preview.invalid",
      expiresAt: 1_893_456_000_000,
    });
  });
});

describe("checkSandboxPreviewLiveness (round 13)", () => {
  function livenessSupport(stdout: string | Error): SandboxPreviewSupport {
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => new Uint8Array()),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(async () => {
        if (stdout instanceof Error) throw stdout;
        return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
      }),
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
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    };
  }

  it("parses an alive verdict with its pid", async () => {
    const liveness = await checkSandboxPreviewLiveness(
      livenessSupport("LITT_PREVIEW_LIVENESS=alive pid=777\n"),
      "sbx-1",
    );
    expect(liveness).toEqual({ pid: 777, alive: true });
  });

  it("parses a dead verdict with its pid", async () => {
    const liveness = await checkSandboxPreviewLiveness(
      livenessSupport("LITT_PREVIEW_LIVENESS=dead pid=777\n"),
      "sbx-1",
    );
    expect(liveness).toEqual({ pid: 777, alive: false });
  });

  it("a missing pid file is undetermined, never a guessed death", async () => {
    const liveness = await checkSandboxPreviewLiveness(
      livenessSupport("LITT_PREVIEW_LIVENESS=no-pid\n"),
      "sbx-1",
    );
    expect(liveness).toEqual({ pid: null, alive: null });
  });

  it("an exec failure is undetermined, never a guessed death", async () => {
    const liveness = await checkSandboxPreviewLiveness(
      livenessSupport(new Error("envd down")),
      "sbx-1",
    );
    expect(liveness).toEqual({ pid: null, alive: null });
  });
});

/**
 * Round 15 (2026-11-17 re-proof diagnosis): the verdict machinery
 * convicted a slow guest because its two safeguards shared one
 * throat — 3 s probes read 6–12 s responses as silence, the
 * liveness exec starved in the same window and returned unreadable,
 * and unreadable + accumulated failures was the one convicting
 * combination. C1: conviction requires a READABLE verdict backed
 * by a patient in-sandbox ground-truth check; probes get 15 s of
 * patience; alive rounds reset the accounting. C5: the [preview]
 * verdict lines are mirrored to stdout so the evidence survives.
 */
describe("verifySandboxPreviewHealth — readable verdicts only (round 15, C1)", () => {
  const failingProbe = async (): Promise<SandboxProbeResult> => ({
    healthy: false,
    authConfigError: false,
    rootRouteMissing: false,
    status: null,
  });

  type LivenessMode = "alive" | "dead" | "unreadable";
  type GroundTruthMode = "answering" | "silent" | "unreadable";

  function makeRound15Support(
    mode: LivenessMode,
    groundTruth: GroundTruthMode,
  ): SandboxPreviewSupport {
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => new Uint8Array()),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(async (_sandboxId: string, input: { command: string }) => {
        if (input.command.includes("LITT_PREVIEW_LIVENESS")) {
          if (mode === "unreadable") throw new Error("envd unreachable");
          return {
            exitCode: 0,
            stdout:
              mode === "alive"
                ? "LITT_PREVIEW_LIVENESS=alive pid=4242\n"
                : "LITT_PREVIEW_LIVENESS=dead pid=4242\n",
            stderr: "",
            durationMs: 1,
          };
        }
        if (input.command.includes("LITT_PREVIEW_GROUND_TRUTH")) {
          if (groundTruth === "unreadable") throw new Error("envd unreachable");
          return {
            exitCode: 0,
            stdout:
              groundTruth === "answering"
                ? "LITT_PREVIEW_GROUND_TRUTH=200\n"
                : "LITT_PREVIEW_GROUND_TRUTH=000\n",
            stderr: "",
            durationMs: 1,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      }),
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
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    };
  }

  function makeReadyRuntime(): PreviewRuntime {
    const runtime = makeRuntime();
    runtime.status = "ready";
    runtime.upstream = {
      kind: "sandbox",
      sandboxId: "sbx-1",
      origin: "https://stub-preview.invalid",
      headers: { "e2b-traffic-access-token": "stub-token" },
    };
    return runtime;
  }

  it("the live verify probes with 15 s patience, not the start loop's 3 s", async () => {
    const support = makeRound15Support("alive", "silent");
    const runtime = makeReadyRuntime();
    const seen: (number | undefined)[] = [];
    const probe = async (
      _origin: string,
      _headers: Record<string, string>,
      timeoutMs?: number,
    ): Promise<SandboxProbeResult> => {
      seen.push(timeoutMs);
      return failingProbe();
    };

    await verifySandboxPreviewHealth(support, runtime, { probe });

    expect(PREVIEW_VERIFY_PROBE_TIMEOUT_MS).toBe(15_000);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((t) => t === PREVIEW_VERIFY_PROBE_TIMEOUT_MS)).toBe(true);
  });

  it("a confirmed-dead pid does NOT convict when the guest answers locally — data-path state, not a dead server", async () => {
    const support = makeRound15Support("dead", "answering");
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(runtime.errorCode).toBeNull();
    expect(runtime.healthFailureCount).toBe(0);
    expect(
      runtime.logs.some((l) =>
        l.includes("answers inside the sandbox (local HTTP 200)"),
      ),
    ).toBe(true);
  });

  it("a confirmed-dead pid convicts when the guest does not answer locally", async () => {
    const support = makeRound15Support("dead", "silent");
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });

    expect(ok).toBe(false);
    expect(runtime.status).toBe("failed");
    expect(runtime.errorCode).toBe("preview_dev_server_failed");
    expect(runtime.error).toContain("pid 4242");
    expect(runtime.error).toContain("no longer running");
  });

  it("a confirmed-dead pid convicts even when the ground-truth check itself is unreadable", async () => {
    const support = makeRound15Support("dead", "unreadable");
    const runtime = makeReadyRuntime();

    const ok = await verifySandboxPreviewHealth(support, runtime, { probe: failingProbe });

    expect(ok).toBe(false);
    expect(runtime.status).toBe("failed");
    expect(runtime.errorCode).toBe("preview_dev_server_failed");
  });

  it("sustained unreadable liveness escalates in the log — the machinery is degraded, not the server", async () => {
    const support = makeRound15Support("unreadable", "silent");
    const runtime = makeReadyRuntime();

    for (let i = 0; i < PREVIEW_LIVENESS_UNREADABLE_ESCALATION_ROUNDS; i++) {
      const ok = await verifySandboxPreviewHealth(support, runtime, {
        probe: failingProbe,
      });
      expect(ok).toBe(true);
      expect(runtime.status).toBe("ready");
    }
    expect(runtime.healthLivenessUnreadableCount).toBe(
      PREVIEW_LIVENESS_UNREADABLE_ESCALATION_ROUNDS,
    );
    expect(runtime.healthFailureCount ?? 0).toBe(0);
    expect(
      runtime.logs.some((l) => l.includes("the verdict machinery")),
    ).toBe(true);
    expect(
      runtime.logs.some((l) => l.includes("is degraded, not the server")),
    ).toBe(true);
  });
});

describe("checkSandboxPreviewGroundTruth (round 15, C1)", () => {
  function groundTruthSupport(stdout: string | Error): SandboxPreviewSupport {
    const provider = {
      name: "stub",
      fileTransfer: {
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
          _id: string,
          input: { command: string; timeoutMs?: number },
        ) => {
          if (stdout instanceof Error) throw stdout;
          return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
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
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    };
  }

  it("parses a locally-answering guest with its HTTP status", async () => {
    const truth = await checkSandboxPreviewGroundTruth(
      groundTruthSupport("LITT_PREVIEW_GROUND_TRUTH=200\n"),
      "sbx-1",
    );
    expect(truth).toEqual({ status: 200, answering: true });
  });

  it("curl's 000 is a readable 'not answering', not an unreadable check", async () => {
    const truth = await checkSandboxPreviewGroundTruth(
      groundTruthSupport("LITT_PREVIEW_GROUND_TRUTH=000\n"),
      "sbx-1",
    );
    expect(truth).toEqual({ status: null, answering: false });
  });

  it("an exec failure is undetermined, never a guessed verdict", async () => {
    const truth = await checkSandboxPreviewGroundTruth(
      groundTruthSupport(new Error("envd down")),
      "sbx-1",
    );
    expect(truth).toEqual({ status: null, answering: null });
  });

  it("asks the guest with a patient budget, not the liveness check's 10 s", async () => {
    const support = groundTruthSupport("LITT_PREVIEW_GROUND_TRUTH=200\n");
    const provider = support.provider as unknown as {
      execute: ReturnType<typeof vi.fn>;
    };
    await checkSandboxPreviewGroundTruth(support, "sbx-1");
    const call = provider.execute.mock.calls[0];
    expect(call[1].command).toContain("curl");
    expect(call[1].command).toContain("localhost:3000");
    expect(call[1].timeoutMs).toBe(30_000);
  });
});

describe("pushPreviewLog — stdout mirror (round 15, C5)", () => {
  it("mirrors [preview] verdict lines to stdout so they survive the runtime", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const runtime = makeRuntime();
      pushPreviewLog(runtime, "[preview] Health check passed — ready (sandbox)");
      expect(runtime.logs).toContain("[preview] Health check passed — ready (sandbox)");
      const mirrored = info.mock.calls.map((c) => String(c[0]));
      expect(mirrored).toContain("[preview] Health check passed — ready (sandbox)");
    } finally {
      info.mockRestore();
    }
  });

  it("does NOT mirror the dev server's own output lines", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const runtime = makeRuntime();
      pushPreviewLog(runtime, "GET / 200 in 6.8s");
      pushPreviewLog(runtime, "[stderr] compiling…");
      expect(runtime.logs).toHaveLength(2);
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });
});

/**
 * Round 16 (C2) — gated sandbox recreation for a verifiably dead
 * preview address.
 *
 * The live failure these tests answer (2026-11-17, production):
 * sandbox iqurn9a3kukxgdt8vd7x0's dev server was alive and healthy
 * INSIDE the sandbox while every external probe of its preview
 * address timed out — and the round-14 re-exposure kept returning
 * the IDENTICAL address, because E2B derives the host
 * deterministically from (sandboxId, port). The provider stub
 * below models exactly that contract: exposePort(sandboxId) is a
 * pure function of the sandbox id, so the ONLY way to a new
 * address is a new sandbox.
 *
 * Recreation must fire on sustained dead-address evidence with a
 * locally-serving guest (or unreadable verdicts), must NOT fire
 * for a genuinely dead server, and must be capped + spaced so it
 * can never loop.
 */
describe("verifySandboxPreviewHealth — sandbox recreation (round 16, C2)", () => {
  const SBX1_ORIGIN = "https://3000-sbx-1.e2b.app";
  const SBX2_ORIGIN = "https://3000-sbx-2.e2b.app";
  const SBX3_ORIGIN = "https://3000-sbx-3.e2b.app";

  const failing: SandboxProbeResult = {
    healthy: false,
    authConfigError: false,
    rootRouteMissing: false,
    status: null,
  };
  const healthy: SandboxProbeResult = {
    healthy: true,
    authConfigError: false,
    rootRouteMissing: false,
    status: 200,
  };
  const probeByOrigin =
    (healthyOrigins: ReadonlySet<string>) =>
    async (origin: string): Promise<SandboxProbeResult> =>
      healthyOrigins.has(origin) ? healthy : failing;

  type LivenessMode = "alive" | "dead" | "unreadable";
  type GroundTruthMode = "answering" | "silent" | "unreadable";

  function makeRecreationSupport(
    opts: {
      liveness?: LivenessMode;
      groundTruth?: GroundTruthMode;
      destroyError?: Error;
      /** Sandbox ids ensureSandboxForPreview hands out, in order. */
      ensureIds?: string[];
    } = {},
  ) {
    const liveness = opts.liveness ?? "alive";
    const groundTruth = opts.groundTruth ?? "answering";
    const ensureIds = opts.ensureIds ?? ["sbx-2"];
    let ensureCalls = 0;
    const destroySandbox = vi.fn(async (_ws: WorkspaceDescriptor) => {
      if (opts.destroyError) throw opts.destroyError;
    });
    const ensureSandboxForPreview = vi.fn(async () => ({
      sandboxId: ensureIds[Math.min(ensureCalls++, ensureIds.length - 1)],
    }));
    const exposePort = vi.fn(async (sandboxId: string) => ({
      // The production contract (round 15): host + token are a
      // deterministic function of the sandbox — same sandbox, same
      // address; NEW sandbox, NEW address.
      url: `https://3000-${sandboxId}.e2b.app`,
      previewToken: `tok-${sandboxId}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }));
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => new Uint8Array()),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(
        async (_sandboxId: string, input: { command: string }) => {
          if (input.command.includes("LITT_PREVIEW_LIVENESS")) {
            if (liveness === "unreadable") throw new Error("envd unreachable");
            return {
              exitCode: 0,
              stdout:
                liveness === "alive"
                  ? "LITT_PREVIEW_LIVENESS=alive pid=4242\n"
                  : "LITT_PREVIEW_LIVENESS=dead pid=4242\n",
              stderr: "",
              durationMs: 1,
            };
          }
          if (input.command.includes("LITT_PREVIEW_GROUND_TRUTH")) {
            if (groundTruth === "unreadable") {
              throw new Error("envd unreachable");
            }
            return {
              exitCode: 0,
              stdout:
                groundTruth === "answering"
                  ? "LITT_PREVIEW_GROUND_TRUTH=200\n"
                  : "LITT_PREVIEW_GROUND_TRUTH=000\n",
              stderr: "",
              durationMs: 1,
            };
          }
          // Install / launch / housekeeping execs in the recreated
          // sandbox simply succeed.
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        },
      ),
      exposePort,
      extendTimeout: vi.fn(async () => true),
    };
    const executor = {
      ensureSandboxForPreview,
      destroySandbox,
      notePreviewPort: vi.fn(),
    };
    return {
      support: {
        executor: executor as unknown as SandboxWorkspaceExecutor,
        provider: provider as unknown as SandboxProvider,
      },
      destroySandbox,
      ensureSandboxForPreview,
      exposePort,
    };
  }

  function makeReadyRuntime(): PreviewRuntime {
    const runtime = makeRuntime();
    runtime.status = "ready";
    runtime.packageManager = "pnpm";
    runtime.upstream = {
      kind: "sandbox",
      sandboxId: "sbx-1",
      origin: SBX1_ORIGIN,
      headers: { "e2b-traffic-access-token": "tok-sbx-1" },
      expiresAt: null,
    };
    return runtime;
  }

  /**
   * Seed the external-failure accounting as if the previous rounds
   * already failed across the recreation window — the next failing
   * round completes the sustained evidence.
   */
  function seedSustained(runtime: PreviewRuntime) {
    runtime.healthExternalFailureCount =
      PREVIEW_RECREATION_FAILURE_THRESHOLD - 1;
    runtime.healthExternalFailureSince =
      Date.now() - PREVIEW_RECREATION_FAILURE_WINDOW_MS - 1_000;
  }

  const resolveWorkspace = () => WS;

  it("dead ingress + alive, locally-answering server recreates exactly once and the NEW address is used", async () => {
    const healthyOrigins = new Set<string>([SBX2_ORIGIN]);
    const { support, destroySandbox } = makeRecreationSupport();
    const runtime = makeReadyRuntime();
    seedSustained(runtime);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(healthyOrigins),
      resolveWorkspace,
    });

    expect(ok).toBe(true);
    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(destroySandbox).toHaveBeenCalledWith(WS);
    expect(runtime.healthRecreationCount).toBe(1);
    // The trigger decision is logged with both ids and addresses.
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("recreating the sandbox for a fresh address") &&
          l.includes("sbx-1") &&
          l.includes(SBX1_ORIGIN),
      ),
    ).toBe(true);

    const recreation = previewRecreationPromise(runtime);
    expect(recreation).not.toBeNull();
    await recreation;
    await vi.waitFor(() => expect(runtime.status).toBe("ready"));

    // The runtime now points at the NEW sandbox and ITS address —
    // the panel surfaces the fresh upstream from here on.
    expect(runtime.upstream).toMatchObject({
      kind: "sandbox",
      sandboxId: "sbx-2",
      origin: SBX2_ORIGIN,
      headers: { "e2b-traffic-access-token": "tok-sbx-2" },
    });
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("Sandbox recreation complete") &&
          l.includes("sbx-2") &&
          l.includes(SBX2_ORIGIN),
      ),
    ).toBe(true);
    expect(previewRecreationPromise(runtime)).toBeNull();
    expect(runtime.healthRecreationInFlight).toBe(false);

    // Continued failure against the new address does NOT immediately
    // re-trigger: the recreation reset the external accounting, so
    // the fresh address earns its own evidence window.
    healthyOrigins.delete(SBX2_ORIGIN);
    for (let i = 0; i < PREVIEW_RECREATION_FAILURE_THRESHOLD - 1; i++) {
      const roundOk = await verifySandboxPreviewHealth(support, runtime, {
        probe: probeByOrigin(healthyOrigins),
        resolveWorkspace,
      });
      expect(roundOk).toBe(true);
    }
    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(runtime.healthRecreationCount).toBe(1);
  });

  it("a genuinely dead server does NOT recreate — the C1 conviction stands", async () => {
    const { support, destroySandbox, ensureSandboxForPreview } =
      makeRecreationSupport({ liveness: "dead", groundTruth: "silent" });
    const runtime = makeReadyRuntime();
    seedSustained(runtime);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
      resolveWorkspace,
    });

    expect(ok).toBe(false);
    expect(runtime.status).toBe("failed");
    expect(runtime.errorCode).toBe("preview_dev_server_failed");
    expect(destroySandbox).not.toHaveBeenCalled();
    expect(ensureSandboxForPreview).not.toHaveBeenCalled();
    expect(runtime.healthRecreationCount ?? 0).toBe(0);
  });

  it("ground truth saying the server does not answer locally blocks recreation even under a live pid", async () => {
    const { support, destroySandbox } = makeRecreationSupport({
      liveness: "alive",
      groundTruth: "silent",
    });
    const runtime = makeReadyRuntime();
    seedSustained(runtime);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
      resolveWorkspace,
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(destroySandbox).not.toHaveBeenCalled();
    expect(
      runtime.logs.some((l) => l.includes("recreation is not the remedy")),
    ).toBe(true);
  });

  it("unreadable liveness AND ground truth with a sustained dead address still recreates", async () => {
    const { support, destroySandbox } = makeRecreationSupport({
      liveness: "unreadable",
      groundTruth: "unreadable",
    });
    const runtime = makeReadyRuntime();
    seedSustained(runtime);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>([SBX2_ORIGIN])),
      resolveWorkspace,
    });

    expect(ok).toBe(true);
    expect(destroySandbox).toHaveBeenCalledTimes(1);
    await previewRecreationPromise(runtime);
    await vi.waitFor(() => expect(runtime.status).toBe("ready"));
    expect(runtime.upstream).toMatchObject({
      kind: "sandbox",
      sandboxId: "sbx-2",
      origin: SBX2_ORIGIN,
    });
  });

  it("below the sustained window, no recreation — the evidence accumulates organically first", async () => {
    const { support, destroySandbox } = makeRecreationSupport();
    const runtime = makeReadyRuntime();

    // A full threshold of failing rounds in quick succession: the
    // count is met but the WINDOW is not — a burst is not sustained.
    for (let i = 0; i < PREVIEW_RECREATION_FAILURE_THRESHOLD; i++) {
      const ok = await verifySandboxPreviewHealth(support, runtime, {
        probe: probeByOrigin(new Set<string>()),
        resolveWorkspace,
      });
      expect(ok).toBe(true);
      expect(runtime.status).toBe("ready");
    }
    expect(runtime.healthExternalFailureCount).toBe(
      PREVIEW_RECREATION_FAILURE_THRESHOLD,
    );
    expect(destroySandbox).not.toHaveBeenCalled();
  });

  it("the session cap is enforced — after the cap, sustained failure logs the cap and stays ready", async () => {
    const { support, destroySandbox } = makeRecreationSupport();
    const runtime = makeReadyRuntime();
    runtime.healthRecreationCount = PREVIEW_RECREATION_MAX_PER_SESSION;
    runtime.healthLastRecreationAt =
      Date.now() - PREVIEW_RECREATION_COOLDOWN_MS - 1_000;
    seedSustained(runtime);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
      resolveWorkspace,
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(destroySandbox).not.toHaveBeenCalled();
    expect(
      runtime.logs.some((l) => l.includes("recreation cap")),
    ).toBe(true);
  });

  it("the cooldown is enforced — a recent recreation blocks the next one", async () => {
    const { support, destroySandbox } = makeRecreationSupport();
    const runtime = makeReadyRuntime();
    runtime.healthRecreationCount = 1;
    runtime.healthLastRecreationAt = Date.now();
    seedSustained(runtime);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
      resolveWorkspace,
    });

    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(destroySandbox).not.toHaveBeenCalled();
    expect(runtime.healthRecreationCount).toBe(1);
    expect(runtime.logs.some((l) => l.includes("cooldown"))).toBe(true);
  });

  it("a second recreation fires after the window and cooldown — and the cap stops the third", async () => {
    const healthyOrigins = new Set<string>([SBX2_ORIGIN]);
    const { support, destroySandbox } = makeRecreationSupport({
      ensureIds: ["sbx-2", "sbx-3"],
    });
    const runtime = makeReadyRuntime();
    seedSustained(runtime);

    // Recreation #1: sbx-1 → sbx-2.
    await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(healthyOrigins),
      resolveWorkspace,
    });
    await previewRecreationPromise(runtime);
    await vi.waitFor(() => expect(runtime.status).toBe("ready"));
    expect(runtime.upstream).toMatchObject({ sandboxId: "sbx-2" });
    expect(destroySandbox).toHaveBeenCalledTimes(1);

    // The sbx-2 address dies too. Fresh sustained evidence + the
    // cooldown served → recreation #2: sbx-2 → sbx-3.
    healthyOrigins.delete(SBX2_ORIGIN);
    healthyOrigins.add(SBX3_ORIGIN);
    seedSustained(runtime);
    runtime.healthLastRecreationAt =
      Date.now() - PREVIEW_RECREATION_COOLDOWN_MS - 1_000;
    await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(healthyOrigins),
      resolveWorkspace,
    });
    await previewRecreationPromise(runtime);
    await vi.waitFor(() => expect(runtime.status).toBe("ready"));
    expect(runtime.upstream).toMatchObject({
      sandboxId: "sbx-3",
      origin: SBX3_ORIGIN,
    });
    expect(destroySandbox).toHaveBeenCalledTimes(2);
    expect(runtime.healthRecreationCount).toBe(2);

    // A third dead address hits the session cap — no more recreations.
    healthyOrigins.delete(SBX3_ORIGIN);
    seedSustained(runtime);
    runtime.healthLastRecreationAt =
      Date.now() - PREVIEW_RECREATION_COOLDOWN_MS - 1_000;
    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(healthyOrigins),
      resolveWorkspace,
    });
    expect(ok).toBe(true);
    expect(runtime.status).toBe("ready");
    expect(destroySandbox).toHaveBeenCalledTimes(2);
    expect(
      runtime.logs.some((l) => l.includes("recreation cap")),
    ).toBe(true);
  });

  it("a recreation failure degrades honestly — no crash, no wedged runtime", async () => {
    const { support, ensureSandboxForPreview } = makeRecreationSupport({
      destroyError: new Error("provider destroy unavailable"),
    });
    const runtime = makeReadyRuntime();
    seedSustained(runtime);

    const ok = await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
      resolveWorkspace,
    });

    expect(ok).toBe(true);
    // The detached recreation runs to completion on its own (it
    // never rejects — the failure surfaces in the log instead).
    await vi.waitFor(() =>
      expect(
        runtime.logs.some((l) => l.includes("Sandbox recreation failed")),
      ).toBe(true),
    );
    // The runtime is NOT left wedged in "starting" and the failure
    // is on the record.
    expect(runtime.status).toBe("ready");
    expect(runtime.healthRecreationInFlight).toBe(false);
    expect(previewRecreationPromise(runtime)).toBeNull();
    expect(ensureSandboxForPreview).not.toHaveBeenCalled();
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("Sandbox recreation failed") &&
          l.includes("provider destroy unavailable"),
      ),
    ).toBe(true);
  });
});
