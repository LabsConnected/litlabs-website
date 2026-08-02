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

  it("PUT rejects path traversal (../)", async () => {
    const { PUT } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "PUT", { path: "../../../etc/passwd", content: "evil" });
    const response = await PUT(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
  });

  it("PUT rejects absolute paths", async () => {
    const { PUT } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "PUT", { path: "/etc/passwd", content: "evil" });
    const response = await PUT(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
  });

  it("PUT rejects null bytes in path", async () => {
    const { PUT } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "PUT", { path: "safe.txt\0../../etc/passwd", content: "evil" });
    const response = await PUT(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
  });

  it("DELETE rejects path traversal (../)", async () => {
    const { DELETE } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files?path=../../../etc/passwd", "DELETE");
    const response = await DELETE(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
  });

  it("DELETE rejects absolute paths", async () => {
    const { DELETE } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files?path=/etc/passwd", "DELETE");
    const response = await DELETE(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
  });

  it("POST read rejects path traversal", async () => {
    const { POST } = await import("@/app/api/studio-projects/[projectId]/files/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/files", "POST", { action: "read", path: "../../secret" });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(response.status).toBe(400);
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

  it("POST rollback returns 503 when terminal service key is missing", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce({ id: "cp-1", projectId: "proj-1", gitSha: "abc123def456", label: "Test", userId: "test-user-id" } as any);
    const originalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(503);
    if (originalKey) process.env.TERMINAL_INTERNAL_SERVICE_KEY = originalKey;
  });

  it("POST rollback returns 500 when git reset fails and does not run git clean", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce({ id: "cp-1", projectId: "proj-1", gitSha: "abc123def456", label: "Test", userId: "test-user-id" } as any);
    const originalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "a".repeat(32);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // First call: git ls-files succeeds, second: git reset fails
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 0, stdout: "index.html\n", stderr: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 1, stdout: "", stderr: "fatal: bad ref" }), { status: 200 }));
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(500);
    // Only 2 fetch calls: ls-files + reset. Clean should NOT have been called.
    expect(fetchSpy.mock.calls.length).toBe(2);
    fetchSpy.mockRestore();
    if (originalKey) process.env.TERMINAL_INTERNAL_SERVICE_KEY = originalKey;
    else delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
  });

  it("POST rollback succeeds and returns file summary", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce({ id: "cp-1", projectId: "proj-1", gitSha: "abc123def456", label: "Test", userId: "test-user-id" } as any);
    const originalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "a".repeat(32);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // ls-files (before), reset, clean, ls-files (after)
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 0, stdout: "index.html\nold.html\n", stderr: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 0, stdout: "", stderr: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 0, stdout: "index.html\n", stderr: "" }), { status: 200 }));
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.summary.deletedFiles).toEqual(["old.html"]);
    expect(data.summary.beforeCount).toBe(2);
    expect(data.summary.afterCount).toBe(1);
    fetchSpy.mockRestore();
    if (originalKey) process.env.TERMINAL_INTERNAL_SERVICE_KEY = originalKey;
    else delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
  });

  it("POST rollback fails (500) when git clean returns nonzero exitCode — no false success", async () => {
    const { getCheckpoint } = await import("@/lib/missions/mission-repository");
    vi.mocked(getCheckpoint).mockResolvedValueOnce({ id: "cp-1", projectId: "proj-1", gitSha: "abc123def456", label: "Test", userId: "test-user-id" } as any);
    const originalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = "a".repeat(32);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // ls-files (before) OK, reset OK, clean FAILS (exitCode 1).
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 0, stdout: "index.html\n", stderr: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 0, stdout: "HEAD is now at abc123", stderr: "" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ exitCode: 1, stdout: "", stderr: "clean failed" }), { status: 200 }));
    const { POST } = await import("@/app/api/studio-projects/[projectId]/checkpoints/[checkpointId]/route");
    const req = createReq("http://localhost/api/studio-projects/proj-1/checkpoints/cp-1/rollback", "POST", { confirm: true });
    const response = await POST(req as any, { params: Promise.resolve({ projectId: "proj-1", checkpointId: "cp-1" }) });
    expect(response.status).toBe(500);
    const data = await response.json();
    // Explicit no-false-success: a failed clean must never look like a rollback.
    expect(data.ok).not.toBe(true);
    expect(data.error).toMatch(/exit 1|clean failed|git clean/i);
    // Only 3 fetch calls: ls-files + reset + clean. The after-ls-files must NOT run.
    expect(fetchSpy.mock.calls.length).toBe(3);
    fetchSpy.mockRestore();
    if (originalKey) process.env.TERMINAL_INTERNAL_SERVICE_KEY = originalKey;
    else delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
  });
});

describe("CanvasTool loadServerFiles (regression: saved files must reload)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("parses the {name,type} directory listing and fetches content per file", async () => {
    // The terminal-server /ws-files GET returns entries with {name, type} only —
    // NOT {path, content}. The old code read e.path/e.content and crashed on
    // `e.path.split("/")` because path was undefined. This test proves the fix.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = String(typeof input === "string" ? input : input.url);
      const method = init?.method ?? (typeof input === "object" && input ? input.method : undefined);
      if (url.includes("/files") && (method === undefined || method === "GET")) {
        return new Response(
          JSON.stringify({
            entries: [
              { name: "index.html", type: "file" },
              { name: "style.css", type: "file" },
              { name: "node_modules", type: "folder" },
              { name: "readme.md", type: "file" },
            ],
            workspaceId: "ws-1",
          }),
          { status: 200 },
        );
      }
      const raw = init?.body ?? "";
      const parsed = (() => { try { return JSON.parse(raw); } catch { return {}; } })();
      const path: string = parsed.path ?? "";
      const contentMap: Record<string, string> = {
        "index.html": "<h1>Hello</h1>",
        "style.css": "body { color: red; }",
        "readme.md": "# Project",
      };
      return new Response(JSON.stringify({ content: contentMap[path] ?? "" }), { status: 200 });
    });

    const { loadServerFiles } = await import("@/app/studio/tools/CanvasTool");
    const files = await loadServerFiles("proj-1");

    expect(files).toHaveLength(3); // node_modules folder excluded
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(["index.html", "readme.md", "style.css"]);
    const indexFile = files.find((f) => f.name === "index.html");
    expect(indexFile?.content).toBe("<h1>Hello</h1>");
    expect(indexFile?.language).toBe("html");
    const cssFile = files.find((f) => f.name === "style.css");
    expect(cssFile?.content).toBe("body { color: red; }");
    expect(cssFile?.language).toBe("css");

    // Verify the read endpoint was hit for each file (proves content is loaded,
    // not just the directory listing).
    const readCalls = fetchSpy.mock.calls.filter((c) => {
      const init = c[1] as RequestInit | undefined;
      return init?.method === "POST";
    });
    expect(readCalls.length).toBe(3);
    fetchSpy.mockRestore();
  });

  it("returns [] when the project has no saved files (no crash on undefined path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ entries: [], workspaceId: "ws-1" }), { status: 200 }),
    );
    const { loadServerFiles } = await import("@/app/studio/tools/CanvasTool");
    const files = await loadServerFiles("proj-empty");
    expect(files).toEqual([]);
    vi.spyOn(globalThis, "fetch").mockRestore();
  });

  it("returns [] when the listing endpoint fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    const { loadServerFiles } = await import("@/app/studio/tools/CanvasTool");
    const files = await loadServerFiles("proj-fail");
    expect(files).toEqual([]);
    vi.spyOn(globalThis, "fetch").mockRestore();
  });
});