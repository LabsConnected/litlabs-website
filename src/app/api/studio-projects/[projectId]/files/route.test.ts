import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  GET,
  POST,
} from "@/app/api/studio-projects/[projectId]/files/route";

/**
 * files route — upstream-404 scoping (regression).
 *
 * Demonstrated failure: the route treated ANY terminal-server 404 as a lost
 * workspace and ran ensureWorkspaceAlive re-provisioning on routine
 * file-level misses. Only an upstream body of exactly "Workspace not found"
 * justifies recovery; "File not found" / "Path not found" pass through.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "t", expiresAt: Date.now() + 60000 })),
}));
vi.mock("@/lib/file-audit", () => ({ logFileOperation: vi.fn() }));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
  reprepareWorkspace: vi.fn(),
  normalizeFileError: vi.fn((s: string) => s),
}));
vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
  terminalNotConfiguredResponse: vi.fn(() => null),
}));

import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { ensureWorkspaceAlive } from "@/lib/studio/workspace-recovery";

const authMock = vi.mocked(auth);
const verifyMock = vi.mocked(verifyProjectWorkspace);
const recoverMock = vi.mocked(ensureWorkspaceAlive);

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}
function upstream(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("studio-projects files route — 404 scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    verifyMock.mockResolvedValue({ workspaceId: "ws-1" } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST read: file-level 404 passes through WITHOUT workspace recovery", async () => {
    const fetchMock = vi.fn(async () => upstream(404, { error: "File not found" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      new Request("https://x.test/api/studio-projects/p1/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "read", path: "missing.html" }),
      }) as unknown as import("next/server").NextRequest,
      makeParams("p1"),
    );

    expect(res.status).toBe(404);
    expect(recoverMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POST read: workspace-level 404 triggers recovery and retries once", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(upstream(404, { error: "Workspace not found" }))
      .mockResolvedValueOnce(upstream(200, { content: "<html/>" }));
    vi.stubGlobal("fetch", fetchMock);
    recoverMock.mockResolvedValue({ reprepared: true, workspaceId: "ws-1b" } as never);

    const res = await POST(
      new Request("https://x.test/api/studio-projects/p1/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "read", path: "index.html" }),
      }) as unknown as import("next/server").NextRequest,
      makeParams("p1"),
    );

    expect(recoverMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("GET list: file-level 404 passes through WITHOUT workspace recovery", async () => {
    const fetchMock = vi.fn(async () => upstream(404, { error: "Path not found" }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new NextRequest("https://x.test/api/studio-projects/p1/files?path=sub"),
      makeParams("p1"),
    );

    expect(res.status).toBe(404);
    expect(recoverMock).not.toHaveBeenCalled();
  });
});
