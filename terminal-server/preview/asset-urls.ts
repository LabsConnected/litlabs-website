/**
 * Preview asset-URL rewriting.
 *
 * The public preview proxy mounts each workspace under
 * /preview/:workspaceId and requires ?token= on EVERY request. Inside the
 * Studio iframe this breaks subresources twice over:
 *
 *   - Root-relative refs (src="/assets/x.png", href="/styles.css",
 *     Next's "/_next/..." chunks) resolve against the terminal host root,
 *     escaping the mount entirely -> 404.
 *   - Relative refs (src="assets/x.png") stay inside the mount but carry
 *     no token -> 401.
 *
 * Verified in production 2026-09-18: a generated <img src="/assets/...">
 * rendered as alt text while the API-level fetch (preview path + token)
 * returned the bytes fine.
 *
 * The proxy already rewrites successful HTML bodies to inject the
 * inspector bridge; this module performs a second, purely mechanical
 * pass on the same body: every local attribute/inline-CSS URL is
 * resolved against the page's own path inside the mount and re-emitted
 * with the preview token appended. Deterministic — no cookies, no
 * Referer dependency, no scheme changes to external links.
 */

export interface RewritePreviewUrlsOptions {
  workspaceId: string;
  /** The validated preview token (already in the page URL — no new exposure). */
  token: string;
  /** The path the HTML document was fetched at, e.g. "/" or "/about/". */
  pagePath: string;
}

/** Schemes/protocols that must never be rewritten. */
const NON_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Attributes whose value is a single URL. */
const URL_ATTRS = /(\b(?:src|href|action|poster|formaction|data|background)\s*=\s*)("([^"]*)"|'([^']*)')/gi;

/** srcset="url d, url d" — comma-separated candidates. */
const SRCSET_ATTR = /(\bsrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi;

/** url(...) inside inline <style> blocks and style="" attributes. */
const CSS_URL = /url\(\s*("([^"]*)"|'([^']*)'|([^'")]*))\s*\)/gi;

/**
 * Resolve a document-local URL to its absolute path inside the preview
 * mount, with the preview token merged into the query. Returns the
 * original value unchanged for external/data/fragment URLs.
 */
function rewriteOne(raw: string, mount: string, baseUrl: URL, token: string): string {
  const value = raw.trim();
  if (!value || NON_LOCAL.test(value)) return raw;
  const hasToken = /[?&]token=/.test(value);

  let absolutePath: string;
  if (value.startsWith("/")) {
    // Root-relative: re-home under the mount (the whole point of this pass).
    absolutePath = `${mount}${value}`;
  } else {
    // Relative: resolve against the page's own URL inside the mount.
    const resolved = new URL(value, baseUrl);
    absolutePath = resolved.pathname + resolved.search + resolved.hash;
  }

  // Split fragment — query params belong before it.
  const hashIndex = absolutePath.indexOf("#");
  const fragment = hashIndex >= 0 ? absolutePath.slice(hashIndex) : "";
  const beforeFragment = hashIndex >= 0 ? absolutePath.slice(0, hashIndex) : absolutePath;

  const withToken = token && !hasToken
    ? `${beforeFragment}${beforeFragment.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    : beforeFragment;
  return withToken + fragment;
}

/**
 * Rewrite every local URL in a proxied HTML document so it stays inside
 * /preview/:workspaceId and carries the preview token.
 */
export function rewritePreviewAssetUrls(html: string, opts: RewritePreviewUrlsOptions): string {
  const mount = `/preview/${encodeURIComponent(opts.workspaceId)}`;
  const pagePath = opts.pagePath.startsWith("/") ? opts.pagePath : `/${opts.pagePath}`;
  const baseUrl = new URL(`https://preview.local${mount}${pagePath}`);
  const rewrite = (raw: string) => rewriteOne(raw, mount, baseUrl, opts.token);

  let out = html.replace(URL_ATTRS, (_m, prefix, _quoted, dq, sq) => {
    const value = dq ?? sq ?? "";
    const quote = dq !== undefined ? '"' : "'";
    return `${prefix}${quote}${rewrite(value)}${quote}`;
  });

  out = out.replace(SRCSET_ATTR, (_m, prefix, _quoted, dq, sq) => {
    const value = dq ?? sq ?? "";
    const quote = dq !== undefined ? '"' : "'";
    const candidates = value
      .split(",")
      .map((candidate: string) => {
        const trimmed = candidate.trim();
        if (!trimmed) return trimmed;
        const [url, ...descriptor] = trimmed.split(/\s+/);
        return [rewrite(url), ...descriptor].join(" ");
      })
      .join(", ");
    return `${prefix}${quote}${candidates}${quote}`;
  });

  out = out.replace(CSS_URL, (m, _full, dq, sq, bare) => {
    const value = dq ?? sq ?? bare ?? "";
    if (!value || NON_LOCAL.test(value.trim())) return m;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `url(${quote}${rewrite(value)}${quote})`;
  });

  return out;
}

