/**
 * Production-build ORDER for monorepos (live failure 2026-11-22,
 * round-6 proof on the 8 GB sandbox).
 *
 * The flagship litlabs-website project's sandbox preview build
 * died at ~18 minutes with:
 *
 *   Module not found: Can't resolve '@litt/agent-core'
 *
 * Root cause (PREVIEW-BUILD-PACKAGES-DIAGNOSIS-2026-11-22.md): the
 * sandbox's production-build command was a bare
 * `pnpm exec next build`. In this pnpm monorepo the app imports
 * workspace packages (@litt/agent-core, @litt/models) whose
 * package.json `exports` resolve only through a compiled `dist/` —
 * gitignored, absent from a fresh clone, and never produced by
 * `pnpm install` (install links workspace packages; it does not
 * build them). Production builds them FIRST (root Dockerfile:
 * `pnpm --filter @litt/agent-core --filter @litt/models build`,
 * then the site build; the root `build` script encodes the same
 * order as `pnpm build:workspace-deps && next build`).
 *
 * The fix: the production-build serve mode runs the project's own
 * declared build chain (`<pm> run build`) when package.json
 * declares one, and keeps the bare command when it does not.
 * These tests pin the three shapes end to end through
 * PreviewManager detection + serve-mode resolution:
 *
 *   - monorepo-shaped (declared build chain) → `pnpm run build`
 *   - large Next.js, NO build script         → `pnpm exec next build` (unchanged)
 *   - small Next.js WITH a build script      → dev mode, no build at all (unchanged)
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import { SandboxExecGate } from "../sandbox/exec-router";
import { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import {
  startPreview,
  stopPreviewAndWait,
  getPreviewStatus,
  registerSandboxPreviewSupport,
} from "../preview/PreviewManager";
import { useTrustedLocalEnv } from "./helpers/trusted-local-env";

useTrustedLocalEnv();

const OWNER = "user_owner_preview_build_order";

interface RunningFixture {
  workspaceId: string;
  volumeParent: string;
}

const running: RunningFixture[] = [];

function openGate(p: FakeSandboxProvider): SandboxExecGate {
  return new SandboxExecGate({
    providerEnabled: true,
    routingEnabled: true,
    isOwner: (userId) => userId === OWNER,
    isVerified: () => true,
    templateId: "fake-template",
    provider: p,
  });
}

function stubFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("<html>app</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ),
  );
}

async function waitForStatus(workspaceId: string, status: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getPreviewStatus(workspaceId)?.status === status) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `preview never reached status ${status}; now ${getPreviewStatus(workspaceId)?.status}`,
  );
}

/**
 * Prepare a sandbox workspace cloned from `files` and register the
 * preview support against it, with the fake provider's detached
 * production build simulated as succeeding (the serve-mode suite's
 * stub shape: build.sh launch exits 0, the exit-file poll reports
 * DONE 0).
 */
async function startWith(files: Record<string, string>): Promise<RunningFixture> {
  const volumeParent = mkdtempSync(join(tmpdir(), "litt-preview-build-order-"));
  const provider = new FakeSandboxProvider({ cloneFiles: files });
  const executor = new SandboxWorkspaceExecutor({
    provider,
    gate: openGate(provider),
    templateId: "fake-template",
    log: () => {},
  });
  registerSandboxPreviewSupport({ executor, provider });
  const realExecute = provider.execute.bind(provider);
  provider.execute = async (sandboxId, input) => {
    if (input.command.includes('echo "DONE')) {
      return { exitCode: 0, stdout: "DONE 0", stderr: "", durationMs: 1 };
    }
    if (input.command.includes("build.sh")) {
      return { exitCode: 0, stdout: "✓ Compiled successfully\n", stderr: "", durationMs: 1 };
    }
    return realExecute(sandboxId, input);
  };
  const ws = await executor.prepareRepoWorkspace({
    userId: OWNER,
    projectId: "proj-preview-build-order",
    installationId: 7,
    owner: "acme",
    repo: "big-site",
    branch: "main",
    workspaceRoot: volumeParent,
    githubToken: ["test", "scoped", "token", "0004"].join("-"),
  });
  const fixture = { workspaceId: ws.workspaceId, volumeParent };
  running.push(fixture);
  return fixture;
}

