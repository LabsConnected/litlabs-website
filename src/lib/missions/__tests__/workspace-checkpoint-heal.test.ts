// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Round 10: heal-on-workspace-failure for the checkpoint client.
 *
 * The checkpoint is the baseline the run's change-verification diffs
 * against. Its exec client had no heal: a lost terminal descriptor
 * (404 "Workspace not found" / 409 "Workspace not ready") failed the
 * checkpoint, createCheckpointBeforeMutation swallowed that to null,
 * and every later verification reported "unknown" even when the run's
 * writes had landed (round-10 diagnosis Q2). The client now heals
 * once via ensureWorkspaceAlive — the sanctioned re-prepare path,
 * the same shape as the transport's fix E — and retries. The gate's
 * fail-closed 503 and execution 500s are not workspace misses and
 * surface untouched.
 */

vi.mock("@/lib/missions/mission-repository", () => ({
  createCheckpoint: vi.fn(async () => ({ id: "ckpt-1" })),
}));
vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
}));

import {
  createWorkspaceCheckpoint,
  CHECKPOINT_EXEC_TIMEOUT_MS,
} from "@/lib/missions/workspace-checkpoint";
import { ensureWorkspaceAlive } from "@/lib/studio/workspace-recovery";
import { createCheckpoint } from "@/lib/missions/mission-repository";

const SHA = "a".repeat(40);
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Script the exec route by command: `commitScript` plays back in
 * order for the checkpoint commit command; rev-parse always answers
 * the SHA. Records every URL hit so tests can assert the retry went
 * to the healed workspaceId.
 */
function stubFetch(commitScript: Response[]) {
  const queue = [...commitScript];
  const urls: string[] = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    urls.push(u);
    const { command } = JSON.parse(init?.body ?? "{}") as { command?: string };
    if (command?.includes("git commit")) {
      const next = queue.shift();
      if (!next) throw new Error("unexpected extra commit exec call");
      return next;
    }
    if (command?.includes("rev-parse")) {
      return jsonResponse({ exitCode: 0, stdout: `${SHA}\n`, stderr: "" });
    }
    throw new Error(`unexpected command: ${command}`);
  }) as unknown as typeof fetch;
  return urls;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("workspace checkpoint heal (round 10)", () => {
  it("heals once and retries the checkpoint commit after a workspace-level 404", async () => {
    const urls = stubFetch([
      jsonResponse({ error: "Workspace not found" }, 404),
      jsonResponse({ exitCode: 0, stdout: "", stderr: "" }),
    ]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_healed",
      reprepared: true,
    });

    const result = await createWorkspaceCheckpoint({
      projectId: "proj_test",
      userId: "user_test",
      workspaceId: "ws_lost",
      label: "before mutation",
    });

    expect(result.gitSha).toBe(SHA);
    expect(result.checkpointId).toBe("ckpt-1");
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
    expect(ensureWorkspaceAlive).toHaveBeenCalledWith("proj_test", "user_test", "ws_lost");
    // The commit retry went to the healed workspace.
    const commitUrls = urls.filter((u) => u.includes("/exec"));
    expect(commitUrls[0]).toContain("/internal/workspace/ws_lost/exec");
    expect(commitUrls[1]).toContain("/internal/workspace/ws_healed/exec");
    expect(createCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("heals after a 409 Workspace not ready", async () => {
    stubFetch([
      jsonResponse({ error: "Workspace not ready" }, 409),
      jsonResponse({ exitCode: 0, stdout: "", stderr: "" }),
    ]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_lost",
      reprepared: true,
    });

    const result = await createWorkspaceCheckpoint({
      projectId: "proj_test",
      userId: "user_test",
      workspaceId: "ws_lost",
      label: "before mutation",
    });

    expect(result.gitSha).toBe(SHA);
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
  });

  it("does NOT heal the sandbox gate's fail-closed 503", async () => {
    stubFetch([jsonResponse({ error: "Host execution is disabled" }, 503)]);

    await expect(
      createWorkspaceCheckpoint({
        projectId: "proj_test",
        userId: "user_test",
        workspaceId: "ws_lost",
        label: "before mutation",
      }),
    ).rejects.toThrow("Workspace exec failed (503)");
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
  });

  it("surfaces the original 404 when the heal reports failure", async () => {
    stubFetch([jsonResponse({ error: "Workspace not found" }, 404)]);
    vi.mocked(ensureWorkspaceAlive).mockResolvedValue({
      workspaceId: "ws_lost",
      reprepared: false,
      healFailed: true,
    });

    await expect(
      createWorkspaceCheckpoint({
        projectId: "proj_test",
        userId: "user_test",
        workspaceId: "ws_lost",
        label: "before mutation",
      }),
    ).rejects.toThrow("Workspace exec failed (404)");
    expect(ensureWorkspaceAlive).toHaveBeenCalledTimes(1);
    expect(createCheckpoint).not.toHaveBeenCalled();
  });

  it("leaves the happy path untouched (no heal attempted)", async () => {
    stubFetch([jsonResponse({ exitCode: 0, stdout: "", stderr: "" })]);

    const result = await createWorkspaceCheckpoint({
      projectId: "proj_test",
      userId: "user_test",
      workspaceId: "ws_ok",
      label: "before mutation",
    });

    expect(result.gitSha).toBe(SHA);
    expect(ensureWorkspaceAlive).not.toHaveBeenCalled();
  });

  it("pins the raised checkpoint exec budget above the cold-start cost it replaces", () => {
    // Was 120s — exactly the server's per-command budget, with no
    // room for the cold sandbox create + mirror the response waits
    // on. The constant is the contract; see its doc comment.
    expect(CHECKPOINT_EXEC_TIMEOUT_MS).toBe(360_000);
  });
});
