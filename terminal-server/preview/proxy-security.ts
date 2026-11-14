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

/**
 * Strip auth and forwarding headers before sending a request to a preview
 * workspace. The workspace must not receive terminal or production auth context.
 */
export function stripPreviewAuthHeaders(
  headers: Headers,
  upstreamPort: number,
): Record<string, string> {
  const upstreamHeaders: Record<string, string> = {};

  for (const [key, value] of headers) {
    if (!AUTH_FORWARDING_HEADERS.has(key.toLowerCase())) {
      upstreamHeaders[key] = value;
    }
  }

  upstreamHeaders.host = `127.0.0.1:${upstreamPort}`;
  return upstreamHeaders;
}

/**
 * Sandbox-aware variant (Phase 2 lifecycle, design note §3.5): the
 * same auth/forwarding stripping as the host path, but the request
 * carries the PROVIDER host (the sandbox URL must resolve and route)
 * and the provider's traffic-token header from the runtime's
 * in-memory upstream. The token is added here — the one place it is
 * allowed to travel — and never comes from the incoming request.
 */
export function buildSandboxUpstreamHeaders(
  headers: Headers,
  upstream: { origin: string; headers: Record<string, string> },
): Record<string, string> {
  const upstreamHeaders: Record<string, string> = {};

  for (const [key, value] of headers) {
    if (!AUTH_FORWARDING_HEADERS.has(key.toLowerCase())) {
      upstreamHeaders[key] = value;
    }
  }

  upstreamHeaders.host = new URL(upstream.origin).host;
  for (const [key, value] of Object.entries(upstream.headers)) {
    upstreamHeaders[key.toLowerCase()] = value;
  }
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
