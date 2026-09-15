import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

/**
 * Workspace ownership + cwd containment for /internal/command.
 *
 * Defect: dispatchCommand resolved any workspaceId to its filesystem root
 * through the unchecked getWorkspace(), never comparing ws.userId against
 * the requesting userId — while the ownership-checking helper
 * getWorkspaceRoot(workspaceId, userId) existed with zero call sites. The
 * /ws-files routes enforce `ws.userId !== userId → 403` inline, so the two
 * paths that resolve a workspace to a root disagreed.
 *
 * /internal/command is authenticated by the internal service key and takes
 * userId from the request body, so the web route forwarding an
 * unvalidated body.workspaceId made this the enforcement point.
 */

// ── Filesystem fixture ────────────────────────────────────────────
const FIXTURE = mkdtempSync(join(tmpdir(), "litt-ws-own-"));
const ALICE_ROOT = join(FIXTURE, "alice", "project");
const ALICE_NESTED = join(ALICE_ROOT, "src", "components");
const BOB_ROOT = join(FIXTURE, "bob", "project");

mkdirSync(ALICE_NESTED, { recursive: true });
mkdirSync(BOB_ROOT, { recursive: true });

// A symlink planted inside Alice's workspace pointing at Bob's. Windows
// needs privileges for this, so the symlink test is skipped when it fails.
const ESCAPE_LINK = join(ALICE_ROOT, "escape-link");
let symlinkAvailable = true;
try {
  symlinkSync(BOB_ROOT, ESCAPE_LINK, "junction");
} catch {
  symlinkAvailable = false;
}

afterAll(() => {
  rmSync(FIXTURE, { recursive: true, force: true });
});

// ── Mocks ─────────────────────────────────────────────────────────
const WORKSPACES: Record<string, { root: string; userId: string }> = {
  "ws-alice": { root: ALICE_ROOT, userId: "user_alice" },
  "ws-bob": { root: BOB_ROOT, userId: "user_bob" },
};

vi.mock("../workspace/WorkspaceManager", () => ({
  getWorkspaceRoot: (workspaceId: string, userId?: string) => {
    const ws = WORKSPACES[workspaceId];
    if (!ws) return null;
    if (userId && ws.userId !== userId) return null;
    return ws.root;
  },
  getWorkspace: (workspaceId: string) => WORKSPACES[workspaceId],
}));

const dispatchRegistryMock = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  kind: "text",
  data: { text: "ok" },
}));

