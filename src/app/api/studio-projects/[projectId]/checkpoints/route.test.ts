import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  POST,
} from "@/app/api/studio-projects/[projectId]/checkpoints/route";

/**
 * checkpoints route — gitless detection (regression).
 *
 * Demonstrated failure: a static workspace nested under a repo-rooted
 * TERMINAL_WORKSPACE_ROOT answered "inside work tree = true" because git
 * discovered the OUTER repository — `git add`/`commit` would have mutated
 * the outer repo's index and history. The probe now requires the workspace
 * to be the ROOT of its own repo (`--git-dir` == ".git").
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("@/lib/missions/mission-repository", () => ({
  listCheckpoints: vi.fn(),
  createCheckpoint: vi.fn(),
}));
vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
  terminalNotConfiguredResponse: vi.fn(() => null),
}));

import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createCheckpoint } from "@/lib/missions/mission-repository";

const authMock = vi.mocked(auth);
const verifyMock = vi.mocked(verifyProjectWorkspace);
const checkpointMock = vi.mocked(createCheckpoint);

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}
function execResult(exitCode: number, stdout = "", stderr = "") {
  return new Response(JSON.stringify({ exitCode, stdout, stderr }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function postCheckpoint(label = "my checkpoint") {
  return new Request("https://x.test/api/studio-projects/p1/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label }),
  }) as unknown as import("next/server").NextRequest;
}

describe("checkpoints POST — gitless scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TERMINAL_INTERNAL_SERVICE_KEY", "x".repeat(40));
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    verifyMock.mockResolvedValue({ workspaceId: "ws-1" } as never);
    checkpointMock.mockResolvedValue({ id: "cp-1", gitSha: "deadbeef" } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("workspace nested in an OUTER repo → 409 WORKSPACE_GITLESS; git add never runs", async () => {
    // rev-parse succeeds (outer repo found) but --git-dir is the outer gitdir
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      execResult(0, "true\nC:/LiTT/Canonical-2026/.git\n"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(postCheckpoint(), makeParams("p1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("WORKSPACE_GITLESS");
    // Exactly ONE exec call (the probe); no add/commit ever reached the workspace
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain("rev-parse");
    expect(checkpointMock).not.toHaveBeenCalled();
  });

  it("workspace with NO repo at all → 409 WORKSPACE_GITLESS", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      execResult(128, "", "fatal: not a git repository (or any of the parent directories): .git"),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(postCheckpoint(), makeParams("p1"));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("WORKSPACE_GITLESS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("workspace that IS its own repo root → probe passes, checkpoint is created", async () => {
    const fetchMock = vi
      .fn(async (_url: string, _init?: RequestInit) => new Response("x"))
      .mockResolvedValueOnce(execResult(0, "true\n.git\n"))       // probe
      .mockResolvedValueOnce(execResult(0))                        // git add .
      .mockResolvedValueOnce(execResult(0))                        // git commit --file=-
      .mockResolvedValueOnce(execResult(0, "deadbeef\n"));         // git rev-parse HEAD
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(postCheckpoint("golden run"), makeParams("p1"));
    expect(res.status).toBe(201);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(checkpointMock).toHaveBeenCalledWith(
      expect.objectContaining({ gitSha: "deadbeef", label: "golden run" }),
    );
  });

  it("a real git failure inside a valid repo still surfaces as 500, not 409", async () => {
    const fetchMock = vi
      .fn(async (_url: string, _init?: RequestInit) => new Response("x"))
      .mockResolvedValueOnce(execResult(0, "true\n.git\n"))
      .mockResolvedValueOnce(execResult(1, "", "error: pathspec did not match"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(postCheckpoint(), makeParams("p1"));
    expect(res.status).toBe(500);
    expect((await res.json()).code).not.toBe("WORKSPACE_GITLESS");
  });
});
