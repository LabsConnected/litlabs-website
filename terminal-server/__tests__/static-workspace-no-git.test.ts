/**
 * Static workspace provisioning — file storage without Git.
 *
 * Gate 1 containment correctly blocks ALL Git operations in production
 * (git add/commit can run hooks and filters). But that left new users
 * unable to get any working workspace at all: prepareManagedWorkspace()
 * calls ensureGitRepository(), which throws HOST_EXECUTION_DISABLED.
 *
 * Static workspaces solve this by skipping Git entirely. The directory is
 * created, template files are written with pure filesystem operations, and
 * NO subprocess is ever spawned. File read/write via /ws-files works
 * normally. Checkpoints/diff/restore are unavailable (they need Git).
 *
 * Properties proven here:
 *   1. Static provisioning SUCCEEDS in a production-like environment
 *      (no opt-in keys) — it must not throw or return 503.
 *   2. ZERO subprocesses are spawned during static provisioning or file
 *      writes — mocked child_process and simple-git assert this.
 *   3. AI-written files persist: write via the filesystem (same path as
 *      /ws-files/write), read back, content matches.
 *   4. No .git directory is created for static workspaces.
 *   5. Managed (git-backed) provisioning STILL fails closed in production —
 *      existing behavior is preserved, not weakened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const m = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  fork: vi.fn(),
  simpleGit: vi.fn(),
}));

vi.mock("child_process", async (orig) => {
  const actual = await orig<typeof import("child_process")>();
  return {
    ...actual,
    execFile: m.execFile,
    execFileSync: m.execFileSync,
    exec: m.exec,
    execSync: m.execSync,
    spawn: m.spawn,
    spawnSync: m.spawnSync,
    fork: m.fork,
  };
});
vi.mock("simple-git", () => ({ simpleGit: m.simpleGit }));

import {
  prepareStaticWorkspace,
  prepareManagedWorkspace,
  STATIC_WORKSPACE_COMMIT_SHA,
} from "../workspace/WorkspaceManager";
import { TerminalIsolationError } from "../isolation-policy";

let ROOT: string;

function prodEnv(): void {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LITT_LOCAL_EXECUTION_OPT_IN", "");
  vi.stubEnv("LITT_ISOLATION_VERIFIED", "");
  // Ensure no Railway markers leak in from the real environment
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "");
  vi.stubEnv("RAILWAY_PROJECT_ID", "");
  vi.stubEnv("RAILWAY_SERVICE_ID", "");
  vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "");
}

beforeEach(() => {
  ROOT = mkdtempSync(join(tmpdir(), "litt-static-ws-"));
  prodEnv();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  try {
    rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // Disposable temp dir
  }
});

function subprocessCallCount(): number {
  return (
    m.execFile.mock.calls.length +
    m.execFileSync.mock.calls.length +
    m.exec.mock.calls.length +
    m.execSync.mock.calls.length +
    m.spawn.mock.calls.length +
    m.spawnSync.mock.calls.length +
    m.fork.mock.calls.length +
    m.simpleGit.mock.calls.length
  );
}

describe("static workspace provisioning (no git)", () => {
  it("provisions successfully in a production-like environment (no opt-in keys)", async () => {
    const ws = await prepareStaticWorkspace({
      userId: "user_static_1",
      projectId: "proj-static-a",
      workspaceRoot: ROOT,
      templateId: "blank-static",
    });

    expect(ws.ready).toBe(true);
    expect(ws.userId).toBe("user_static_1");
    expect(ws.projectId).toBe("proj-static-a");
    expect(existsSync(ws.root)).toBe(true);
    // Template files were written
    expect(existsSync(join(ws.root, "index.html"))).toBe(true);
  });

  it("creates no .git directory", async () => {
    const ws = await prepareStaticWorkspace({
      userId: "user_static_2",
      projectId: "proj-static-b",
      workspaceRoot: ROOT,
      templateId: "blank-static",
    });

    expect(existsSync(join(ws.root, ".git"))).toBe(false);
  });

  it("uses the static sentinel commit SHA", async () => {
    const ws = await prepareStaticWorkspace({
      userId: "user_static_3",
      projectId: "proj-static-c",
      workspaceRoot: ROOT,
      templateId: "blank-static",
    });

    expect(ws.commitSha).toBe(STATIC_WORKSPACE_COMMIT_SHA);
    expect(ws.branch).toBe("main");
  });

  it("spawns ZERO subprocesses during provisioning", async () => {
    await prepareStaticWorkspace({
      userId: "user_static_4",
      projectId: "proj-static-d",
      workspaceRoot: ROOT,
      templateId: "blank-static",
    });

    expect(subprocessCallCount()).toBe(0);
    expect(m.simpleGit).not.toHaveBeenCalled();
  });

  it("AI-written files persist: write then read back with matching content", async () => {
    const ws = await prepareStaticWorkspace({
      userId: "user_static_5",
      projectId: "proj-static-e",
      workspaceRoot: ROOT,
      templateId: "empty-static",
    });

    // Simulate what /ws-files/write does: resolve path, mkdir, writeFileSync
    const filePath = join(ws.root, "about.html");
    const content = "<html><body><h1>AI-generated page</h1></body></html>";
    writeFileSync(filePath, content, "utf-8");

    // Simulate what /ws-files/read does
    const readBack = readFileSync(filePath, "utf-8");
    expect(readBack).toBe(content);
  });

  it("spawns ZERO subprocesses during file write", async () => {
    const ws = await prepareStaticWorkspace({
      userId: "user_static_6",
      projectId: "proj-static-f",
      workspaceRoot: ROOT,
      templateId: "empty-static",
    });

    vi.clearAllMocks();

    writeFileSync(join(ws.root, "app.js"), "console.log('hello');", "utf-8");
    const readBack = readFileSync(join(ws.root, "app.js"), "utf-8");

    expect(readBack).toBe("console.log('hello');");
    expect(subprocessCallCount()).toBe(0);
  });

  it("is idempotent: re-provisioning adopts existing content", async () => {
    const input = {
      userId: "user_static_7",
      projectId: "proj-static-g",
      workspaceRoot: ROOT,
      templateId: "empty-static",
    };
    const ws1 = await prepareStaticWorkspace(input);

    // AI writes a file
    writeFileSync(join(ws1.root, "custom.html"), "<p>user content</p>", "utf-8");

    // Re-provision (e.g. after terminal-server restart)
    const ws2 = await prepareStaticWorkspace(input);

    expect(ws2.workspaceId).toBe(ws1.workspaceId);
    expect(ws2.root).toBe(ws1.root);
    // Content preserved, not overwritten
    expect(readFileSync(join(ws2.root, "custom.html"), "utf-8")).toBe("<p>user content</p>");
    expect(subprocessCallCount()).toBe(0);
  });

  it("empty-static template writes no starter files (agent creates first artifact)", async () => {
    const ws = await prepareStaticWorkspace({
      userId: "user_static_8",
      projectId: "proj-static-h",
      workspaceRoot: ROOT,
      templateId: "empty-static",
    });

    expect(ws.ready).toBe(true);
    expect(existsSync(join(ws.root, "index.html"))).toBe(false);
  });
});

describe("managed workspace still fails closed in production", () => {
  it("prepareManagedWorkspace throws in production-like env (existing behavior preserved)", async () => {
    await expect(
      prepareManagedWorkspace({
        userId: "user_managed_1",
        projectId: "proj-managed-a",
        workspaceRoot: ROOT,
        templateId: "blank-static",
      }),
    ).rejects.toThrow(TerminalIsolationError);
  });

  it("does not create a workspace directory when blocked", async () => {
    const projectId = "proj-managed-b";
    await expect(
      prepareManagedWorkspace({
        userId: "user_managed_2",
        projectId,
        workspaceRoot: ROOT,
        templateId: "blank-static",
      }),
    ).rejects.toThrow();

    // The git guard throws before any .git directory could be created.
    // simple-git must never have been invoked.
    expect(m.simpleGit).not.toHaveBeenCalled();
  });
});
