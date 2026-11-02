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

vi.mock("@/lib/projects/preview-token", () => ({
  createPreviewToken: vi.fn(() => ({ token: "preview-token-1", expiresAt: Date.now() + 60000 })),
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
import { getProject } from "@/lib/projects/project-repository";import { startPreviewInternal,
  getPreviewStatusInternal,
} from "@/lib/terminal-internal-client";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";
import { createPreviewToken } from "@/lib/projects/preview-token";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const getPreviewStatusMock = vi.mocked(getPreviewStatusInternal);
const startPreviewMock = vi.mocked(startPreviewInternal);
const provisionMock = vi.mocked(provisionWorkspaceForProject);
const createPreviewTokenMock = vi.mocked(createPreviewToken);

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

  it("GET returns ready + static URL with a project-scoped preview token", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _opts?: RequestInit) =>
      new Response(JSON.stringify({ content: "<html></html>" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // The real preview-token module throws when TERMINAL_AUTH_SECRET is unset,
    // so this test proves the static path still reaches ready when the terminal
    // returns a real index.html blob. prove that readiness no longer depends on
    // the dev-server status path even when the token-bearing previewUrl would
    // only have been set by a prior regression that consulted getPreviewStatusInternal.
    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("ready");
    expect(body.previewUrl).toBe("/api/preview/proj-1/t/preview-token-1/index.html");
    expect(body.previewToken).toBe("preview-token-1");
    expect(body.previewTokenExpiresAt).toBeGreaterThan(Date.now());
    expect(body.previewTokenExpiresAt).toBeLessThanOrEqual(Date.now() + 60000);
    expect(body.framework).toBe("static");
    // The index.html existence check fires exactly once; the dev-server
    // status path is never consulted for static projects.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/ws-files/read");
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
    expect(createPreviewTokenMock).toHaveBeenCalledTimes(1);
    expect(createPreviewTokenMock).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ projectId: "proj-1", workspaceId: "ws-1", assets: ["index.html"] }),
    );
  });

  it("GET returns not_started when the terminal is unreachable", async () => {
    // The static GET path regressed to waiting on the terminal service before
    // returning static preview URLs. Prove that a missing terminal now returns
    // not_started and does not call the dev-server status path.
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("TerminalNotConfiguredError");
    }));

    const res = await GET(
      new Request("https://x.test/api/studio-projects/proj-1/preview") as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("not_started");
    expect(body.previewUrl).toBeNull();
    expect(body.framework).toBe("static");
    expect(getPreviewStatusMock).not.toHaveBeenCalled();
    // TerminalNotConfiguredError must not leave the studio panel stuck loading.
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
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
    // Without a ready static payload we must not mint or embed a preview
    // token — there is no instrumented document to honor the bridge.
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
  });

  it("POST for static projects never returns a preview token", async () => {
    // Static projects reject dev-server startup at the API boundary, so
    // the POST path must not mint a static preview token either.
    const res = await POST(
      new Request("https://x.test/api/studio-projects/proj-1/preview", { method: "POST" }) as unknown as import("next/server").NextRequest,
      makeParams("proj-1"),
    );
    expect(res.status).toBe(400);
    expect(createPreviewTokenMock).not.toHaveBeenCalled();
  });
});
