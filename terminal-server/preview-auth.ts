import { timingSafeEqual } from "crypto";
import {
  isWorkspacePreviewTokenConfigured,
  verifyWorkspacePreviewToken,
} from "./preview/preview-token";

export type PreviewAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string; errorCode: string };

/**
 * Check the preview access token for GET /preview/:workspaceId/*.
 *
 * Two channels, checked in order:
 *
 * 1. SIGNED PER-WORKSPACE TOKEN (Phase 2, preferred). A short-lived
 *    token minted by the web app, bound to exactly one workspace
 *    (see preview/preview-token.ts). When `workspaceId` is supplied
 *    and the token verifies against it, access is granted — no
 *    shared secret crosses the wire, and one workspace's token is
 *    useless for any other workspace.
 *
 * 2. LEGACY GLOBAL TOKEN (transition). The single static
 *    PREVIEW_ACCESS_TOKEN every workspace shared. Kept working until
 *    the web app's buildPreviewProxyUrl mints signed tokens instead
 *    (specced in PHASE2-PRODUCTION-READINESS-REPORT.md); retiring it
 *    is then just unsetting the env var here.
 *
 * FAIL-CLOSED: when NEITHER channel is configured on the server,
 * every request is denied (503) instead of letting unauthenticated
 * traffic through. Previously the check was `if (expectedToken && ...)` —
 * an unset token silently disabled authentication and exposed any
 * workspace's running preview to the public internet. When a channel
 * IS configured but the presented token matches neither, the denial
 * is 401.
 */
export function checkPreviewToken(
  providedToken: string,
  workspaceId?: string,
): PreviewAuthResult {
  // Channel 1: signed per-workspace token.
  if (
    workspaceId &&
    providedToken &&
    verifyWorkspacePreviewToken(providedToken, workspaceId)
  ) {
    return { ok: true };
  }

  // Channel 2: legacy global token.
  const expectedToken = process.env.PREVIEW_ACCESS_TOKEN ?? "";
  if (expectedToken) {
    const a = Buffer.from(providedToken);
    const b = Buffer.from(expectedToken);
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (match) {
      return { ok: true };
    }
    return {
      ok: false,
      status: 401,
      error: "Invalid preview token",
      errorCode: "invalid_preview_token",
    };
  }

  // No legacy token configured. If the signed channel IS configured,
  // a presented-but-unverifiable token is a plain 401; if NOTHING is
  // configured, the deployment never set preview auth up — 503.
  const signedConfigured = workspaceId
    ? isWorkspacePreviewTokenConfigured()
    : false;
  if (!signedConfigured) {
    return {
      ok: false,
      status: 503,
      error: "Preview access is not configured on this server",
      errorCode: "preview_token_not_configured",
    };
  }
  return {
    ok: false,
    status: 401,
    error: "Invalid preview token",
    errorCode: "invalid_preview_token",
  };
}
