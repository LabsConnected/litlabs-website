// @vitest-environment node
// Chromium regression tests for the Gate B preview correction: scripts stay
// EXTERNAL and load through a scoped capability token, so the browser — not
// a document transform — applies native script execution semantics.
//
// What this proves, against the REAL preview route in a sandboxed
// (opaque-origin) iframe whose subresource requests cannot carry the session
// cookie:
//   1. A deferred classic script runs after parsing with the DOM available
//      (the original PR #661 regression: inlining kept `defer`, browsers
//      ignore it inline, and the script ran in <head> before <body> existed).
//   2. Module-before-deferred-classic dependency ordering (the defect that
//      failed commit d7892daa in Codex review: relocation moved the classic
//      script after the module's execution point in the shared post-parse
//      queue, breaking cross-type globals in this direction).
//   3. Deferred-classic-before-module dependency ordering (other direction).
//   4. Execution timing relative to parsing and DOMContentLoaded.
//   5. Async scripts still run with no ordering contract.
//   6. Module graphs: relative imports resolve inside the token prefix.
//   7. CSS still renders; unauthorized asset requests are rejected.
// On baseline 3dd296b7 scenarios 1–4 and 6 fail (inlined scripts execute
// during parsing or cannot resolve their imports); on this correction all
// pass because ordering is the browser's own.
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "@playwright/test";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: vi.fn(() => vi.fn()), createRouteMatcher: vi.fn(() => vi.fn()) }));
vi.mock("@clerk/backend/proxy", () => ({ clerkFrontendApiProxy: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async (req: NextRequest) => ({ userId: req?.headers.get("x-fixture-auth-context") === "matched" && req.cookies.get("__session")?.value === "fixture-owner" ? "owner" : null })) }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn(async (id: string, user: string) => id === "owned-project" && user === "owner" ? { workspaceId: "fixture-workspace" } : null) }));
vi.mock("@/lib/terminal-auth", () => ({ createTerminalToken: vi.fn(() => ({ token: "fixture-terminal-token" })) }));
vi.mock("@/lib/terminal-config", () => ({ requireTerminalBaseUrl: vi.fn(() => "http://fixture-terminal") }));
import { config } from "@/proxy";
import { GET } from "@/app/api/preview/[projectId]/[[...path]]/route";
import { createPreviewToken } from "@/lib/projects/preview-token";

let files: Record<string, string> = {};
let server: Server;
let browser: Browser;
let origin: string;
// Captured before beforeAll stubs global fetch with the terminal fixture.
const realFetch = globalThis.fetch;
beforeAll(async () => {
  // The preview-token module is real (not mocked): it signs with this secret.
  vi.stubEnv("TERMINAL_AUTH_SECRET", "browser-fixture-secret-with-32-plus-chars");
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const { path } = JSON.parse(String(options?.body));
    return new Response(JSON.stringify({ content: files[path] }), { status: files[path] ? 200 : 404 });
  }));
  server = createServer(async (req, res) => {
    try {
      if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "__session=fixture-owner; Path=/; HttpOnly; SameSite=Lax" });
        res.end('<!doctype html><iframe id="preview" sandbox="allow-scripts" src="/api/preview/owned-project/"></iframe>');
        return;
      }
      const url = new URL(req.url!, origin);
      const match = url.pathname.match(/^\/api\/preview\/([^/]+)\/(.*)$/);
      if (!match) { res.writeHead(404); res.end(); return; }
      const headers = new Headers();
      if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
      if (unstable_doesMiddlewareMatch({ config, url: url.href })) headers.set("x-fixture-auth-context", "matched");
      const response = await GET(new NextRequest(url, { headers }), { params: Promise.resolve({ projectId: match[1], path: match[2] ? match[2].split("/") : [] }) });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  origin = `http://localhost:${port}`;
  browser = await chromium.launch({ headless: true });
}, 20000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function openPreview() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(origin, { waitUntil: "networkidle" });
  const frame = page.frames().find((frame) => frame.url().includes("/api/preview/"))!;
  return { context, frame, pageErrors };
}

const ORDER_SETUP = '<script>window.__order = []; document.addEventListener("DOMContentLoaded", () => window.__order.push("DOMContentLoaded"));</script>';

