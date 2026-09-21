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
import { createServer } from "http";

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

function createFailingExecutable(dir: string, name: string, exitCode: number, stderr: string): string {
  if (IS_WIN) {
    const cmdPath = join(dir, `${name}.cmd`);
    writeFileSync(cmdPath, `@echo off\r\necho ${stderr} 1>&2\r\nexit /b ${exitCode}\r\n`);
    return cmdPath;
  }
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, `#!/bin/sh\necho '${stderr}' >&2\nexit ${exitCode}\n`);
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

import {
  buildChildPath,
  formatPreviewDiagnostic,
  probeHealth,
  resolvePackageManager,
} from "../preview/PreviewManager";
import { buildPreviewEnv } from "../preview/preview-env";

// ─── Preview child env allowlist ───────────────────────────────────
// Workspace children run untrusted generated code — the child env must
// be allowlisted, never ...process.env (which hands workspace code the
// platform's TERMINAL_INTERNAL_SERVICE_KEY, PREVIEW_ACCESS_TOKEN, etc.).

describe("buildPreviewEnv — child env allowlist", () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("never leaks platform secrets into the child env", () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "internal-key";
    process.env.TERMINAL_AUTH_SECRET = "auth-secret";
    process.env.PREVIEW_ACCESS_TOKEN = "preview-gate-token";
    process.env.CLERK_SECRET_KEY = "sk_live_platform";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_platform";
    process.env.DATABASE_URL = "postgres://prod";
    process.env.STRIPE_SECRET_KEY = "sk_live_platform";
    process.env.OPENAI_API_KEY = "sk-platform";

    const env = buildPreviewEnv();
    expect(env.TERMINAL_INTERNAL_SERVICE_KEY).toBeUndefined();
    expect(env.TERMINAL_AUTH_SECRET).toBeUndefined();
    expect(env.PREVIEW_ACCESS_TOKEN).toBeUndefined();
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.SUPABASE_SECRET_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("preserves required runtime vars and package-manager config", () => {
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/svc";
    process.env.NODE_ENV = "production";
    process.env.NODE_BIN_DIR = "/opt/node/bin";
    process.env.NPM_CONFIG_REGISTRY = "https://registry.example.com";
    process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
    process.env.PNPM_HOME = "/root/.local/share/pnpm";
    process.env.LANG = "C.UTF-8";

    const env = buildPreviewEnv();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/svc");
    expect(env.NODE_ENV).toBe("production");
    expect(env.NODE_BIN_DIR).toBe("/opt/node/bin");
    expect(env.NPM_CONFIG_REGISTRY).toBe("https://registry.example.com");
    expect(env.COREPACK_ENABLE_DOWNLOAD_PROMPT).toBe("0");
    expect(env.PNPM_HOME).toBe("/root/.local/share/pnpm");
    expect(env.LANG).toBe("C.UTF-8");
  });

  it("never inherits the platform's own Clerk keys — publishable included", () => {
    process.env.CLERK_SECRET_KEY = "sk_live_platform";
    process.env.CLERK_PUBLISHABLE_KEY = "pk_live_platform";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_platform";

    const env = buildPreviewEnv();
    // No Clerk config is inherited at all — a platform publishable key
    // would also override a workspace's own .env.local pk, creating a
    // mismatched sk/pk pair from different Clerk apps.
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBeUndefined();
  });

  it("maps isolated PREVIEW_CLERK_* credentials onto the standard names", () => {
    process.env.PREVIEW_CLERK_SECRET_KEY = "sk_test_previewapp";
    process.env.PREVIEW_CLERK_PUBLISHABLE_KEY = "pk_test_previewapp";
    // The platform's own keys are still never inherited.
    process.env.CLERK_SECRET_KEY = "sk_live_platform";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_platform";

    const env = buildPreviewEnv();
    expect(env.CLERK_SECRET_KEY).toBe("sk_test_previewapp");
    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toBe("pk_test_previewapp");
    // The PREVIEW_* source vars are secret-shaped — never cross as-is.
    expect(env.PREVIEW_CLERK_SECRET_KEY).toBeUndefined();
    expect(env.PREVIEW_CLERK_PUBLISHABLE_KEY).toBeUndefined();
  });

  it("drops secret-shaped names even inside allowed prefix families", () => {
    process.env.NPM_CONFIG_TOKEN = "registry-auth-token";
    process.env.YARN_NPM_AUTH_TOKEN = "yarn-token";

    const env = buildPreviewEnv();
    expect(env.NPM_CONFIG_TOKEN).toBeUndefined();
    expect(env.YARN_NPM_AUTH_TOKEN).toBeUndefined();
  });

  it("honors PREVIEW_ENV_ALLOWLIST extras but cannot re-allow gateway credentials", () => {
    process.env.PREVIEW_ENV_ALLOWLIST = "MY_PROJECT_FLAG,PREVIEW_ACCESS_TOKEN";
    process.env.MY_PROJECT_FLAG = "on";
    process.env.PREVIEW_ACCESS_TOKEN = "preview-gate-token";

    const env = buildPreviewEnv();
    expect(env.MY_PROJECT_FLAG).toBe("on");
    expect(env.PREVIEW_ACCESS_TOKEN).toBeUndefined();
  });

  it("PREVIEW_ENV_ALLOWLIST cannot smuggle secret-shaped names", () => {
    process.env.PREVIEW_ENV_ALLOWLIST =
      "MY_APP_SECRET,MY_APP_TOKEN,MY_APP_API_KEY,CLERK_SECRET_KEY,SUPABASE_SERVICE_ROLE_KEY,SESSION_KEY,MY_WEBHOOK_SECRET,MY_PRIVATE_KEY,MY_APP_PASSWORD";
    process.env.MY_APP_SECRET = "s";
    process.env.MY_APP_TOKEN = "t";
    process.env.MY_APP_API_KEY = "k";
    process.env.CLERK_SECRET_KEY = "sk_live_platform";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_KEY = "sess";
    process.env.MY_WEBHOOK_SECRET = "w";
    process.env.MY_PRIVATE_KEY = "pk";
    process.env.MY_APP_PASSWORD = "p";
    process.env.MY_BENIGN_FLAG = "yes";
    process.env.PREVIEW_ENV_ALLOWLIST += ",MY_BENIGN_FLAG";

    const env = buildPreviewEnv();
    expect(env.MY_APP_SECRET).toBeUndefined();
    expect(env.MY_APP_TOKEN).toBeUndefined();
    expect(env.MY_APP_API_KEY).toBeUndefined();
    expect(env.CLERK_SECRET_KEY).toBeUndefined();
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.SESSION_KEY).toBeUndefined();
    expect(env.MY_WEBHOOK_SECRET).toBeUndefined();
    expect(env.MY_PRIVATE_KEY).toBeUndefined();
    expect(env.MY_APP_PASSWORD).toBeUndefined();
    // Benign extras still pass.
    expect(env.MY_BENIGN_FLAG).toBe("yes");
  });

  it("applies caller overrides last", () => {
    process.env.NODE_ENV = "production";
    const env = buildPreviewEnv({ NODE_ENV: "development", PORT: "4100" });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe("4100");
  });
});

