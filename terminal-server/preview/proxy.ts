/**
 * Public preview proxy — /preview/:workspaceId/*
 *
 * Forwards HTTP requests to the workspace's dev server on
 * 127.0.0.1:<runtime.port>. This is how the Studio iframe reaches the
 * running application.
 *
 * Access is protected by a preview token presented via ?token= query,
 * X-Preview-Token header, the __litt_preview_<wsid> cookie this proxy
 * sets on every authenticated response, or a same-origin Referer inside
 * the workspace's mount (the channel runtime-generated requests —
 * fetch(), <link>/<script> subresources, WS upgrades — rely on). The
 * check is FAIL-CLOSED: when PREVIEW_ACCESS_TOKEN is not configured,
 * all requests are denied.
 *
 * This handler lives in its own module — rather than inline in
 * server.ts — so the routing-parity regression tests exercise the SAME
 * code the server registers (see __tests__/preview-proxy-parity.test.ts
 * and workspace-routes.ts for the convention).
 */

import type { Application, NextFunction, Response } from "express";
import type { IncomingMessage } from "http";
import { createConnection } from "net";
import type { Duplex } from "stream";

import { checkPreviewToken } from "../preview-auth";
import {
  getPreviewStatus as defaultGetPreviewStatus,
  decideProxiedEntryResponse,
  markPreviewRootRouteMissing,
  markPreviewBackendUnreachable,
  buildPreviewErrorPage,
} from "./PreviewManager";
import {
  shouldInjectInspector,
  injectInspector as injectInspectorScript,
} from "./inspector";
import {
  rewritePreviewAssetUrls,
  rewritePreviewCssUrls,
  rewritePreviewJsUrls,
  rewritePreviewLocation,
  isRehomedAuthHandshake,
} from "./asset-urls";
import {
  isPreviewScopedRedirect,
  stripPreviewAuthHeaders,
  resolvePreviewToken,
  resolveEscapedWorkspace,
  buildPreviewCookie,
  upstreamCookieHeader,
  previewCookieName,
  cookieHeaderValue,
} from "./proxy-security";
import type { AuthenticatedRequest } from "../internal-auth";

type PreviewStatusSnapshot = ReturnType<typeof defaultGetPreviewStatus>;

export interface PreviewProxyDeps {
  /** Injected for tests; defaults to the real PreviewManager runtime store. */
  getPreviewStatus?: (workspaceId: string) => PreviewStatusSnapshot;
  markPreviewRootRouteMissing?: (workspaceId: string) => boolean;
  markPreviewBackendUnreachable?: (workspaceId: string) => boolean;
}

/**
 * Headers that must never be forwarded verbatim from the upstream dev
 * server. undici transparently decodes compressed bodies, so the bytes
 * we send no longer match a forwarded content-encoding/content-length —
 * the browser then fails decoding and the page renders as raw unstyled
 * HTML. transfer-encoding/connection/keep-alive are hop-by-hop and owned
 * by Express; x-frame-options is dropped so Studio can embed the preview
 * (Studio's own CSP still controls which hosts may be framed).
 */
const NEVER_FORWARD_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "x-frame-options",
  "content-encoding",
  "content-length",
]);

/**
 * The app's own CSP may carry frame-ancestors — inside the Studio iframe
 * 'self' resolves to the terminal-server origin, not the app, so a
 * 'frame-ancestors 'self'' would block embedding entirely. Strip just
 * that directive; every other CSP rule survives untouched.
 */
function stripFrameAncestorsDirective(csp: string): string | null {
  const kept = csp
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !d.toLowerCase().startsWith("frame-ancestors"));
  return kept.length ? kept.join("; ") : null;
}

function firstHeaderValue(v: unknown): string {
  return String(Array.isArray(v) ? v[0] : (v ?? "")).split(",")[0].trim();
}

