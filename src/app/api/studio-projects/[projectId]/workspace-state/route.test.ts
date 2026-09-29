import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(() => Promise.resolve({ workspaceId: "ws-123" })),
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "tok", expiresAt: 9999999999 })),
}));

vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => "http://terminal:1234"),
}));

const WELCOME_HTML = `<!-- LITT-WELCOME-SCREEN -->\n<h1>Welcome to LiTT</h1>`;
const REAL_HTML = `<h1>My Business</h1>`;

function mockTerminalReads(manifestContent: string | null, entryContent: string | null) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { path?: string };
    const content = body.path === ".litt/scaffold.json" ? manifestContent : entryContent;
    if (content === null) {
      return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
    }
    return { ok: true, status: 200, json: async () => ({ content }) };
  }));
}

describe("GET /api/studio-projects/[projectId]/workspace-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports scaffolded=true + starterContent=true for a brand-new untouched project", async () => {
    mockTerminalReads(`{"files":[]}`, WELCOME_HTML);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scaffolded: true, starterContent: true });
  });

  it("reports scaffolded=false + starterContent=true for the P0-2 case (touched but still starter)", async () => {
    // Manifest consumed by the first write, but the edit was additive so the
    // welcome marker is still in the entry file.
    mockTerminalReads(null, `${WELCOME_HTML}\n<!-- acceptance-test -->`);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scaffolded: false, starterContent: true });
  });

  it("reports scaffolded=false + starterContent=false for a real project", async () => {
    mockTerminalReads(null, REAL_HTML);
    const { GET } = await import("./route");
    const res = await GET(
      new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
      { params: Promise.resolve({ projectId: "p1" }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scaffolded: false, starterContent: false });
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
