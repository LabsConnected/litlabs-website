/**
 * Preview serve mode — production build for large Next.js projects.
 *
 * Live failure (2026-11-19): the flagship litlabs-website project
 * rendered in the sandbox preview, then dropped at +2–3 minutes —
 * outside probes timed out while the `next dev` process was still
 * alive inside, the sandbox liveness signal went unreadable, the
 * box was killed, and recreation died the same way. The dev
 * server's compile/watch load starves the 2 vCPU / 2048 MB
 * sandbox on a large tree (4,028 files). Small projects are stable
 * on dev and keep its hot reload.
 *
 * The fix (preview/serve-mode.ts): a Next.js project above
 * PREVIEW_PROD_BUILD_FILE_THRESHOLD files is built for production
 * inside the sandbox after the install and served with
 * `next start`. These tests pin the selection rule, the file
 * counter, the command composition, and — the honesty requirement
 * — that a failed build is a failed start with the build's output
 * as the evidence: no launch, no ready, no stale build served.
 */

import { describe, it, expect, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  countProjectFiles,
  nextProductionBuildCommand,
  nextProductionStartCommand,
  resolvePreviewHealthProbeTimeoutMs,
  resolvePreviewServeMode,
  PREVIEW_PROD_BUILD_FILE_THRESHOLD,
  PREVIEW_PROD_HEALTH_PROBE_TIMEOUT_MS,
  SANDBOX_PREVIEW_BUILD_TIMEOUT_MS,
} from "../preview/serve-mode";
import {
  HEALTH_PROBE_TIMEOUT_MS,
  startSandboxPreview,
  type SandboxPreviewSupport,
} from "../preview/sandbox-runtime";
import { PreviewError, type PreviewRuntime } from "../preview/PreviewManager";
import { SANDBOX_PREVIEW_NODE_HEAP_MB } from "../sandbox/install-flight";
import type { SandboxProvider } from "../sandbox/provider";
import type { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import type { WorkspaceDescriptor } from "../workspace/WorkspaceManager";

describe("resolvePreviewServeMode — the selection rule", () => {
  it("keeps a small Next.js project on the dev server", () => {
    // The proven-good scaffold class: ~10 files, renders and holds.
    expect(resolvePreviewServeMode("nextjs", 10)).toBe("dev");
  });

  it("serves a large Next.js project from a production build", () => {
    // The proven-bad class: litlabs-website measures 4,028 files.
    expect(resolvePreviewServeMode("nextjs", 4028)).toBe("production-build");
  });

  it("flips exactly above the threshold, not at it", () => {
    expect(resolvePreviewServeMode("nextjs", PREVIEW_PROD_BUILD_FILE_THRESHOLD)).toBe("dev");
    expect(resolvePreviewServeMode("nextjs", PREVIEW_PROD_BUILD_FILE_THRESHOLD + 1)).toBe(
      "production-build",
    );
  });

  it("never changes how other frameworks are served, however large", () => {
    expect(resolvePreviewServeMode("static", 100_000)).toBe("dev");
    expect(resolvePreviewServeMode("vite", 100_000)).toBe("dev");
    expect(resolvePreviewServeMode("node", 100_000)).toBe("dev");
    expect(resolvePreviewServeMode("unknown", 100_000)).toBe("dev");
  });
});

describe("countProjectFiles — the size signal", () => {
  function makeTree(files: string[]): string {
    const root = mkdtempSync(join(tmpdir(), "serve-mode-count-"));
    for (const rel of files) {
      const abs = join(root, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, "x");
    }
    return root;
  }

  it("counts nested project files", () => {
    const root = makeTree(["package.json", "app/page.tsx", "app/layout.tsx", "src/lib/a.ts"]);
    try {
      expect(countProjectFiles(root)).toBe(4);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes node_modules, .git and build output — installed/generated weight is not project size", () => {
    const root = makeTree([
      "package.json",
      "index.html",
      "node_modules/pkg/index.js",
      "node_modules/pkg/deep/file.js",
      ".git/objects/ab/cdef",
      ".next/server/app/page.js",
      ".turbo/cache/x",
      ".cache/y",
    ]);
    try {
      expect(countProjectFiles(root)).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stops at the limit — deciding against the threshold costs a bounded walk", () => {
    const files = Array.from({ length: 600 }, (_, i) => `src/f${i}.ts`);
    const root = makeTree(files);
    try {
      expect(countProjectFiles(root, 25)).toBe(25);
      // The default limit is exactly the decision boundary + 1.
      expect(countProjectFiles(root)).toBe(PREVIEW_PROD_BUILD_FILE_THRESHOLD + 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 0 for a missing root instead of throwing", () => {
    expect(countProjectFiles(join(tmpdir(), "serve-mode-definitely-absent"))).toBe(0);
  });
});

describe("production command composition", () => {
  it("without a declared build script, builds with the project's package manager directly", () => {
    expect(nextProductionBuildCommand("pnpm")).toBe("pnpm exec next build");
    expect(nextProductionBuildCommand("npm")).toBe("npm exec next build");
    expect(nextProductionBuildCommand("pnpm", null)).toBe("pnpm exec next build");
    expect(nextProductionBuildCommand("pnpm", "")).toBe("pnpm exec next build");
    expect(nextProductionBuildCommand("pnpm", "   ")).toBe("pnpm exec next build");
  });

  it("with a declared build script, runs the project's own build chain — workspace packages first, in production's order", () => {
    // The flagship's scripts.build is
    // "pnpm build:workspace-deps && next build": the workspace
    // packages (@litt/agent-core, @litt/models) compile BEFORE the
    // site build, exactly as the production Dockerfile orders it.
    // The bare `exec next build` skipped that step and the build
    // died "Can't resolve '@litt/agent-core'" (round-6 proof,
    // 2026-11-22) because those packages resolve only through a
    // dist/ that install never produces.
    expect(
      nextProductionBuildCommand("pnpm", "pnpm build:workspace-deps && next build"),
    ).toBe("pnpm run build");
    expect(nextProductionBuildCommand("npm", "next build")).toBe("npm run build");
  });

  it("serves with next start carrying the same $PORT placeholder and hostname as the dev command", () => {
    expect(nextProductionStartCommand("pnpm", "0.0.0.0")).toBe(
      "pnpm exec next start --port $PORT --hostname 0.0.0.0",
    );
  });
});

// ─── startSandboxPreview build path ────────────────────────────────

interface CapturedExecute {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

function makeRuntime(): PreviewRuntime {
  return {
    workspaceId: "ws-serve-mode",
    userId: "user-1",
    projectId: "proj-1",
    process: null,
    port: 0,
    framework: "nextjs",
    command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
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

function makeSupport(
  buildExitCode: number,
  buildOpts: {
    runningPollsBeforeDone?: number;
    neverDone?: boolean;
    /** First N polls throw the SDK's deadline_exceeded error. */
    pollThrowsBeforeDone?: number;
    /** Every poll throws — the sandbox never answers a status check. */
    pollAlwaysThrows?: boolean;
    /** The build launch execute itself throws (transport failure). */
    launchThrows?: boolean;
  } = {},
): {
  support: SandboxPreviewSupport;
  executions: CapturedExecute[];
  writtenFiles: Map<string, string>;
} {
  const executions: CapturedExecute[] = [];
  const writtenFiles = new Map<string, string>();
  let pollCount = 0;
  const provider = {
    name: "stub",
    fileTransfer: {
      // Empty root listing: no node_modules in the sandbox, so the
      // install branch runs before the build.
      listDir: vi.fn(async () => []),
      makeDir: vi.fn(async () => {}),
      writeFile: vi.fn(async (_id: string, path: string, data: Uint8Array) => {
        writtenFiles.set(path, new TextDecoder().decode(data));
      }),
      readFile: vi.fn(async (_id: string, path: string) => {
        // The detached build's log: the build's own output, success
        // or failure, is read back from the log file.
        if (path.includes("build.log")) {
          return new TextEncoder().encode(
            buildExitCode === 0
              ? "✓ Compiled successfully\n✓ Generating static pages"
              : "Module not found: Can't resolve './missing-widget'",
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
        input: {
          command: string;
          cwd?: string;
          env?: Record<string, string>;
          timeoutMs?: number;
        },
      ) => {
        executions.push(input);
        // The build launch execute, failing at the transport layer
        // (round 3): the start must kill the possibly-running
        // detached build rather than orphan it.
        if (buildOpts.launchThrows && input.command.includes("build.sh")) {
          throw new Error(
            "[deadline_exceeded] the operation timed out: launch transport failed",
          );
        }
        // The detached build's poll (its command echoes DONE/RUNNING
        // from the exit file): RUNNING for the configured number of
        // polls, then DONE with the configured build outcome — or
        // RUNNING forever when neverDone is set. Round 3: polls can
        // also throw the SDK's deadline_exceeded text, exactly as a
        // build-starved envd answers in production.
        if (input.command.includes('echo "DONE')) {
          pollCount += 1;
          if (
            buildOpts.pollAlwaysThrows ||
            pollCount <= (buildOpts.pollThrowsBeforeDone ?? 0)
          ) {
            throw new Error(
              "[deadline_exceeded] the operation timed out: This error is likely " +
                "due to exceeding 'timeoutMs' — the total time a long running " +
                "request (like command execution or directory watch) can be active.",
            );
          }
          if (buildOpts.neverDone || pollCount <= (buildOpts.runningPollsBeforeDone ?? 0)) {
            return { exitCode: 0, stdout: "RUNNING", stderr: "", durationMs: 1 };
          }
          return {
            exitCode: 0,
            stdout: `DONE ${buildExitCode}`,
            stderr: "",
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
    writtenFiles,
  };
}

const WS = {
  workspaceId: "ws-serve-mode",
  userId: "user-1",
  projectId: "proj-1",
  root: "/volume/ws-serve-mode",
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

describe("startSandboxPreview — production-build mode", () => {
  it("builds after the install, then launches next start as production", async () => {
    const { support, executions, writtenFiles } = makeSupport(0);
    const runtime = makeRuntime();

    await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      serveMode: "production-build",
      buildCommand: "pnpm exec next build",
      travelingEnv: {},
      probe: healthyProbe,
    });

    const installIdx = executions.findIndex((e) => e.command.includes("install"));
    const buildIdx = executions.findIndex((e) => e.command.includes("build.sh"));
    const launchIdx = executions.findIndex((e) => e.command.includes("run.sh"));
    expect(installIdx, "an install execute call").toBeGreaterThanOrEqual(0);
    expect(buildIdx, "a build launch execute call").toBeGreaterThan(installIdx);
    expect(launchIdx, "a launch execute call").toBeGreaterThan(buildIdx);

    // The build launches DETACHED (the 2026-11-20 fix): no single
    // execute carries the build or its total budget — the launch
    // is a short setsid/nohup like the server's, the build command
    // itself lives in the build script, and
    // SANDBOX_PREVIEW_BUILD_TIMEOUT_MS is only the poll loop's
    // total budget.
    const build = executions[buildIdx];
    expect(build.command).toContain("setsid nohup");
    expect(build.timeoutMs).toBe(30_000);
    expect(build.env?.NODE_ENV).toBe("production");
    expect(build.env?.NEXT_TELEMETRY_DISABLED).toBe("1");
    // The build is heap-shaped with the launch bound, not the
    // install's 768 MB resolve/link bound.
    expect(build.env?.NODE_OPTIONS).toBe(`--max-old-space-size=${SANDBOX_PREVIEW_NODE_HEAP_MB}`);
    const buildScript = [...writtenFiles.values()].find((v) => v.includes("next build"));
    expect(buildScript, "a build script carrying the build command").toBeDefined();
    expect(buildScript).toContain("pnpm exec next build");
    expect(buildScript).toContain("build.exit");
    // The exit file was polled before the launch.
    const pollIdx = executions.findIndex((e) => e.command.includes('echo "DONE'));
    expect(pollIdx, "a build poll execute call").toBeGreaterThan(buildIdx);
    expect(pollIdx).toBeLessThan(launchIdx);

    // The run script serves the production start command, and the
    // launch env runs it as production.
    const script = [...writtenFiles.values()].find((v) => v.includes("exec pnpm exec next start"));
    expect(script).toContain("exec pnpm exec next start --port 3000");
    expect(executions[launchIdx].env?.NODE_ENV).toBe("production");

    // The mode is recorded on the runtime so a recreation rebuilds
    // and re-serves in the same mode.
    expect(runtime.serveMode).toBe("production-build");
    expect(runtime.buildCommand).toBe("pnpm exec next build");
    expect(runtime.logs.some((l) => l.includes("Production build complete"))).toBe(true);
  });

  it("fails the start honestly when the build fails — no launch, build output is the evidence", async () => {
    const { support, executions } = makeSupport(1);
    const runtime = makeRuntime();

    const err = await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      serveMode: "production-build",
      buildCommand: "pnpm exec next build",
      travelingEnv: {},
      probe: healthyProbe,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PreviewError);
    expect((err as PreviewError).code).toBe("preview_build_failed");
    expect(runtime.status).toBe("failed");
    expect(runtime.errorCode).toBe("preview_build_failed");
    // The build's own error text reaches the user-facing error via
    // the log tail — never a bare "build failed" with no cause.
    expect(runtime.error).toContain("Production build failed in sandbox (exit 1)");
    expect(runtime.error).toContain("Module not found: Can't resolve './missing-widget'");
    // No server was launched: there is no state in which a failed
    // build gets served. (The build's own detached launch uses
    // build.sh; the server's run.sh launch must never appear.)
    expect(executions.some((e) => e.command.includes("run.sh"))).toBe(false);
    expect(runtime.status).not.toBe("ready");
  });

  it("polls a still-running build until its exit file lands, then launches", async () => {
    // Two RUNNING polls, then DONE — a build that takes real time.
    const { support, executions } = makeSupport(0, { runningPollsBeforeDone: 2 });
    const runtime = makeRuntime();

    await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      serveMode: "production-build",
      buildCommand: "pnpm exec next build",
      travelingEnv: {},
      probe: healthyProbe,
      buildPollIntervalMs: 1,
    });

    const polls = executions.filter((e) => e.command.includes('echo "DONE'));
    expect(polls.length).toBe(3);
    // The server launch followed the completed build (the health
    // verdict itself lands through the background probe, exactly
    // as in the single-poll case above).
    expect(executions.some((e) => e.command.includes("run.sh"))).toBe(true);
    expect(runtime.logs.some((l) => l.includes("Production build complete"))).toBe(true);
  });

  it("stops a build that exceeds its total budget and fails the start honestly", async () => {
    const { support, executions } = makeSupport(0, { neverDone: true });
    const runtime = makeRuntime();

    const err = await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      serveMode: "production-build",
      buildCommand: "pnpm exec next build",
      travelingEnv: {},
      probe: healthyProbe,
      buildPollIntervalMs: 1,
      buildBudgetMs: 5,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PreviewError);
    expect((err as PreviewError).code).toBe("preview_build_failed");
    expect(runtime.logs.some((l) => l.includes("exceeded the") && l.includes("budget"))).toBe(true);
    // The wedged build was killed, not left running in the sandbox.
    expect(executions.some((e) => e.command.includes("kill -KILL"))).toBe(true);
    expect(executions.some((e) => e.command.includes("run.sh"))).toBe(false);
  });

  it("tolerates throwing build polls and still launches when the build lands (round 3)", async () => {
    // A build-starved envd answers status checks with
    // [deadline_exceeded]; the pre-round-3 loop let the first such
    // throw abort the whole start with the raw SDK error. Two
    // throwing polls, then DONE 0: the start must survive, log the
    // failures and the recovery, and launch.
    const { support, executions } = makeSupport(0, { pollThrowsBeforeDone: 2 });
    const runtime = makeRuntime();

    await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      serveMode: "production-build",
      buildCommand: "pnpm exec next build",
      travelingEnv: {},
      probe: healthyProbe,
      buildPollIntervalMs: 1,
    });

    expect(executions.some((e) => e.command.includes("run.sh"))).toBe(true);
    expect(
      runtime.logs.some((l) => l.includes("Build status check failed (1 in a row")),
    ).toBe(true);
    expect(
      runtime.logs.some((l) => l.includes("Build status checks recovered after 2")),
    ).toBe(true);
    expect(runtime.logs.some((l) => l.includes("Production build complete"))).toBe(true);
  });

  it("fails as status-unreadable — never the raw transport error — when polls throw until the budget ends (round 3)", async () => {
    // Every status check throws: the wait must end at the budget
    // with the failure CLASS named (build outcome unknown), the
    // poll evidence counted, and a memory snapshot attempted —
    // not with the SDK's bare [deadline_exceeded] message, which
    // is all the round-2 proof could see.
    const { support, executions } = makeSupport(0, { pollAlwaysThrows: true });
    const runtime = makeRuntime();

    const err = await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      serveMode: "production-build",
      buildCommand: "pnpm exec next build",
      travelingEnv: {},
      probe: healthyProbe,
      buildPollIntervalMs: 1,
      buildBudgetMs: 25,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PreviewError);
    expect((err as PreviewError).code).toBe("preview_build_failed");
    expect(runtime.error).toContain("Production build status became unreadable in sandbox");
    expect(runtime.error).toContain("consecutive status checks failed");
    expect(
      runtime.logs.some((l) => l.includes("Build status became unreadable")),
    ).toBe(true);
    // The memory snapshot was attempted (the stub answers empty,
    // which is itself recorded) — the 2048 MB evidence channel.
    expect(executions.some((e) => e.command.includes("free -m"))).toBe(true);
    expect(runtime.logs.some((l) => l.includes("Memory snapshot"))).toBe(true);
    // The possibly-still-running build was killed at the budget.
    expect(executions.some((e) => e.command.includes("kill -KILL"))).toBe(true);
    expect(executions.some((e) => e.command.includes("run.sh"))).toBe(false);
  });

  it("kills the detached build when the start dies after the launch (round 3)", async () => {
    // The launch execute throws at the transport layer: whether or
    // not the detached build actually started is unknowable, so
    // the start must best-effort kill it via the pid file instead
    // of orphaning a saturating build into the next start.
    const { support, executions } = makeSupport(0, { launchThrows: true });
    const runtime = makeRuntime();

    const err = await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      serveMode: "production-build",
      buildCommand: "pnpm exec next build",
      travelingEnv: {},
      probe: healthyProbe,
      buildPollIntervalMs: 1,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("launch transport failed");
    expect(executions.some((e) => e.command.includes("kill -KILL"))).toBe(true);
    expect(executions.some((e) => e.command.includes("run.sh"))).toBe(false);
  });

  it("pins the total build budget at 45 minutes — the measured flagship build cannot fit in the old 900 s", () => {
    expect(SANDBOX_PREVIEW_BUILD_TIMEOUT_MS).toBe(2_700_000);
  });

  it("dev mode (the default) never builds and launches as development", async () => {
    const { support, executions } = makeSupport(0);
    const runtime = makeRuntime();
    runtime.command = "pnpm exec next dev --port 3000 --hostname 0.0.0.0";

    await startSandboxPreview({
      support,
      runtime,
      ws: WS,
      framework: "nextjs",
      command: "pnpm exec next dev --port 3000 --hostname 0.0.0.0",
      packageManager: "pnpm",
      travelingEnv: {},
      probe: healthyProbe,
    });

    expect(executions.some((e) => e.command.includes("next build"))).toBe(false);
    const launch = executions.find((e) => e.command.includes("setsid nohup"));
    expect(launch, "a launch execute call").toBeDefined();
    expect(launch!.env?.NODE_ENV).toBe("development");
    expect(runtime.serveMode).toBe("dev");
  });
});

// ─── Health-fix (2026-11-19): probe budget, verdict honesty ────────
//
// The #1062 live proof: provisioning was fixed, the production
// build ran, `next start` launched and stayed alive — and the start
// still failed "did not become healthy within 120s". The 120 s
// window was sized for a dev server; the production path never got
// its own. These tests pin the serve-mode budget in the probe loop,
// the distinct ground-truth recording, and the ready-line boot
// evidence.

describe("resolvePreviewHealthProbeTimeoutMs — the budget rule", () => {
  it("gives the production-build path its own 300 s window", () => {
    expect(PREVIEW_PROD_HEALTH_PROBE_TIMEOUT_MS).toBe(300_000);
    expect(resolvePreviewHealthProbeTimeoutMs("production-build", HEALTH_PROBE_TIMEOUT_MS)).toBe(
      300_000,
    );
  });

  it("keeps the dev path on the caller's existing window", () => {
    expect(resolvePreviewHealthProbeTimeoutMs("dev", HEALTH_PROBE_TIMEOUT_MS)).toBe(
      HEALTH_PROBE_TIMEOUT_MS,
    );
    expect(resolvePreviewHealthProbeTimeoutMs("dev", 42_000)).toBe(42_000);
  });
});

const unhealthyProbe = async () => ({
  healthy: false,
  authConfigError: false,
  rootRouteMissing: false,
  status: null,
});

function makeProbeSupport(opts: { groundTruthStdout?: string; logText?: string }): {
  support: SandboxPreviewSupport;
} {
  const provider = {
    name: "stub",
    fileTransfer: {
      listDir: vi.fn(async () => []),
      makeDir: vi.fn(async () => {}),
      writeFile: vi.fn(async () => {}),
      readFile: vi.fn(async () =>
        opts.logText ? new TextEncoder().encode(opts.logText) : new Uint8Array(),
      ),
      listTree: vi.fn(async () => []),
      removePath: vi.fn(async () => {}),
      renamePath: vi.fn(async () => {}),
    },
    execute: vi.fn(
      async (
        _sandboxId: string,
        input: { command: string; cwd?: string; env?: Record<string, string>; timeoutMs?: number },
      ) => {
        if (input.command.includes("LITT_PREVIEW_GROUND_TRUTH")) {
          return {
            exitCode: 0,
            stdout: opts.groundTruthStdout ?? "",
            stderr: "",
            durationMs: 1,
          };
        }
        // The detached build's poll: the build finished clean.
        if (input.command.includes('echo "DONE')) {
          return { exitCode: 0, stdout: "DONE 0", stderr: "", durationMs: 1 };
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
    ensureSandboxForPreview: vi.fn(async () => ({ sandboxId: "sbx-health" })),
    notePreviewPort: vi.fn(),
  };
  return {
    support: {
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    },
  };
}

function makeHealthRuntime(workspaceId: string): PreviewRuntime {
  return {
    workspaceId,
    userId: "user-1",
    projectId: "proj-1",
    process: null,
    port: 0,
    framework: "nextjs",
    command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
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

const HEALTH_WS = {
  workspaceId: "ws-health-fix",
  userId: "user-1",
  projectId: "proj-1",
  root: "/volume/ws-health-fix",
  branch: "main",
  commitSha: "",
  ready: true,
} as WorkspaceDescriptor;

describe("startSandboxPreview — health probe budgets and verdicts (health-fix)", () => {
  it("production-build: still starting after the dev window, fails at its own 300 s budget", async () => {
    vi.useFakeTimers();
    try {
      const { support } = makeProbeSupport({});
      const runtime = makeHealthRuntime("ws-health-prod");
      const startP = startSandboxPreview({
        support,
        runtime,
        ws: { ...HEALTH_WS, workspaceId: "ws-health-prod" },
        framework: "nextjs",
        command: "pnpm exec next start --port 3000 --hostname 0.0.0.0",
        packageManager: "pnpm",
        serveMode: "production-build",
        buildCommand: "pnpm exec next build",
        travelingEnv: {},
        probe: unhealthyProbe,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await startP;
      // Past the old dev window (120 s): a production start is
      // legitimately still converging — no verdict yet.
      await vi.advanceTimersByTimeAsync(121_000);
      expect(runtime.status).toBe("starting");
      // Past the production budget (300 s): the verdict lands, and
      // names the budget it actually used. The stub's ground-truth
      // check returns no marker, so the check is UNREADABLE — and
      // the record says so instead of convicting the guest.
      await vi.advanceTimersByTimeAsync(200_000);
      expect(runtime.status).toBe("failed");
      expect(runtime.errorCode).toBe("preview_port_never_ready");
      expect(runtime.error).toContain("did not become healthy within 300s");
      expect(runtime.error).toContain("in-sandbox check unreadable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a readable not-answering ground truth distinctly", async () => {
    vi.useFakeTimers();
    try {
      const { support } = makeProbeSupport({
        groundTruthStdout: "LITT_PREVIEW_GROUND_TRUTH=000\n",
      });
      const runtime = makeHealthRuntime("ws-health-gt");
      const startP = startSandboxPreview({
        support,
        runtime,
        ws: { ...HEALTH_WS, workspaceId: "ws-health-gt" },
        framework: "nextjs",
        command: "pnpm exec next dev --port 3000 --hostname 0.0.0.0",
        packageManager: "pnpm",
        travelingEnv: {},
        probe: unhealthyProbe,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await startP;
      await vi.advanceTimersByTimeAsync(130_000);
      expect(runtime.status).toBe("failed");
      expect(runtime.error).toContain("did not become healthy within 120s");
      expect(runtime.error).toContain("guest confirmed not answering locally");
      expect(runtime.error).not.toContain("check unreadable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ready-line evidence separates boot from first-response health", async () => {
    vi.useFakeTimers();
    try {
      const { support } = makeProbeSupport({
        logText: "▲ Next.js 14.2.3\n✓ Ready in 900ms\n",
      });
      const runtime = makeHealthRuntime("ws-health-ready");
      const startP = startSandboxPreview({
        support,
        runtime,
        ws: { ...HEALTH_WS, workspaceId: "ws-health-ready" },
        framework: "nextjs",
        command: "pnpm exec next dev --port 3000 --hostname 0.0.0.0",
        packageManager: "pnpm",
        travelingEnv: {},
        probe: unhealthyProbe,
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await startP;
      await vi.advanceTimersByTimeAsync(130_000);
      expect(runtime.status).toBe("failed");
      // The scan saw the server's own ready line during probing…
      expect(
        runtime.logs.some((l) => l.includes("Server reported ready in its output")),
      ).toBe(true);
      // …and the verdict records the boot, distinct from the
      // first response never becoming healthy.
      expect(runtime.error).toContain("so it booted");
    } finally {
      vi.useRealTimers();
    }
  });
});
