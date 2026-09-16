import { createHash, timingSafeEqual } from "crypto";
import { previewCookiePath } from "./preview/proxy-path";

export type PreviewAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string; errorCode: string };

/** Workspace-specific cookie name prevents one preview tab from selecting another workspace. */
export function previewSessionCookieName(workspaceId: string): string {
  const digest = createHash("sha256").update(workspaceId).digest("hex").slice(0, 24);
  return `litt_preview_${digest}`;
}

export function readPreviewSessionCookie(cookieHeader: string | undefined, workspaceId: string): string {
  if (!cookieHeader) return "";
  const name = previewSessionCookieName(workspaceId);
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

export function previewSessionSetCookie(workspaceId: string, token: string): string {
  return `${previewSessionCookieName(workspaceId)}=${encodeURIComponent(token)}; Path=${previewCookiePath(workspaceId)}; Max-Age=3600; HttpOnly; SameSite=Lax; Secure`;
}

/**
 * Check the preview access token for GET /preview/:workspaceId/*.
 *
 * FAIL-CLOSED: when PREVIEW_ACCESS_TOKEN is not configured on the server,
 * every request is denied (503) instead of letting unauthenticated traffic
 * through. Previously the check was `if (expectedToken && ...)` — an unset
 * token silently disabled authentication and exposed any workspace's
 * running preview to the public internet.
 *
 * The website must set the same PREVIEW_ACCESS_TOKEN so its redirect URLs
 * (buildPreviewProxyUrl) carry a valid `?token=` query parameter.
 */
export function checkPreviewToken(providedToken: string): PreviewAuthResult {
  const expectedToken = process.env.PREVIEW_ACCESS_TOKEN ?? "";

  if (!expectedToken) {
    return {
      ok: false,
      status: 503,
      error: "Preview access is not configured on this server",
      errorCode: "preview_token_not_configured",
    };
  }

  const a = Buffer.from(providedToken);
  const b = Buffer.from(expectedToken);
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    return {
      ok: false,
      status: 401,
      error: "Invalid preview token",
      errorCode: "invalid_preview_token",
    };
  }

  return { ok: true };
}
