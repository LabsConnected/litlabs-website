// @vitest-environment node
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

const files: Record<string, string> = {
  "index.html": '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Styled preview</h1><script src="app.js"></script></body></html>',
  "style.css": 'body { background-color: rgb(12, 24, 36); }',
  "app.js": 'document.querySelector("h1").dataset.executed = "true";',
};
let server: Server;
let browser: Browser;
let origin: string;
beforeAll(async () => {
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
});

it("loads CSS and classic JS in an authenticated opaque-origin preview", async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "networkidle" });
  const frame = page.frames().find((frame) => frame.url().includes("/api/preview/"))!;
  expect(await frame.locator("h1").textContent()).toBe("Styled preview");
  expect(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(12, 24, 36)");
  expect(await frame.locator("h1").getAttribute("data-executed")).toBe("true");
  expect(await frame.evaluate(() => { try { return Boolean(parent.document.body); } catch { return false; } })).toBe(false);
  expect((await context.request.get(`${origin}/api/preview/not-owned/style.css`)).status()).toBe(404);
  const outsider = await browser.newContext();
  expect((await outsider.request.get(`${origin}/api/preview/owned-project/style.css`)).status()).toBe(401);
  await outsider.close();
  await context.close();
}, 20000);
