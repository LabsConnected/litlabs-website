import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "test-user-id" })),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(() => Promise.resolve({ workspaceId: "test-workspace-id" })),
  getProject: vi.fn(() => Promise.resolve({ id: "test-project-id", name: "Test", userId: "test-user-id" })),
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "test-token" })),
}));

vi.mock("@/lib/file-audit", () => ({
  logFileOperation: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/missions/mission-repository", () => ({
  listCheckpoints: vi.fn(() => Promise.resolve([])),
  createCheckpoint: vi.fn(() => Promise.resolve({ id: "cp-1", projectId: "test-project-id", gitSha: "abc123", label: "Test" })),
  getCheckpoint: vi.fn(() => Promise.resolve({ id: "cp-1", projectId: "test-project-id", gitSha: "abc123", label: "Test", userId: "test-user-id" })),
}));

function createReq(url: string, method: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request(url, init);
}

describe("Project Files API", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("PUT returns 401 for unauthenticated requests", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as any);
    const { PUT } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "PUT", { path: "test.html", content: "test" });
    const response = await PUT(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(401);
  });

  it("DELETE returns 401 for unauthenticated requests", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as any);
    const { DELETE } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files?path=test.html", "DELETE");
    const response = await DELETE(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(401);
  });

  it("PUT returns 400 when path is missing", async () => {
    const { PUT } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "PUT", { content: "test" });
    const response = await PUT(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
  });

  it("DELETE returns 400 when path is missing", async () => {
    const { DELETE } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "DELETE");
    const response = await DELETE(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
  });

  it("PUT writes files through the verified API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { PUT } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "PUT", { path: "index.html", content: "<h1>Hello</h1>" });
    const response = await PUT(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/ws-files/write");
    fetchSpy.mockRestore();
  });

  it("DELETE deletes files through the verified API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { DELETE } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files?path=old-file.html", "DELETE");
    const response = await DELETE(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(200);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/ws-files/delete");
    fetchSpy.mockRestore();
  });
});

describe("Checkpoint Rollback API", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("POST rollback returns 401 for unauthenticated requests", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as any);
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(401);
  });

  it("POST rollback returns 404 for non-existent checkpoint", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce(null as any);
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-missing/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-missing" }) });
    expect(response.status).toBe(404);
  });

  it("POST rollback returns 403 when checkpoint belongs to different project", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce({ id: "cp-1", projectId: "different-project", gitSha: "abc123", label: "Test", userId: "test-user-id" } as any);
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(403);
  });

  it("POST rollback returns 400 when confirm is missing", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce({ id: "cp-1", projectId: "proj-1", gitSha: "abc123def456", label: "Test", userId: "test-user-id" } as any);
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", {});
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("confirmation");
  });

  it("POST rollback returns 400 for invalid gitSha format", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce({ id: "cp-1", projectId: "proj-1", gitSha: "../../etc/passwd", label: "Bad", userId: "test-user-id" } as any);
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid checkpoint git SHA");
  });
});