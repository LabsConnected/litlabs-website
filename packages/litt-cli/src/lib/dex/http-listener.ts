/**
 * Dex agent HTTP listener — loopback-only, bearer-authed, read-only.
 *
 * Defense layers, every one fail-closed:
 *   1. binds 127.0.0.1 exclusively — no LAN, no tailnet, no public
 *   2. Host header must exactly match the bound address+port
 *   3. browser-originated requests rejected (Origin / Sec-Fetch-*)
 *   4. Bearer token verified via timing-safe digest compare
 *   5. GET only, verb allowlist only — no shot, no mutations, no body
 *   6. fixed-window rate limit per source
 *   7. STOP sentinel checked per request — halts even if the loop is wedged
 *   8. transport timeouts cover stalled headers AND slow requests;
 *      JSON-only responses, secrets never emitted
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { audit } from "./audit.js";
import { isStopRequested } from "./kill-switch.js";
import { verifyToken } from "./auth-token.js";
import { reportCpu, reportOllama, reportProcs, reportProject, reportRam, reportStatus } from "./report.js";

/** HTTP verb allowlist — `shot` and any mutation are excluded by design. */
const ROUTES: Record<string, () => Promise<unknown> | unknown> = {
  "/status": reportStatus,
  "/cpu": reportCpu,
  "/ram": reportRam,
  "/procs": reportProcs,
  "/ollama": reportOllama,
  "/project": reportProject,
};

/** Headers that only a browser context sends — Origin/Referer always
 * imply a web page; Sec-Fetch-Site/Dest/User are emitted by real
 * browsers but NOT by non-browser fetch clients (undici sends only
 * sec-fetch-mode, which is therefore deliberately absent here). */
const BROWSER_HEADERS = ["origin", "referer", "sec-fetch-site", "sec-fetch-dest", "sec-fetch-user"];

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_BODY_BYTES = 64; // the API takes no bodies — anything larger is anomalous
// Transport ceilings (server-level — they cover connections that stall
// before a complete header block exists, which the per-request timeout
// installed in the callback below can never see).
const HEADERS_TIMEOUT_MS = 4_000;
// Socket-inactivity ceiling: covers a client that connects and never
// completes a request (Node's headersTimeout does not fire on a stalled
// partial header block — verified on Node 22). In-flight requests are
// already bounded by REQUEST_TIMEOUT_MS; keep-alive idle by the 5s
// keepAliveTimeout default.
const SOCKET_IDLE_MS = 6_000;

export interface DexListener {
  server: Server;
  port: number;
  url: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function reject(res: ServerResponse, status: number, reason: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, reason }));
}

/**
 * Create the listener (does not bind). `token` is the expected bearer
 * value; the Host-header allowlist derives from the actual bound socket
 * address, so it is correct even on an ephemeral (port 0) bind.
 */
export function createDexListener(token: string, port: number, onHalt: () => void): DexListener {
  const buckets = new Map<string, Bucket>();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const t0 = Date.now();
    const remote = req.socket.remoteAddress ?? "unknown";
    const verb = req.url?.split("?")[0] ?? "";
    req.setTimeout(REQUEST_TIMEOUT_MS, () => reject(res, 408, "request timeout"));

    const finish = (status: number, reason: string) => {
      audit({ verb: `http:${req.method} ${verb}`, ok: status < 400, ms: Date.now() - t0, detail: `${status} ${reason} from ${remote}` });
    };

    // ── 1. Emergency stop checked per-request ──
    if (isStopRequested()) {
      reject(res, 503, "agent stopped");
      finish(503, "stop-sentinel");
      onHalt();
      return;
    }

    // ── 2. Host header exact allowlist — defeats DNS rebinding: an
    // attacker-controlled hostname never matches 127.0.0.1:port. The
    // allowlist derives from the ACTUAL bound socket, not config. ──
    const boundPort = (server.address() as { port: number } | null)?.port;
    if (!req.headers.host || (req.headers.host !== `127.0.0.1:${boundPort}` && req.headers.host !== `localhost:${boundPort}`)) {
      reject(res, 403, "host not allowed");
      finish(403, `bad-host:${String(req.headers.host).slice(0, 64)}`);
      return;
    }

    // ── 3. Browser-originated request rejection — local tools never
    // send Origin/Sec-Fetch-*; their presence means a browser tab ──
    if (BROWSER_HEADERS.some((h) => req.headers[h] !== undefined)) {
      reject(res, 403, "browser-originated requests are not accepted");
      finish(403, "browser-headers");
      return;
    }

    // ── 4. Method + body restrictions — GET only, no request bodies ──
    if (req.method !== "GET") {
      reject(res, 405, "method not allowed");
      finish(405, String(req.method));
      return;
    }
    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (contentLength > MAX_BODY_BYTES || req.headers["transfer-encoding"]) {
      reject(res, 413, "request bodies are not accepted");
      finish(413, `body:${contentLength}`);
      return;
    }

    // ── 5. Bearer token, timing-safe ──
    const auth = req.headers.authorization;
    const presented = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (!verifyToken(presented, token)) {
      reject(res, 401, "unauthorized");
      finish(401, "bad-token");
      return;
    }

    // ── 6. Rate limit (post-auth so brute force costs the attacker) ──
    const now = Date.now();
    let bucket = buckets.get(remote);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      buckets.set(remote, bucket);
    }
    if (++bucket.count > RATE_LIMIT) {
      reject(res, 429, "rate limited");
      finish(429, "rate-limit");
      return;
    }

    // ── 7. Verb allowlist ──
    const handler = ROUTES[verb];
    if (!handler) {
      reject(res, 404, "unknown verb");
      finish(404, verb.slice(0, 64));
      return;
    }

    void Promise.resolve()
      .then(handler)
      .then((data) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data }));
        finish(200, verb);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        reject(res, 500, "verb failed");
        finish(500, `${verb}:${msg.slice(0, 120)}`);
      });
  });

  // Server-level timeouts. headersTimeout/requestTimeout are the standard
  // knobs; on Node 22 a stalled PARTIAL header block is not covered by
  // headersTimeout (verified: only the socket-inactivity timeout fires),
  // so server.timeout is also bounded at SOCKET_IDLE_MS and its handler
  // destroys the stalled socket. In-flight requests are separately
  // bounded by requestTimeout; keep-alive idle by keepAliveTimeout.
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.timeout = SOCKET_IDLE_MS;
  server.on("timeout", (socket) => socket.destroy());

  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
  };
}
