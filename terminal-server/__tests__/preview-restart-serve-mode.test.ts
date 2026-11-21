/**
 * Explicit restart of a production-build preview (live failure
 * 2026-11-20, main 56edf1b2).
 *
 * The big litlabs-website project's preview classified Large
 * Next.js → production build → `next start`. But an explicit
 * restart (the panel's failed-state Restart, or a user retry after
 * a long "Preparing") went through PreviewManager.restartPreview,
 * which passed the runtime's stored framework+command back
 * verbatim. The stored command IS the serve command (`next start`),
 * and a caller-supplied command suppresses serve-mode resolution
 * in the sandbox branch — so the restarted runtime came back
 * serveMode "dev", buildCommand null, and launched `next start`
 * with no build step at all. In any sandbox where the previous
 * build output was absent (`.next` is sandbox-local output, never
 * on the volume: a fresh sandbox, or a first build interrupted by
 * the restart) Next died instantly with "Could not find a
 * production build in the '.next' directory", and the health probe
 * convicted the guest at the dev-sized 120 s window ("Dev server
 * did not become healthy within 120s") — the production path's own
 * window is 300 s, which is how the live log proved the failing
 * start was running in dev mode.
 *
 * The fix: restartPreview omits framework/command for a
 * production-build runtime, so the restart re-runs detection +
 * serve-mode resolution and rebuilds before it re-serves, exactly
 * like a fresh start. These tests pin that: after an explicit
 * restart, the runtime is STILL production-build, still carries
 * its build command, and the build actually ran again.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import { SandboxExecGate } from "../sandbox/exec-router";
import { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import {
  startPreview,
  restartPreview,
  stopPreviewAndWait,
  getPreviewStatus,
  registerSandboxPreviewSupport,
} from "../preview/PreviewManager";
import { useTrustedLocalEnv } from "./helpers/trusted-local-env";

useTrustedLocalEnv();

const OWNER = "user_owner_preview_restart";

let volumeParent: string;
let provider: FakeSandboxProvider;
let executor: SandboxWorkspaceExecutor;
let workspaceId: string;

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

/** A Next.js tree above the 250-file production-build threshold. */
function largeNextCloneFiles(): Record<string, string> {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: "big-app",
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: { next: "16.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    }),
    "next.config.mjs": "export default {};\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  };
  for (let i = 0; i < 260; i += 1) {
    files[`src/f${i}.ts`] = `export const f${i} = ${i};\n`;
  }
  return files;
}

async function prepareSandboxWorkspace(): Promise<void> {
  const ws = await executor.prepareRepoWorkspace({
    userId: OWNER,
    projectId: "proj-preview-restart",
    installationId: 7,
    owner: "acme",
    repo: "big-site",
    branch: "main",
    workspaceRoot: volumeParent,
    githubToken: ["test", "scoped", "token", "0003"].join("-"),
  });
  workspaceId = ws.workspaceId;
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

async function waitForStatus(status: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getPreviewStatus(workspaceId)?.status === status) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    `preview never reached status ${status}; now ${getPreviewStatus(workspaceId)?.status}`,
  );
}

beforeEach(async () => {
  volumeParent = mkdtempSync(join(tmpdir(), "litt-preview-restart-"));
  provider = new FakeSandboxProvider({ cloneFiles: largeNextCloneFiles() });
  executor = new SandboxWorkspaceExecutor({
    provider,
    gate: openGate(provider),
    templateId: "fake-template",
    log: () => {},
  });
  registerSandboxPreviewSupport({ executor, provider });
  // The fake provider's command model has no build shapes (it
  // answers 127 "unsupported command"). Simulate a successful
  // DETACHED production build — the launch (build.sh) exits 0 and
  // the exit-file poll reports DONE 0, like the serve-mode suite's
  // stubs — and delegate everything else to the fake's own model.
  const realExecute = provider.execute.bind(provider);
  provider.execute = async (sandboxId, input) => {
    if (input.command.includes('echo "DONE')) {
      return { exitCode: 0, stdout: "DONE 0", stderr: "", durationMs: 1 };
    }
    if (input.command.includes("build.sh")) {
      return {
        exitCode: 0,
        stdout: "✓ Compiled successfully\n",
        stderr: "",
        durationMs: 1,
      };
    }
    return realExecute(sandboxId, input);
  };
  await prepareSandboxWorkspace();
});

afterEach(async () => {
  await stopPreviewAndWait(workspaceId).catch(() => {});
  registerSandboxPreviewSupport(null);
  vi.unstubAllGlobals();
  rmSync(volumeParent, { recursive: true, force: true });
});

describe("explicit restart of a production-build preview", () => {
  it("re-derives production-build mode on restart instead of serving next start with no build", async () => {
    stubFetchOk();

    // Fresh start with NO caller-supplied framework/command: the
    // panel's real path for this project. Detection + serve-mode
    // resolution classify it production-build.
    const first = await startPreview({ workspaceId, userId: OWNER });
    expect(first.serveMode).toBe("production-build");
    expect(first.buildCommand).toContain("next build");
    expect(first.command).toContain("next start");
    await waitForStatus("ready");

    // The explicit restart — the path that lost the mode live.
    const second = await restartPreview(workspaceId);
    expect(second).not.toBe(first);
    expect(second.serveMode).toBe("production-build");
    expect(second.buildCommand).toContain("next build");
    expect(second.command).toContain("next start");
    await waitForStatus("ready");

    // The build actually ran again on the restart: one
    // "Production build complete" line per production-build start.
    const logs = getPreviewStatus(workspaceId)!.logs;
    const buildCompletions = logs.filter((l) =>
      l.includes("Production build complete"),
    );
    expect(buildCompletions.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
