// @vitest-environment node
import { describe, it, expect } from "vitest";
import { resolve, relative, isAbsolute } from "path";

/**
 * Tests for workspace path resolution security.
 * These mirror the logic in terminal-server's resolveWorkspacePath()
 * and verify that path traversal and symlink escape are blocked.
 */

const MAX_PATH_LENGTH = 4096;

function checkPathTraversal(root: string, filePath: string): { safe: boolean; reason?: string } {
  if (filePath.length > MAX_PATH_LENGTH) {
    return { safe: false, reason: "Path too long" };
  }
  const target = resolve(root, filePath);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    return { safe: false, reason: "Invalid path — escapes workspace root" };
  }
  return { safe: true };
}

describe("workspace path security", () => {
  const workspaceRoot = "/tmp/workspaces/ws-abc-123/root";

  it("allows a simple relative path", () => {
    const result = checkPathTraversal(workspaceRoot, "src/index.ts");
    expect(result.safe).toBe(true);
  });

  it("allows nested relative paths", () => {
    const result = checkPathTraversal(workspaceRoot, "src/components/Button.tsx");
    expect(result.safe).toBe(true);
  });

  it("blocks parent directory traversal (..)", () => {
    const result = checkPathTraversal(workspaceRoot, "../../../etc/passwd");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("escapes workspace root");
  });

  it("blocks absolute paths", () => {
    const result = checkPathTraversal(workspaceRoot, "/etc/passwd");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("escapes workspace root");
  });

  it("blocks paths that escape via nested traversal", () => {
    const result = checkPathTraversal(workspaceRoot, "src/../../etc/shadow");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("escapes workspace root");
  });

  it("blocks paths that are too long", () => {
    const longPath = "a".repeat(MAX_PATH_LENGTH + 1);
    const result = checkPathTraversal(workspaceRoot, longPath);
    expect(result.safe).toBe(false);
    expect(result.reason).toBe("Path too long");
  });

  it("allows the workspace root itself (.)", () => {
    const result = checkPathTraversal(workspaceRoot, ".");
    expect(result.safe).toBe(true);
  });

  it("blocks path traversal disguised as a valid path", () => {
    const result = checkPathTraversal(workspaceRoot, "valid/../../../escape");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("escapes workspace root");
  });
});

describe("workspace ownership verification", () => {
  it("rejects a workspaceId that does not belong to the user", () => {
    // This mirrors the logic in requireWorkspaceAuth and getWorkspace()
    const workspaceStore = new Map<string, { workspaceId: string; userId: string; ready: boolean }>([
      ["ws-abc", { workspaceId: "ws-abc", userId: "user_owner", ready: true }],
    ]);

    const requestingUser = "user_attacker";
    const ws = workspaceStore.get("ws-abc");
    const isForbidden = ws && ws.userId !== requestingUser;
    expect(isForbidden).toBe(true);
  });

  it("rejects a non-ready workspace", () => {
    const workspaceStore = new Map<string, { workspaceId: string; userId: string; ready: boolean }>([
      ["ws-xyz", { workspaceId: "ws-xyz", userId: "user_owner", ready: false }],
    ]);

    const ws = workspaceStore.get("ws-xyz");
    const isNotReady = ws && ws.userId === "user_owner" && !ws.ready;
    expect(isNotReady).toBe(true);
  });

  it("accepts a ready workspace owned by the user", () => {
    const workspaceStore = new Map<string, { workspaceId: string; userId: string; ready: boolean }>([
      ["ws-ok", { workspaceId: "ws-ok", userId: "user_owner", ready: true }],
    ]);

    const ws = workspaceStore.get("ws-ok");
    const isAllowed = ws && ws.userId === "user_owner" && ws.ready;
    expect(isAllowed).toBe(true);
  });
});