interface ForwardPreviewOptions {
  req: AuthenticatedRequest | IncomingMessage;
  res: Response;
  workspaceId: string;
  /** The validated preview token (query/header/cookie/referer channel). */
  token: string;
  status: PreviewStatusSnapshot;
  /** Path+query to request upstream — already mount-stripped. */
  upstreamPath: string;
  /** Public origin the browser used (x-forwarded-host/proto). */
  publicOrigin?: string;
  markRootRouteMissing: (workspaceId: string) => boolean;
  markUnreachable: (workspaceId: string) => boolean;
}

/**
 * Fetch one request from the workspace dev server and stream it back to
 * the browser with the preview rules applied: scoped redirects, entry
 * servability guard, per-type body rewriting, and honest error pages.
 */
async function forwardPreviewRequest(opts: ForwardPreviewOptions): Promise<void> {
  const {
    req,
    res,
    workspaceId,
    token,
    status,
    upstreamPath,
    publicOrigin,
    markRootRouteMissing,
    markUnreachable,
  } = opts;
  const upstreamPort = status.port!;

  const locationOpts = {
    workspaceId,
    token,
    upstreamPort,
    publicOrigin,
  };

  const targetUrl = `http://127.0.0.1:${upstreamPort}${upstreamPath}`;
  try {
    const proxyResp = await fetch(targetUrl, {
      method: req.method,
      headers: stripPreviewAuthHeaders(
        new Headers(req.headers as Record<string, string>),
        upstreamPort,
      ),
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : (req as any),
      redirect: "manual",
    });

    // TEMPORARY diagnostic logging (2026-09-21): fingerprint upstream
    // redirects. A transient 302 from the workspace dev server (~02:30 EDT)
    // escaped the /preview/:workspaceId mount and landed the Studio iframe
    // on "Cannot GET /". The emitter is unidentified and the 302 no longer
    // reproduces, so log the full fingerprint of any upstream 3xx while it
    // is live. Purely additive — no behavior change. Safe to remove once
    // the emitter is found. (Never logs the preview token or cookies.)
    if (proxyResp.status >= 300 && proxyResp.status < 400) {
      const rawLocation = proxyResp.headers.get("location") ?? "(none)";
      const pathOnly = upstreamPath.split("?")[0] || "/";
      console.warn(
        `[Preview] upstream redirect workspace=${workspaceId} ` +
          `port=${upstreamPort} path=${pathOnly} status=${proxyResp.status} ` +
          `location=${rawLocation} ` +
          `rewritten=${rewritePreviewLocation(rawLocation, locationOpts)} ` +
          `server=${proxyResp.headers.get("server") ?? "-"} ` +
          `poweredBy=${proxyResp.headers.get("x-powered-by") ?? "-"}`,
      );
    }

    // Redirect escape guard: the Location handed to the browser must
    // stay inside /preview/<workspaceId>. In-mount redirects and the
    // ones rewritePreviewLocation re-homes (root-relative, absolute
    // back at this dev server) pass through; anything that still
    // resolves outside the mount — an external hosted-auth bounce, a
    // foreign host, traversal that escapes the mount — is rejected
    // rather than forwarded to the iframe.
    //
    // Exception — the re-homed auth handshake: the upstream app builds
    // redirect_url from its forwarded headers, pointing at the bare
    // public origin; rewritePreviewLocation re-homes that param inside
    // the mount. The outer redirect still targets the external auth
    // provider (Clerk handshake), which the scope check alone would
    // reject — so a redirect whose redirect_url param was re-homed from
    // outside the mount to inside it is let through. The handshake
    // completes and the browser lands back inside the mount; a redirect
    // whose param was already in-mount (or never pointed at our origin)
    // stays subject to the guard.
    const redirectLocation = proxyResp.headers.get("location");
    if (proxyResp.status >= 300 && proxyResp.status < 400) {
      const rewrittenLocation =
        redirectLocation === null
          ? null
          : rewritePreviewLocation(redirectLocation, locationOpts);
      const scoped = isPreviewScopedRedirect(
        rewrittenLocation,
        workspaceId,
        req.headers.host ? String(req.headers.host) : undefined,
      );
      const authHandshake =
        redirectLocation !== null &&
        isRehomedAuthHandshake(redirectLocation, rewrittenLocation ?? "", {
          workspaceId,
          publicOrigin,
        });
      if (!scoped && !authHandshake) {
        res.status(502).json({
          error: "preview_escape_redirect",
          message: "Workspace attempted to redirect outside preview scope",
          location: redirectLocation,
        });
        return;
      }
    }

    // Entry-path servability guard (2026-09-18): a 404 on / means the
    // process on the preview port is not serving the app. The old code
    // forwarded the backend's white "Cannot GET /" while the UI still
    // said "Preview ready". Flip the runtime to failed and serve an
    // honest error page instead — never the raw backend 404.
    if (decideProxiedEntryResponse(upstreamPath, proxyResp.status) === "entry_route_missing") {
      markRootRouteMissing(workspaceId);
      res.status(502).setHeader("content-type", "text/html; charset=utf-8");
      res.send(buildPreviewErrorPage({
        heading: "Preview isn't serving the app",
        message: "The preview server answered, but the app entry route (/) returned 404 — the process on the preview port is not serving your project. This is usually a stale or wrong dev server holding the port.",
        command: status.command,
        framework: status.framework,
        errorCode: "preview_root_route_missing",
        workspaceId,
      }));
      return;
    }

    const contentType = proxyResp.headers.get("content-type") ?? "";
    const ok = proxyResp.status >= 200 && proxyResp.status < 300;
    const injectInspector = shouldInjectInspector(proxyResp.status, contentType);
    const isCss = ok && contentType.toLowerCase().includes("text/css");
    const isJs =
      ok && /(?:java|ecma)script/i.test(contentType);

    // Forward status, headers, and body
    res.status(proxyResp.status);
    proxyResp.headers.forEach((value, key) => {
      const header = key.toLowerCase();

      if (NEVER_FORWARD_HEADERS.has(header)) {
        return;
      }

      // Redirect containment: a root-relative or upstream-loopback
      // Location resolves against the terminal-server origin and escapes
      // the /preview/:workspaceId mount — the browser lands on an
      // Express route that doesn't exist ("Cannot GET /…") while the
      // badge still says ready. Re-home it under the mount instead.
      if (header === "location") {
        res.setHeader(
          "location",
          rewritePreviewLocation(value, locationOpts),
        );
        return;
      }

      // frame-ancestors inside the app's CSP would resolve 'self' to the
      // terminal-server origin and block Studio's embed. Strip only that
      // directive; keep the rest of the policy intact.
      if (header === "content-security-policy") {
        const csp = stripFrameAncestorsDirective(value);
        if (csp) res.setHeader(key, csp);
        return;
      }

      res.setHeader(key, value);
    });

    // Upstream cookies round-trip through the proxy, and every authed
    // response refreshes the workspace's preview credential cookie so
    // runtime requests that can't carry ?token= (fetch, WS upgrades)
    // still authenticate.
    const setCookies = proxyResp.headers.getSetCookie?.() ?? [];
    res.setHeader("set-cookie", [...setCookies, buildPreviewCookie(workspaceId, token)]);

    const body = await proxyResp.arrayBuffer();
    if (injectInspector) {
      // Rewrite document-local URLs so subresources stay inside the
      // /preview/:workspaceId mount and carry the preview token —
      // root-relative refs ("/assets/x", "/_next/...") otherwise escape
      // the mount (404) and relative refs lose auth (401).
      const rewritten = rewritePreviewAssetUrls(
        Buffer.from(body).toString("utf8"),
        { workspaceId, token, pagePath: upstreamPath },
      );
      res.send(injectInspectorScript(rewritten));
      return;
    }
    if (isCss) {
      res.send(rewritePreviewCssUrls(Buffer.from(body).toString("utf8"), {
        workspaceId,
        token,
        cssPath: upstreamPath.split("?")[0],
      }));
      return;
    }
    if (isJs) {
      res.send(rewritePreviewJsUrls(Buffer.from(body).toString("utf8"), {
        workspaceId,
        token,
      }));
      return;
    }
    res.send(Buffer.from(body));
  } catch (err) {
    // The backend died between the status check and the proxy (or was
    // never reachable). An iframe showing raw JSON next to a green
    // "Preview ready" badge is the same lie as the white 404 — flip the
    // runtime and serve the honest error page instead.
    markUnreachable(workspaceId);
    res.status(502).setHeader("content-type", "text/html; charset=utf-8");
    res.send(buildPreviewErrorPage({
      heading: "Preview dev server unreachable",
      message: "The preview proxy could not reach the dev server — it may have crashed after reporting ready.",
      command: status.command,
      framework: status.framework,
      errorCode: "preview_dev_server_failed",
      workspaceId,
    }));
  }
}

