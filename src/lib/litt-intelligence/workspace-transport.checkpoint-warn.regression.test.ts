// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression test — a failed checkpoint is a WARN, not silence
 * (Repair R3, Diagnosis E4-S7).
 *
 * The defect: WorkspaceTransport.createCheckpointBeforeMutation caught
 * every error from the checkpoint layer and returned null without a
 * trace. Downstream, "no checkpoint" degrades every later verdict for
 * the run to "unknown" — and nothing in deployment stdout explained
 * why. The failure now emits a WARN line naming the project/user (ids
 * and outcomes only), while the null return contract is unchanged.
 */

vi.mock("@/lib/missions/workspace-checkpoint", () => ({
  createWorkspaceCheckpoint: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(() =>
    Promise.resolve({
      workspaceId: "ws-1",
      workspaceRoot: "/workspaces/ws-1",
      project: { framework: "static" },
    })),
}));

import { createWorkspaceTransport } from "./workspace-transport";
import { createWorkspaceCheckpoint } from "@/lib/missions/workspace-checkpoint";

function loggedEntries(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

describe("createCheckpointBeforeMutation — failure WARN (R3/E4-S7)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The reachability probe may fail or succeed — either way transport
    // creation must complete; the probe never throws by contract.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "unavailable",
    })));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("returns null AND logs a WARN when checkpoint creation throws", async () => {
    vi.mocked(createWorkspaceCheckpoint).mockRejectedValue(new Error("terminal down"));

    const transport = await createWorkspaceTransport("proj-1", "user-1");
    const checkpoint = await transport.createCheckpointBeforeMutation("pre-mutation");

    expect(checkpoint).toBeNull();
    const entry = loggedEntries(consoleSpy).find(
      (e) => e.message === "workspace:checkpoint_unavailable",
    );
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ level: "warn", projectId: "proj-1", userId: "user-1" });
  });

  it("returns the checkpoint and logs no WARN on success", async () => {
    vi.mocked(createWorkspaceCheckpoint).mockResolvedValue({
      checkpointId: "chk-9",
      label: "pre-mutation",
      gitSha: "",
      kind: "manifest",
      manifest: { "index.html": "abc" },
    } as never);

    const transport = await createWorkspaceTransport("proj-1", "user-1");
    const checkpoint = await transport.createCheckpointBeforeMutation("pre-mutation");

    expect(checkpoint?.checkpointId).toBe("chk-9");
    const entry = loggedEntries(consoleSpy).find(
      (e) => e.message === "workspace:checkpoint_unavailable",
    );
    expect(entry).toBeUndefined();
  });
});