vi.mock("../command-registry", () => ({
  resolveCommand: (name: string) => (name === "unknown-cmd" ? null : { name }),
  getCommandNames: () => ["status", "diff"],
  dispatchRegistry: (...args: unknown[]) =>
    (dispatchRegistryMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("../run-registry.js", () => ({
  getRunRegistry: () => ({
    clear: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
  }),
}));

import { dispatchCommand } from "../command-bridge";
import { resolveOwnedCwd } from "../workspace/owned-cwd";

beforeEach(() => {
  dispatchRegistryMock.mockClear();
});

describe("dispatchCommand — workspace ownership", () => {
  // 1. owner + valid workspace + no cwd
  it("allows the owner and runs in the workspace root", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-alice",
    } as never);

    expect(res.ok).toBe(true);
    expect(dispatchRegistryMock).toHaveBeenCalledTimes(1);
    const ctx = dispatchRegistryMock.mock.calls[0][1] as { cwd: string };
    expect(resolve(ctx.cwd)).toBe(resolve(ALICE_ROOT));
  });

  // 2. owner + nested cwd inside the root
  it("allows a nested cwd inside the owned root", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-alice",
      cwd: "src/components",
    } as never);

    expect(res.ok).toBe(true);
    const ctx = dispatchRegistryMock.mock.calls[0][1] as { cwd: string };
    expect(resolve(ctx.cwd)).toBe(resolve(ALICE_NESTED));
  });

  // 3. non-owner workspace
  it("refuses a workspace owned by another user and never dispatches", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-bob",
    } as never);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("workspace_unauthorized");
    expect(dispatchRegistryMock).not.toHaveBeenCalled();
  });

  // 4. unknown workspace — fails closed, indistinguishable from not-owned
  it("fails closed on an unknown workspace with the same code as not-owned", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-does-not-exist",
    } as never);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("workspace_unauthorized");
    expect(dispatchRegistryMock).not.toHaveBeenCalled();
  });

  // never trust workspaceId alone
  it("refuses a workspace request that carries no user identity", async () => {
    const res = await dispatchCommand({
      command: "status",
      workspaceId: "ws-alice",
    } as never);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("workspace_unauthorized");
    expect(dispatchRegistryMock).not.toHaveBeenCalled();
  });

  // 5. traversal escape
  it("rejects a traversal cwd that escapes the owned root", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-alice",
      cwd: "../../bob/project",
    } as never);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("workspace_unauthorized");
    expect(dispatchRegistryMock).not.toHaveBeenCalled();
  });

  // 6. absolute cwd outside the workspace
  it("rejects an absolute cwd outside the owned root", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-alice",
      cwd: BOB_ROOT,
    } as never);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("workspace_unauthorized");
    expect(dispatchRegistryMock).not.toHaveBeenCalled();
  });

  // 8. cwd without workspace identity
  it("rejects a cwd supplied without a workspaceId", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      cwd: "/etc",
    } as never);

    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("workspace_required");
    expect(dispatchRegistryMock).not.toHaveBeenCalled();
  });

  // 9. ordering — validation precedes execution
  it("validates ownership before the command ever dispatches", async () => {
    await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-bob",
    } as never);

    expect(dispatchRegistryMock).not.toHaveBeenCalled();
  });

  // Error bodies must not disclose filesystem layout
  it("does not disclose another user's workspace root in the error", async () => {
    const res = await dispatchCommand({
      command: "status",
      userId: "user_alice",
      workspaceId: "ws-bob",
    } as never);

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(BOB_ROOT);
    expect(serialized).not.toContain(ALICE_ROOT);
    expect(serialized).not.toContain(FIXTURE);
  });

  // Workspace-less commands keep working (CLI / cockpit / existing tests)
  it("still runs a command that names no workspace at all", async () => {
    const res = await dispatchCommand({ command: "status" } as never);

    expect(res.ok).toBe(true);
    expect(dispatchRegistryMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveOwnedCwd — containment", () => {
  it("returns the root when no cwd is requested", () => {
    expect(resolveOwnedCwd(ALICE_ROOT, undefined)).toEqual({
      ok: true,
      cwd: resolve(ALICE_ROOT),
    });
  });

  it("treats an empty or whitespace cwd as the root", () => {
    for (const value of ["", "   "]) {
      const result = resolveOwnedCwd(ALICE_ROOT, value);
      expect(result.ok).toBe(true);
    }
  });

  it("allows a nested path", () => {
    const result = resolveOwnedCwd(ALICE_ROOT, "src/components");
    expect(result).toEqual({ ok: true, cwd: resolve(ALICE_NESTED) });
  });

  it("allows a path that does not exist yet inside the root", () => {
    const result = resolveOwnedCwd(ALICE_ROOT, "not/created/yet");
    expect(result.ok).toBe(true);
  });

  it.each([["../.."], ["../../bob/project"], ["./../../bob"]])(
    "rejects traversal %s",
    (value: string) => {
      expect(resolveOwnedCwd(ALICE_ROOT, value)).toEqual({
        ok: false,
        reason: "outside_workspace",
      });
    },
  );

  it("rejects an absolute path outside the root", () => {
    expect(resolveOwnedCwd(ALICE_ROOT, BOB_ROOT)).toEqual({
      ok: false,
      reason: "outside_workspace",
    });
  });

  // 7. symlink escape
  it.skipIf(!symlinkAvailable)(
    "rejects a symlink inside the root that points outside it",
    () => {
      expect(resolveOwnedCwd(ALICE_ROOT, "escape-link")).toEqual({
        ok: false,
        reason: "outside_workspace",
      });
    },
  );
});
