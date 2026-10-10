import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GET,
  POST,
} from "@/app/api/studio-projects/[projectId]/preview/route";

/**
 * P0 — AI Build → Static Preview: studio-projects preview route-level tests.
 *
 * Proves the static-project server-side guards:
 *  1. POST rejects static projects at the API boundary (no dev server startup).
 *  2. GET returns ready + a static preview URL for static projects WITHOUT
 *     consulting the dev-server status path (getPreviewStatusInternal).
 *  3. GET returns not_started when index.html is missing from the workspace.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
  updateProjectRuntime: vi.fn(),
}));

vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
  provisionWorkspaceForProject: vi.fn(),
}));

vi.mock("@/lib/terminal-v1/secret-broker", () => ({
  SecretBroker: vi.fn(),
}));

vi.mock("@/lib/preview-clerk-env", () => ({
  extractClerkEnvFromSecrets: vi.fn(() => ({})),
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "test-token", expiresAt: Date.now() + 60000 })),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));

vi.mock("@/lib/terminal-internal-client", () => ({
  startPreviewInternal: vi.fn(),
  getPreviewStatusInternal: vi.fn(),
  stopPreviewInternal: vi.fn(),
  buildPreviewProxyUrl: vi.fn((workspaceId: string) => `https://proxy.test/${workspaceId}`),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import {
  startPreviewInternal,
  getPreviewStatusInternal,
} from "@/lib/terminal-internal-client";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const getPreviewStatusMock = vi.mocked(getPreviewStatusInternal);
const startPreviewMock = vi.mocked(startPreviewInternal);
const provisionMock = vi.mocked(provisionWorkspaceForProject);

const staticProject = {
  id: "proj-1",
  userId: "user-1",
  workspaceId: "ws-1",
  framework: "static",
};

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe("studio-projects preview route — static guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ ...staticProject } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POST returns 400 for framework: static (server-side guard)", async () => {
    const res = await POST(
      new Request("https://x.test/api/studio-projects/proj-1/preview", { method: "POST" }) as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Static projects");
    // The dev-server machinery must never engage for static projects.
    expect(provisionMock).not.toHaveBeenCalled();
    expect(startPreviewMock).not.toHaveBeenCalled();
  });

  it("GET returns ready + static URL without calling dev-server status", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: "<html></html>" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("ready");
    expect(body.previewUrl).toBe("/api/preview/proj-1/index.html");
    expect(body.framework).toBe("static");
    // The index.html existence check fires exactly once; the dev-server
    // status path is never consulted for static projects.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/ws-files/read");
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
  });

  it("GET returns not_started when index.html is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
    );

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.previewUrl).toBeNull();
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
  });
});
