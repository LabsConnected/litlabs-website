/**
 * Network egress policy for the browser driver — shared by the URL-level
 * guards (assertPublicHttpUrl / assertPublicHttpDestination) and the
 * local enforcing forward proxy (startEgressProxy) that Chrome is
 * launched through.
 *
 * Policy: the agent must not reach local services, LAN hosts, or cloud
 * metadata endpoints through the browser — page content is untrusted
 * input and a prompt-injected page could otherwise exfiltrate via
 * http://169.254.169.254/ or pivot into the internal network.
 *
 * Why a proxy and not only URL checks: Chrome resolves DNS itself at
 * connect time, so a hostname that passed a one-time lookup can rebind
 * to a private address before Chrome connects (DNS rebinding), and
 * Fetch-domain interception does not cover dedicated workers or every
 * network path. The proxy is the authoritative layer: EVERY connection
 * Chrome makes is a CONNECT (https/wss) or absolute-URI request that we
 * validate and then connect to the already-validated IP — Chrome never
 * performs its own resolution for proxied traffic, which removes the
 * validation-to-connection race entirely.
 *
 * LITT_BROWSER_ALLOW_PRIVATE=1 is the explicit dev opt-out: it disables
 * the proxy AND the URL guards, preserving trusted local workflows
 * (e.g. browsing a localhost dev server).
 */

import { lookup } from "node:dns/promises";
import { connect, isIP, type Socket } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split(".").map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true; // unparseable → deny
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 || // this-net, private, loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved + broadcast
  );
}

function ipv6IsPrivate(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true; // link-local, ULA
  // IPv4-mapped IPv6 (::ffff:a.b.c.d). Node's URL parser normalizes the
  // dotted form to hex (::ffff:7f00:1), so handle both representations —
  // otherwise a mapped loopback/private address would slip the guard.
  const mapped = s.match(/^::ffff:(.+)$/);
  if (mapped) {
    const rest = mapped[1];
    if (/^\d+\.\d+\.\d+\.\d+$/.test(rest)) return ipv4IsPrivate(rest);
    const groups = rest.split(":");
    if (groups.length === 2) {
      const hi = parseInt(groups[0], 16);
      const lo = parseInt(groups[1], 16);
      if (!Number.isNaN(hi) && !Number.isNaN(lo) && hi <= 0xffff && lo <= 0xffff) {
        return ipv4IsPrivate(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
    }
    return true; // unrecognized mapped form → deny
  }
  return false;
}

function addressIsPublic(address: string, family: number): boolean {
  if (family === 4) return !ipv4IsPrivate(address);
  if (family === 6) return !ipv6IsPrivate(address);
  return false; // unknown family → deny
}

export type DnsResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** Thrown when the egress policy itself refuses a destination. */
export class EgressPolicyError extends Error {}

const defaultResolver: DnsResolver = async (hostname) => {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family }));
};

interface DnsVerdict { ok: boolean; ip: string | null; expires: number }
const DNS_CACHE_TTL_MS = 15_000;
const dnsCache = new Map<string, DnsVerdict>();

/**
 * Literal-host check shared by the URL guard and the proxy: rejects
 * private/loopback/link-local IP literals, localhost and internal
 * names. Returns the normalized lowercase hostname on success.
 */
export function assertPublicHostname(host: string): string {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (PRIVATE_HOSTNAMES.has(h) || h.endsWith(".localhost") || h.endsWith(".internal")) {
    throw new EgressPolicyError(`destination refused: ${h} is a local/internal host`);
  }
  const kind = isIP(h);
  if (kind === 4 && ipv4IsPrivate(h)) {
    throw new EgressPolicyError(`destination refused: ${h} is a private/reserved address`);
  }
  if (kind === 6 && ipv6IsPrivate(h)) {
    throw new EgressPolicyError(`destination refused: ${h} is a private/reserved address`);
  }
  return h;
}

/**
 * Resolve `host` and require EVERY answer to be a public address.
 * Returns the first resolved address — the IP the caller should connect
 * to ("pinning": the validated answer is the connected answer, so there
 * is no second resolution an attacker can rebind). Lookup failure or an
 * empty answer fails closed. Literal IPs return themselves.
 *
 * Verdicts are cached per-host for DNS_CACHE_TTL_MS so subresource
 * bursts don't stampede the resolver; the cached IP is itself a
 * previously-validated public address, so a stale entry can only ever
 * pin an old public IP, never authorize a new private one.
 */