export function registerPreviewProxyRoute(
  app: Application,
  deps: PreviewProxyDeps = {},
): void {
  const getStatus = deps.getPreviewStatus ?? defaultGetPreviewStatus;
  const markRootRouteMissing =
    deps.markPreviewRootRouteMissing ?? markPreviewRootRouteMissing;
  const markUnreachable =
    deps.markPreviewBackendUnreachable ?? markPreviewBackendUnreachable;

  app.use("/preview/:workspaceId", async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.params.workspaceId;

    // Verify preview token — fail CLOSED when the token is not configured.
    // Runtime-generated requests authenticate through the workspace cookie
    // or a same-origin in-mount Referer instead of ?token=.
    const previewToken = resolvePreviewToken(req, workspaceId);
    const previewAuth = checkPreviewToken(previewToken);
    if (!previewAuth.ok) {
      res.status(previewAuth.status).json({ error: previewAuth.error, errorCode: previewAuth.errorCode });
      return;
    }

    const status = getStatus(workspaceId);
    if (status.status !== "ready" || !status.port) {
      res.status(503).json({
        error: status.error ?? "Preview not ready",
        errorCode: status.errorCode ?? "preview_not_ready",
        status: status.status,
        command: status.command,
        framework: status.framework,
      });
      return;
    }

    // The public origin the browser used, as the upstream app sees it via
    // forwarded headers. The app builds absolute URLs (and auth-handshake
    // redirect_url params) against this origin after the proxy strips the
    // mount prefix — rewritePreviewLocation uses it to tell self-redirects
    // apart from genuinely external links.
    const publicHost =
      firstHeaderValue(req.headers["x-forwarded-host"]) ||
      firstHeaderValue(req.headers.host);
    const publicProto =
      firstHeaderValue(req.headers["x-forwarded-proto"]) || "https";
    const publicOrigin = publicHost ? `${publicProto}://${publicHost}` : undefined;

    // Proxy the request to localhost:<port>
    const strippedPath = req.url.replace(/^\/preview\/[^/]+/, "");
    await forwardPreviewRequest({
      req,
      res,
      workspaceId,
      token: previewToken,
      status,
      upstreamPath: strippedPath || "/",
      publicOrigin,
      markRootRouteMissing,
      markUnreachable,
    });
  });
}

