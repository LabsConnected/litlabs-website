/**
 * Workspace-to-preview routing parity — regression test for the
 * "Preview ready" + bare "Cannot GET /" incident.
 *
 * Root cause covered by the companion PreviewManager changes: the
 * runtime's assigned port could point at a process that is NOT the
 * spawned dev server (orphan squatter after a restart, or a next dev
 * auto-increment the runtime never tracked). The probe and proxy then
 * both talked to the wrong process.
 *
 * The contract this file proves end-to-end through the REAL proxy
 * handler (registerPreviewProxyRoute — the same function server.ts
 * mounts):
 *
 *   When the workspace's dev server serves GET / on the assigned
 *   preview port, the preview gateway's GET /preview/:workspaceId/
 *   returns the SAME application response as a direct
 *   GET http://127.0.0.1:<port>/ — same status, same content type, the
 *   app's own markup — never a bare "Cannot GET /".
 *
 *   When the port is owned by a foreign process that 404s /, the
 *   gateway answers 502 with the honest error page and flips the
 *   runtime — the raw "Cannot GET /" never reaches the iframe.
 *
 *   Upstream redirect Location headers are re-homed INSIDE
 *   /preview/:workspaceId — a root-relative "Location: /" previously
 *   escaped the mount and landed on the terminal-server's Express
 *   origin, producing the exact "Cannot GET /" body while the badge
 *   still said ready.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";

import { registerPreviewProxyRoute, type PreviewProxyDeps } from "../preview/proxy";
import { rewritePreviewLocation } from "../preview/asset-urls";
import {
  isPortFree,
  allocateFreePort,
  detectBoundPort,
  adoptBoundPort,
  type PreviewRuntime,
} from "../preview/PreviewManager";

const WORKSPACE_ID = "ws_parity";
const TOKEN = "test-preview-token";

const HTML_BODY = [
  "<!DOCTYPE html><html><head>",
  "<title>Workspace Test App</title>",
  '<script src="/_next/static/chunks/app.js"></script>',
  "</head><body>",
  '<h1 id="app">Hello from the workspace app</h1>',
  "</body></html>",
].join("");

const JS_BODY = "console.log('workspace chunk');\n";

/** Simulated dev server — serves the app on / and redirect fixtures. */
function upstreamDevServer(): Server {
  return createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    switch (url) {
      case "/":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(HTML_BODY);
        return;
      case "/_next/static/chunks/app.js":
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end(JS_BODY);
        return;
      case "/redirect-root":
        res.writeHead(302, { location: "/" });
        res.end();
        return;
      case "/redirect-abs": {
        // Absolute URL pointing back at this dev server (Host carries
        // the real bound port — it is not known until listen() runs).
        const port = (req.headers.host ?? "127.0.0.1:0").split(":").pop();
        res.writeHead(302, { location: `http://localhost:${port}/about` });
        res.end();
        return;
      }
      case "/redirect-ext":
        res.writeHead(302, { location: "https://accounts.example.com/sign-in" });
        res.end();
        return;
      case "/redirect-gateway":
        // Absolute redirect at the gateway's own public origin — escapes
        // the mount onto the terminal-server's Express routes.
        res.writeHead(302, { location: "https://terminal.litlabs.net/login" });
        res.end();
        return;
      case "/redirect-gateway-protorel":
        res.writeHead(302, { location: "//terminal.litlabs.net/login" });
        res.end();
        return;
      case "/redirect-gateway-mounted":
        res.writeHead(302, { location: `https://terminal.litlabs.net/preview/${WORKSPACE_ID}/dash?x=1` });
        res.end();
        return;
      case "/redirect-gateway-port":
        res.writeHead(302, { location: "https://terminal.litlabs.net:8443/login" });
        res.end();
        return;
      case "/redirect-railway-domain":
        res.writeHead(302, { location: "https://litt-terminal.up.railway.app/login" });
        res.end();
        return;
      case "/echo-headers":
        // Returns the exact header set the workspace dev server received —
        // proves what does and does not cross the gateway boundary.
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(req.headers));
        return;
      default:
        // Express-style 404 — the shape a foreign process on the port emits.
        res.writeHead(404, { "content-type": "text/plain" });
        res.end(`Cannot GET ${url}`);
    }
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

function listenOnPreviewPortOrEphemeral(server: Server): Promise<void> {
  // The regression spec names workspace port 4100 — use it when free,
  // otherwise take an OS-assigned port so the suite stays deterministic.
  return listen(server, 4100).catch(() => listen(server, 0));
}