/** Merge the preview token into a path+query string, preserving #fragments. */
function withPreviewToken(pathQuery: string, token: string): string {
  const hashIndex = pathQuery.indexOf("#");
  const fragment = hashIndex >= 0 ? pathQuery.slice(hashIndex) : "";
  const head = hashIndex >= 0 ? pathQuery.slice(0, hashIndex) : pathQuery;
  if (!token || /[?&]token=/.test(head)) return head + fragment;
  return `${head}${head.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}${fragment}`;
}

/** Loopback hostnames a dev-server redirect may use to point at itself. */
const UPSTREAM_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"]);

export interface RewritePreviewLocationOptions {
  workspaceId: string;
  /** The validated preview token (same value already present in the page URL). */
  token: string;
  /** The upstream dev-server port the proxy forwards to. */
  upstreamPort: number;
  /**
   * Host[:port] identities of this gateway's own public origin (request
   * Host header, RAILWAY_PUBLIC_DOMAIN, etc.). An absolute redirect that
   * targets one of these OUTSIDE the mount is an escape, not an external
   * redirect — it lands on the terminal-server's Express routes.
   */
  gatewayHosts?: readonly string[];
}

/**
 * What the proxy should do with an upstream `Location` header.
 *   rewrite     — re-homed inside /preview/:workspaceId (token merged)
 *   passthrough — genuinely external origin, forward untouched
 *   escape      — targets the gateway's own public origin outside the
 *                 mount; the proxy must fail explicitly rather than emit
 *                 this Location (re-homing it risks a redirect loop).
 */
export type RewritePreviewLocationResult =
  | { action: "rewrite"; location: string }
  | { action: "passthrough"; location: string }
  | { action: "escape"; location: string };

/**
 * True when `u` targets one of the gateway's own public host[:port]
 * identities. A bare-host entry ("terminal.litlabs.net") matches only
 * URLs on the scheme-default port — "host:8443" is a different service,
 * not the gateway. A host:port entry ("localhost:4001") matches the
 * URL's full host:port.
 */
function isGatewayHost(u: URL, gatewayHosts: readonly string[]): boolean {
  const host = u.host.toLowerCase();
  const hostname = u.hostname.toLowerCase();
  for (const raw of gatewayHosts) {
    const gh = raw.trim().toLowerCase();
    if (!gh) continue;
    if (gh.includes(":") || gh.startsWith("[")) {
      if (host === gh) return true;
    } else if (hostname === gh && !u.port) {
      return true;
    }
  }
  return false;
}

/**
 * Classify an upstream `Location` header so a redirect stays inside the
 * /preview/:workspaceId mount instead of escaping to the terminal-server
 * origin (where every path 404s with "Cannot GET /…").
 *
 * Rewritten:
 *   "/login"                                -> "/preview/<ws>/login?token=T"
 *   "/"                                     -> "/preview/<ws>/?token=T"
 *   "http://localhost:<port>/x"             -> "/preview/<ws>/x?token=T"  (same upstream)
 *   "https://<gateway>/preview/<ws>/x"      -> "/preview/<ws>/x?token=T"  (own origin, inside mount)
 * Passthrough:
 *   "https://accounts.example/…"            external origin — must pass through
 *   "//cdn.example/…"                       protocol-relative external
 * Escape (caller must fail — never emit this Location):
 *   "https://<gateway>/login"               own public origin outside the mount
 *   "//<gateway>/preview/<other>/x"         own origin, different workspace
 */
export function rewritePreviewLocation(
  location: string,
  opts: RewritePreviewLocationOptions,
): RewritePreviewLocationResult {
  const value = location.trim();
  if (!value) return { action: "passthrough", location };
  const mount = `/preview/${encodeURIComponent(opts.workspaceId)}`;

  // Already inside the mount — keep it, just make sure the token survives.
  if (value === mount || value.startsWith(`${mount}/`) || value.startsWith(`${mount}?`)) {
    return { action: "rewrite", location: withPreviewToken(value, opts.token) };
  }

  // Protocol-relative or scheme-qualified absolute URL.
  if (value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const u = new URL(value, "http://upstream.invalid");
      const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
      if (UPSTREAM_HOSTS.has(u.hostname) && port === opts.upstreamPort) {
        return {
          action: "rewrite",
          location: `${mount}${withPreviewToken(`${u.pathname}${u.search}`, opts.token)}${u.hash}`,
        };
      }
      if (isGatewayHost(u, opts.gatewayHosts ?? [])) {
        // Own public origin but already inside this workspace's mount —
        // strip the origin and keep the mounted path (no loop possible).
        if (u.pathname === mount || u.pathname.startsWith(`${mount}/`)) {
          return {
            action: "rewrite",
            location: `${withPreviewToken(`${u.pathname}${u.search}`, opts.token)}${u.hash}`,
          };
        }
        return { action: "escape", location };
      }
    } catch {
      // Unparseable absolute URL — pass through untouched.
    }
    return { action: "passthrough", location };
  }

  // Root-relative — re-home under the mount.
  if (value.startsWith("/")) {
    return { action: "rewrite", location: `${mount}${withPreviewToken(value, opts.token)}` };
  }

  // Bare relative ("login") — resolves inside the mount already; add token.
  return { action: "rewrite", location: withPreviewToken(value, opts.token) };
}
