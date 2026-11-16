import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Round 11, Fix 3a — the transport records WHY checkpoint creation
 * failed instead of swallowing it to a silent null.
 *
 * Diagnosis Q2: createCheckpointBeforeMutation caught every failure
 * to `return null`, so a 500-class exec failure during checkpointing
 * became an unexplained "Workspace unknown" at settlement. The null
 * return stays (callers treat it as "no checkpoint"), but the reason
 * is now recorded on transport.lastCheckpointError for the settlement
 * to surface, and cleared by the next success.
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
vi.mock("@/lib/missions/workspace-checkpoint", () => ({
  createWorkspaceCheckpoint: vi.fn(),
}));

import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { createWorkspaceCheckpoint } from "@/lib/missions/workspace-checkpoint";

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.mocked(createWorkspaceCheckpoint).mockReset();
  // The factory's reachability probe: answer the /ws-files listing.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ entries: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("WorkspaceTransport.createCheckpointBeforeMutation — failure visibility", () => {
  it("returns null AND records the reason on a 500-class checkpoint failure", async () => {
    vi.mocked(createWorkspaceCheckpoint).mockRejectedValue(
      new Error("Checkpoint exec failed (500): sandbox unavailable"),
    );
    const transport = await createWorkspaceTransport("proj_test", "user_test");
    const result = await transport.createCheckpointBeforeMutation("pre-mutation");
    expect(result).toBeNull();
    expect(transport.lastCheckpointError).toMatch(/Checkpoint exec failed \(500\)/);
  });

  it("a later success clears the recorded reason", async () => {
    vi.mocked(createWorkspaceCheckpoint)
      .mockRejectedValueOnce(new Error("Checkpoint exec failed (500)"))
      .mockResolvedValue({
        checkpointId: "cp-1",
        label: "pre-mutation",
        gitSha: "abc123",
        createdAt: new Date().toISOString(),
      } as never);
    const transport = await createWorkspaceTransport("proj_test", "user_test");
    await transport.createCheckpointBeforeMutation("first");
    expect(transport.lastCheckpointError).toMatch(/500/);
    const ok = await transport.createCheckpointBeforeMutation("second");
    expect(ok?.gitSha).toBe("abc123");
    expect(transport.lastCheckpointError).toBeNull();
  });
});
