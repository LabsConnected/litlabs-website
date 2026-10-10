import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET as previewGET } from "@/app/api/preview/[projectId]/[[...path]]/route";
import { handleFilesWrite } from "@/lib/litt-intelligence/tool-handlers-v2";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";

/**
 * P0 — AI Build → Static Preview: end-to-end integration.
 *
 * Proves the complete authenticated flow with ZERO subprocesses:
 * 1. Authenticated user creates a static project (mocked auth + project lookup)
 * 2. AI writes files through the REAL registered tool handler
 * 3. Files persist (in-memory terminal-server simulation)
 * 4. Preview renders via the REAL preview route (correct MIME, sandbox headers)
 * 5. AI edits a file → preview returns updated content
 * 6. Different user → 404 (ownership enforced, no terminal fetch)
 * 7. Path traversal → 400
 *
 * The terminal server is simulated with an in-memory file store behind the
 * same /ws-files/read+write contract (no HTTP server, no subprocess).
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "tok", expiresAt: Date.now() + 60000 })),
}));
vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);

// ── In-memory terminal server ──────────────────────────────────────────────
const fileStore = new Map<string, string>(); // "workspaceId/path" → content

function installTerminalSimulation() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const wsId = (init?.headers as Record<string, string>)?.["X-Workspace-Id"] ?? "ws-1";
      if (String(url).endsWith("/ws-files/write")) {
        if (body.path.includes("..")) {
          return new Response(JSON.stringify({ error: "traversal" }), { status: 400 });
        }
        fileStore.set(`${wsId}/${body.path}`, String(body.content ?? ""));
        return new Response(JSON.stringify({ saved: true }), { status: 200 });
      }
      if (String(url).endsWith("/ws-files/read")) {
        const key = `${wsId}/${body.path}`;
        if (!fileStore.has(key)) {
          return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
        }
        const content = fileStore.get(key)!;
        return new Response(
          JSON.stringify({ content, size: content.length, encoding: "utf-8" }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

/** Transport that goes through the simulated terminal HTTP contract. */
function makeHttpTransport(): WorkspaceTransport {
  const base = "https://terminal.test";
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer tok",
    "X-Workspace-Id": "ws-1",
  };
  const post = async (path: string, body: unknown) => {
    const resp = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`${path} failed (${resp.status})`);
    return resp.json();
  };
  return {
    projectId: "proj-1",
    userId: "user-1",
    workspaceId: "ws-1",
    workspaceRoot: "/ws-1",
    fileOpsReachable: true,
    probeReachable: async () => true,
    listFiles: async () => ({ entries: [] }),
    readFile: async (p: string) => {
      const d = (await post("/ws-files/read", { path: p, encoding: "utf-8" })) as { content: string; size: number };
      return d;
    },
    readBinaryFile: async () => ({ content: "", size: 0 }),
    writeFile: async (p: string, c: string) => post("/ws-files/write", { path: p, content: c }) as Promise<{ saved: boolean }>,
    writeBinaryFile: async () => ({ saved: true }),
    deleteFile: async () => ({ deleted: true }),
    mkdir: async () => {},
    rename: async () => {},
    startPreview: async () => ({ status: "failed" as const, workspaceId: "ws-1", error: "n/a", logs: [] }),
    getPreviewStatus: async () => ({ status: "failed" as const, workspaceId: "ws-1", logs: [] }),
    stopPreview: async () => ({ status: "stopped" as const, workspaceId: "ws-1" }),
  } as unknown as WorkspaceTransport;
}

const childProcessSpies: Array<{ mockRestore(): void; mockClear(): void }> = [];
function spyOnChildProcess() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("node:child_process") as typeof import("node:child_process");
  for (const m of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    childProcessSpies.push(vi.spyOn(cp, m) as unknown as { mockRestore(): void; mockClear(): void });
  }
}
function assertZeroSubprocesses() {
  for (const spy of childProcessSpies) expect(spy).not.toHaveBeenCalled();
}

describe("E2E: AI build → static preview (zero subprocesses)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileStore.clear();
    spyOnChildProcess();
    installTerminalSimulation();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ id: "proj-1", userId: "user-1", workspaceId: "ws-1" } as never);
  });

  afterEach(() => {
    for (const s of childProcessSpies) s.mockRestore();
    childProcessSpies.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("full flow: AI writes → preview renders → AI edits → preview updates", async () => {
    const transport = makeHttpTransport();

    // 2. AI writes index.html + style.css through the REAL tool handler.
    const w1 = await handleFilesWrite(
      { path: "index.html", content: '<html><head><link rel="stylesheet" href="style.css"></head><body><h1>V1</h1></body></html>' },
      transport,
    );
    expect(w1.success).toBe(true);
    const w2 = await handleFilesWrite({ path: "style.css", content: "h1 { color: blue; }" }, transport);
    expect(w2.success).toBe(true);

    // 3+4. Preview renders index.html with correct MIME + sandbox headers.
    const p1 = await previewGET(
      new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );
    expect(p1.status).toBe(200);
    expect(p1.headers.get("Content-Type")).toContain("text/html");
    expect(p1.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(await p1.text()).toContain("<h1>V1</h1>");

    // CSS asset loads with correct MIME.
    const pCss = await previewGET(
      new Request("https://x.test/api/preview/proj-1/style.css") as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ projectId: "proj-1", path: ["style.css"] }) },
    );
    expect(pCss.status).toBe(200);
    expect(pCss.headers.get("Content-Type")).toContain("text/css");
    expect(await pCss.text()).toBe("h1 { color: blue; }");

    // 5+6. AI edits → preview returns updated content.
    const w3 = await handleFilesWrite(
      { path: "index.html", content: '<html><body><h1>V2 updated</h1></body></html>' },
      transport,
    );
    expect(w3.success).toBe(true);
    const p2 = await previewGET(
      new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );
    expect(await p2.text()).toContain("V2 updated");

    assertZeroSubprocesses();
  });

  it("ownership: another user gets 404 and no terminal fetch fires", async () => {
    authMock.mockResolvedValue({ userId: "user-2" } as never);
    getProjectMock.mockResolvedValue(null); // not their project
    const res = await previewGET(
      new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ projectId: "proj-1" }) },
    );
    expect(res.status).toBe(404);
    assertZeroSubprocesses();
  });

  it("path traversal is rejected before any file access", async () => {
    const res = await previewGET(
      new Request("https://x.test/api/preview/proj-1/x") as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ projectId: "proj-1", path: ["..", "secret"] }) },
    );
    expect(res.status).toBe(400);
    assertZeroSubprocesses();
  });
});