/**
 * Escaped-asset fallback — register LAST, after every real route.
 *
 * Runtime-generated root-absolute requests ("/_next/…" chunk loads,
 * "/@vite/client", "/favicon.ico", "/__nextjs_*" dev tooling) resolve
 * against the terminal-server origin and arrive outside the
 * /preview/:workspaceId mount. When a request arrives here, nothing else
 * claimed it; if a preview cookie or same-origin in-mount Referer ties
 * it to a live workspace, re-home it on that workspace's dev server.
 * Anything without preview context falls through untouched — the plain
 * Express 404 exactly as before.
 */
export function registerPreviewFallbackRoute(
  app: Application,
  deps: PreviewProxyDeps = {},
): void {
  const getStatus = deps.getPreviewStatus ?? defaultGetPreviewStatus;
  const markRootRouteMissing =
    deps.markPreviewRootRouteMissing ?? markPreviewRootRouteMissing;
  const markUnreachable =
    deps.markPreviewBackendUnreachable ?? markPreviewBackendUnreachable;

  app.use(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/preview/") || req.path === "/preview") return next();
    if (req.path.startsWith("/socket.io")) return next();

    const escaped = resolveEscapedWorkspace(
      req.headers as Record<string, unknown>,
    );
    if (!escaped || !escaped.token) return next();
    if (!checkPreviewToken(escaped.token).ok) return next();

    const status = getStatus(escaped.workspaceId);
    if (status.status !== "ready" || !status.port) return next();

    const publicHost =
      firstHeaderValue(req.headers["x-forwarded-host"]) ||
      firstHeaderValue(req.headers.host);
    const publicProto =
      firstHeaderValue(req.headers["x-forwarded-proto"]) || "https";

    await forwardPreviewRequest({
      req,
      res,
      workspaceId: escaped.workspaceId,
      token: escaped.token,
      status,
      upstreamPath: req.url,
      publicOrigin: publicHost ? `${publicProto}://${publicHost}` : undefined,
      markRootRouteMissing,
      markUnreachable,
    });
  });
}

