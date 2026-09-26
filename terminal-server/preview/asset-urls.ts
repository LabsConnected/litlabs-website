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

/**
 * Absolute URLs that point back at the dev server (or any loopback). The
 * app builds these from the Host it sees — 127.0.0.1:<port> after the
 * proxy rewrites the Host header — and a browser hitting them would try
 * to reach the VIEWER's own machine. Re-home the path inside the mount
 * instead: it is the same content through the proxy, and it also keeps a
 * previewed app from ever addressing localhost on the viewer's device.
 */
const LOOPBACK_ABSOLUTE = /^https?:\/\/(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?(\/[^?#]*)?([?#].*)?$/i;

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
  if (!value) return raw;

  // Absolute loopback URLs (http://127.0.0.1:<port>/x, http://localhost/x)
  // are the app addressing itself through the Host it observed — re-home
  // the path inside the mount so the request lands back on the proxied
  // dev server instead of the viewer's own machine.
  const loopback = LOOPBACK_ABSOLUTE.exec(value);
  if (loopback) {
    const path = `${loopback[1] ?? "/"}${loopback[2] ?? ""}`;
    const hashIndex = path.indexOf("#");
    const fragment = hashIndex >= 0 ? path.slice(hashIndex) : "";
    const head = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
    const withToken = token && !/[?&]token=/.test(head)
      ? `${head}${head.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : head;
    return `${mount}${withToken}${fragment}`;
  }

  if (NON_LOCAL.test(value)) return raw;
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
    if (!value) return m;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `url(${quote}${rewrite(value)}${quote})`;
  });

  // Root-absolute runtime paths embedded in inline scripts and RSC/JSON
  // payloads (self.__next_f.push chunks carry "/_next/…" strings). The
  // attribute passes above can't see quoted literals — same rule as for
  // JS bodies: mount them, cookie/referer supplies auth.
  out = rewritePreviewJsUrls(out, { workspaceId: opts.workspaceId, token: opts.token });

  return out;
}

/**
 * Rewrite root-absolute dev-runtime paths inside JavaScript (and inline
 * HTML script/JSON) bodies. Next.js hard-codes "/_next/…" literals for
 * webpack's publicPath, dynamic chunk imports, next/image, HMR and dev
 * tooling — inside the iframe they would resolve to the terminal-server
 * origin root and escape the /preview/:workspaceId mount entirely.
 *
 * Only a quote character directly before the slash counts — ordinary
 * prose mentioning these paths mid-string is left alone, and the already
 * rewritten /preview/<ws>/_next/… output never re-matches. No token is
 * appended to prefix literals (publicPath is concatenated with chunk
 * names; a ?token= would corrupt the path) — those requests authenticate
 * through the preview cookie / same-origin Referer. The HMR socket path
 * is a leaf, so it does carry the token: WebSocket upgrades on browsers
 * that block third-party cookies still need a query param to auth.
 */
export function rewritePreviewJsUrls(
  js: string,
  opts: { workspaceId: string; token: string },
): string {
  const mount = `/preview/${encodeURIComponent(opts.workspaceId)}`;
  const tokenQuery = opts.token ? `?token=${encodeURIComponent(opts.token)}` : "";
  return js
    .replace(
      /(["'`])\/_next\/webpack-hmr\b/g,
      `$1${mount}/_next/webpack-hmr${tokenQuery}`,
    )
    .replace(/(["'`])\/(_next\/|__nextjs)/g, `$1${mount}/$2`);
}

/**
 * Rewrite url() references and @import strings inside a proxied CSS body.
 * Next/Tailwind emit url(/_next/static/media/…) for fonts and assets —
 * left alone they escape the mount (404 → missing fonts) or hit the
 * terminal origin unauthenticated (401). Relative refs resolve against
 * the stylesheet's own path inside the mount.
 */
export function rewritePreviewCssUrls(
  css: string,
  opts: { workspaceId: string; token: string; cssPath: string },
): string {
  const mount = `/preview/${encodeURIComponent(opts.workspaceId)}`;
  const cssPath = opts.cssPath.startsWith("/") ? opts.cssPath : `/${opts.cssPath}`;
  const baseUrl = new URL(`https://preview.local${mount}${cssPath}`);
  const rewrite = (raw: string) => rewriteOne(raw, mount, baseUrl, opts.token);

  let out = css.replace(CSS_URL, (m, _full, dq, sq, bare) => {
    const value = dq ?? sq ?? bare ?? "";
    if (!value) return m;
    const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
    return `url(${quote}${rewrite(value)}${quote})`;
  });

  // @import "theme.css" — the bare-string form url() can't catch.
  out = out.replace(/(@import\s+)("([^"]*)"|'([^']*)')/gi, (_m, prefix, _quoted, dq, sq) => {
    const value = dq ?? sq ?? "";
    const quote = dq !== undefined ? '"' : "'";
    return `${prefix}${quote}${rewrite(value)}${quote}`;
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
   * The proxy's own public origin as the browser sees it, e.g.
   * "https://terminal.litlabs.net" (built from x-forwarded-host/proto).
   * The upstream app builds absolute URLs against this origin from its
   * forwarded headers (the proxy strips the mount prefix before
   * forwarding), so absolute redirects to it are self-redirects that must
   * be re-homed inside the mount. It is also the key for detecting
   * redirect_url params that escape the mount (Clerk handshake, 2026-09-21).
   */
  publicOrigin?: string;
}

/** Query params that carry a "where to go next" URL (auth handshakes, OAuth). */
const REDIRECT_URL_PARAMS = ["redirect_url", "redirectUrl"];

function isInsideMount(pathname: string, mount: string): boolean {
  return pathname === mount || pathname.startsWith(`${mount}/`);
}

/**
 * Re-home a redirect_url-style param whose value is an absolute URL on the
 * proxy's own public origin but outside the mount. The upstream app never
 * sees the mount prefix (the proxy strips it before forwarding), so auth
 * handshakes built from forwarded headers — e.g. Clerk's
 * /v1/client/handshake?redirect_url=https://<origin>/?token=… — point at
 * the bare origin and the browser escapes the mount ("Cannot GET /").
 * Returns the outer URL unchanged when there is nothing to fix.
 */
function rehomeRedirectParam(
  outer: string,
  mount: string,
  token: string,
  publicOrigin: string,
): string {
  // Bare-relative outers resolve against the mount path already; only
  // absolute or root-relative outers can carry an escaping param target.
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(outer) || outer.startsWith("//");
  if (!isAbsolute && !outer.startsWith("/")) return outer;
  let u: URL;
  try {
    u = new URL(outer, publicOrigin);
  } catch {
    return outer;
  }
  let changed = false;
  for (const name of REDIRECT_URL_PARAMS) {
    const raw = u.searchParams.get(name);
    if (!raw) continue;
    let inner: URL;
    try {
      inner = new URL(raw);
    } catch {
      continue; // relative or unparseable — not our escape
    }
    if (!/^https?:$/.test(inner.protocol)) continue;
    if (inner.origin !== publicOrigin) continue; // genuinely external
    if (isInsideMount(inner.pathname, mount)) continue; // already contained
    const rehomed = `${mount}${withPreviewToken(`${inner.pathname}${inner.search}`, token)}${inner.hash}`;
    u.searchParams.set(name, `${publicOrigin}${rehomed}`);
    changed = true;
  }
  if (!changed) return outer;
  return isAbsolute ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
}

/**
 * Rewrite an upstream `Location` header so a redirect stays inside the
 * /preview/:workspaceId mount instead of escaping to the terminal-server
 * origin (where every path 404s with "Cannot GET /…").
 *
 * Rewritten:
 *   "/login"                       -> "/preview/<ws>/login?token=T"
 *   "/"                            -> "/preview/<ws>/?token=T"
 *   "http://localhost:<port>/x"    -> "/preview/<ws>/x?token=T"  (same upstream)
 *   "https://<publicOrigin>/x"     -> "/preview/<ws>/x?token=T"  (self-origin;
 *                                     requires opts.publicOrigin)
 *   "https://clerk…/handshake?redirect_url=https%3A%2F%2F<publicOrigin>%2F…"
 *                                  -> outer URL passes through, but the
 *                                     redirect_url param is re-homed under
 *                                     the mount (Clerk handshake escape,
 *                                     2026-09-21)
 * Untouched:
 *   "https://accounts.example/…"   external origin — must pass through
 *   "//cdn.example/…"              protocol-relative external
 *   already-mounted paths          kept, token ensured
 */
export function rewritePreviewLocation(
  location: string,
  opts: RewritePreviewLocationOptions,
): string {
  const value = location.trim();
  if (!value) return location;
  const mount = `/preview/${encodeURIComponent(opts.workspaceId)}`;
  const publicOrigin = opts.publicOrigin?.trim().replace(/\/+$/, "");

  let rewritten: string;
  if (value === mount || value.startsWith(`${mount}/`) || value.startsWith(`${mount}?`)) {
    // Already inside the mount — keep it, just make sure the token survives.
    rewritten = withPreviewToken(value, opts.token);
  } else if (value.startsWith("//")) {
    // Protocol-relative external — pass through (redirect params still checked below).
    rewritten = value;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    // Scheme-qualified absolute URL.
    rewritten = value;
    try {
      const u = new URL(value);
      const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
      const isLoopback = UPSTREAM_HOSTS.has(u.hostname) && port === opts.upstreamPort;
      // The upstream app builds absolute URLs against the public origin from
      // its forwarded headers (the proxy strips the mount prefix before
      // forwarding) — those are self-redirects, not external links.
      const isSelfOrigin = !!publicOrigin && u.origin === publicOrigin;
      if (isLoopback || isSelfOrigin) {
        rewritten = `${mount}${withPreviewToken(`${u.pathname}${u.search}`, opts.token)}${u.hash}`;
      }
    } catch {
      // Unparseable absolute URL — pass through untouched.
    }
  } else if (value.startsWith("/")) {
    // Root-relative — re-home under the mount.
    rewritten = `${mount}${withPreviewToken(value, opts.token)}`;
  } else {
    // Bare relative ("login") — resolves inside the mount already; add token.
    rewritten = withPreviewToken(value, opts.token);
  }

  // Auth-handshake escape hatch: an absolute redirect can carry a
  // redirect_url param pointing at the public origin but outside the mount
  // (Clerk builds it from forwarded headers after the mount prefix is
  // stripped). Re-home the param target so the handshake lands back inside
  // the mount instead of on "Cannot GET /".
  if (publicOrigin) {
    rewritten = rehomeRedirectParam(rewritten, mount, opts.token, publicOrigin);
  }
  return rewritten;
}

export interface AuthHandshakeCheckOptions {
  workspaceId: string;
  publicOrigin?: string;
}

/**
 * True when `original` is the auth-handshake escape pattern that
 * rewritePreviewLocation re-homes: an absolute redirect to an external
 * auth provider (e.g. Clerk's /v1/client/handshake) whose redirect_url-style
 * param pointed at the proxy's public origin OUTSIDE the mount, and
 * `rewritten` is that same redirect with the param now pointing INSIDE the
 * mount.
 *
 * The preview escape guard (proxy.ts) uses this to let the handshake
 * through: the outer redirect legitimately leaves the mount for the auth
 * provider, but the re-homed param guarantees the browser comes back
 * inside the mount when the handshake completes. A redirect whose param
 * was already inside the mount — or never pointed at our origin — is not
 * this pattern and stays subject to the guard, so a workspace cannot
 * launder an arbitrary external bounce by appending a benign
 * redirect_url.
 */
export function isRehomedAuthHandshake(
  original: string,
  rewritten: string,
  opts: AuthHandshakeCheckOptions,
): boolean {
  const publicOrigin = opts.publicOrigin?.trim().replace(/\/+$/, "");
  if (!publicOrigin) return false;
  const value = original.trim();
  const isAbsoluteOrRoot =
    /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("/");
  if (!isAbsoluteOrRoot) return false;

  let outer: URL;
  let outerRewritten: URL;
  try {
    outer = new URL(value, publicOrigin);
    outerRewritten = new URL(rewritten.trim(), publicOrigin);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(outer.protocol)) return false;

  const mount = `/preview/${encodeURIComponent(opts.workspaceId)}`;
  for (const name of REDIRECT_URL_PARAMS) {
    const rawOriginal = outer.searchParams.get(name);
    const rawRewritten = outerRewritten.searchParams.get(name);
    if (!rawOriginal || !rawRewritten) continue;
    let innerOriginal: URL;
    let innerRewritten: URL;
    try {
      // rehomeRedirectParam only acts on absolute param targets (it
      // constructs new URL(raw) with no base); mirror that exactly.
      innerOriginal = new URL(rawOriginal);
      innerRewritten = new URL(rawRewritten);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(innerOriginal.protocol)) continue;
    if (!/^https?:$/.test(innerRewritten.protocol)) continue;
    if (innerOriginal.origin !== publicOrigin) continue;
    if (innerRewritten.origin !== publicOrigin) continue;
    const wasOutsideMount = !isInsideMount(innerOriginal.pathname, mount);
    const nowInsideMount = isInsideMount(innerRewritten.pathname, mount);
    if (wasOutsideMount && nowInsideMount) return true;
  }
  return false;
}
