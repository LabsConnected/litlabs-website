/**
 * Same-origin validation for the `redirect_url` query parameter (sign-in,
 * sign-up, and the proxy's auth redirects).
 *
 * Without validation, `?redirect_url=https://evil.com` on /sign-in turns a
 * successful login into an open redirect to an attacker-controlled site.
 *
 * Accepted targets:
 * - relative paths starting with exactly one "/" ("/studio", "/pricing?x=1")
 * - absolute http(s) URLs on the app's own hosts — www.litlabs.net and
 *   clerk.litlabs.net. The latter is preserved because Clerk's OAuth
 *   authorize flow passes its full authorize URL back through /sign-in.
 *
 * Everything else (evil.com, //evil.com, javascript:, data:, backslashes,
 * control characters, empty) falls back to the default post-login
 * destination.
 */
export const DEFAULT_POST_LOGIN_DESTINATION = "/studio";

const TRUSTED_ABSOLUTE_HOSTS = new Set([
  "www.litlabs.net",
  "clerk.litlabs.net",
]);

export function getSafeRedirectUrl(
  raw: string | null | undefined,
): string {
  if (!raw) return DEFAULT_POST_LOGIN_DESTINATION;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT_POST_LOGIN_DESTINATION;
  }
  const target = decoded.trim();
  if (!target) return DEFAULT_POST_LOGIN_DESTINATION;

  // Backslashes and control characters are never legitimate in a target.
  // (Some browsers treat "\" as "/" in URLs.)
  if (/[\\\u0000-\u001f\u007f]/.test(target)) {
    return DEFAULT_POST_LOGIN_DESTINATION;
  }

  // Dangerous schemes — never redirect to these.
  const lower = target.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return DEFAULT_POST_LOGIN_DESTINATION;
  }

  // Absolute URL: allow only the app's own hosts.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      return DEFAULT_POST_LOGIN_DESTINATION;
    }
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      TRUSTED_ABSOLUTE_HOSTS.has(url.hostname.toLowerCase())
    ) {
      // Return the original, untouched — the OAuth flow must receive the
      // exact URL it passed in.
      return raw;
    }
    return DEFAULT_POST_LOGIN_DESTINATION;
  }

  // Protocol-relative ("//evil.com") and anything not root-relative is out.
  if (!target.startsWith("/") || target.startsWith("//")) {
    return DEFAULT_POST_LOGIN_DESTINATION;
  }

  return target;
}
