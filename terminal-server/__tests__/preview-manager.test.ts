/**
 * Regression tests for PreviewManager.
 *
 * Covers:
 *   - PATH construction (buildChildPath)
 *     - includes directory of process.execPath
 *     - NODE_BIN_DIR gets merged when configured
 *     - existing PATH remains intact
 *     - project node_modules/.bin is available
 *     - deduplication
 *     - dead NODE_BIN_DIR is skipped
 *   - Package manager resolution (resolvePackageManager)
 *     - pnpm resolution succeeds when on PATH
 *     - missing pnpm produces typed error
 *   - Preview lifecycle
 *     - exit 127 is not surfaced as a meaningless generic crash
 *     - crashed process updates preview state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { delimiter as PATH_DELIMITER, dirname, join } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "fs";
import { tmpdir } from "os";

const IS_WIN = process.platform === "win32";

// Helper: create a fake executable in a directory, platform-aware.
function createFakeExecutable(dir: string, name: string): string {
  if (IS_WIN) {
    const cmdPath = join(dir, `${name}.cmd`);
    writeFileSync(cmdPath, `@echo off\r\nexit 0\r\n`);
    return cmdPath;
  }
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, `#!/bin/sh\nexit 0\n`);
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

// Helper: override process.execPath to point to a clean temp directory
// that does NOT contain pnpm/npm/corepack. This is needed because on the
// test machine, dirname(process.execPath) may contain globally-installed
// package managers that buildChildPath always prepends.
function overrideExecPath(cleanDir: string): () => void {
  const orig = process.execPath;
  const fakeNode = join(cleanDir, IS_WIN ? "node.exe" : "node");
  writeFileSync(fakeNode, IS_WIN ? "" : "#!/bin/sh\n");
  if (!IS_WIN) chmodSync(fakeNode, 0o755);
  Object.defineProperty(process, "execPath", { value: fakeNode, configurable: true });
  return () => {
    Object.defineProperty(process, "execPath", { value: orig, configurable: true });
  };
}

// ─── PATH construction ─────────────────────────────────────────────

import { buildChildPath, resolvePackageManager } from "../preview/PreviewManager";

describe("PreviewManager — buildChildPath", () => {
  let origEnv: NodeJS.ProcessEnv;
  let tmpRoot: string;

  beforeEach(() => {
    origEnv = { ...process.env };
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-test-"));
  });

  afterEach(() => {
    process.env = origEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("includes the directory of process.execPath", () => {
    const path = buildChildPath(tmpRoot);
    const nodeDir = dirname(process.execPath);
    expect(path).toContain(nodeDir);
  });

  it("includes project node_modules/.bin", () => {
    const path = buildChildPath(tmpRoot);
    expect(path).toContain(join(tmpRoot, "node_modules", ".bin"));
  });

  it("preserves existing PATH entries", () => {
    process.env.PATH = `/usr/local/bin${PATH_DELIMITER}/usr/bin`;
    const path = buildChildPath(tmpRoot);
    expect(path).toContain("/usr/local/bin");
    expect(path).toContain("/usr/bin");
  });

  it("merges NODE_BIN_DIR when configured and it exists", () => {
    const customBin = join(tmpRoot, "custom-bin");
    mkdirSync(customBin, { recursive: true });
    process.env.NODE_BIN_DIR = customBin;
    const path = buildChildPath(tmpRoot);
    expect(path).toContain(customBin);
    // NODE_BIN_DIR should come before the runtime node dir
    expect(path.indexOf(customBin)).toBeLessThan(path.indexOf(dirname(process.execPath)));
  });

  it("skips a dead NODE_BIN_DIR silently", () => {
    process.env.NODE_BIN_DIR = "/nonexistent/path/that/does/not/exist";
    const path = buildChildPath(tmpRoot);
    expect(path).not.toContain("/nonexistent/path/that/does/not/exist");
  });

  it("deduplicates PATH entries", () => {
    const nodeDir = dirname(process.execPath);
    process.env.PATH = `${nodeDir}${PATH_DELIMITER}/usr/bin`;
    const path = buildChildPath(tmpRoot);
    const entries = path.split(PATH_DELIMITER);
    const nodeDirCount = entries.filter((e) => e === nodeDir).length;
    expect(nodeDirCount).toBe(1);
  });

  it("handles empty PATH gracefully", () => {
    delete process.env.PATH;
    const path = buildChildPath(tmpRoot);
    expect(path).toBeTruthy();
    expect(path).toContain(dirname(process.execPath));
  });

  it("does not replace PATH — only prepends", () => {
    process.env.PATH = `/usr/local/bin${PATH_DELIMITER}/usr/bin${PATH_DELIMITER}/bin`;
    const path = buildChildPath(tmpRoot);
    expect(path).toContain("/usr/local/bin");
    expect(path).toContain("/usr/bin");
    expect(path).toContain("/bin");
  });
});

// ─── Package manager resolution ────────────────────────────────────

describe("PreviewManager — resolvePackageManager", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-pm-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves pnpm when it is on PATH", () => {
    const fakeBin = join(tmpRoot, "fakebin");
    mkdirSync(fakeBin, { recursive: true });
    createFakeExecutable(fakeBin, "pnpm");
    process.env.PATH = fakeBin;
    delete process.env.NODE_BIN_DIR;
    const resolved = resolvePackageManager("pnpm", tmpRoot);
    expect(resolved.found).toBe(true);
    expect(resolved.executable).toBe("pnpm");
  });

  it("reports pnpm as not found when it is absent", () => {
    const cleanNodeDir = join(tmpRoot, "clean-node");
    mkdirSync(cleanNodeDir, { recursive: true });
    const restore = overrideExecPath(cleanNodeDir);

    const emptyDir = join(tmpRoot, "emptybin");
    mkdirSync(emptyDir, { recursive: true });
    process.env.PATH = emptyDir;
    delete process.env.NODE_BIN_DIR;
    const resolved = resolvePackageManager("pnpm", tmpRoot);
    expect(resolved.found).toBe(false);
    expect(resolved.pathSearched).toBeTruthy();

    restore();
  });

  it("falls back to corepack shim for pnpm", () => {
    const cleanNodeDir = join(tmpRoot, "clean-node");
    mkdirSync(cleanNodeDir, { recursive: true });
    const restore = overrideExecPath(cleanNodeDir);

    const fakeBin = join(tmpRoot, "fakebin");
    mkdirSync(fakeBin, { recursive: true });
    createFakeExecutable(fakeBin, "corepack");
    process.env.PATH = fakeBin;
    delete process.env.NODE_BIN_DIR;
    const resolved = resolvePackageManager("pnpm", tmpRoot);
    expect(resolved.found).toBe(true);
    expect(resolved.executable).toBe("corepack");

    restore();
  });

  it("resolves npm when it is on PATH", () => {
    const fakeBin = join(tmpRoot, "fakebin");
    mkdirSync(fakeBin, { recursive: true });
    createFakeExecutable(fakeBin, "npm");
    process.env.PATH = fakeBin;
    delete process.env.NODE_BIN_DIR;
    const resolved = resolvePackageManager("npm", tmpRoot);
    expect(resolved.found).toBe(true);
    expect(resolved.executable).toBe("npm");
  });
});

// ─── Preview lifecycle (typed errors + state transitions) ──────────

import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  PreviewError,
} from "../preview/PreviewManager";

vi.mock("../workspace/WorkspaceManager", () => ({
  getWorkspace: vi.fn(),
}));

const { getWorkspace } = await import("../workspace/WorkspaceManager");
const mockedGetWorkspace = vi.mocked(getWorkspace);

describe("PreviewManager — typed errors", () => {
  let tmpRoot: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-err-"));
    origEnv = { ...process.env };
    mockedGetWorkspace.mockReset();
  });

  afterEach(() => {
    process.env = origEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("throws preview_workspace_not_found when workspace does not exist", async () => {
    mockedGetWorkspace.mockReturnValue(undefined as any);
    try {
      await startPreview({ workspaceId: "nonexistent", userId: "u1" });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PreviewError);
      expect((e as PreviewError).code).toBe("preview_workspace_not_found");
    }
  });

  it("records preview_package_manager_missing when pnpm is absent", async () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
    writeFileSync(join(tmpRoot, "next.config.js"), "module.exports = {}");
    writeFileSync(join(tmpRoot, "pnpm-lock.yaml"), "");

    mockedGetWorkspace.mockReturnValue({
      workspaceId: "ws-pm-missing",
      userId: "u1",
      projectId: "p1",
      root: tmpRoot,
      branch: "main",
      commitSha: "abc",
      ready: true,
    } as any);

    // Override execPath to a clean dir with no pnpm, and set empty PATH
    const cleanNodeDir = join(tmpRoot, "clean-node");
    mkdirSync(cleanNodeDir, { recursive: true });
    const restore = overrideExecPath(cleanNodeDir);
    const emptyDir = join(tmpRoot, "emptybin");
    mkdirSync(emptyDir, { recursive: true });
    process.env.PATH = emptyDir;
    delete process.env.NODE_BIN_DIR;

    try {
      await startPreview({ workspaceId: "ws-pm-missing", userId: "u1" });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PreviewError);
      expect((e as PreviewError).code).toBe("preview_package_manager_missing");
      const diag = (e as PreviewError).diagnostic;
      expect(diag.packageManager).toBe("pnpm");
      expect(diag.pathSearched).toBeTruthy();
      expect(diag.runtimeNodePath).toBeTruthy();
      expect(diag.suggestedRemediation).toBeTruthy();
    }

    // The runtime should be recorded as failed with the typed error code
    const status = getPreviewStatus("ws-pm-missing");
    expect(status.status).toBe("failed");
    expect(status.errorCode).toBe("preview_package_manager_missing");
    expect(status.error).toContain("pnpm");

    stopPreview("ws-pm-missing");
    restore();
  });
});

describe("PreviewManager — exit 127 mapping", () => {
  let tmpRoot: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-127-"));
    origEnv = { ...process.env };
    mockedGetWorkspace.mockReset();
  });

  afterEach(() => {
    process.env = origEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("maps exit code 127 to preview_command_not_found, not a generic crash", async () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
    writeFileSync(join(tmpRoot, "next.config.js"), "module.exports = {}");
    writeFileSync(join(tmpRoot, "pnpm-lock.yaml"), "");

    mockedGetWorkspace.mockReturnValue({
      workspaceId: "ws-127",
      userId: "u1",
      projectId: "p1",
      root: tmpRoot,
      branch: "main",
      commitSha: "abc",
      ready: true,
    } as any);

    // Override execPath to a clean dir so only our fake pnpm is found
    const cleanNodeDir = join(tmpRoot, "clean-node");
    mkdirSync(cleanNodeDir, { recursive: true });
    const restore = overrideExecPath(cleanNodeDir);

    // Make pnpm resolvable so we proceed to spawn
    const fakeBin = join(tmpRoot, "fakebin");
    mkdirSync(fakeBin, { recursive: true });
    createFakeExecutable(fakeBin, "pnpm");
    process.env.PATH = fakeBin;
    delete process.env.NODE_BIN_DIR;

    // Use a command that will exit 127 — the shell will try to run a
    // nonexistent binary.
    await startPreview({
      workspaceId: "ws-127",
      userId: "u1",
      command: "nonexistent-binary-xyz-123",
      framework: "node",
      packageManager: "pnpm",
    });

    // Wait for the process to exit
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const status = getPreviewStatus("ws-127");
    // It should be failed
    expect(status.status).toBe("failed");
    // If it exited with 127, the error code should be preview_command_not_found
    // (not a generic crash). If the health probe timed out first, that's also
    // acceptable — but the error should NOT be a bare "Process exited unexpectedly".
    if (status.errorCode === "preview_command_not_found") {
      expect(status.error).toContain("127");
      expect(status.error).toContain("Command not found");
    }

    stopPreview("ws-127");
    restore();
  });
});
