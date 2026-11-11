import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));

vi.mock("@/lib/projects/project-repository", () => {
  class ProjectVerificationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = "ProjectVerificationError";
    }
  }
  return {
    verifyProjectWorkspace: vi.fn(() => Promise.resolve({ workspaceId: "ws-123" })),
    getProject: vi.fn(() => Promise.resolve(null)),
    ProjectVerificationError,
  };
});

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "tok", expiresAt: 9999999999 })),
}));

vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => "http://terminal:1234" ),
}));

const WELCOME_HTML = `<!-- LITT-WELCOME-SCREEN -->\n<h1>Welcome to LiTT</h1>`;
const REAL_HTML = `<h1>My Business</h1>`;

function mockTerminalReads(
  manifestContent: string | null,
  entryContent: string | null,
  gitCommitCount: number | null = null,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string; method?: string }) => {
      const urlStr = String(url);
      // git rev-list via the internal workspace exec API
      if (urlStr.includes("/internal/workspace/")) {
        if (gitCommitCount === null) {
          return { ok: false, status: 500, json: async () => ({ error: "no git" }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ exitCode: 0, stdout: String(gitCommitCount) }),
        };
      }
      // root file listing fallback
      if (init?.method !== "POST" && urlStr.includes("/ws-files?")) {
        return { ok: true, status: 200, json: async () => ({ entries: [] }) };
      }
      // file reads
      const body = JSON.parse(String(init?.body ?? "{}")) as { path?: string };
      const content = body.path === ".litt/scaffold.json" ? manifestContent : entryContent;
      if (content === null) {
        return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
      }
      return { ok: true, status: 200, json: async () => ({ content }) };
    }),
  );
}

describe("GET /api/studio-projects/[projectId]/workspace-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports scaffolded=true, touched=false, starterContent=true for a brand-new untouched project", async () => {
    mockTerminalReads(`{"files":[]}`, WELCOME_HTML, 1);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scaffolded: true, touched: false, starterContent: true });
  });

  it("reports touched=true for the P0-2 case (manifest consumed, second commit landed, marker kept)", async () => {
    // Manifest consumed by the first write and a second git commit landed,
    // but the edit was additive so the welcome marker is still in the entry.
    mockTerminalReads(null, `${WELCOME_HTML}\n<!-- acceptance-test -->`, 2);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scaffolded: false, touched: true, starterContent: true });
  });

  it("reports scaffolded=false, touched=true, starterContent=false for a real project", async () => {
    mockTerminalReads(null, REAL_HTML, 5);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scaffolded: false, touched: true, starterContent: false });
  });

  it("returns 401 when unauthenticated", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValueOnce({ userId: null } as never);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(401);
  });
});

describe("GET workspace-state — expected workspace refusals are not 500s (seam close)", () => {
  const HOST_EXEC_STORED =
    'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  async function callRoute() {
    const { GET } = await import("./route");
    return GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
  }

  it("returns 200 + fallback + codes when the workspace was never provisioned (host-exec refusal stored)", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(
      new repo.ProjectVerificationError("Workspace not provisioned", "WORKSPACE_NOT_PROVISIONED"),
    );
    vi.mocked(repo.getProject).mockResolvedValueOnce({
      id: "p1", userId: "user-123", workspaceStatus: "failed", workspaceError: HOST_EXEC_STORED,
    } as never);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scaffolded).toBe(false);
    expect(body.touched).toBe(false);
    expect(body.starterContent).toBe(false);
    expect(body.code).toBe("WORKSPACE_NOT_PROVISIONED");
    // The refusal code the preview pane consumes, recovered from the stored
    // error with the same extraction the project-runtime route uses.
    expect(body.workspaceErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("returns 200 + code with a null workspaceErrorCode for a non-host-exec not-ready workspace", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(
      new repo.ProjectVerificationError("Workspace not ready (current: provisioning)", "WORKSPACE_NOT_READY"),
    );
    vi.mocked(repo.getProject).mockResolvedValueOnce({
      id: "p1", userId: "user-123", workspaceStatus: "provisioning", workspaceError: null,
    } as never);

    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("WORKSPACE_NOT_READY");
    expect(body.workspaceErrorCode).toBeNull();
  });

  it("keeps genuinely unexpected verification errors at 500 with the old shape", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(new Error("supabase melted"));

    const res = await callRoute();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("supabase melted");
    expect(body.code).toBeUndefined();
    expect(body.scaffolded).toBe(false);
  });
});
