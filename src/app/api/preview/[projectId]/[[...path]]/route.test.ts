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
    vi.stubEnv("TERMINAL_AUTH_SECRET", "x".repeat(32));
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
    // Bare 'self' never matches subresource URLs from an opaque origin, so
    // it must never appear — relative assets would silently break.
    expect(csp).not.toMatch(/default-src 'self'/);
    // Generated sites are built on third-party assets the generation
    // contract emits (Tailwind browser CDN, Google Fonts, stock images);
    // resource loads are unrestricted to match the deployed /sites policy —
    // the sandbox + manifest-scoped token are the real security boundary.
    expect(csp).toContain("https:");
    expect(csp).toContain("'wasm-unsafe-eval'"); // Tailwind v4 browser build (Oxide WASM)
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
      vi.stubEnv("TERMINAL_AUTH_SECRET", "x".repeat(32));
      authMock.mockResolvedValue({ userId: null } as never);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    function tokenFor(overrides: { userId?: string; projectId?: string; workspaceId?: string; ttl?: number; assets?: string[] } = {}) {
      return createPreviewToken(overrides.userId ?? "user-1", {
        projectId: overrides.projectId ?? "proj-1",
        workspaceId: overrides.workspaceId ?? "ws-1",
        assets: overrides.assets,
      }, overrides.ttl ?? 300).token;
    }

    it("serves an asset to a valid scoped token without a session", async () => {
      mockTerminalFile("window.ok = true;");
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/app.js") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", tokenFor({ assets: ["app.js"] }), "app.js"]),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("window.ok = true;");
      // Token-mode hardening: only the opaque origin may read the response
      // (never "*"), and token-authorized content is never stored.
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("null");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      assertZeroSubprocesses();
    });

    it("refuses a valid token for workspace files outside its asset manifest", async () => {
      // The workspace DOES contain these files (the mock serves any path);
      // the manifest is the only reason they are refused. This is the
      // Codex 9da01ed0 P1: the bearer must not read arbitrary workspace
      // files — logs, env files, unreferenced sources.
      mockTerminalFile("SECRET CONTENT");
      const token = tokenFor({ assets: ["index.html", "app.js"] });
      for (const path of ["QUALITY_LOG.md", ".env", "secret.txt", "other.js", "notes.md"]) {
        const res = await GET(
          new Request(`https://x.test/api/preview/proj-1/t/x/${path}`) as unknown as import("next/server").NextRequest,
          makeParams("proj-1", ["t", token, path]),
        );
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain("SECRET CONTENT");
      }
      assertZeroSubprocesses();
    });

    it("refuses non-manifest paths WITHOUT any workspace read (no existence oracle)", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ content: "SECRET CONTENT" }), { status: 200 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/QUALITY_LOG.md") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", tokenFor({ assets: ["app.js"] }), "QUALITY_LOG.md"]),
      );
      expect(res.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("a token with an empty manifest authorizes nothing", async () => {
      mockTerminalFile("window.ok = true;");
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/app.js") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", tokenFor(), "app.js"]),
      );
      expect(res.status).toBe(403);
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
            : body.path === "app.js"
              ? "window.app = true;"
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

    it("does not mint a bearer token when manifest verification is incomplete", async () => {
      authMock.mockResolvedValue({ userId: "user-1" } as never);
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, opts) => {
          const body = JSON.parse((opts as RequestInit).body as string);
          if (body.path === "app.js") return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
          return new Response(JSON.stringify({ content: '<script type="module" src="app.js"></script>' }), { status: 200 });
        }),
      );
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/index.html") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["index.html"]),
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Preview asset manifest could not be verified" });
    });

    it("mints a manifest covering the module import closure, and nothing beyond it", async () => {
      authMock.mockResolvedValue({ userId: "user-1" } as never);
      const files: Record<string, string> = {
        "index.html": '<html><head><script type="module" src="mod.js"></script></head><body></body></html>',
        "mod.js": 'import { x } from "./dep.js"; console.log(x);',
        "dep.js": "export const x = 1;",
        "QUALITY_LOG.md": "# must never enter a manifest",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, opts) => {
          const body = JSON.parse((opts as RequestInit).body as string);
          const content = files[body.path as string];
          return content === undefined
            ? new Response(JSON.stringify({ error: "nf" }), { status: 404 })
            : new Response(JSON.stringify({ content }), { status: 200 });
        }),
      );
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/index.html") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["index.html"]),
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      const match = html.match(/src="\/api\/preview\/proj-1\/t\/([^/]+)\/mod\.js"/);
      expect(match).not.toBeNull();
      expect(verifyPreviewToken(match![1]).assets).toEqual(["dep.js", "index.html", "mod.js"]);
      assertZeroSubprocesses();
    });

    it("mints a manifest covering linked documents and their scripts (navigation stays working)", async () => {
      authMock.mockResolvedValue({ userId: "user-1" } as never);
      const files: Record<string, string> = {
        "index.html": '<html><head><script src="app.js"></script></head><body><a href="page2.html">two</a></body></html>',
        "app.js": "window.a = 1;",
        "page2.html": '<html><head><script src="page2.js"></script></head><body></body></html>',
        "page2.js": "window.p2 = 1;",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, opts) => {
          const body = JSON.parse((opts as RequestInit).body as string);
          const content = files[body.path as string];
          return content === undefined
            ? new Response(JSON.stringify({ error: "nf" }), { status: 404 })
            : new Response(JSON.stringify({ content }), { status: 200 });
        }),
      );
      const res = await GET(
        new Request("https://x.test/api/preview/proj-1/index.html") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["index.html"]),
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      const match = html.match(/src="\/api\/preview\/proj-1\/t\/([^/]+)\/app\.js"/);
      expect(match).not.toBeNull();
      expect(verifyPreviewToken(match![1]).assets).toEqual(["app.js", "index.html", "page2.html", "page2.js"]);
      assertZeroSubprocesses();
    });

    it("full chain: a session-minted token serves its manifest (incl. linked docs) and refuses everything else", async () => {
      const files: Record<string, string> = {
        "index.html": '<html><head><script type="module" src="main.js"></script></head><body><a href="page2.html">two</a></body></html>',
        "main.js": 'import "./dep.js";',
        "dep.js": "export {};",
        "page2.html": '<html><head><script src="page2.js"></script></head><body></body></html>',
        "page2.js": "window.p2 = 1;",
        "secret.txt": "WORKSPACE-SECRET",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url, opts) => {
          const body = JSON.parse((opts as RequestInit).body as string);
          const content = files[body.path as string];
          return content === undefined
            ? new Response(JSON.stringify({ error: "nf" }), { status: 404 })
            : new Response(JSON.stringify({ content }), { status: 200 });
        }),
      );
      // 1. Session request mints the token.
      authMock.mockResolvedValue({ userId: "user-1" } as never);
      const doc = await GET(
        new Request("https://x.test/api/preview/proj-1/index.html") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["index.html"]),
      );
      expect(doc.status).toBe(200);
      const token = (await doc.text()).match(/\/t\/([^/]+)\/main\.js/)![1];
      // 2. Session-less (token-mode) requests: manifest members serve,
      //    including the linked document and ITS script (navigation),
      //    with the document's own script rewritten under the same token.
      authMock.mockResolvedValue({ userId: null } as never);
      for (const path of ["main.js", "dep.js", "page2.html", "page2.js"]) {
        const res = await GET(
          new Request(`https://x.test/api/preview/proj-1/t/x/${path}`) as unknown as import("next/server").NextRequest,
          makeParams("proj-1", ["t", token, path]),
        );
        expect(res.status).toBe(200);
        if (path === "page2.html") {
          expect(await res.text()).toContain(`/t/${token}/page2.js`);
        }
      }
      // 3. The same token cannot reach the workspace file the site never
      //    referenced, even though it exists.
      const secret = await GET(
        new Request("https://x.test/api/preview/proj-1/t/x/secret.txt") as unknown as import("next/server").NextRequest,
        makeParams("proj-1", ["t", token, "secret.txt"]),
      );
      expect(secret.status).toBe(403);
      expect(await secret.text()).not.toContain("WORKSPACE-SECRET");
      assertZeroSubprocesses();
    });
  });
});