/**
 * WebSocket upgrade tunnel for previewed dev servers — HMR channels
 * (Next's /_next/webpack-hmr, Vite's socket, etc.) arrive here once their
 * URL literals are mount-rewritten or recovered through the preview
 * cookie. Returns true when the upgrade belonged to a preview and was
 * handled (tunnelled or refused); false means "not ours — let other
 * upgrade listeners see it".
 */
export function handlePreviewUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  deps: PreviewProxyDeps = {},
): boolean {
  const getStatus = deps.getPreviewStatus ?? defaultGetPreviewStatus;
  const url = req.url ?? "";

  let workspaceId: string | null = null;
  let upstreamPath = url;
  let token = "";

  const mounted = /^\/preview\/([^/?#]+)((?:[/?#]).*)?$/.exec(url);
  if (mounted) {
    workspaceId = decodeURIComponent(mounted[1]);
    // mounted[2] may start with "?" (e.g. /preview/ws?token=x) — the
    // upstream request line must always carry a leading "/".
    const rest = mounted[2] ?? "";
    upstreamPath = rest.startsWith("/") ? rest : `/${rest}`;
    try {
      token = new URL(`http://preview.invalid${upstreamPath}`).searchParams.get("token") ?? "";
    } catch {
      token = "";
    }
    if (!token) {
      // Mount-rewritten HMR URLs carry ?token=; anything else relies on
      // the workspace's own preview cookie.
      token =
        cookieHeaderValue(
          String(req.headers.cookie ?? ""),
          previewCookieName(workspaceId),
        ) ?? "";
    }
  } else {
    const escaped = resolveEscapedWorkspace(
      req.headers as Record<string, unknown>,
    );
    if (!escaped) return false;
    workspaceId = escaped.workspaceId;
    token = escaped.token;
  }

  if (!workspaceId || !checkPreviewToken(token).ok) {
    socket.destroy();
    return true;
  }

  const status = getStatus(workspaceId);
  if (status.status !== "ready" || !status.port) {
    socket.destroy();
    return true;
  }

  const upstream = createConnection(status.port, "127.0.0.1");
  // A closed leg must sever the whole tunnel — a half-open client socket
  // would otherwise pin a dev-server connection forever (and vice versa).
  upstream.on("error", () => socket.destroy());
  upstream.on("close", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());

  const headerLines: string[] = [];
  for (const [key, raw] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "authorization" ||
      lower === "x-preview-token" ||
      lower === "x-forwarded-host" ||
      lower === "x-forwarded-proto" ||
      lower === "x-forwarded-port" ||
      lower === "forwarded"
    ) {
      continue;
    }
    if (lower === "cookie") {
      const kept = upstreamCookieHeader(String(raw ?? ""));
      if (kept) headerLines.push(`cookie: ${kept}`);
      continue;
    }
    if (Array.isArray(raw)) {
      for (const v of raw) headerLines.push(`${key}: ${v}`);
    } else if (raw !== undefined) {
      headerLines.push(`${key}: ${raw}`);
    }
  }

  upstream.on("connect", () => {
    upstream.write(
      `${req.method} ${upstreamPath} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${status.port}\r\n` +
        headerLines.map((l) => `${l}\r\n`).join("") +
        `\r\n`,
    );
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  return true;
}