function readyStatus(port: number) {
  return {
    status: "ready" as const,
    port,
    framework: "nextjs",
    command: `pnpm exec next dev --port ${port} --hostname 0.0.0.0`,
    startedAt: Date.now(),
    lastHealthCheck: Date.now(),
    error: null,
    errorCode: null,
    logs: [],
  };
}

function buildGateway(deps: PreviewProxyDeps): express.Application {
  const app = express();
  registerPreviewProxyRoute(app, deps);
  return app;
}

describe("preview gateway — routing parity with the workspace dev server", () => {
  let upstream: Server;
  let upstreamPort: number;
  let app: express.Application;
  const markRootRouteMissing = vi.fn(() => true);
  const markBackendUnreachable = vi.fn(() => true);

  beforeAll(async () => {
    process.env.PREVIEW_ACCESS_TOKEN = TOKEN;
    upstream = upstreamDevServer();
    await listenOnPreviewPortOrEphemeral(upstream);
    upstreamPort = (upstream.address() as AddressInfo).port;
    app = buildGateway({
      getPreviewStatus: () => readyStatus(upstreamPort),
      markPreviewRootRouteMissing: markRootRouteMissing,
      markPreviewBackendUnreachable: markBackendUnreachable,
    });
  });

  afterAll(async () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("GET / through the gateway returns the same application response as a direct GET", async () => {
    const direct = await fetch(`http://127.0.0.1:${upstreamPort}/`);
    const directBody = await direct.text();

    const proxied = await request(app).get(`/preview/${WORKSPACE_ID}/?token=${TOKEN}`);

    expect(proxied.status).toBe(direct.status);
    expect(proxied.headers["content-type"]).toContain("text/html");
    // The application's own markup must reach the iframe — never the
    // backend's bare "Cannot GET /".
    expect(proxied.text).toContain("Workspace Test App");
    expect(proxied.text).toContain("Hello from the workspace app");
    expect(proxied.text).not.toContain("Cannot GET /");
    // Root-relative asset refs are re-homed INSIDE the preview mount
    // with the token, not left to escape to the terminal origin.
    expect(proxied.text).toContain(`/preview/${WORKSPACE_ID}/_next/static/chunks/app.js`);
    expect(proxied.text).toContain(`token=${TOKEN}`);
    // The upstream body itself is unchanged apart from URL rewriting —
    // the direct response proves the same document was served.
    expect(directBody).toContain("Workspace Test App");
  });

  it("GET of a non-HTML asset through the gateway is byte-identical to direct", async () => {
    const path = "/_next/static/chunks/app.js";
    const direct = await fetch(`http://127.0.0.1:${upstreamPort}${path}`);
    const proxied = await request(app).get(
      `/preview/${WORKSPACE_ID}${path}?token=${TOKEN}`,
    );

    expect(proxied.status).toBe(direct.status);
    expect(proxied.text).toBe(await direct.text());
  });

  it("a 404 on the entry route becomes an honest 502 — never raw 'Cannot GET /'", async () => {
    // Point the runtime at a foreign process that has no GET / — the
    // squatter scenario. The gateway must refuse the lie.
    const squatter = createServer((_req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Cannot GET /");
    });
    await listen(squatter, 0);
    const squatterPort = (squatter.address() as AddressInfo).port;
    try {
      const squatterGateway = buildGateway({
        getPreviewStatus: () => readyStatus(squatterPort),
        markPreviewRootRouteMissing: markRootRouteMissing,
        markPreviewBackendUnreachable: markBackendUnreachable,
      });
      markRootRouteMissing.mockClear();

      const proxied = await request(squatterGateway).get(
        `/preview/${WORKSPACE_ID}/?token=${TOKEN}`,
      );

      expect(proxied.status).toBe(502);
      expect(proxied.text).not.toBe("Cannot GET /");
      expect(proxied.text).toContain("preview_root_route_missing");
      expect(markRootRouteMissing).toHaveBeenCalledWith(WORKSPACE_ID);
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });
});

describe("preview gateway — redirect containment inside the mount", () => {
  let upstream: Server;
  let upstreamPort: number;
  let app: express.Application;

  beforeAll(async () => {
    process.env.PREVIEW_ACCESS_TOKEN = TOKEN;
    upstream = upstreamDevServer();
    await listenOnPreviewPortOrEphemeral(upstream);
    upstreamPort = (upstream.address() as AddressInfo).port;
    app = buildGateway({
      getPreviewStatus: () => readyStatus(upstreamPort),
    });
  });

  afterAll(async () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("re-homes a root-relative Location: / inside /preview/:workspaceId — no origin escape", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-root?token=${TOKEN}`)
      .redirects(0);

    expect(proxied.status).toBe(302);
    const location = proxied.headers["location"];
    // Must never be the bare origin path that produces "Cannot GET /".
    expect(location).not.toBe("/");
    expect(location).toBe(`/preview/${WORKSPACE_ID}/?token=${TOKEN}`);
  });

  it("re-homes an absolute Location pointing back at the upstream dev server", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-abs?token=${TOKEN}`)
      .redirects(0);

    expect(proxied.status).toBe(302);
    expect(proxied.headers["location"]).toBe(
      `/preview/${WORKSPACE_ID}/about?token=${TOKEN}`,
    );
  });

  it("passes external absolute Locations through untouched", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-ext?token=${TOKEN}`)
      .redirects(0);

    expect(proxied.status).toBe(302);
    expect(proxied.headers["location"]).toBe(
      "https://accounts.example.com/sign-in",
    );
  });

  it("denies requests without the preview token (fail closed)", async () => {
    const res = await request(app).get(`/preview/${WORKSPACE_ID}/`);
    expect(res.status).toBe(401);
  });
});

describe("preview gateway — request-header boundary", () => {
  let upstream: Server;
  let upstreamPort: number;
  let app: express.Application;

  beforeAll(async () => {
    process.env.PREVIEW_ACCESS_TOKEN = TOKEN;
    upstream = upstreamDevServer();
    await listenOnPreviewPortOrEphemeral(upstream);
    upstreamPort = (upstream.address() as AddressInfo).port;
    app = buildGateway({
      getPreviewStatus: () => readyStatus(upstreamPort),
    });
  });

  afterAll(async () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("strips the browser's session material and spoofable edge identity before the workspace", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/echo-headers?token=${TOKEN}`)
      .set("Cookie", "__session=clerk-session-jwt; __client_uat=123")
      .set("Authorization", "Bearer clerk-session-token")
      .set("X-Preview-Token", TOKEN)
      .set("X-Internal-Service-Key", "platform-internal-key")
      .set("X-Api-Key", "some-api-key")
      .set("X-Forwarded-For", "1.2.3.4")
      .set("X-Forwarded-Host", "litlabs.net")
      .set("X-Forwarded-Proto", "https")
      .set("Forwarded", "for=1.2.3.4;proto=https")
      .set("CF-Connecting-IP", "1.2.3.4")
      .set("CF-Ray", "8f8f8f-SJC")
      .set("X-Real-IP", "1.2.3.4")
      .set("X-Clerk-Auth-Status", "signed-in")
      .set("X-Custom-App-Header", "kept")
      .set("Accept-Language", "en-US,en;q=0.9");

    expect(proxied.status).toBe(200);
    const echoed = JSON.parse(proxied.text) as Record<string, string>;

    // Session/auth material owned by the gateway origin — never upstream.
    expect(echoed["cookie"]).toBeUndefined();
    expect(echoed["authorization"]).toBeUndefined();
    expect(echoed["x-preview-token"]).toBeUndefined();
    expect(echoed["x-internal-service-key"]).toBeUndefined();
    expect(echoed["x-api-key"]).toBeUndefined();

    // Client-supplied edge/forwarding identity — spoofable, dropped.
    expect(echoed["x-forwarded-for"]).toBeUndefined();
    expect(echoed["x-forwarded-host"]).toBeUndefined();
    expect(echoed["x-forwarded-proto"]).toBeUndefined();
    expect(echoed["forwarded"]).toBeUndefined();
    expect(echoed["cf-connecting-ip"]).toBeUndefined();
    expect(echoed["cf-ray"]).toBeUndefined();
    expect(echoed["x-real-ip"]).toBeUndefined();
    expect(echoed["x-clerk-auth-status"]).toBeUndefined();

    // Ordinary application headers still reach the dev server, and Host
    // is rewritten to the upstream (not the gateway origin).
    expect(echoed["x-custom-app-header"]).toBe("kept");
    expect(echoed["accept-language"]).toBe("en-US,en;q=0.9");
    expect(echoed["host"]).toBe(`127.0.0.1:${upstreamPort}`);
  });
});