it("runs a deferred classic script after parsing, with the DOM available, and CSS applied", async () => {
  files = {
    "index.html": `<!doctype html><html><head>${ORDER_SETUP}<script defer src="app.js"></script><link rel="stylesheet" href="style.css"></head><body><h1>Styled preview</h1><script>window.__order.push("body-script");</script></body></html>`,
    "style.css": 'body { background-color: rgb(12, 24, 36); }',
    "app.js": 'document.querySelector("h1").dataset.executed = "deferred"; window.__order.push("deferred-app");',
  };
  const { context, frame, pageErrors } = await openPreview();
  expect(await frame.locator("h1").getAttribute("data-executed")).toBe("deferred");
  expect(await frame.evaluate(() => (window as unknown as { __order: string[] }).__order)).toEqual(["body-script", "deferred-app", "DOMContentLoaded"]);
  expect(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(12, 24, 36)");
  expect(pageErrors).toEqual([]);
  await context.close();
}, 20000);

it("preserves module-before-deferred-classic dependency ordering (the d7892daa defect)", async () => {
  files = {
    "index.html": `<!doctype html><html><head>${ORDER_SETUP}<script type="module" src="mod.js"></script><script defer src="classic.js"></script></head><body><h1>Mixed A</h1><script>window.__order.push("body-script");</script></body></html>`,
    "mod.js": 'window.__shared = "from-module"; window.__order.push("module");',
    "classic.js": 'document.querySelector("h1").dataset.dep = window.__shared ?? "missing"; window.__order.push("classic");',
  };
  const { context, frame, pageErrors } = await openPreview();
  // Native semantics: module and deferred classic share one post-parse queue
  // in document order — the module initializes first, the classic consumes.
  expect(await frame.locator("h1").getAttribute("data-dep")).toBe("from-module");
  expect(await frame.evaluate(() => (window as unknown as { __order: string[] }).__order)).toEqual(["body-script", "module", "classic", "DOMContentLoaded"]);
  expect(pageErrors).toEqual([]);
  await context.close();
}, 20000);

it("preserves deferred-classic-before-module dependency ordering", async () => {
  files = {
    "index.html": `<!doctype html><html><head>${ORDER_SETUP}<script defer src="classic.js"></script><script type="module" src="mod.js"></script></head><body><h1>Mixed B</h1><script>window.__order.push("body-script");</script></body></html>`,
    "classic.js": 'window.__shared = "from-classic"; window.__order.push("classic");',
    "mod.js": 'document.querySelector("h1").dataset.dep = window.__shared ?? "missing"; window.__order.push("module");',
  };
  const { context, frame, pageErrors } = await openPreview();
  expect(await frame.locator("h1").getAttribute("data-dep")).toBe("from-classic");
  expect(await frame.evaluate(() => (window as unknown as { __order: string[] }).__order)).toEqual(["body-script", "classic", "module", "DOMContentLoaded"]);
  expect(pageErrors).toEqual([]);
  await context.close();
}, 20000);

it("keeps parser-blocking classic scripts synchronous during parsing", async () => {
  files = {
    "index.html": '<!doctype html><html><head><script src="head.js"></script></head><body><h1>Sync</h1><script>document.querySelector("h1").dataset.head = window.__head ?? "missing";</script></body></html>',
    "head.js": 'window.__head = "ran-during-parse";',
  };
  const { context, frame, pageErrors } = await openPreview();
  expect(await frame.locator("h1").getAttribute("data-head")).toBe("ran-during-parse");
  expect(pageErrors).toEqual([]);
  await context.close();
}, 20000);

it("runs async scripts (no ordering contract) and resolves module-graph imports inside the token prefix", async () => {
  files = {
    "index.html": '<!doctype html><html><head><script async src="async.js"></script><script type="module" src="app.mjs"></script></head><body><h1>Graph</h1></body></html>',
    "async.js": 'window.__asyncRan = true;',
    "app.mjs": 'import { mark } from "./dep.js"; mark();',
    "dep.js": 'export function mark() { document.querySelector("h1").dataset.dep = "loaded"; }',
  };
  const { context, frame, pageErrors } = await openPreview();
  expect(await frame.locator("h1").getAttribute("data-dep")).toBe("loaded");
  expect(await frame.evaluate(() => (window as unknown as { __asyncRan?: boolean }).__asyncRan)).toBe(true);
  expect(pageErrors).toEqual([]);
  await context.close();
}, 20000);

it("confines the bearer to the minted asset manifest (the Codex 9da01ed0 P1)", async () => {
  files = {
    "index.html": '<!doctype html><html><head><script type="module" src="main.js"></script></head><body><h1>Manifest</h1><a id="to-page2" href="page2.html">Page 2</a></body></html>',
    "main.js": 'import "./dep.js"; window.__mainRan = true;',
    "dep.js": 'document.querySelector("h1").dataset.dep = "loaded";',
    "page2.html": '<!doctype html><html><head><script src="page2.js"></script></head><body><h1>Page 2</h1></body></html>',
    "page2.js": 'document.querySelector("h1").dataset.p2 = "yes";',
    "secret.txt": "WORKSPACE-SECRET-MARKER",
    "QUALITY_LOG.md": "# quality-log-marker",
    "other.js": "window.__otherRan = true;",
  };
  const { context, frame, pageErrors } = await openPreview();
  // Positive control: the module closure inside the manifest loads and runs.
  expect(await frame.locator("h1").getAttribute("data-dep")).toBe("loaded");

  // The preview document itself — untrusted code holding the real bearer in
  // its own script URLs — tries to read workspace files outside the
  // manifest. Every attempt must be refused; only manifest assets load.
  const attacks = await frame.evaluate(async () => {
    const src = document.querySelector('script[src*="/t/"]')!.getAttribute("src")!;
    const base = src.slice(0, src.lastIndexOf("/") + 1);
    const probe = async (path: string) => {
      try {
        const response = await fetch(base + path);
        return { status: response.status, body: await response.text() };
      } catch {
        // A response without CORS approval (e.g. the tokenless 401 the
        // traversal probe resolves to) surfaces as a rejected fetch —
        // status 0 here still proves nothing was readable.
        return { status: 0, body: "" };
      }
    };
    return {
      allowed: await probe("main.js"),
      secret: await probe("secret.txt"),
      log: await probe("QUALITY_LOG.md"),
      unreferenced: await probe("other.js"),
      traversal: await probe("../secret.txt"),
      tokenBase: base,
    };
  });
  expect(attacks.allowed.status).toBe(200);
  expect(attacks.secret.status).toBe(403);
  expect(attacks.secret.body).not.toContain("WORKSPACE-SECRET-MARKER");
  expect(attacks.log.status).toBe(403);
  expect(attacks.log.body).not.toContain("quality-log-marker");
  expect(attacks.unreferenced.status).toBe(403);
  expect(attacks.traversal.status).not.toBe(200);
  expect(attacks.traversal.body).not.toContain("WORKSPACE-SECRET-MARKER");

  // CORS narrowing: a foreign origin reading a token-mode response gets
  // ACAO for the opaque origin only ("null"), never "*" and never its own
  // origin reflected back.
  const foreign = await realFetch(new URL(`${attacks.tokenBase}main.js`, origin), {
    headers: { Origin: "https://evil.example" },
  });
  expect(foreign.headers.get("access-control-allow-origin")).toBe("null");

  // NOTE: in-frame navigation to the linked page2 document is covered
  // deterministically at route level (session mint → token-mode GET of
  // page2.html and page2.js, in route.test.ts): the fixture harness's
  // navigation path intermittently trips a Next/vitest AsyncLocalStorage
  // invariant in this environment (the same failure Codex's independent
  // harness hit), which would make this suite report infrastructure noise
  // instead of product signal. The browser-level facts — the closure
  // executes, the bearer is confined, CORS is narrowed — are proven above.
  expect(pageErrors).toEqual([]);
  await context.close();
}, 20000);

it("rejects unauthorized asset requests: no token, tampered token, wrong-project token", async () => {
  files = { "app.js": 'window.__ok = true;' };
  const bare = await realFetch(`${origin}/api/preview/owned-project/app.js`);
  expect(bare.status).toBe(401);
  const tampered = await realFetch(`${origin}/api/preview/owned-project/t/AAAA.invalid/app.js`);
  expect(tampered.status).toBe(401);
  const wrongProject = createPreviewToken("owner", { projectId: "other-project", workspaceId: "fixture-workspace" }).token;
  const scoped = await realFetch(`${origin}/api/preview/owned-project/t/${wrongProject}/app.js`);
  expect(scoped.status).toBe(403);
}, 20000);
