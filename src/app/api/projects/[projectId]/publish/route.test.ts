import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/projects/[projectId]/publish/route";

/**
 * P0 — Static Publishing API: route-level tests.
 *
 * Proves the publish endpoint enforces Clerk auth + project ownership,
 * delegates to the deploy pipeline, handles unpublish, and spawns
 * zero subprocesses. All Gate 1 guards remain intact.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
}));

vi.mock("@/lib/deployments/deployment-store", () => ({
  listLatestDeploymentsForUser: vi.fn(),
  supabaseDeploymentStore: {},
}));

vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(),
}));

vi.mock("@/lib/deployments/deploy-service", () => ({
  deployUserProject: vi.fn(),
  unpublishDeployment: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { listLatestDeploymentsForUser } from "@/lib/deployments/deployment-store";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { deployUserProject, unpublishDeployment } from "@/lib/deployments/deploy-service";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const listDeploymentsMock = vi.mocked(listLatestDeploymentsForUser);
const createTransportMock = vi.mocked(createWorkspaceTransport);
const deployMock = vi.mocked(deployUserProject);
const unpublishMock = vi.mocked(unpublishDeployment);

const childProcessSpies: Array<{ mockRestore(): void; mockClear(): void }> = [];

function spyOnChildProcess() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("node:child_process") as typeof import("node:child_process");
  for (const m of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    childProcessSpies.push(vi.spyOn(cp, m) as unknown as { mockRestore(): void; mockClear(): void });
  }
}

function assertZeroSubprocesses() {
  for (const spy of childProcessSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
}

function makeParams(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function makeRequest(method: string, body?: unknown): NextRequest {
  return new NextRequest(`https://test.local/api/projects/proj-1/publish`, {
    method,
    ...(body !== undefined
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  spyOnChildProcess();
  authMock.mockResolvedValue({ userId: "user-1" } as never);
  getProjectMock.mockResolvedValue({ id: "proj-1", name: "Test" } as never);
});

afterEach(() => {
  for (const spy of childProcessSpies) spy.mockRestore();
  childProcessSpies.length = 0;
  vi.unstubAllGlobals();
});

describe("GET /api/projects/[projectId]/publish", () => {
  it("returns 401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null } as never);
    const res = await GET(makeRequest("GET"), makeParams("proj-1"));
    expect(res.status).toBe(401);
    assertZeroSubprocesses();
  });

  it("returns 404 for non-owned project (no ownership oracle)", async () => {
    getProjectMock.mockResolvedValue(null);
    const res = await GET(makeRequest("GET"), makeParams("proj-1"));
    expect(res.status).toBe(404);
    // Deployment store must NOT be queried for non-owners.
    expect(listDeploymentsMock).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("returns published=true with live URL when deployment is ready", async () => {
    listDeploymentsMock.mockResolvedValue([
      {
        id: "dep-1",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        status: "ready",
        target: "litt-hosting",
        publicUrl: "https://example.litt.host/sites/dep-1",
        urlVerified: true,
        fileCount: 3,
        totalBytes: 1024,
        contentHash: "abc",
        errorClass: null,
        errorMessage: null,
      },
    ]);
    const res = await GET(makeRequest("GET"), makeParams("proj-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.published).toBe(true);
    expect(data.deployment.publicUrl).toBe("https://example.litt.host/sites/dep-1");
    assertZeroSubprocesses();
  });

  it("returns published=false when no deployment exists", async () => {
    listDeploymentsMock.mockResolvedValue([]);
    const res = await GET(makeRequest("GET"), makeParams("proj-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.published).toBe(false);
    expect(data.deployment).toBeNull();
    assertZeroSubprocesses();
  });

  it("hides publicUrl for non-ready deployments", async () => {
    listDeploymentsMock.mockResolvedValue([
      {
        id: "dep-2",
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        status: "failed",
        target: "litt-hosting",
        publicUrl: "https://example.litt.host/sites/dep-2",
        urlVerified: false,
        fileCount: 0,
        totalBytes: 0,
        contentHash: null,
        errorClass: "build",
        errorMessage: "boom",
      },
    ]);
    const res = await GET(makeRequest("GET"), makeParams("proj-1"));
    const data = await res.json();
    expect(data.published).toBe(false);
    expect(data.deployment.publicUrl).toBeNull();
    assertZeroSubprocesses();
  });
});

describe("POST /api/projects/[projectId]/publish", () => {
  it("returns 401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null } as never);
    const res = await POST(makeRequest("POST"), makeParams("proj-1"));
    expect(res.status).toBe(401);
    expect(createTransportMock).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("returns 404 for non-owned project", async () => {
    getProjectMock.mockResolvedValue(null);
    const res = await POST(makeRequest("POST"), makeParams("proj-1"));
    expect(res.status).toBe(404);
    expect(deployMock).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("publishes and returns the verified public URL", async () => {
    const fakeTransport = { userId: "user-1", projectId: "proj-1", workspaceId: "ws-1" };
    createTransportMock.mockResolvedValue(fakeTransport as never);
    deployMock.mockResolvedValue({
      ok: true,
      deploymentId: "dep-9",
      status: "ready",
      publicUrl: "https://example.litt.host/sites/dep-9",
      urlVerified: true,
      target: "litt-hosting",
      projectId: "proj-1",
      workspaceId: "ws-1",
      fileCount: 5,
      totalBytes: 2048,
      reused: false,
    });
    const res = await POST(makeRequest("POST"), makeParams("proj-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.published).toBe(true);
    expect(data.publicUrl).toBe("https://example.litt.host/sites/dep-9");
    // Transport built for the authenticated owner.
    expect(createTransportMock).toHaveBeenCalledWith("proj-1", "user-1");
    assertZeroSubprocesses();
  });

  it("returns 502 with detail when deploy fails", async () => {
    createTransportMock.mockResolvedValue({ userId: "user-1", projectId: "proj-1", workspaceId: "ws-1" } as never);
    deployMock.mockResolvedValue({
      ok: false,
      deploymentId: null,
      status: "failed",
      publicUrl: null,
      errorClass: "hosting",
      message: "Hosting not configured.",
      retryable: false,
    });
    const res = await POST(makeRequest("POST"), makeParams("proj-1"));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe("Publish failed.");
    assertZeroSubprocesses();
  });

  it("returns 409 when workspace provisioning fails", async () => {
    createTransportMock.mockRejectedValue(new Error("workspace unavailable"));
    const res = await POST(makeRequest("POST"), makeParams("proj-1"));
    expect(res.status).toBe(409);
    expect(deployMock).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });
});

describe("DELETE /api/projects/[projectId]/publish", () => {
  it("returns 401 without auth", async () => {
    authMock.mockResolvedValue({ userId: null } as never);
    const res = await DELETE(makeRequest("DELETE", { deploymentId: "dep-1" }), makeParams("proj-1"));
    expect(res.status).toBe(401);
    expect(unpublishMock).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("returns 400 without deploymentId", async () => {
    const res = await DELETE(makeRequest("DELETE", {}), makeParams("proj-1"));
    expect(res.status).toBe(400);
    assertZeroSubprocesses();
  });

  it("unpublishes and confirms", async () => {
    unpublishMock.mockResolvedValue({ ok: true, deploymentId: "dep-1", message: "unpublished" });
    const res = await DELETE(makeRequest("DELETE", { deploymentId: "dep-1" }), makeParams("proj-1"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unpublished).toBe(true);
    expect(unpublishMock).toHaveBeenCalledWith(
      { userId: "user-1", projectId: "proj-1", deploymentId: "dep-1" },
      expect.anything(),
    );
    assertZeroSubprocesses();
  });

  it("maps Forbidden to 403", async () => {
    unpublishMock.mockResolvedValue({ ok: false, deploymentId: "dep-1", message: "Forbidden: you do not own this deployment." });
    const res = await DELETE(makeRequest("DELETE", { deploymentId: "dep-1" }), makeParams("proj-1"));
    expect(res.status).toBe(403);
    assertZeroSubprocesses();
  });
});