describe("preview gateway — escape redirect guard", () => {
  let upstream: Server;
  let upstreamPort: number;
  let app: express.Application;
  const markEscapeRedirect = vi.fn(() => true);

  beforeAll(async () => {
    process.env.PREVIEW_ACCESS_TOKEN = TOKEN;
    // The gateway's configured public domain — detected even when the
    // request Host is something else.
    process.env.RAILWAY_PUBLIC_DOMAIN = "litt-terminal.up.railway.app";
    upstream = upstreamDevServer();
    await listenOnPreviewPortOrEphemeral(upstream);
    upstreamPort = (upstream.address() as AddressInfo).port;
    app = buildGateway({
      getPreviewStatus: () => readyStatus(upstreamPort),
      markPreviewEscapeRedirect: markEscapeRedirect,
    });
  });

  afterAll(async () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("fails an absolute redirect at the gateway's own origin — never emits the escape Location", async () => {
    markEscapeRedirect.mockClear();
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-gateway?token=${TOKEN}`)
      .set("Host", "terminal.litlabs.net")
      .redirects(0);

    expect(proxied.status).toBe(502);
    // The escape Location must never reach the browser.
    expect(proxied.headers["location"]).toBeUndefined();
    expect(proxied.text).toContain("preview_escape_redirect");
    expect(markEscapeRedirect).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("fails a protocol-relative redirect at the gateway origin", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-gateway-protorel?token=${TOKEN}`)
      .set("Host", "terminal.litlabs.net")
      .redirects(0);

    expect(proxied.status).toBe(502);
    expect(proxied.headers["location"]).toBeUndefined();
    expect(proxied.text).toContain("preview_escape_redirect");
  });

  it("fails a redirect at the configured Railway public domain even when the request Host differs", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-railway-domain?token=${TOKEN}`)
      .redirects(0);

    expect(proxied.status).toBe(502);
    expect(proxied.headers["location"]).toBeUndefined();
    expect(proxied.text).toContain("preview_escape_redirect");
  });

  it("re-homes a gateway-origin redirect that stays inside this workspace's mount", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-gateway-mounted?token=${TOKEN}`)
      .set("Host", "terminal.litlabs.net")
      .redirects(0);

    expect(proxied.status).toBe(302);
    expect(proxied.headers["location"]).toBe(
      `/preview/${WORKSPACE_ID}/dash?x=1&token=${TOKEN}`,
    );
  });

  it("treats a non-default port on the gateway hostname as a different service — passthrough", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/redirect-gateway-port?token=${TOKEN}`)
      .set("Host", "terminal.litlabs.net")
      .redirects(0);

    expect(proxied.status).toBe(302);
    expect(proxied.headers["location"]).toBe("https://terminal.litlabs.net:8443/login");
  });
});

describe("rewritePreviewLocation — escape classification", () => {
  const OPTS = {
    workspaceId: "ws_1",
    token: "tok-1",
    upstreamPort: 4100,
    gatewayHosts: ["terminal.litlabs.net", "litt-terminal.up.railway.app"],
  };

  it("classifies a gateway-origin absolute redirect outside the mount as escape", () => {
    expect(rewritePreviewLocation("https://terminal.litlabs.net/login", OPTS))
      .toEqual({ action: "escape", location: "https://terminal.litlabs.net/login" });
  });

  it("classifies a protocol-relative gateway redirect as escape", () => {
    expect(rewritePreviewLocation("//terminal.litlabs.net/login", OPTS))
      .toEqual({ action: "escape", location: "//terminal.litlabs.net/login" });
  });

  it("classifies a redirect to another workspace's mount on the gateway as escape", () => {
    expect(rewritePreviewLocation("https://terminal.litlabs.net/preview/ws_other/x", OPTS))
      .toEqual({ action: "escape", location: "https://terminal.litlabs.net/preview/ws_other/x" });
  });

  it("rewrites a gateway-origin redirect inside the mount to a path-only location", () => {
    expect(rewritePreviewLocation("https://terminal.litlabs.net/preview/ws_1/dash?x=1", OPTS))
      .toEqual({ action: "rewrite", location: "/preview/ws_1/dash?x=1&token=tok-1" });
  });

  it("passes genuinely external absolute origins through", () => {
    expect(rewritePreviewLocation("https://accounts.example.com/sign-in", OPTS))
      .toEqual({ action: "passthrough", location: "https://accounts.example.com/sign-in" });
    expect(rewritePreviewLocation("//cdn.example.com/x.png", OPTS))
      .toEqual({ action: "passthrough", location: "//cdn.example.com/x.png" });
  });

  it("does not flag the gateway hostname on a non-default port", () => {
    expect(rewritePreviewLocation("https://terminal.litlabs.net:8443/login", OPTS))
      .toEqual({ action: "passthrough", location: "https://terminal.litlabs.net:8443/login" });
  });

  it("still re-homes root-relative and upstream-loopback locations", () => {
    expect(rewritePreviewLocation("/login", OPTS))
      .toEqual({ action: "rewrite", location: "/preview/ws_1/login?token=tok-1" });
    expect(rewritePreviewLocation("http://localhost:4100/x", OPTS))
      .toEqual({ action: "rewrite", location: "/preview/ws_1/x?token=tok-1" });
  });
});

describe("preview port truth — isPortFree", () => {
  it("reports a bound port as occupied and a free port as free", async () => {
    const blocker = createServer((_req, res) => res.end());
    await listen(blocker, 0);
    const taken = (blocker.address() as AddressInfo).port;

    const probe = createServer((_req, res) => res.end());
    await listen(probe, 0);
    const free = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    try {
      expect(await isPortFree(taken, "127.0.0.1")).toBe(false);
      expect(await isPortFree(free, "127.0.0.1")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

describe("preview port truth — allocateFreePort", () => {
  it("never hands out a port a squatter already owns", async () => {
    // A stale/orphaned process holding a port inside the preview range —
    // the post-restart scenario. The allocator must skip it even though
    // its in-process usedPorts set has no record of the squatter.
    const squatter = createServer((_req, res) => {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Cannot GET /");
    });
    // Find a genuinely free in-range port for the squatter to occupy.
    let squatted = 0;
    for (let candidate = 4100; candidate <= 4200; candidate++) {
      try {
        await listen(squatter, candidate);
        squatted = candidate;
        break;
      } catch {
        // occupied — try the next candidate
      }
    }
    if (!squatted) throw new Error("No free port in 4100-4200 for squatter");

    try {
      const allocated = await allocateFreePort();
      expect(allocated).not.toBe(squatted);
      expect(allocated).toBeGreaterThanOrEqual(4100);
      expect(allocated).toBeLessThanOrEqual(4200);
      expect(await isPortFree(allocated, "127.0.0.1")).toBe(true);
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });
});

describe("preview port truth — detectBoundPort", () => {
  it("parses the Next.js port-conflict announcement", () => {
    expect(
      detectBoundPort("⚠ Port 4100 is in use, trying 4101 instead."),
    ).toBe(4101);
    expect(detectBoundPort("Port 4100 is in use, trying 4102")).toBe(4102);
  });

  it("parses the Next/Vite 'Local:' bound-URL line", () => {
    expect(detectBoundPort("- Local:        http://localhost:4101")).toBe(4101);
    expect(detectBoundPort("  ➜  Local:   http://127.0.0.1:5174/")).toBe(5174);
    expect(detectBoundPort("➜  Local:   http://localhost:5173/")).toBe(5173);
  });

  it("returns null for lines without bound-port information", () => {
    expect(detectBoundPort("▲ Next.js 15.0.0")).toBeNull();
    expect(detectBoundPort("Compiling / ...")).toBeNull();
    expect(detectBoundPort("ready started server on 0.0.0.0:3000")).toBeNull();
    expect(detectBoundPort("")).toBeNull();
  });
});

describe("preview port truth — adoptBoundPort", () => {
  const fakeRuntime = (port: number): PreviewRuntime => ({
    workspaceId: `ws_${port}`,
    userId: "u1",
    projectId: "p1",
    process: null,
    port,
    framework: "nextjs",
    command: `pnpm exec next dev --port ${port}`,
    commandTemplate: "pnpm exec next dev --port $PORT",
    status: "starting",
    startedAt: Date.now(),
    lastHealthCheck: null,
    error: null,
    errorCode: null,
    logs: [],
  });

  it("retargets runtime.port when the dev server moved ports", () => {
    const rt = fakeRuntime(4197);
    adoptBoundPort(rt, 4198);
    expect(rt.port).toBe(4198);
    expect(rt.status).toBe("starting");
    expect(rt.logs.some((l) => l.includes("retargeting"))).toBe(true);
  });

  it("refuses to adopt a port another preview owns — tenant crossover guard", () => {
    const first = fakeRuntime(4195);
    adoptBoundPort(first, 4196); // claims 4196 into usedPorts
    expect(first.port).toBe(4196);

    const second = fakeRuntime(4194);
    adoptBoundPort(second, 4196); // foreign-owned port
    expect(second.port).toBe(4194); // not adopted
    expect(second.status).toBe("failed");
    expect(second.errorCode).toBe("preview_port_conflict");
  });

  it("is a no-op when the announced port matches the allocated port", () => {
    const rt = fakeRuntime(4193);
    adoptBoundPort(rt, 4193);
    expect(rt.status).toBe("starting");
    expect(rt.logs).toHaveLength(0);
  });
});
