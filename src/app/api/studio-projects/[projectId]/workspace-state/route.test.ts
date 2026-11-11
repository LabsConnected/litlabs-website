import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(() => Promise.resolve({ workspaceId: "ws-123" })),
  getProject: vi.fn(() => Promise.resolve({ workspaceError: null })),
  // Mirrors the real class so the route's instanceof check works.
  ProjectVerificationError: class ProjectVerificationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = "ProjectVerificationError";
    }
  },
}));

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

  // Route honesty (console-errors diagnosis): "no workspace yet" is an
  // expected state, not a server fault — it must not return 500.
  it("maps WORKSPACE_NOT_PROVISIONED to a coded 200 with the fallback body", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(
      new repo.ProjectVerificationError("Workspace not provisioned", "WORKSPACE_NOT_PROVISIONED"),
    );
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: "WORKSPACE_NOT_PROVISIONED",
      workspaceErrorCode: null,
      scaffolded: false,
      touched: false,
      starterContent: false,
    });
  });

  // The preview pane's second truth channel (ART-20261111-024): the stored
  // workspaceError carries the terminal-server's refusal only as embedded
  // JSON text; the route recovers the machine code so the pane can render
  // the honest host-execution notice even when the preview payload itself
  // arrives code-less (Larry's production path).
  it("recovers the stored refusal code into workspaceErrorCode on the coded 200", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(
      new repo.ProjectVerificationError("Workspace not provisioned", "WORKSPACE_NOT_PROVISIONED"),
    );
    vi.mocked(repo.getProject).mockResolvedValueOnce({
      workspaceError:
        'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}',
    } as never);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("WORKSPACE_NOT_PROVISIONED");
    expect(body.workspaceErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("reports workspaceErrorCode null when the stored error carries no code", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(
      new repo.ProjectVerificationError("Workspace not ready", "WORKSPACE_NOT_READY"),
    );
    vi.mocked(repo.getProject).mockResolvedValueOnce({
      workspaceError: "Workspace preparation failed",
    } as never);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("WORKSPACE_NOT_READY");
    expect(body.workspaceErrorCode).toBeNull();
  });

  it("maps WORKSPACE_NOT_READY to a coded 200 with the fallback body", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(
      new repo.ProjectVerificationError("Workspace not ready", "WORKSPACE_NOT_READY"),
    );
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe("WORKSPACE_NOT_READY");
  });

  it("keeps unexpected verification failures at 500", async () => {
    const repo = await import("@/lib/projects/project-repository");
    vi.mocked(repo.verifyProjectWorkspace).mockRejectedValueOnce(new Error("db down"));
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(500);
  });
});
