/**
 * Public preview proxy — /preview/:workspaceId/*
 *
 * Forwards HTTP requests to the workspace's dev server on
 * 127.0.0.1:<runtime.port>. This is how the Studio iframe reaches the
 * running application.
 *
 * Access is protected by a preview token query parameter (or
 * X-Preview-Token header). The check is FAIL-CLOSED: when
 * PREVIEW_ACCESS_TOKEN is not configured, all requests are denied.
 *
 * This handler lives in its own module — rather than inline in
 * server.ts — so the routing-parity regression tests exercise the SAME
 * code the server registers (see __tests__/preview-proxy-parity.test.ts
 * and workspace-routes.ts for the convention).
 */

import type { Application, Response } from "express";
import type { IncomingHttpHeaders } from "http";

import { checkPreviewToken } from "../preview-auth";
import {
  getPreviewStatus as defaultGetPreviewStatus,
  decideProxiedEntryResponse,
  markPreviewRootRouteMissing,
  markPreviewBackendUnreachable,
  markPreviewEscapeRedirect,
  buildPreviewErrorPage,
} from "./PreviewManager";
import {
  shouldInjectInspector,
  injectInspector as injectInspectorScript,
  INSPECTOR_DROPPED_HEADERS,
} from "./inspector";
import { rewritePreviewAssetUrls, rewritePreviewLocation } from "./asset-urls";
import type { AuthenticatedRequest } from "../internal-auth";

type PreviewStatusSnapshot = ReturnType<typeof defaultGetPreviewStatus>;

export interface PreviewProxyDeps {
  /** Injected for tests; defaults to the real PreviewManager runtime store. */
  getPreviewStatus?: (workspaceId: string) => PreviewStatusSnapshot;
  markPreviewRootRouteMissing?: (workspaceId: string) => boolean;
  markPreviewBackendUnreachable?: (workspaceId: string) => boolean;
  markPreviewEscapeRedirect?: (workspaceId: string) => boolean;
}

// ─── Request-header boundary ────────────────────────────────────────
// This proxy is the trust boundary between the authenticated browser
// context and workspace code. Requests arrive carrying the user's
// terminal-origin session material — Clerk cookies (__session,
// __clerk_*), Authorization — plus client-supplied edge identity headers
// (X-Forwarded-*, Forwarded, CF-*) that edge/CDN front-ends normally own.
// Forwarding them into the workspace dev server lets untrusted generated
// code ride the user's session and lets clients spoof edge identity.
// The proxy therefore sends an explicit allowlist-shaped header set
// upstream — never the raw `...req.headers` spread.

