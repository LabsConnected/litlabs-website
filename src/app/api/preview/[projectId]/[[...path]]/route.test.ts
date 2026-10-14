import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/preview/[projectId]/[[...path]]/route";

/**
 * P0 — AI Build → Static Preview: route-level tests.
 *
 * Proves the preview endpoint enforces ownership, rejects path traversal,
 * serves correct MIME types, applies sandbox isolation headers, and spawns
 * zero subprocesses (pure fetch + response, no dev server).
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "test-token", expiresAt: Date.now() + 60000 })),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { createPreviewToken, verifyPreviewToken } from "@/lib/projects/preview-token";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);

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

function makeParams(projectId: string, path?: string[]) {
  return { params: Promise.resolve({ projectId, path }) };
}

function mockTerminalFile(content: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ content, size: content.length, encoding: "utf-8" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

describe("GET /api/preview/[projectId]/[[...path]]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spyOnChildProcess();
    // The real preview-token module signs with TERMINAL_AUTH_SECRET; the
    // route has always required this secret (createTerminalToken throws
    // without it), so the suite provides one.
    vi.stubEnv("TERMINAL_AUTH_SECRET", "route-test-secret-with-at-least-32-chars");
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({
      id: "proj-1",
      userId: "user-1",
      workspaceId: "ws-1",
    } as never);
    mockTerminalFile("<h1>Hello</h1>");
  });

  afterEach(() => {
    for (const spy of childProcessSpies) spy.mockRestore();
    childProcessSpies.length = 0;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("serves index.html for empty path with HTML MIME type", async () => {
    const res = await GET(new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest, makeParams("proj-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(await res.text()).toBe("<h1>Hello</h1>");
    assertZeroSubprocesses();
  });

  it("serves CSS with correct MIME type", async () => {
    mockTerminalFile("body {}");
    const res = await GET(
      new Request("https://x.test/api/preview/proj-1/assets/style.css") as unknown as import("next/server").NextRequest,
      makeParams("proj-1", ["assets", "style.css"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/css");
    assertZeroSubprocesses();
  });

  it("serves JS with correct MIME type", async () => {
    mockTerminalFile("console.log(1)");
    const res = await GET(
      new Request("https://x.test/api/preview/proj-1/app.js") as unknown as import("next/server").NextRequest,
      makeParams("proj-1", ["app.js"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    assertZeroSubprocesses();
  });

  it("applies sandbox isolation headers", async () => {
    const res = await GET(new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest, makeParams("proj-1"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    // Opaque origin: user content cannot touch LiTT cookies/storage/DOM.
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("allow-same-origin");
    // Regression: default-src must use EXPLICIT origins, never bare 'self'.
    // The iframe sandbox omits allow-same-origin (opaque origin), and per the
    // CSP spec 'self' never matches subresource URLs from an opaque origin —
    // bare 'self' would silently block relative assets (style.css, app.js,
    // images) and render multi-file sites unstyled/broken.
    expect(csp).toContain("https://www.litlabs.net");
    expect(csp).not.toMatch(/default-src 'self'/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    assertZeroSubprocesses();
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.mockResolvedValue({ userId: null } as never);
    const res = await GET(new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest, makeParams("proj-1"));
    expect(res.status).toBe(401);
    assertZeroSubprocesses();
  });

  it("returns 404 when the user does not own the project", async () => {
    getProjectMock.mockResolvedValue(null);
    const res = await GET(new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest, makeParams("proj-1"));
    expect(res.status).toBe(404);
    // Terminal fetch must never fire for a project the user doesn't own.
    expect(global.fetch).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("rejects path traversal (..)", async () => {
    const res = await GET(
      new Request("https://x.test/api/preview/proj-1/..") as unknown as import("next/server").NextRequest,
      makeParams("proj-1", [".."]),
    );
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("rejects backslash traversal", async () => {
    const res = await GET(
      new Request("https://x.test/api/preview/proj-1/a") as unknown as import("next/server").NextRequest,
      makeParams("proj-1", ["a\\b"]),
    );
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("returns 404 when the file does not exist in the workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
    );
    const res = await GET(
      new Request("https://x.test/api/preview/proj-1/missing.html") as unknown as import("next/server").NextRequest,
      makeParams("proj-1", ["missing.html"]),
    );
    expect(res.status).toBe(404);
    assertZeroSubprocesses();
  });

  it("returns 409 when the workspace is not provisioned", async () => {
    getProjectMock.mockResolvedValue({ id: "proj-1", userId: "user-1", workspaceId: null } as never);
    const res = await GET(new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest, makeParams("proj-1"));
    expect(res.status).toBe(409);
    expect(global.fetch).not.toHaveBeenCalled();
    assertZeroSubprocesses();
  });

  it("serves binary PNG bytes without corruption (base64 round-trip)", async () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const base64Content = pngBytes.toString("base64");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, opts) => {
        const body = JSON.parse((opts as RequestInit).body as string);
        expect(body.encoding).toBe("base64");
        return new Response(JSON.stringify({ content: base64Content }), { status: 200 });
      }),
    );
    const res = await GET(
      new Request("https://x.test/api/preview/proj-1/logo.png") as unknown as import("next/server").NextRequest,
      makeParams("proj-1", ["logo.png"]),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.equals(pngBytes)).toBe(true);
    assertZeroSubprocesses();
  });

  it("serves root path as index.html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, opts) => {
        const body = JSON.parse((opts as RequestInit).body as string);
        expect(body.path).toBe("index.html");
        return new Response(JSON.stringify({ content: "<html></html>" }), { status: 200 });
      }),
    );
    const res = await GET(
      new Request("https://x.test/api/preview/proj-1") as unknown as import("next/server").NextRequest,
      makeParams("proj-1", []),
    );
    expect(res.status).toBe(200);
    assertZeroSubprocesses();
  });

  describe("capability token (opaque-origin asset requests)", () => {
    // The preview-token module is intentionally NOT mocked: these tests
    // exercise the real HMAC signing/verification end to end at route level.
    beforeEach(() => {
      vi.stubEnv("TERMINAL_AUTH_SECRET", "route-test-secret-with-at-least-32-chars");
      authMock.mockResolvedValue({ userId: null } as never);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    function tokenFor(overrides: { userId?: string; projectId?: string; workspaceId?: string; ttl?: number } = {}) {
      return createPreviewToken(overrides.userId ?? "user-1", {
        projectId: overrides.projectId ?? "proj-1",
        workspaceId: overrides.workspaceId ?? "ws-1",
      }, overrides.ttl ?? 300).token;
    }

    it("serves an asset to a valid scoped token without a session", async () => {
      mockTerminalFile("window.ok = true;");
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/app.js") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", tokenFor(), "app.js"]),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("window.ok = true;");
      assertZeroSubprocesses();
    });

    it("rejects a token scoped to a different project", async () => {
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/app.js") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", tokenFor({ projectId: "proj-2" }), "app.js"]),
      );
      expect(res.status).toBe(403);
    });

    it("rejects a token scoped to a different workspace", async () => {
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/app.js") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", tokenFor({ workspaceId: "ws-2" }), "app.js"]),
      );
      expect(res.status).toBe(403);
    });

    it("rejects a malformed token and an expired token", async () => {
      const malformed = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/app.js") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", "garbage.token", "app.js"]),
      );
      expect(malformed.status).toBe(401);
      const expired = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/app.js") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", tokenFor({ ttl: -5 }), "app.js"]),
      );
      expect(expired.status).toBe(401);
    });

    it("session HTML rewrites script URLs under a freshly minted token prefix", async () => {
      authMock.mockResolvedValue({ userId: "user-1" } as never);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, opts) => {
          const body = JSON.parse((opts as RequestInit).body as string);
          const content = body.path === "style.css"
            ? "body { color: rgb(1, 2, 3); }"
            : '<html><head><link rel="stylesheet" href="style.css"><script defer src="app.js"></script></head><body></body></html>';
          return new Response(JSON.stringify({ content }), { status: 200 });
        }),
      );
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/index.html") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["index.html"]),
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      // Stylesheet embedded; script stays external under /t/<token>/ and the
      // token actually verifies against the route's own scope rules.
      expect(html).toContain("body { color: rgb(1, 2, 3); }");
      const match = html.match(/src="\/api\/preview\/proj-1\/t\/([^/]+)\/app\.js"/);
      expect(match).not.toBeNull();
      expect(verifyPreviewToken(match![1])).toMatchObject({ userId: "user-1", projectId: "proj-1", workspaceId: "ws-1" });
      assertZeroSubprocesses();
    });
  });
});
