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
  resolvePreviewServeMode,
  PREVIEW_PROD_BUILD_FILE_THRESHOLD,
  SANDBOX_PREVIEW_BUILD_TIMEOUT_MS,
} from "../preview/serve-mode";
import { startSandboxPreview, type SandboxPreviewSupport } from "../preview/sandbox-runtime";
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
  it("builds with the project's package manager, bypassing its dev script like the dev command does", () => {
    expect(nextProductionBuildCommand("pnpm")).toBe("pnpm exec next build");
    expect(nextProductionBuildCommand("npm")).toBe("npm exec next build");
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

function makeSupport(buildExitCode: number): {
  support: SandboxPreviewSupport;
  executions: CapturedExecute[];
  writtenFiles: Map<string, string>;
} {
  const executions: CapturedExecute[] = [];
  const writtenFiles = new Map<string, string>();
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
          timeoutMs?: number;
        },
      ) => {
        executions.push(input);
        if (input.command.includes("next build")) {
          return {
            exitCode: buildExitCode,
            stdout: buildExitCode === 0 ? "✓ Compiled successfully\n✓ Generating static pages" : "",
            stderr:
              buildExitCode === 0
                ? ""
                : "Module not found: Can't resolve './missing-widget'",
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
    const buildIdx = executions.findIndex((e) => e.command.includes("next build"));
    const launchIdx = executions.findIndex((e) => e.command.includes("setsid nohup"));
    expect(installIdx, "an install execute call").toBeGreaterThanOrEqual(0);
    expect(buildIdx, "a build execute call").toBeGreaterThan(installIdx);
    expect(launchIdx, "a launch execute call").toBeGreaterThan(buildIdx);

    const build = executions[buildIdx];
    expect(build.timeoutMs).toBe(SANDBOX_PREVIEW_BUILD_TIMEOUT_MS);
    expect(build.env?.NODE_ENV).toBe("production");
    // The build is heap-shaped with the launch bound, not the
    // install's 768 MB resolve/link bound.
    expect(build.env?.NODE_OPTIONS).toBe(`--max-old-space-size=${SANDBOX_PREVIEW_NODE_HEAP_MB}`);

    // The run script serves the production start command, and the
    // launch env runs it as production.
    const script = [...writtenFiles.values()].find((v) => v.includes("exec "));
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
    // build gets served.
    expect(executions.some((e) => e.command.includes("setsid nohup"))).toBe(false);
    expect(runtime.status).not.toBe("ready");
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
