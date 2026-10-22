import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression — project-less verify result must not crash the factory.
 *
 * CI on 24ecbd01 (Build and Type Check, run 39383013688) failed its Test
 * step: 4 tests crashed with "TypeError: Cannot read properties of
 * undefined (reading 'framework')" at createWorkspaceTransport
 * (workspace-transport.ts), where Gate 1 (cc2f6de4) reads
 * verified.project.framework to carry the static-workspace fact into the
 * transport. The real verifyProjectWorkspace contract always returns the
 * project row (it throws otherwise), but any verify result shaped without
 * `project` — a partial mock, a future contract drift — turned that read
 * into a fatal dereference. The fixture alignment (7cc813d3) brought the
 * binary suite's mock up to contract; this suite pins the other half: the
 * factory itself tolerates a project-less result and reports the
 * workspace as non-static instead of throwing.
 */

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: verifyMock,
}));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "t", expiresAt: Date.now() + 60_000 })),
}));
vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => "https://terminal.test"),
}));

import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  // Reachability probe: answer the /ws-files root listing so factory
  // creation completes exactly as it does for a healthy workspace.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ entries: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("createWorkspaceTransport — project-less verify result", () => {
  it("does not throw and yields a non-static transport when project is missing", async () => {
    // The exact shape that crashed CI: workspace fields present, no
    // `project` key at all.
    verifyMock.mockResolvedValue({
      workspaceId: "ws_test",
      workspaceRoot: "/data/ws_test",
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    expect(transport.isStaticWorkspace).toBe(false);
  });

  it("still detects a static workspace when project.framework is 'static'", async () => {
    verifyMock.mockResolvedValue({
      project: { framework: "static" },
      workspaceId: "ws_test",
      workspaceRoot: "/data/ws_test",
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    expect(transport.isStaticWorkspace).toBe(true);
  });

  it("treats a present but non-static framework as non-static", async () => {
    verifyMock.mockResolvedValue({
      project: { framework: "vite" },
      workspaceId: "ws_test",
      workspaceRoot: "/data/ws_test",
    });

    const transport = await createWorkspaceTransport("proj_test", "user_test");
    expect(transport.isStaticWorkspace).toBe(false);
  });
});