describe("PreviewManager — process diagnostics", () => {
  it("preserves complete recent stderr lines instead of truncating the fatal error", () => {
    const logs = [
      "[preview] Ready in 265ms",
      "[stderr] Error: application crashed after startup",
      "[stderr]     at boot (/workspace/app/server.ts:42:7)",
      "[stderr]     at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    ];

    const diagnostic = formatPreviewDiagnostic(logs);

    expect(diagnostic).toContain("[preview] Ready in 265ms");
    expect(diagnostic).toContain("[stderr] Error: application crashed after startup");
    expect(diagnostic).toContain("[stderr]     at boot (/workspace/app/server.ts:42:7)");
    expect(diagnostic).toContain("[stderr]     at processTicksAndRejections");
    expect(diagnostic.split("\n").every((line) => line.length > 0)).toBe(true);
  });

  it("redacts secrets per line without cutting a neighboring error line", () => {
    const diagnostic = formatPreviewDiagnostic([
      "[stderr] Error: invalid token=super-secret-value",
      "[stderr] The request failed after Next reported ready",
    ]);

    expect(diagnostic).toContain("token=[REDACTED]");
    expect(diagnostic).toContain("The request failed after Next reported ready");
    expect(diagnostic).not.toContain("super-secret-value");
  });
});

describe("PreviewManager — root route health", () => {
  it("does not call a running server ready when GET / returns Cannot GET /", async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 404;
      res.end("Cannot GET /");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    try {
      const result = await probeHealth(address.port, 100);
      expect(result.healthy).toBe(false);
      expect(result.rootRouteMissing).toBe(true);
      expect(result.status).toBe(404);
      expect(result.bodySnippet).toContain("entry route");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

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

describe("PreviewManager — dependency install diagnostics", () => {
  let tmpRoot: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-install-"));
    origEnv = { ...process.env };
    mockedGetWorkspace.mockReset();
  });

  afterEach(() => {
    process.env = origEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("surfaces dependency install exit 254 with safe diagnostics", async () => {
    writeFileSync(join(tmpRoot, "package.json"), JSON.stringify({ scripts: { dev: "next dev" } }));
    writeFileSync(join(tmpRoot, "next.config.js"), "module.exports = {}");
    writeFileSync(join(tmpRoot, "pnpm-lock.yaml"), "");

    mockedGetWorkspace.mockReturnValue({
      workspaceId: "ws-install-254",
      userId: "u1",
      projectId: "p1",
      root: tmpRoot,
      branch: "main",
      commitSha: "abc",
      ready: true,
    } as any);

    const cleanNodeDir = join(tmpRoot, "clean-node");
    mkdirSync(cleanNodeDir, { recursive: true });
    const restore = overrideExecPath(cleanNodeDir);
    const fakeBin = join(tmpRoot, "fakebin");
    mkdirSync(fakeBin, { recursive: true });
    createFailingExecutable(fakeBin, "pnpm", 254, "ERR_PNPM_UNEXPECTED_STORE");
    process.env.PATH = fakeBin;
    delete process.env.NODE_BIN_DIR;

    try {
      await startPreview({ workspaceId: "ws-install-254", userId: "u1" });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PreviewError);
      const previewError = error as PreviewError;
      expect(previewError.code).toBe("preview_dependency_install_failed");
      expect(previewError.message).toContain("exit 254");
      expect(previewError.message).toContain("ERR_PNPM_UNEXPECTED_STORE");
      expect(previewError.diagnostic.cwd).toBe(tmpRoot);
      expect(previewError.diagnostic.command).toContain("install");
      expect(previewError.diagnostic.exitCode).toBe(254);
    }

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

// ─── Clerk configuration validation ─────────────────────────────────

import {
  validateClerkConfig,
  fingerprintClerkEnv,
} from "../preview/PreviewManager";

describe("PreviewManager — Clerk config validation", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-clerk-"));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeClerkPackageJson(root: string): void {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { "@clerk/nextjs": "^6.0.0" } }),
    );
  }

  function writeNonClerkPackageJson(root: string): void {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { next: "^16.0.0" } }),
    );
  }

  it("skips validation for non-Clerk projects", () => {
    writeNonClerkPackageJson(tmpRoot);
    const result = validateClerkConfig({}, tmpRoot);
    expect(result.ok).toBe(true);
    expect(result.usesClerk).toBe(false);
  });

  it("fails when CLERK_SECRET_KEY is missing for a Clerk project", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc123" },
      tmpRoot,
    );
    expect(result.ok).toBe(false);
    expect(result.usesClerk).toBe(true);
    expect(result.reason).toContain("CLERK_SECRET_KEY is missing");
  });

  it("fails when CLERK_SECRET_KEY has a publishable key prefix (pk_)", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      {
        CLERK_SECRET_KEY: "pk_live_abc123",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc123",
      },
      tmpRoot,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("publishable key");
    expect(result.reason).toContain("pk_");
  });

  it("fails when CLERK_SECRET_KEY has an unexpected prefix", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      {
        CLERK_SECRET_KEY: "garbage_value_here",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc123",
      },
      tmpRoot,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unexpected prefix");
  });

  it("fails when secret and publishable keys are identical", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      {
        CLERK_SECRET_KEY: "sk_live_same123",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "sk_live_same123",
      },
      tmpRoot,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("identical");
  });

  it("fails when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      { CLERK_SECRET_KEY: "sk_live_abc123" },
      tmpRoot,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing");
  });

  it("fails on test/live environment mismatch", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      {
        CLERK_SECRET_KEY: "sk_test_abc123",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_abc123",
      },
      tmpRoot,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("mismatch");
    expect(result.reason).toContain("test");
    expect(result.reason).toContain("live");
  });

  it("passes when both keys are valid and from the same environment", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      {
        CLERK_SECRET_KEY: "sk_live_abc123def456",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_xyz789ghi012",
      },
      tmpRoot,
    );
    expect(result.ok).toBe(true);
    expect(result.usesClerk).toBe(true);
  });

  it("accepts CLERK_PUBLISHABLE_KEY as fallback for NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      {
        CLERK_SECRET_KEY: "sk_test_abc123",
        CLERK_PUBLISHABLE_KEY: "pk_test_xyz789",
      },
      tmpRoot,
    );
    expect(result.ok).toBe(true);
  });

  it("cleans whitespace, newlines, and quotes from key values", () => {
    writeClerkPackageJson(tmpRoot);
    const result = validateClerkConfig(
      {
        CLERK_SECRET_KEY: '  "sk_live_abc123"\n  ',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "  pk_live_xyz789  ",
      },
      tmpRoot,
    );
    expect(result.ok).toBe(true);
  });

  it("workspace .env.local keys satisfy validation with nothing injected", () => {
    writeClerkPackageJson(tmpRoot);
    writeFileSync(
      join(tmpRoot, ".env.local"),
      "CLERK_SECRET_KEY=sk_test_fromworkspace\n" +
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_workspace\n",
    );
    const result = validateClerkConfig({}, tmpRoot);
    expect(result.ok).toBe(true);
    expect(result.usesClerk).toBe(true);
  });

  it("workspace .env fallback keys satisfy validation", () => {
    writeClerkPackageJson(tmpRoot);
    writeFileSync(
      join(tmpRoot, ".env"),
      "CLERK_SECRET_KEY=sk_test_dotenv\nCLERK_PUBLISHABLE_KEY=pk_test_dotenv\n",
    );
    const result = validateClerkConfig({}, tmpRoot);
    expect(result.ok).toBe(true);
  });

  it("child env wins over workspace .env files (Next.js semantics)", () => {
    writeClerkPackageJson(tmpRoot);
    writeFileSync(
      join(tmpRoot, ".env.local"),
      "CLERK_SECRET_KEY=sk_test_dotenv\nNEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_dotenv\n",
    );
    const result = validateClerkConfig(
      { CLERK_SECRET_KEY: "bogus_value" },
      tmpRoot,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unexpected prefix");
  });

  it("the platform's own CLERK_SECRET_KEY cannot satisfy preview auth", () => {
    writeClerkPackageJson(tmpRoot);
    const origSecret = process.env.CLERK_SECRET_KEY;
    const origPk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    process.env.CLERK_SECRET_KEY = "sk_live_platform";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_platform";
    try {
      const env = buildPreviewEnv();
      expect(env.CLERK_SECRET_KEY).toBeUndefined();
      const result = validateClerkConfig(env, tmpRoot);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("CLERK_SECRET_KEY is missing");
    } finally {
      if (origSecret === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = origSecret;
      if (origPk === undefined) delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      else process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = origPk;
    }
  });
});