export async function resolvePublicIp(
  host: string,
  resolve: DnsResolver = defaultResolver,
): Promise<string> {
  const h = assertPublicHostname(host);
  if (isIP(h)) return h;
  const cached = dnsCache.get(h);
  if (cached && cached.expires > Date.now()) {
    if (!cached.ok || !cached.ip) throw new EgressPolicyError(`destination refused: ${h} resolves to a private/reserved address`);
    return cached.ip;
  }
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await resolve(h);
  } catch (e) {
    throw new EgressPolicyError(`destination refused: could not verify ${h} resolves publicly (${(e as Error).message})`);
  }
  const ok = addrs.length > 0 && addrs.every((a) => addressIsPublic(a.address, a.family));
  dnsCache.set(h, { ok, ip: ok ? addrs[0].address : null, expires: Date.now() + DNS_CACHE_TTL_MS });
  if (!ok) {
    throw new EgressPolicyError(`destination refused: ${h} resolves to a private/reserved address`);
  }
  return addrs[0].address;
}

/**
 * Throws when `raw` is not a public http(s) URL. Returns the normalized
 * URL string on success. Literal checks only — for the full DNS check
 * use assertPublicHttpDestination.
 */
export function assertPublicHttpUrl(raw: string): string {
  if (process.env.LITT_BROWSER_ALLOW_PRIVATE === "1") {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error(`browser.navigate only supports http(s) URLs, got ${u.protocol}`);
    }
    return u.toString();
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`browser.navigate got an invalid URL: ${raw.slice(0, 120)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`browser.navigate only supports http(s) URLs, got ${u.protocol}`);
  }
  assertPublicHostname(u.hostname);
  return u.toString();
}

/**
 * Async counterpart to assertPublicHttpUrl: literal checks PLUS DNS
 * resolution of hostname destinations via resolvePublicIp.
 */
export async function assertPublicHttpDestination(
  raw: string,
  resolve: DnsResolver = defaultResolver,
  allowPrivate = process.env.LITT_BROWSER_ALLOW_PRIVATE === "1",
): Promise<string> {
  const normalized = assertPublicHttpUrl(raw); // scheme + literal-host checks (also honors allowPrivate)
  if (allowPrivate) return normalized;
  const host = new URL(normalized).hostname;
  await resolvePublicIp(host, resolve);
  return normalized;
}

// ─── Enforcing forward proxy ───────────────────────────────────────
//
// Chrome is launched with --proxy-server pointing here, so ALL network
// egress — main documents, redirects, subresources, dedicated workers,
// service workers, WebSockets — passes through this process. Two request
// forms are handled:
//
//   CONNECT host:port          → https/wss. Validate host, connect to the
//                                pinned IP, tunnel bytes. TLS stays
//                                end-to-end between Chrome and the origin.
//   GET http://host/path ...   → plain http. Validate host, forward the
//                                request to the pinned IP preserving the
//                                original Host header.
//   ... with Upgrade: ws       → plain ws://. Same tunnel treatment as
//                                CONNECT after validation.
//
// Anything that fails validation gets an immediate 403; anything
// unparseable fails closed. There is no bypass: --proxy-bypass-list
// "<-loopback>" removes Chrome's implicit localhost exemption so even
// loopback targets are forced through policy.

export interface EgressProxy {
  port: number;
  close: () => Promise<void>;
}

/**
 * Injectable TCP dial — returns a socket (still connecting is fine;
 * callers that need a live connection await 'connect'). Tests substitute
 * a loopback dial to avoid real egress.
 */
export type EgressDial = (ip: string, port: number) => Socket;

const UPSTREAM_CONNECT_TIMEOUT_MS = 10_000;
// Proxy-specific headers that must not reach the origin when the raw
// request head is replayed into the upstream tunnel.
const PROXY_HEADERS = new Set([
  "proxy-connection", "proxy-authorization", "proxy-authenticate",
]);

function denySocket(socket: Socket, status = "403 Forbidden"): void {
  try {
    socket.write(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
  } catch { /* ignore */ }
  socket.destroy();
}

/**
 * Start the enforcing proxy on 127.0.0.1 (ephemeral port). Fails closed:
 * if the server cannot bind, launch() propagates the error and no
 * browser starts.
 */
export async function startEgressProxy(
  resolve: DnsResolver = defaultResolver,
  dial: EgressDial = (ip, port) => connect({ host: ip, port }),
): Promise<EgressProxy> {
  const sockets = new Set<Socket>();
  const track = (s: Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  };

  const openUpstream = async (host: string, port: number): Promise<Socket> => {
    const ip = await resolvePublicIp(host, resolve);
    const s = dial(ip, port);
    s.setTimeout(UPSTREAM_CONNECT_TIMEOUT_MS, () => s.destroy(new Error("upstream connect timeout")));
    if (!s.connecting) return s;
    await new Promise<void>((res, rej) => {
      s.once("connect", () => { s.setTimeout(0); res(); });
      s.once("error", rej);
    });
    return s;
  };

  const server: Server = createServer();
  // Track every accepted socket — including ones that connect and never
  // send a request — so close() can destroy them and server.close()
  // cannot hang on an idle connection.
  server.on("connection", track);
  server.on("secureConnection", track);

  // CONNECT authority → tunnel to pinned IP.
  server.on("connect", (req: IncomingMessage, client: Socket, head: Buffer) => {
    void (async () => {
      let host = "";
      let port = 443;
      try {
        const u = new URL(`http://${req.url ?? ""}`);
        host = u.hostname;
        port = u.port ? parseInt(u.port, 10) : 443;
        if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) throw new EgressPolicyError("bad authority");
        const upstream = await openUpstream(host, port);
        track(upstream);
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
      } catch (e) {
        denySocket(client, e instanceof EgressPolicyError ? "403 Forbidden" : "502 Bad Gateway");
      }
    })();
  });

  // Rebuild the raw request head (request line + headers, minus
  // proxy-* headers) for replay into an upstream tunnel. Used by
  // plain-http requests and WebSocket upgrades alike.
  const rawRequestHead = (req: IncomingMessage): string => {
    const lines: string[] = [];
    for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
      if (PROXY_HEADERS.has(req.rawHeaders[i].toLowerCase())) continue;
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    return `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${lines.join("\r\n")}\r\n\r\n`;
  };

  // Validate an absolute-URI http request and return {host, port}.
  const parseHttpTarget = (req: IncomingMessage): { host: string; port: number } => {
    const u = new URL(req.url ?? "");
    if (u.protocol !== "http:") throw new EgressPolicyError("non-http absolute URI");
    return { host: u.hostname, port: u.port ? parseInt(u.port, 10) : 80 };
  };

  // Absolute-URI http request → validate, then tunnel raw bytes to the
  // pinned IP. This is a true end-to-end tunnel: keep-alive and any
  // subsequent requests on the same client connection flow through
  // untouched, exactly like CONNECT.
  //
  // Body handling: the HTTP parser owns the socket until the request
  // body is consumed, so the parsed body is forwarded via req.pipe()
  // first; only after 'end' (or immediately for bodyless requests) is
  // the socket detached into raw mode for keep-alive traffic.
  server.on("request", (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const { host, port } = parseHttpTarget(req);
        const upstream = await openUpstream(host, port);
        track(upstream);
        upstream.write(rawRequestHead(req));
        upstream.pipe(req.socket);
        // end:false — the request body must not FIN the upstream socket;
        // keep-alive connections carry further requests after it.
        req.pipe(upstream, { end: false });
        const handoff = () => {
          res.detachSocket(req.socket);
          req.socket.pipe(upstream);
        };
        if (req.complete || req.readableEnded) handoff();
        else req.on("end", handoff);
        upstream.on("error", () => req.socket.destroy());
        req.socket.on("error", () => upstream.destroy());
      } catch (e) {
        if (!res.headersSent) res.writeHead(e instanceof EgressPolicyError ? 403 : 502);
        res.end();
      }
    })();
  });

  // WebSocket handshake (ws://) arrives as an HTTP Upgrade request —
  // Node routes it to 'upgrade', not 'request'. Same tunnel treatment.
  server.on("upgrade", (req: IncomingMessage, client: Socket, head: Buffer) => {
    void (async () => {
      try {
        const { host, port } = parseHttpTarget(req);
        const upstream = await openUpstream(host, port);
        track(upstream);
        upstream.write(rawRequestHead(req));
        if (head?.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
        upstream.on("error", () => client.destroy());
        client.on("error", () => upstream.destroy());
      } catch (e) {
        denySocket(client, e instanceof EgressPolicyError ? "403 Forbidden" : "502 Bad Gateway");
      }
    })();
  });

  server.on("clientError", (_err, socket) => {
    denySocket(socket as Socket);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  if (!port) {
    server.close();
    throw new Error("egress proxy failed to bind");
  }

  return {
    port,
    close: () => new Promise<void>((resolveClose) => {
      for (const s of sockets) { try { s.destroy(); } catch { /* ignore */ } }
      sockets.clear();
      server.close(() => resolveClose());
    }),
  };
}
