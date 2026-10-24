#!/usr/bin/env node
/**
 * qa-guard-proxy.mjs — denylist-enforcing forward proxy for QA browser traffic.
 *
 * Why this exists: Playwright MCP's --allowed-origins/--blocked-origins flags
 * explicitly "do not serve as a security boundary and do not affect redirects"
 * (see `npx @playwright/mcp --help`). So production protection is enforced here,
 * at the network layer: ANY browser request (initial navigation, redirect hop,
 * or agent-driven browser_navigate) to a production host is refused with 403,
 * regardless of what the MCP session tries to do.
 *
 * Denylist is exact-host: litlabs.net, www.litlabs.net, app.litlabs.net, and
 * web-production-d3a22.up.railway.app (the Railway domain serving the
 * production app service). Subdomains NOT listed here stay reachable on
 * purpose: clerk.litlabs.net is the Clerk Frontend API required for auth on
 * previews.
 *
 * Usage: node qa-guard-proxy.mjs  (prints QA_GUARD_PROXY_PORT=<port> on stdout)
 * Stderr carries an audit log of every blocked attempt.
 */
import http from "node:http";
import net from "node:net";

const DENY = new Set([
  "litlabs.net",
  "www.litlabs.net",
  "app.litlabs.net",
  "web-production-d3a22.up.railway.app",
]);

const hostOf = (value) =>
  String(value || "")
    .split(":")[0]
    .toLowerCase()
    .replace(/\.$/, "");
const denied = (host) => DENY.has(hostOf(host));
const logBlocked = (what) =>
  console.error(`[qa-guard-proxy] BLOCKED ${what}`);

const server = http.createServer((req, res) => {
  // Plain-HTTP requests arrive with an absolute URI:
  //   GET http://host:port/path HTTP/1.1   +   Host: host:port
  let target;
  try {
    target = new URL(req.url);
  } catch {
    try {
      target = new URL(`http://${req.headers.host}${req.url}`);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
  }
  const host = target.hostname.toLowerCase();
  if (denied(target.hostname)) {
    logBlocked(`http://${target.host}${target.pathname || ""}`);
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("blocked by qa-guard-proxy: production origin");
    return;
  }
  const fwd = http.request(
    {
      host: target.hostname,
      port: target.port ? parseInt(target.port, 10) : 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  fwd.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(fwd);
});

server.on("connect", (req, socket, head) => {
  const target = String(req.url || "");
  if (denied(target)) {
    logBlocked(`CONNECT ${target}`);
    socket.write(
      "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nblocked by qa-guard-proxy: production origin"
    );
    socket.destroy();
    return;
  }
  const [h, p] = target.split(":");
  const port = parseInt(p || "443", 10);
  const upstream = net.connect(port, h, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", () => {
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.destroy();
  });
  socket.on("error", () => upstream.destroy());
});

const port = parseInt(process.env.QA_GUARD_PORT || "0", 10);
server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  console.log(`QA_GUARD_PROXY_PORT=${addr.port}`);
});