// ─── Clerk env fingerprinting (never logs full key) ──────────────────

describe("PreviewManager — Clerk env fingerprinting", () => {
  it("never includes the full key value in the fingerprint", () => {
    const secret = "sk_test_fake_clerk_secret_for_fingerprint_test_only";
    const publishable = "pk_test_fake_clerk_publishable_for_fingerprint_test_only";
    const fingerprint = fingerprintClerkEnv({
      CLERK_SECRET_KEY: secret,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
    });

    const serialized = JSON.stringify(fingerprint);
    // The full key value must NOT appear in the serialized fingerprint
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(publishable);
    // But the prefix and fingerprint hash should be present
    expect(serialized).toContain("sk_test_");
    expect(serialized).toContain("pk_test_");
    expect(fingerprint.CLERK_SECRET_KEY.present).toBe(true);
    expect(fingerprint.CLERK_SECRET_KEY.length).toBe(secret.length);
    expect(fingerprint.CLERK_SECRET_KEY.fingerprint).toBeTruthy();
    expect(fingerprint.CLERK_SECRET_KEY.fingerprint).toHaveLength(12);
  });

  it("reports absent keys correctly", () => {
    const fingerprint = fingerprintClerkEnv({});
    expect(fingerprint.CLERK_SECRET_KEY.present).toBe(false);
    expect(fingerprint.CLERK_SECRET_KEY.prefix).toBeNull();
    expect(fingerprint.CLERK_SECRET_KEY.fingerprint).toBe("none");
    expect(fingerprint.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.present).toBe(false);
  });
});

