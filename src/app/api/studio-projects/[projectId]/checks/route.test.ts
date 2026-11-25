import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "@/app/api/studio-projects/[projectId]/checks/route";

/**
 * ACC-06a item 2 — checks must settle honestly.
 *
 * Production proof on 8cd7728c: after a completed build, every
 * Check (Build, TypeScript, Lint, Test, Security, Accessibility,
 * Performance) showed a bare "Not run" — no reason anywhere. The
 * GET returned not_run checks with error: null even though the
 * reason is known and stable: project checks run on demand from
 * the Checks panel, never automatically as part of a build.
 *
 * And the single-check POST shared the run-never-finishes disease:
 * its workspace command had NO timeout (the run-all route has
 * one), so a workspace command that never answered hung the check
 * — and the panel — in "running" forever.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
  verifyProjectWorkspace: vi.fn(),
}));
vi.mock("@/lib/missions/mission-repository", () => ({
  listCheckpoints: vi.fn(),
  listPendingApprovals: vi.fn(),
}));
vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
  terminalNotConfiguredResponse: vi.fn(() => null),
}));

import { auth } from "@/lib/auth";
import { getProject, verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { listCheckpoints, listPendingApprovals } from "@/lib/missions/mission-repository";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const verifyMock = vi.mocked(verifyProjectWorkspace);

const PROJECT = {
  id: "p1",
  name: "Bakery",
  workspaceId: "ws-1",
  workspaceStatus: "ready",
  workspaceError: null,
  packageManager: "pnpm",
  githubBranch: null,
  githubDefaultBranch: "main",
  runtimeStatus: "ready",
  previewUrl: null,
  runtimeError: null,
};

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function getRequest() {
  return new Request("https://x.test/api/studio-projects/p1/checks", {
    method: "GET",
  }) as unknown as import("next/server").NextRequest;
}

function postRequest(check: string) {
  return new Request("https://x.test/api/studio-projects/p1/checks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ check }),
  }) as unknown as import("next/server").NextRequest;
}

describe("checks route — honest not-run + bounded commands (ACC-06a item 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue(PROJECT as never);
    verifyMock.mockResolvedValue({ workspaceId: "ws-1" } as never);
    vi.mocked(listCheckpoints).mockResolvedValue([] as never);
    vi.mocked(listPendingApprovals).mockResolvedValue([] as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("GET records WHY checks are not run instead of a bare Not run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const res = await GET(getRequest(), makeParams("p1"));
    const payload = (await res.json()) as {
      checks: Array<{ id: string; status: string; error: string | null }>;
    };

    expect(payload.checks).toHaveLength(7);
    for (const check of payload.checks) {
      expect(check.status).toBe("not_run");
      expect(check.error).toBeTruthy();
      expect(check.error).toMatch(/on demand/i);
    }
  });

  it("POST settles a hung workspace command as failed with a timeout reason", async () => {
    vi.stubEnv("CHECKS_COMMAND_TIMEOUT_MS", "50");
    // A workspace command that never answers; like real fetch, it
    // rejects when the caller's AbortSignal fires.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted", "AbortError")),
            );
          }),
      ),
    );

    const outcome = await Promise.race([
      POST(postRequest("lint"), makeParams("p1")),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2_000)),
    ]);
    expect(outcome).not.toBe("hung");
    const res = outcome as Exclude<typeof outcome, "hung">;
    const payload = (await res.json()) as {
      check: { id: string; status: string; error: string | null };
    };
    expect(payload.check.status).toBe("failed");
    expect(payload.check.error).toMatch(/timed out/i);
  });
});
