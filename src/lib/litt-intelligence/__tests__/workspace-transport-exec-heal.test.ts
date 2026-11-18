import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Round 10: heal-on-workspace-failure for the transport exec path.
 *
 * The round-9 fix E healed the agent WRITE path (postWsFileWrite),
 * but the run's change-verification — computeWorkspaceChange's git
 * probe and the checkpoint client — rides exec(), which had no heal:
 * a descriptor-level miss (404 "Workspace not found" / 409
 * "Workspace not ready") failed every probe and the run reported
 * "Workspace unknown / 0 files" while the Files panel read the same
 * workspace fine (its routes heal). exec() now heals once and retries
 * on workspace-level failures only. The sandbox gate's fail-closed
 * 503 and sandbox execution 500s are NOT workspace misses and are
 * surfaced untouched — healing must never become a way around the
 * gate.
 */

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(async () => ({
    workspaceId: "ws_test",
    workspaceRoot: "/data/ws_test",
  })),
}));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "t", expiresAt: Date.now() + 60_000 })),
}));
vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => "https://terminal.test"),
}));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
}));

import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { ensureWorkspaceAlive } from "@/lib/studio/workspace-recovery";

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Route the fetch stub by URL: the creation probe (GET /ws-files)
 * gets a listing, /health gets an empty object, and the exec route
 * plays back the scripted responses in order.
 */
function stubFetch(execScript: Response[]) {
  const queue = [...execScript];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/internal/workspace/")) {
      const next = queue.shift();
      if (!next) throw new Error("unexpected extra exec call");
      return next;
    }
    if (u.includes("/health")) return jsonResponse({});
    return jsonResponse({ entries: [] });
  }) as unknown as typeof fetch;
}

function execCallCount(): number {
  const calls = vi.mocked(globalThis.fetch).mock.calls as unknown as Array<[string, unknown]>;
  return calls.filter(([url]) => String(url).includes("/internal/workspace/")).length;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("workspace transport exec heal (round 10)", () => {
  it("heals once and retries the exec after a workspace-level 404", async () => {
    stubFetch([
      jsonResponse({ error: "Workspace not found" }, 404),
      jsonResponse({ exitCode: 0, stdout: "## main\n", stderr: "" }),
    ]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_test",
      reprepared: true,
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const result = await transport.exec("git status --porcelain=v1 -b");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("## main\n");
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
    expect(ensureWorkspaceAlive).toHaveBeenCalledWith("proj_test", "user_test", "ws_test");
    expect(execCallCount()).toBe(2);
  });

  it("heals once and retries the exec after a 409 Workspace not ready", async () => {
    stubFetch([
      jsonResponse({ error: "Workspace not ready" }, 409),
      jsonResponse({ exitCode: 0, stdout: "", stderr: "" }),
    ]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_test",
      reprepared: true,
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const result = await transport.exec("git status --porcelain=v1 -b");

    expect(result.exitCode).toBe(0);
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
    expect(execCallCount()).toBe(2);
  });

  it("retries against the re-registered workspaceId the heal produced", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/internal/workspace/")) {
        urls.push(u);
        return urls.length === 1
          ? jsonResponse({ error: "Workspace not found" }, 404)
          : jsonResponse({ exitCode: 0, stdout: "", stderr: "" });
      }
      if (u.includes("/health")) return jsonResponse({});
      return jsonResponse({ entries: [] });
    }) as unknown as typeof fetch;
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_healed",
      reprepared: true,
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await transport.exec("git status --porcelain=v1 -b");

    expect(urls[0]).toContain("/internal/workspace/ws_test/exec");
    expect(urls[1]).toContain("/internal/workspace/ws_healed/exec");
  });

  it("does NOT heal the sandbox gate's fail-closed 503", async () => {
    stubFetch([jsonResponse({ error: "Host execution is disabled" }, 503)]);

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await expect(transport.exec("git status --porcelain=v1 -b")).rejects.toThrow(
      "exec failed (503)",
    );
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
    expect(execCallCount()).toBe(1);
  });

  it("does NOT heal a sandbox execution 500", async () => {
    stubFetch([jsonResponse({ error: "Sandbox execution failed", message: "boom" }, 500)]);

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await expect(transport.exec("git status --porcelain=v1 -b")).rejects.toThrow(
      "exec failed (500)",
    );
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
    expect(execCallCount()).toBe(1);
  });

  it("does NOT heal a 404 whose body is not the workspace error", async () => {
    stubFetch([jsonResponse({ error: "Path not found" }, 404)]);

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await expect(transport.exec("git status --porcelain=v1 -b")).rejects.toThrow(
      "exec failed (404)",
    );
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
    expect(execCallCount()).toBe(1);
  });

  it("surfaces the original 404 when the heal reports failure", async () => {
    stubFetch([jsonResponse({ error: "Workspace not found" }, 404)]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_test",
      reprepared: false,
      healFailed: true,
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await expect(transport.exec("git status --porcelain=v1 -b")).rejects.toThrow(
      "exec failed (404)",
    );
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
    expect(execCallCount()).toBe(1);
  });

  it("leaves the happy path untouched (no heal, single exec)", async () => {
    stubFetch([jsonResponse({ exitCode: 0, stdout: "ok", stderr: "" })]);

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const result = await transport.exec("git status --porcelain=v1 -b");

    expect(result.exitCode).toBe(0);
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
    expect(execCallCount()).toBe(1);
  });
});
