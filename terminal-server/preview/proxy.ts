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

    // The public origin the browser used, as the upstream app sees it via
    // forwarded headers. The app builds absolute URLs (and auth-handshake
    // redirect_url params) against this origin after the proxy strips the
    // mount prefix — rewritePreviewLocation uses it to tell self-redirects
    // apart from genuinely external links.
    const firstHeaderValue = (v: unknown): string =>
      String(Array.isArray(v) ? v[0] : (v ?? "")).split(",")[0].trim();
    const publicHost =
      firstHeaderValue(req.headers["x-forwarded-host"]) ||
      firstHeaderValue(req.headers.host);
    const publicProto =
      firstHeaderValue(req.headers["x-forwarded-proto"]) || "https";
    const publicOrigin = publicHost ? `${publicProto}://${publicHost}` : undefined;
    const locationOpts = {
      workspaceId,
      token: previewToken,
      upstreamPort,
      publicOrigin,
    };

    // Proxy the request to localhost:<port>
    const strippedPath = req.url.replace(/^\/preview\/[^/]+/, "");
    const targetUrl = `http://127.0.0.1:${upstreamPort}${strippedPath}`;
    try {
      const proxyResp = await fetch(targetUrl, {
        method: req.method,
        headers: {
          ...req.headers as Record<string, string>,
          host: `127.0.0.1:${upstreamPort}`,
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : (req as any),
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
        const pathOnly = strippedPath.split("?")[0] || "/";
        console.warn(
          `[Preview] upstream redirect workspace=${workspaceId} ` +
            `port=${upstreamPort} path=${pathOnly} status=${proxyResp.status} ` +
            `location=${rawLocation} ` +
            `rewritten=${rewritePreviewLocation(rawLocation, locationOpts)} ` +
            `server=${proxyResp.headers.get("server") ?? "-"} ` +
            `poweredBy=${proxyResp.headers.get("x-powered-by") ?? "-"}`,
        );
      }

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
