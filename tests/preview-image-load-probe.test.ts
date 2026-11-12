// @vitest-environment node
// Regression probe for the static-preview image defect: subresource
// requests from the opaque-origin preview iframe cannot carry the session
// cookie, so every workspace-relative <img> failed (401, ERR_BLOCKED_BY_ORB)
// until prepareStaticPreviewDocument learned to reissue subresource URLs
// under the token prefix and the manifest learned to authorize them. This
// test asks the real route + real Chromium for the end-to-end truth:
// the image request must ride the token path and decode (naturalWidth > 0).
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { chromium, type Browser } from "@playwright/test";
import { NextRequest } from "next/server";
vi.mock("@clerk/nextjs/server", () => ({ clerkMiddleware: vi.fn(() => vi.fn()), createRouteMatcher: vi.fn(() => vi.fn()) }));
vi.mock("@clerk/backend/proxy", () => ({ clerkFrontendApiProxy: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async (req: NextRequest) => ({ userId: req?.headers.get("x-fixture-auth-context") === "matched" && req.cookies.get("__session")?.value === "fixture-owner" ? "owner" : null })) }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn(async (id: string, user: string) => id === "owned-project" && user === "owner" ? { workspaceId: "fixture-workspace" } : null) }));
vi.mock("@/lib/terminal-auth", () => ({ createTerminalToken: vi.fn(() => ({ token: "fixture-terminal-token" })) }));
vi.mock("@/lib/terminal-config", () => ({ requireTerminalBaseUrl: vi.fn(() => "http://fixture-terminal") }));
import { GET } from "@/app/api/preview/[projectId]/[[...path]]/route";

let files: Record<string, string> = {};
let server: Server;
let browser: Browser;
let origin: string;
const seenRequests: string[] = [];

// A real 1x1 PNG so a successful serve yields a decodable image.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

beforeAll(async () => {
  vi.stubEnv("TERMINAL_AUTH_SECRET", "x".repeat(32));
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const { path, encoding } = JSON.parse(String(options?.body));
    if (path === "assets/images/p.png") {
      return new Response(JSON.stringify({ content: PNG_B64, size: 70, encoding: encoding === "base64" ? "base64" : "utf-8" }), { status: 200 });
    }
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
      seenRequests.push(`${req.headers.cookie ? "COOKIE" : "ANON"} ${url.pathname}`);
      const headers = new Headers();
      if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
      if (url.pathname.startsWith("/api/preview/")) headers.set("x-fixture-auth-context", "matched");
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

it("loads a workspace-relative <img> inside the opaque-origin preview iframe", async () => {
  files = {
    "index.html": '<!doctype html><html><body><img id="probe" src="assets/images/p.png"></body></html>',
  };
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("requestfailed", (r) => failures.push(`${r.url()} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.url().includes("p.png")) failures.push(`${r.url()} :: HTTP ${r.status()}`); });
  await page.goto(origin, { waitUntil: "networkidle" });
  const frame = page.frames().find((f) => f.url().includes("/api/preview/"))!;
  const loaded = await frame.evaluate(() => {
    const img = document.getElementById("probe") as HTMLImageElement;
    return { complete: img.complete, naturalWidth: img.naturalWidth, src: img.src };
  });
  console.log("IMG RESULT", JSON.stringify(loaded), "REQS", JSON.stringify(seenRequests), "FAILS", JSON.stringify(failures));
  await context.close();
  expect(loaded.naturalWidth).toBeGreaterThan(0);
}, 30000);