afterEach(async () => {
  for (const fixture of running.splice(0)) {
    await stopPreviewAndWait(fixture.workspaceId).catch(() => {});
    rmSync(fixture.volumeParent, { recursive: true, force: true });
  }
  registerSandboxPreviewSupport(null);
  vi.unstubAllGlobals();
});

/** Pad a tree past the 250-file production-build threshold. */
function padPastThreshold(files: Record<string, string>): Record<string, string> {
  for (let i = 0; i < 260; i += 1) {
    files[`src/f${i}.ts`] = `export const f${i} = ${i};\n`;
  }
  return files;
}

/**
 * A monorepo-shaped tree in the flagship's shape: a root build
 * script that builds the workspace packages before the site, a
 * pnpm workspace file, and the workspace packages themselves —
 * whose dist-only exports are the whole point.
 */
function monorepoFiles(): Record<string, string> {
  return padPastThreshold({
    "package.json": JSON.stringify({
      name: "big-monorepo",
      packageManager: "pnpm@10.33.4",
      scripts: {
        dev: "next dev",
        build: "pnpm build:workspace-deps && next build",
        "build:workspace-deps": "pnpm --filter @litt/agent-core --filter @litt/models build",
        start: "next start",
      },
      dependencies: {
        next: "16.0.0",
        react: "19.0.0",
        "react-dom": "19.0.0",
        "@litt/agent-core": "workspace:*",
      },
    }),
    "next.config.mjs": "export default {};\n",
    "pnpm-workspace.yaml": 'packages:\n  - "."\n  - "packages/*"\n',
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "packages/litt-agent-core/package.json": JSON.stringify({
      name: "@litt/agent-core",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", require: "./dist/index.js", import: "./dist/index.js" } },
      scripts: { build: "tsc -p tsconfig.json" },
    }),
    "packages/litt-models/package.json": JSON.stringify({
      name: "@litt/models",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", require: "./dist/index.js", import: "./dist/index.js" } },
      scripts: { build: "tsc -p tsconfig.json" },
    }),
  });
}

/** A large Next.js tree that declares NO build script. */
function largeNextNoBuildScriptFiles(): Record<string, string> {
  return padPastThreshold({
    "package.json": JSON.stringify({
      name: "big-plain-app",
      scripts: { dev: "next dev", start: "next start" },
      dependencies: { next: "16.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    }),
    "next.config.mjs": "export default {};\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  });
}

/** A small Next.js tree — below the threshold — WITH a build script. */
function smallNextFiles(): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: "small-app",
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: { next: "16.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    }),
    "next.config.mjs": "export default {};\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "app/page.tsx": "export default function Page() { return null; }\n",
    "app/layout.tsx": "export default function Layout() { return null; }\n",
  };
}

describe("production-build order — the project's build chain runs, not a bare next build", () => {
  it("monorepo-shaped project: build command is the project's own chain (packages before site)", async () => {
    stubFetchOk();
    const { workspaceId } = await startWith(monorepoFiles());

    const runtime = await startPreview({ workspaceId, userId: OWNER });
    expect(runtime.serveMode).toBe("production-build");
    // `pnpm run build` IS the chain: build:workspace-deps compiles
    // @litt/agent-core + @litt/models, then next build runs — the
    // order production's Dockerfile performs explicitly.
    expect(runtime.buildCommand).toBe("pnpm run build");
    expect(runtime.command).toContain("next start");
    await waitForStatus(workspaceId, "ready");

    const logs = getPreviewStatus(workspaceId)!.logs;
    expect(logs.some((l) => l.includes("Production build complete"))).toBe(true);
  }, 60_000);

  it("large Next.js project with NO build script: bare command, exactly as before", async () => {
    stubFetchOk();
    const { workspaceId } = await startWith(largeNextNoBuildScriptFiles());

    const runtime = await startPreview({ workspaceId, userId: OWNER });
    expect(runtime.serveMode).toBe("production-build");
    expect(runtime.buildCommand).toBe("pnpm exec next build");
    await waitForStatus(workspaceId, "ready");
  }, 60_000);

  it("small Next.js project WITH a build script: stays on dev, no build runs at all", async () => {
    stubFetchOk();
    const { workspaceId } = await startWith(smallNextFiles());

    const runtime = await startPreview({ workspaceId, userId: OWNER });
    expect(runtime.serveMode ?? "dev").toBe("dev");
    expect(runtime.buildCommand ?? null).toBeNull();
    expect(runtime.command).toContain("next dev");
  }, 60_000);
});