/** Exact request headers dropped before forwarding upstream. */
const STRIPPED_REQUEST_HEADERS = new Set([
  // Auth/session material owned by the gateway origin
  "cookie",
  "authorization",
  "proxy-authorization",
  "proxy-authenticate",
  "x-preview-token",
  "x-internal-service-key",
  "x-api-key",
  // Client-supplied edge/forwarding identity — spoofable by the caller
  "forwarded",
  "x-real-ip",
  "true-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  // Hop-by-hop headers (RFC 9110 §7.6.1) — describe this hop, not the next
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Header prefixes dropped before forwarding upstream. */
const STRIPPED_REQUEST_HEADER_PREFIXES = [
  "x-forwarded-", // for/host/proto/port/server/...
  "cf-", // Cloudflare edge headers (cf-connecting-ip, cf-ray, ...)
  "x-clerk-", // Clerk handshake/status headers
  "x-vercel-", // Vercel edge headers
];

/**
 * Build the header set forwarded to the workspace dev server. Drops
 * session/auth material, client-supplied forwarding identity, hop-by-hop
 * headers, and any header named by the request's own `Connection` token
 * list (which marks it hop-by-hop). Multi-value headers are joined per
 * HTTP list semantics.
 */
export function stripAuthHeaders(
  headers: IncomingHttpHeaders,
): Record<string, string> {
  // Any header named by `Connection` is hop-by-hop for this hop.
  const connectionTokens = new Set<string>();
  const connection = headers["connection"];
  const connectionValue = Array.isArray(connection) ? connection.join(",") : connection;
  for (const token of (connectionValue ?? "").split(",")) {
    const name = token.trim().toLowerCase();
    if (name) connectionTokens.add(name);
  }

  const out: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = rawName.toLowerCase();
    if (STRIPPED_REQUEST_HEADERS.has(name)) continue;
    if (connectionTokens.has(name)) continue;
    if (STRIPPED_REQUEST_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

/**
 * Host[:port] identities of this gateway's own public origin. An upstream
 * redirect that targets one of these outside /preview/:workspaceId is an
 * escape, not an external redirect. Sourced from the request's own Host
 * header plus configured public domains so both the custom domain and the
 * Railway-assigned domain are recognized.
 */
function gatewayHostsFor(req: AuthenticatedRequest): string[] {
  return [
    req.headers.host,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.PREVIEW_PROXY_HOST,
    process.env.TERMINAL_PUBLIC_HOST,
  ].filter((h): h is string => Boolean(h));
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
  const markEscapeRedirect =
    deps.markPreviewEscapeRedirect ?? markPreviewEscapeRedirect;

  app.use("/preview/:workspaceId", async (req: AuthenticatedRequest, res: Response) => {
    const workspaceId = req.params.workspaceId;

    // Verify preview token — fail CLOSED when the token is not configured.
    // (checkPreviewToken denies every request if PREVIEW_ACCESS_TOKEN is unset.)
    const previewToken = String(req.query.token || req.headers["x-preview-token"] || "");
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
    const upstreamPort = status.port;

    // Proxy the request to localhost:<port>
    const strippedPath = req.url.replace(/^\/preview\/[^/]+/, "");
    const targetUrl = `http://127.0.0.1:${upstreamPort}${strippedPath}`;
    const gatewayHosts = gatewayHostsFor(req);
    try {
      const proxyResp = await fetch(targetUrl, {
        method: req.method,
        headers: {
          // The browser's authenticated context (cookies, Authorization,
          // edge identity) stops at this boundary — see stripAuthHeaders.
          ...stripAuthHeaders(req.headers),
          host: `127.0.0.1:${upstreamPort}`,
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : (req as any),
        redirect: "manual",
      });

      // Entry-path servability guard (2026-09-18): a 404 on / means the
      // process on the preview port is not serving the app. The old code
      // forwarded the backend's white "Cannot GET /" while the UI still
      // said "Preview ready". Flip the runtime to failed and serve an
      // honest error page instead — never the raw backend 404.
      if (decideProxiedEntryResponse(strippedPath, proxyResp.status) === "entry_route_missing") {
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

      // Successful HTML documents get the inspector bridge injected so the
      // Studio iframe can offer element selection across origins.
      const contentType = proxyResp.headers.get("content-type") ?? "";
      const injectInspector = shouldInjectInspector(proxyResp.status, contentType);

      // Redirect containment is decided up front: a root-relative or
      // upstream-loopback Location resolves against the terminal-server
      // origin and escapes the /preview/:workspaceId mount — the browser
      // lands on an Express route that doesn't exist ("Cannot GET /…")
      // while the badge still says ready. Re-home it under the mount.
      // An absolute Location back at this gateway's own public origin
      // (e.g. https://terminal.litlabs.net/login) is an escape, not an
      // external redirect — re-homing it would risk a redirect loop, so
      // fail explicitly with the honest error page instead.
      const rawLocation = proxyResp.headers.get("location");
      const rewrittenLocation = rawLocation !== null
        ? rewritePreviewLocation(rawLocation, {
            workspaceId,
            token: previewToken,
            upstreamPort,
            gatewayHosts,
          })
        : null;
      if (rewrittenLocation?.action === "escape") {
        markEscapeRedirect(workspaceId);
        res.status(502).setHeader("content-type", "text/html; charset=utf-8");
        res.send(buildPreviewErrorPage({
          heading: "Preview redirect escaped the preview",
          message:
            "The dev server redirected to this gateway's own origin outside the preview mount — the app is building absolute URLs against the wrong host. Fix the app's base-URL or redirect config, then restart preview.",
          command: status.command,
          framework: status.framework,
          errorCode: "preview_escape_redirect",
          workspaceId,
        }));
        return;
      }

      // Forward status, headers, and body
      res.status(proxyResp.status);
      proxyResp.headers.forEach((value, key) => {
        const header = key.toLowerCase();

        // Express manages transfer-encoding. Preview responses must also be
        // frameable by Studio even when the project itself sends DENY/SAMEORIGIN.
        // Studio's parent CSP still controls which preview hosts may be embedded.
        if (header === "transfer-encoding" || header === "x-frame-options") {
          return;
        }

        // Rewritten bodies have a new length and are no longer encoded.
        if (injectInspector && INSPECTOR_DROPPED_HEADERS.has(header)) {
          return;
        }

        if (header === "location") {
          if (rewrittenLocation) {
            res.setHeader("location", rewrittenLocation.location);
          }
          return;
        }

        res.setHeader(key, value);
      });

      const body = await proxyResp.arrayBuffer();
      if (injectInspector) {
        // Rewrite document-local URLs so subresources stay inside the
        // /preview/:workspaceId mount and carry the preview token —
        // root-relative refs ("/assets/x", "/_next/...") otherwise escape
        // the mount (404) and relative refs lose auth (401).
        const rewritten = rewritePreviewAssetUrls(
          Buffer.from(body).toString("utf8"),
          { workspaceId, token: previewToken, pagePath: strippedPath },
        );
        res.send(injectInspectorScript(rewritten));
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
  });
}
