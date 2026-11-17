import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Round 9 fix E: heal-on-404 for the agent write path.
 *
 * The files/preview routes have healed a workspace-level 404 via
 * ensureWorkspaceAlive since #1012, but the agent transport — the
 * path that saves generated images — threw the raw 404 and the run
 * reported "Image generated but project save failed". The transport
 * now runs the same heal once and retries the write; every other
 * failure shape is surfaced exactly as before.
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
 * gets a listing, /health gets an empty object, and /ws-files/write
 * plays back the scripted responses in order.
 */
function stubFetch(writeScript: Response[]) {
  const queue = [...writeScript];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/ws-files/write")) {
      const next = queue.shift();
      if (!next) throw new Error("unexpected extra /ws-files/write call");
      return next;
    }
    if (u.includes("/health")) return jsonResponse({});
    return jsonResponse({ entries: [] });
  }) as unknown as typeof fetch;
}

function writeCallCount(): number {
  const calls = vi.mocked(globalThis.fetch).mock.calls as unknown as Array<[string, unknown]>;
  return calls.filter(([url]) => String(url).includes("/ws-files/write")).length;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("workspace transport write heal-on-404 (round 9 fix E)", () => {
  it("heals once and retries the binary write after a workspace-level 404", async () => {
    stubFetch([
      jsonResponse({ error: "Workspace not found" }, 404),
      jsonResponse({ saved: true }),
    ]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_test",
      reprepared: true,
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const result = await transport.writeBinaryFile("assets/lion.jpeg", "QUJD");

    expect(result).toEqual({ saved: true });
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
    expect(ensureWorkspaceAlive).toHaveBeenCalledWith("proj_test", "user_test", "ws_test");
    expect(writeCallCount()).toBe(2);
  });

  it("surfaces the original 404 when the heal reports failure", async () => {
    stubFetch([jsonResponse({ error: "Workspace not found" }, 404)]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_test",
      reprepared: false,
      healFailed: true,
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await expect(transport.writeBinaryFile("assets/lion.jpeg", "QUJD")).rejects.toThrow(
      "writeBinaryFile failed (404)",
    );
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
    expect(writeCallCount()).toBe(1);
  });

  it("does not heal a file-level 404 (different error body)", async () => {
    stubFetch([jsonResponse({ error: "Path not found" }, 404)]);

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await expect(transport.writeFile("missing.txt", "x")).rejects.toThrow(
      "writeFile failed (404)",
    );
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
    expect(writeCallCount()).toBe(1);
  });

  it("leaves the happy path untouched (no heal, single write)", async () => {
    stubFetch([jsonResponse({ saved: true })]);

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const result = await transport.writeFile("index.html", "<html/>");

    expect(result).toEqual({ saved: true });
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
    expect(writeCallCount()).toBe(1);
  });
});