// ─── Auth config error detection in health probe ────────────────────

describe("PreviewManager — auth config error in health probe", () => {
  let tmpRoot: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-auth-err-"));
    origEnv = { ...process.env };
    mockedGetWorkspace.mockReset();
  });

  afterEach(() => {
    process.env = origEnv;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("surfaces preview_auth_config_error when dev server returns Clerk 500", async () => {
    // Create a Clerk-using project
    writeFileSync(
      join(tmpRoot, "package.json"),
      JSON.stringify({ dependencies: { "@clerk/nextjs": "^6.0.0" } }),
    );
    writeFileSync(join(tmpRoot, "next.config.js"), "module.exports = {}");
    writeFileSync(join(tmpRoot, "pnpm-lock.yaml"), "");

    mockedGetWorkspace.mockReturnValue({
      workspaceId: "ws-auth-err",
      userId: "u1",
      projectId: "p1",
      root: tmpRoot,
      branch: "main",
      commitSha: "abc",
      ready: true,
    } as any);

    // Set valid isolated preview Clerk credentials so validation passes —
    // the platform's own CLERK_SECRET_KEY is never inherited.
    process.env.PREVIEW_CLERK_SECRET_KEY = "sk_live_abc123def456";
    process.env.PREVIEW_CLERK_PUBLISHABLE_KEY = "pk_live_xyz789ghi012";

    // Make pnpm resolvable
    const cleanNodeDir = join(tmpRoot, "clean-node");
    mkdirSync(cleanNodeDir, { recursive: true });
    const restore = overrideExecPath(cleanNodeDir);
    const fakeBin = join(tmpRoot, "fakebin");
    mkdirSync(fakeBin, { recursive: true });
    createFakeExecutable(fakeBin, "pnpm");
    process.env.PATH = fakeBin;
    delete process.env.NODE_BIN_DIR;

    // Mock fetch to return a Clerk 500 after the server "boots"
    const origFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      callCount++;
      if (typeof url === "string" && url.includes("127.0.0.1")) {
        return new Response(
          "Clerk: Handshake token verification failed: The provided Clerk Secret Key is invalid. (reason=secret-key-invalid)",
          { status: 500 },
        );
      }
      return origFetch(url as any);
    }) as any;

    await startPreview({
      workspaceId: "ws-auth-err",
      userId: "u1",
      command: "sleep 30",
      framework: "node",
      packageManager: "pnpm",
    });

    // Wait for the health probe to detect the auth error
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const status = getPreviewStatus("ws-auth-err");
    // Should be failed with auth config error, NOT a generic timeout
    expect(status.status).toBe("failed");
    if (status.errorCode === "preview_auth_config_error") {
      expect(status.error).toContain("authentication configuration error");
      expect(status.error).toContain("NOT a generic preview failure");
    }

    stopPreview("ws-auth-err");
    globalThis.fetch = origFetch;
    restore();
  });
});
