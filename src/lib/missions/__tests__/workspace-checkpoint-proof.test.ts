// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Checkpoint exact-restore proof (Item 8).
 *
 * The workspace checkpoint is a git commit in the workspace repo, created
 * through the terminal-server /internal/workspace/:id/exec transport
 * (execInWorkspace). This test runs the EXACT shell commands the production
 * code sends — by stubbing only the HTTP fetch boundary and executing the
 * commands for real — against a real temporary git repo on disk.
 *
 * It proves:
 *   1. createWorkspaceCheckpoint records a real git SHA per mutation state.
 *   2. restoreWorkspaceCheckpoint(A) returns the working tree EXACTLY to
 *      the state captured by checkpoint A: file contents byte-identical,
 *      files added later gone, `git status --porcelain` and `git diff A`
 *      both empty.
 *   3. restoreWorkspaceCheckpoint(B) brings the later state back.
 *   4. Malformed / shell-injection SHAs are refused before any command runs.
 *
 * The preserved acceptance project (ACCEPTANCE-2026-09-28) is untouched:
 * everything here runs in a temp dir.
 */

vi.mock("@/lib/missions/mission-repository", () => ({
  createCheckpoint: vi.fn(async (input: { gitSha: string }) => ({
    id: `cp-${input.gitSha.slice(0, 8)}`,
  })),
}));

import {
  createWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
} from "../workspace-checkpoint";
import { createCheckpoint } from "@/lib/missions/mission-repository";

let repoDir = "";

const git = (...args: string[]): string =>
  spawnSync("git", args, { cwd: repoDir, encoding: "utf8" }).stdout.trim();

/** Stub ONLY the HTTP transport boundary: run the exact command the
 *  production code sent, for real, inside the temp repo. */
const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
  const { command, stdin } = JSON.parse(init.body) as {
    command: string;
    stdin?: string;
  };
  const r = spawnSync("sh", ["-c", command], {
    cwd: repoDir,
    input: stdin ?? undefined,
    encoding: "utf8",
  });
  return {
    ok: true,
    json: async () => ({
      exitCode: r.status ?? 1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
    }),
  };
});

const INPUT = { projectId: "p-test", userId: "u-test", workspaceId: "ws-test" };

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), "checkpoint-proof-"));
  git("init");
  git("config", "user.email", "proof@test.local");
  git("config", "user.name", "checkpoint-proof");
  git("config", "commit.gpgsign", "false");
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  process.env.TERMINAL_SERVER_INTERNAL_URL = "http://127.0.0.1:1";
  process.env.TERMINAL_INTERNAL_SERVICE_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (repoDir) rmSync(repoDir, { recursive: true, force: true });
  repoDir = "";
});

describe("workspace checkpoint — exact restore proof", () => {
  it("restores the working tree EXACTLY to an earlier checkpoint (and back)", async () => {
    // v1 state
    writeFileSync(join(repoDir, "app.txt"), "v1\n");
    const checkpointA = await createWorkspaceCheckpoint({
      ...INPUT,
      label: "checkpoint A",
    });
    expect(checkpointA.gitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ gitSha: checkpointA.gitSha }),
    );

    // v2 state: modify a file AND add a brand-new untracked file
    writeFileSync(join(repoDir, "app.txt"), "v2\n");
    writeFileSync(join(repoDir, "new.txt"), "brand new\n");
    const checkpointB = await createWorkspaceCheckpoint({
      ...INPUT,
      label: "checkpoint B",
    });
    expect(checkpointB.gitSha).not.toBe(checkpointA.gitSha);

    // Restore A: exact v1 state
    await restoreWorkspaceCheckpoint({
      workspaceId: INPUT.workspaceId,
      userId: INPUT.userId,
      gitSha: checkpointA.gitSha,
    });

    // The exact command sent over the transport
    const commands = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse(init.body) as { command: string }).command,
    );
    expect(commands.at(-1)).toBe(
      `git reset --hard ${checkpointA.gitSha} && git clean -fd`,
    );

    // Byte-identical contents, later-added file gone, tree clean
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("v1\n");
    expect(existsSync(join(repoDir, "new.txt"))).toBe(false);
    expect(git("rev-parse", "HEAD")).toBe(checkpointA.gitSha);
    expect(git("status", "--porcelain")).toBe("");
    expect(git("diff", checkpointA.gitSha)).toBe("");

    // Restore B: v2 state comes back exactly
    await restoreWorkspaceCheckpoint({
      workspaceId: INPUT.workspaceId,
      userId: INPUT.userId,
      gitSha: checkpointB.gitSha,
    });
    expect(readFileSync(join(repoDir, "app.txt"), "utf8")).toBe("v2\n");
    expect(readFileSync(join(repoDir, "new.txt"), "utf8")).toBe("brand new\n");
    expect(git("rev-parse", "HEAD")).toBe(checkpointB.gitSha);
    expect(git("status", "--porcelain")).toBe("");
    expect(git("diff", checkpointB.gitSha)).toBe("");
  });

  it("refuses malformed or shell-injection SHAs before executing anything", async () => {
    fetchMock.mockClear();
    const bad = [
      "not-a-sha",
      "",
      "a".repeat(39),
      "a".repeat(41),
      "z".repeat(40),
      `${"a".repeat(40)}; rm -rf /`,
      `${"a".repeat(40)} && touch pwned`,
      "$(whoami)".padEnd(40, "a"),
    ];
    for (const gitSha of bad) {
      await expect(
        restoreWorkspaceCheckpoint({
          workspaceId: INPUT.workspaceId,
          userId: INPUT.userId,
          gitSha,
        }),
      ).rejects.toThrow(/40-character hex/);
    }
    // No command ever reached the transport for any of them
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails honestly when the workspace has no such commit", async () => {
    await expect(
      restoreWorkspaceCheckpoint({
        workspaceId: INPUT.workspaceId,
        userId: INPUT.userId,
        gitSha: "d".repeat(40),
      }),
    ).rejects.toThrow(/failed/i);
  });
});
