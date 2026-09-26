/**
 * Preview asset pipeline — regression test for the "raw unstyled HTML"
 * incident (P0, 2026-09-25).
 *
 * Root cause: undici transparently decompresses gzip/br bodies but leaves
 * the upstream content-encoding/content-length headers intact. The proxy
 * forwarded those headers alongside the DECODED bytes — the browser then
 * tried to gunzip a plain CSS/JS body (ERR_CONTENT_DECODING_FAILED) and
 * every stylesheet/chunk died while the HTML document (whose encoding
 * headers were already dropped for the inspector rewrite) rendered as an
 * unstyled page.
 *
 * The contracts this file proves through the REAL proxy handler:
 *   - A gzipped upstream stylesheet comes back as decodable text/css —
 *     never an error status, never HTML, never a stale encoding header.
 *   - The same holds for JS chunks; runtime "/_next/" literals inside JS
 *     bodies are re-homed under /preview/:workspaceId.
 *   - Requests the app generates at runtime (escaped root-absolute asset
 *     URLs, token-less fetches) authenticate via the preview cookie or a
 *     same-origin in-mount Referer and reach the workspace dev server.
 *   - A WS upgrade inside the mount is tunnelled to the dev server.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createServer, type Server, type IncomingMessage } from "http";
import { gzipSync } from "zlib";
import { connect, type Socket } from "net";
import type { AddressInfo } from "net";

import {
  registerPreviewProxyRoute,
  registerPreviewFallbackRoute,
  handlePreviewUpgrade,
} from "../preview/proxy";
import { previewCookieName } from "../preview/proxy-security";

const WORKSPACE_ID = "ws_assets";
const TOKEN = "test-preview-token";

const CSS_BODY = "body{display:grid;color:rebeccapurple}\n";
const JS_BODY =
  'self.__webpack_require__ = self.__webpack_require__ || {};\n' +
  '__webpack_require__.p = "/_next/";\n' +
  'var hmr = "/_next/webpack-hmr";\n' +
  'fetch("/_next/image?url=%2Flogo.png");\n';
const CSS_WITH_URL =
  '@import "theme.css";\n@font-face{src:url(/_next/static/media/font.woff2)}\n';

function upstreamDevServer(): Server {
  return createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    switch (url) {
      case "/":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end('<html><head><link rel="stylesheet" href="/_next/static/css/app.css"></head><body>App</body></html>');
        return;
      case "/_next/static/css/app.css": {
        // Serve gzip-compressed CSS exactly like the browser-facing dev
        // server does when it receives Accept-Encoding.
        const acceptEncoding = String(req.headers["accept-encoding"] ?? "");
        if (acceptEncoding.includes("gzip")) {
          const gz = gzipSync(CSS_BODY);
          res.writeHead(200, {
            "content-type": "text/css; charset=utf-8",
            "content-encoding": "gzip",
            "content-length": gz.length,
          });
          res.end(gz);
          return;
        }
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(CSS_BODY);
        return;
      }
      case "/_next/static/css/fonts.css":
        res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        res.end(CSS_WITH_URL);
        return;
      case "/_next/static/chunks/webpack.js":
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
        res.end(JS_BODY);
        return;
      case "/_next/static/media/font.woff2":
        res.writeHead(200, { "content-type": "font/woff2" });
        res.end(Buffer.from([0x77, 0x4f, 0x46, 0x32]));
        return;
      case "/echo-cookie":
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(`cookie:${req.headers.cookie ?? ""}`);
        return;
      default:
        res.writeHead(404, { "content-type": "text/plain" });
        res.end(`Cannot GET ${url}`);
    }
  });
}

function readyStatus(port: number) {
  return {
    status: "ready" as const,
    port,
    framework: "nextjs",
    command: `pnpm exec next dev --port ${port}`,
    startedAt: Date.now(),
    lastHealthCheck: Date.now(),
    error: null,
    errorCode: null,
    logs: [],
  };
}

describe("preview gateway — stylesheet/JS asset pipeline", () => {
  let upstream: Server;
  let upstreamPort: number;
  let app: express.Application;

  beforeAll(async () => {
    process.env.PREVIEW_ACCESS_TOKEN = TOKEN;
    upstream = upstreamDevServer();
    await new Promise<void>((resolve, reject) => {
      upstream.once("error", reject);
      upstream.listen(0, "127.0.0.1", () => resolve());
    });
    upstreamPort = (upstream.address() as AddressInfo).port;
    app = express();
    registerPreviewProxyRoute(app, {
      getPreviewStatus: () => readyStatus(upstreamPort),
    });
    // Registered LAST, mirroring server.ts ordering.
    registerPreviewFallbackRoute(app, {
      getPreviewStatus: () => readyStatus(upstreamPort),
    });
  });

  afterAll(async () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("returns a compressed upstream stylesheet as decodable CSS — never an error or HTML", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/_next/static/css/app.css?token=${TOKEN}`)
      .set("accept-encoding", "gzip")
      // supertest parses encoded bodies; keep the raw view too
      .buffer(true);

    expect(proxied.status).toBe(200);
    expect(proxied.headers["content-type"]).toContain("text/css");
    // The decoded body must not carry a stale content-encoding — the
    // browser would try to gunzip plaintext and drop the stylesheet.
    expect(proxied.headers["content-encoding"]).toBeUndefined();
    expect(proxied.text).toBe(CSS_BODY);
    expect(proxied.text).not.toContain("<");
  });

  it("sets the preview credential cookie so runtime requests can auth", async () => {
    const proxied = await request(app).get(
      `/preview/${WORKSPACE_ID}/?token=${TOKEN}`,
    );
    expect(proxied.status).toBe(200);
    const cookies = proxied.headers["set-cookie"];
    const joined = Array.isArray(cookies) ? cookies.join(";") : String(cookies ?? "");
    expect(joined).toContain(`${previewCookieName(WORKSPACE_ID)}=`);
    expect(joined).toContain("HttpOnly");
    expect(joined).toContain("SameSite=None");
  });

  it("authenticates in-mount requests via the workspace preview cookie (no ?token=)", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/_next/static/css/app.css`)
      .set("cookie", `${previewCookieName(WORKSPACE_ID)}=${encodeURIComponent(TOKEN)}`);

    expect(proxied.status).toBe(200);
    expect(proxied.headers["content-type"]).toContain("text/css");
    expect(proxied.text).toBe(CSS_BODY);
  });

  it("authenticates in-mount requests via a same-origin Referer carrying the token", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/_next/static/chunks/webpack.js`)
      .set("host", "localhost")
      .set("referer", `http://localhost/preview/${WORKSPACE_ID}/?token=${TOKEN}`);

    expect(proxied.status).toBe(200);
    expect(proxied.text).toContain(`/preview/${WORKSPACE_ID}/_next/`);
    expect(proxied.text).not.toContain('"/_next/"');
  });

  it("still denies in-mount requests with no credential (fail closed)", async () => {
    const res = await request(app).get(
      `/preview/${WORKSPACE_ID}/_next/static/css/app.css`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a cookie minted for a different workspace (tenant isolation)", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/_next/static/css/app.css`)
      .set("cookie", `${previewCookieName("ws_other")}=${encodeURIComponent(TOKEN)}`);

    expect(proxied.status).toBe(401);
  });

  it("re-homes escaped /_next/* asset requests through the workspace (Referer-scoped)", async () => {
    const proxied = await request(app)
      .get("/_next/static/chunks/webpack.js")
      .set("host", "localhost")
      .set("referer", `http://localhost/preview/${WORKSPACE_ID}/?token=${TOKEN}`);

    expect(proxied.status).toBe(200);
    expect(proxied.text).toContain("webpack_require");
  });

  it("re-homes escaped /_next/* asset requests through the workspace (cookie-scoped)", async () => {
    const proxied = await request(app)
      .get("/_next/static/css/app.css")
      .set("cookie", `${previewCookieName(WORKSPACE_ID)}=${encodeURIComponent(TOKEN)}`);

    expect(proxied.status).toBe(200);
    expect(proxied.headers["content-type"]).toContain("text/css");
  });

  it("leaves non-preview requests at the terminal origin alone (plain 404)", async () => {
    const res = await request(app).get("/_next/static/chunks/webpack.js");
    expect(res.status).toBe(404);
  });

  it("rewrites url() and @import inside proxied CSS so fonts/imports stay in the mount", async () => {
    const proxied = await request(app).get(
      `/preview/${WORKSPACE_ID}/_next/static/css/fonts.css?token=${TOKEN}`,
    );

    expect(proxied.status).toBe(200);
    expect(proxied.text).toContain(
      `url(/preview/${WORKSPACE_ID}/_next/static/media/font.woff2`,
    );
    expect(proxied.text).toContain(
      `@import "/preview/${WORKSPACE_ID}/_next/static/css/theme.css`,
    );
    expect(proxied.text).toContain(`token=${TOKEN}`);
    expect(proxied.text).not.toContain("url(/_next/");
  });

  it("forwards the app's own cookies upstream but never the preview credential", async () => {
    const proxied = await request(app)
      .get(`/preview/${WORKSPACE_ID}/echo-cookie?token=${TOKEN}`)
      .set(
        "cookie",
        `${previewCookieName(WORKSPACE_ID)}=${encodeURIComponent(TOKEN)}; app_session=abc123`,
      );

    expect(proxied.status).toBe(200);
    expect(proxied.text).toContain("app_session=abc123");
    expect(proxied.text).not.toContain(previewCookieName(WORKSPACE_ID));
    expect(proxied.text).not.toContain(TOKEN);
  });
});

describe("preview gateway — WebSocket upgrade tunnel (HMR)", () => {
  let upstream: Server;
  let upstreamPort: number;
  let gateway: Server;

  beforeAll(async () => {
    process.env.PREVIEW_ACCESS_TOKEN = TOKEN;
    // Upstream "dev server": on upgrade, hand back a 101 then echo bytes.
    upstream = createServer((_req, res) => {
      res.writeHead(404).end();
    });
    upstream.on("upgrade", (req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `\r\n`,
      );
      socket.on("data", (d) => socket.write(`echo:${req.url}:${d.toString()}`));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamPort = (upstream.address() as AddressInfo).port;

    const app = express();
    registerPreviewProxyRoute(app, {
      getPreviewStatus: () => readyStatus(upstreamPort),
    });
    gateway = createServer(app);
    gateway.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
      if ((req.url ?? "").startsWith("/socket.io/")) return;
      if (
        handlePreviewUpgrade(req, socket, head, {
          getPreviewStatus: () => readyStatus(upstreamPort),
        })
      )
        return;
      socket.destroy();
    });
    await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  });

  afterAll(async () => {
    delete process.env.PREVIEW_ACCESS_TOKEN;
    // Upgraded sockets stay open past close() — sever them first, and never
    // wait on close() longer than a few seconds in a slow sandbox.
    gateway.closeAllConnections();
    upstream.closeAllConnections();
    const close = (srv: typeof gateway) =>
      Promise.race([
        new Promise<void>((resolve) => srv.close(() => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    await close(gateway);
    await close(upstream);
  });

  function upgradeRequest(path: string, extraHeaders = ""): Promise<string> {
    const port = (gateway.address() as AddressInfo).port;
    return new Promise((resolve, reject) => {
      const sock = connect(port, "127.0.0.1");
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("\r\n\r\n")) {
          sock.write("ping");
        }
        if (buf.includes("echo:")) {
          sock.destroy();
          resolve(buf);
        }
      });
      sock.on("error", reject);
      sock.on("connect", () => {
        sock.write(
          `GET ${path} HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${port}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            extraHeaders +
            "\r\n",
        );
      });
      setTimeout(() => {
        sock.destroy();
        reject(new Error(`upgrade timed out; got: ${buf.slice(0, 200)}`));
      }, 8000);
    });
  }

  it("tunnels a mount-scoped upgrade (token in query) to the dev server", async () => {
    const response = await upgradeRequest(
      `/preview/${WORKSPACE_ID}/_next/webpack-hmr?token=${TOKEN}`,
    );
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("echo:/_next/webpack-hmr?token=");
  }, 15000);

  it("tunnels an upgrade authenticated by the preview cookie", async () => {
    const response = await upgradeRequest(
      `/preview/${WORKSPACE_ID}/_next/webpack-hmr`,
      `Cookie: ${previewCookieName(WORKSPACE_ID)}=${encodeURIComponent(TOKEN)}\r\n`,
    );
    expect(response).toContain("101 Switching Protocols");
  }, 15000);

  it("tunnels an escaped upgrade path resolved via the preview cookie", async () => {
    const response = await upgradeRequest(
      "/_next/webpack-hmr",
      `Cookie: ${previewCookieName(WORKSPACE_ID)}=${encodeURIComponent(TOKEN)}\r\n`,
    );
    expect(response).toContain("101 Switching Protocols");
    expect(response).toContain("echo:/_next/webpack-hmr:");
  }, 15000);

  it("refuses an upgrade with no valid credential", async () => {
    const port = (gateway.address() as AddressInfo).port;
    await expect(
      new Promise<void>((resolve, reject) => {
        const sock = connect(port, "127.0.0.1");
        sock.on("connect", () => {
          sock.write(
            `GET /preview/${WORKSPACE_ID}/_next/webpack-hmr HTTP/1.1\r\n` +
              `Host: 127.0.0.1:${port}\r\n` +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
              "Sec-WebSocket-Version: 13\r\n\r\n",
          );
        });
        sock.on("data", () => reject(new Error("upgrade unexpectedly succeeded")));
        sock.on("close", () => resolve());
        sock.on("error", () => resolve());
        setTimeout(() => {
          sock.destroy();
          resolve();
        }, 3000);
      }),
    ).resolves.toBeUndefined();
  }, 10000);
});
