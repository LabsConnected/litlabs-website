const AUTH_FORWARDING_HEADERS = new Set([
  "cookie",
  "authorization",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "forwarded",
  "cf-connecting-ip",
  "cf-ray",
  "x-preview-token",
]);

const PREVIEW_COOKIE_PREFIX = "__litt_preview_";

/**
 * Cookie name carrying the preview token for one workspace. The token is
 * already visible to the previewed app (it sits in the iframe's own URL),
 * so the cookie grants no new authority — it exists so runtime requests
 * the app generates (fetch/XHR/WebSocket upgrades) authenticate without a
 * rewritten ?token= param.
 */
export function previewCookieName(workspaceId: string): string {
  // Cookie names must be RFC6265 tokens — workspace ids are alnum/_- so
  // stripping anything else is a no-op in practice.
  return `${PREVIEW_COOKIE_PREFIX}${workspaceId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/**
 * Set-Cookie value for the workspace's preview cookie. SameSite=None +
 * Secure are required for the cookie to live inside the Studio iframe
 * (the preview page is a third-party context relative to the app origin);
 * Partitioned opts into CHIPS where supported so Chrome's third-party
 * cookie phase-out does not strand runtime requests.
 */
export function buildPreviewCookie(workspaceId: string, token: string): string {
  return `${previewCookieName(workspaceId)}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned`;
}

/** Read one cookie value out of a raw Cookie header string. */
export function cookieHeaderValue(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Rebuild a Cookie header for the upstream workspace with our own preview
 * cookies removed. Forwarding the rest restores ordinary app-cookie
 * behavior (login sessions inside the preview) without leaking the
 * preview credential to the workspace process.
 */
export function upstreamCookieHeader(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;
  const kept = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(PREVIEW_COOKIE_PREFIX));
  return kept.length ? kept.join("; ") : null;
}

/**
 * Extract a preview token presented through an alternate channel for
 * runtime-generated requests. Token-bearing channels, in order:
 *   1. ?token= query / X-Preview-Token header (the canonical channel)
 *   2. __litt_preview_<wsid> cookie (set on every authed response)
 *   3. Same-origin Referer whose path sits inside /preview/<wsid> and
 *      whose query carries the token (subresource + fetch() requests
 *      always send it; the referer can only carry a valid token if the
 *      embedding page already had it)
 */
export function resolvePreviewToken(
  req: { query?: unknown; headers: Record<string, unknown> },
  workspaceId: string,
): string {
  const query = (req.query ?? {}) as Record<string, unknown>;
  const direct = String(query.token || req.headers["x-preview-token"] || "");
  if (direct) return direct;

  const cookieHeader = String(req.headers.cookie ?? "");
  const fromCookie = cookieHeaderValue(cookieHeader, previewCookieName(workspaceId));
  if (fromCookie) return fromCookie;

  const referer = String(req.headers.referer ?? "");
  const host = String(req.headers.host ?? "");
  if (referer && host) {
    try {
      const ref = new URL(referer, `http://${host}`);
      if (ref.host === host) {
        const mount = `/preview/${encodeURIComponent(workspaceId)}`;
        const inMount =
          ref.pathname === mount || ref.pathname.startsWith(`${mount}/`);
        if (inMount) return ref.searchParams.get("token") ?? "";
      }
    } catch {
      // Malformed referer — no token.
    }
  }
  return "";
}

/**
 * For escaped requests — asset URLs the app built root-relative
 * ("/_next/…", "/@vite/client", "/favicon.ico") that land on the terminal
 * origin outside the /preview/:workspaceId mount — recover which
 * workspace they belong to. Resolution order:
 *   1. A __litt_preview_<wsid> cookie (present on fetch/XHR and WebSocket
 *      upgrade requests alike).
 *   2. A same-origin Referer inside /preview/<wsid> (subresource loads).
 * Returns the workspaceId plus the candidate token to validate.
 */
export function resolveEscapedWorkspace(
  headers: Record<string, unknown>,
): { workspaceId: string; token: string } | null {
  const cookieHeader = String(headers.cookie ?? "");
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      if (!name.startsWith(PREVIEW_COOKIE_PREFIX)) continue;
      const workspaceId = name.slice(PREVIEW_COOKIE_PREFIX.length);
      if (!workspaceId) continue;
      const raw = part.slice(eq + 1).trim();
      let token = raw;
      try {
        token = decodeURIComponent(raw);
      } catch {
        // raw value is fine as-is
      }
      return { workspaceId, token };
    }
  }

  const referer = String(headers.referer ?? "");
  const host = String(headers.host ?? "");
  if (referer && host) {
    try {
      const ref = new URL(referer, `http://${host}`);
      if (ref.host === host) {
        const m = ref.pathname.match(/^\/preview\/([^/]+)/);
        if (m) {
          return {
            workspaceId: decodeURIComponent(m[1]),
            token: ref.searchParams.get("token") ?? "",
          };
        }
      }
    } catch {
      // Malformed referer — cannot resolve.
    }
  }
  return null;
}

/**
 * Strip auth and forwarding headers before sending a request to a preview
 * workspace. The workspace must not receive terminal or production auth
 * context — except the app's own cookies, which pass through minus the
 * preview credential cookie (the iframe origin only ever holds ours plus
 * whatever the app itself set).
 */
export function stripPreviewAuthHeaders(
  headers: Headers,
  upstreamPort: number,
): Record<string, string> {
  const upstreamHeaders: Record<string, string> = {};

  for (const [key, value] of headers) {
    const lower = key.toLowerCase();
    if (lower === "cookie") {
      // Forward app cookies minus the preview credential cookie.
      const upstreamCookies = upstreamCookieHeader(value);
      if (upstreamCookies) upstreamHeaders.cookie = upstreamCookies;
      continue;
    }
    // accept-encoding is intentionally dropped: undici transparently
    // decompresses gzip/br/deflate bodies but leaves the upstream
    // content-encoding/content-length headers intact — forwarding both
    // alongside the decoded bytes makes the browser fail decoding
    // (ERR_CONTENT_DECODING_FAILED), which is exactly how previewed apps
    // rendered as raw unstyled HTML. Ask upstream for identity instead.
    if (lower === "accept-encoding") continue;
    if (!AUTH_FORWARDING_HEADERS.has(lower)) {
      upstreamHeaders[key] = value;
    }
  }

  upstreamHeaders.host = `127.0.0.1:${upstreamPort}`;
  return upstreamHeaders;
}

/**
 * Return true only for redirects that remain inside this workspace's preview
 * mount. Absolute redirects must also point back to the current proxy host.
 */
export function isPreviewScopedRedirect(
  location: string | null,
  workspaceId: string,
  requestHost?: string,
): boolean {
  if (!location) return true;

  try {
    const isAbsoluteLocation = location.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(location);
    const base = requestHost ? `http://${requestHost}` : "http://preview.invalid";
    const redirect = new URL(location, base);
    if (isAbsoluteLocation && (!requestHost || redirect.host !== requestHost)) return false;

    const previewPath = `/preview/${encodeURIComponent(workspaceId)}`;
    const inPreviewPath = redirect.pathname === previewPath || redirect.pathname.startsWith(`${previewPath}/`);
    if (!inPreviewPath) return false;

    return !requestHost || redirect.host === requestHost;
  } catch {
    return false;
  }
}
