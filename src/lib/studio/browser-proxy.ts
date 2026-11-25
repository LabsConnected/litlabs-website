/**
 * Studio Browser panel — same-origin browsing proxy helpers.
 *
 * Why this exists (diagnosis, 2026-11-20): the board Browser panel used
 * to point an iframe straight at the typed URL. Two independent walls
 * made that a non-browser:
 *
 *   1. Our own page CSP (next.config.ts, global rule) restricts
 *      `frame-src` to 'self' plus a small allowlist, so the Studio page
 *      itself forbids framing arbitrary sites — this alone blocked
 *      example.com, which sends no framing protection of its own.
 *   2. Many sites send X-Frame-Options / CSP frame-ancestors and refuse
 *      to be framed by anyone (verified: google.com sends
 *      `X-Frame-Options: SAMEORIGIN`). No client-side code can override
 *      a target server's refusal.
 *
 * The proxy route (src/app/api/studio/browser/proxy) fetches the page
 * server-side and re-serves it from our own origin — which frame-src
 * 'self' already permits — with the framing-refusal headers stripped.
 * This module holds the pure pieces: the proxy URL shape, the response
 * header rules, and the HTML bootstrap injection.
 *
 * Security posture of the re-served document:
 *   - It is served with `Content-Security-Policy: sandbox …` (see
 *     PROXIED_DOCUMENT_CSP), which forces an opaque origin: proxied
 *     scripts cannot read LiTT cookies, storage, or the parent DOM,
 *     even though the bytes come from our origin.
 *   - Set-Cookie from the target is dropped, so proxied pages cannot
 *     plant cookies on the LiTT origin — and, as a consequence, target
 *     sites cannot keep a login session through the proxy.
 *   - The route is auth-gated and passes every target through the
 *     agent browser URL policy (checkBrowserUrlPolicy), which refuses
 *     non-http(s) schemes, localhost, link-local / cloud-metadata
 *     hosts, and known credential-phishing host patterns.
 *
 * Honest limits (same class as every fetch-based web proxy):
 *   - Subresources resolve against the real origin via <base>, so
 *     images/CSS/fonts load, but a page's own fetch/XHR and CORS-mode
 *     module scripts run from an opaque origin and can be refused by
 *     the target's CORS policy. Heavily app-like sites (webmail,
 *     dashboards behind logins) will not work fully through this path.
 *   - In-page navigation is intercepted for link clicks and GET form
 *     submits; SPA pushState navigations and POST forms are not
 *     proxied (POST forms are handed to the panel as an
 *     open-externally request instead of silently leaving the proxy).
 *   Full fidelity needs a real remote browser (the Browserbase live
 *   view that already backs AI browser sessions) — a product decision,
 *   not something a fetch proxy can grow into.
 */

/** Path of the browsing proxy route. The panel frames this origin. */
export const BROWSER_PROXY_PATH = "/api/studio/browser/proxy";

/** postMessage `source` marker for messages from a proxied document. */
export const BROWSER_PROXY_MESSAGE_SOURCE = "litt-browser";

/**
 * CSP served with proxied documents. The `sandbox` directive forces an
 * opaque origin while still letting the page run its own scripts and
 * forms. Deliberately carries no frame-ancestors restriction (that is
 * the header class the proxy exists to strip) and no resource
 * allowlists (subresources legitimately come from the target origin).
 */
export const PROXIED_DOCUMENT_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads";

/**
 * Response headers from the target that must NOT be forwarded to the
 * panel frame:
 *   - framing refusals (x-frame-options, CSP) — the point of the proxy;
 *   - set-cookie — target cookies must not land on the LiTT origin;
 *   - cross-origin policy headers — the target's COOP/COEP/CORP describe
 *     the target origin, not ours, and can break the framed document;
 *   - strict-transport-security — the target cannot pin our origin;
 *   - content-length / content-encoding / transfer-encoding — the body
 *     is re-served (and for HTML, rewritten), so the originals are lies.
 */
export const STRIPPED_PROXY_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "set-cookie",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "strict-transport-security",
  "content-length",
  "content-encoding",
  "transfer-encoding",
]);

/** The proxy URL the panel loads for a given real target URL. */
export function browserProxyUrl(targetUrl: string): string {
  return `${BROWSER_PROXY_PATH}?url=${encodeURIComponent(targetUrl)}`;
}

/** True when an upstream content-type is an HTML document. */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return /^\s*text\/html\b/i.test(contentType) || /^\s*application\/xhtml\+xml\b/i.test(contentType);
}

/**
 * The bootstrap script injected into proxied HTML documents. It:
 *   - announces the URL the document actually landed on (`landed`), so
 *     the panel can correct its address bar after redirects;
 *   - intercepts link clicks and announces each one (`navigate`) so
 *     the panel can drive the load itself and its history, address
 *     bar, and back/forward buttons track in-page navigation;
 *   - reports GET form submits as `navigate` the same way, and POST
 *     forms as `external` (the panel offers a real tab) instead of
 *     letting the frame silently escape the proxy.
 * The script never navigates the frame itself — see the proxyBase
 * comment below for why a self-navigation cannot work from inside a
 * sandboxed document. Messages carry `source: "litt-browser"` and
 * are only trusted by the panel when they come from the panel's own
 * frame window.
 */
export function buildProxyBootstrapScript(finalUrl: string, proxyOrigin?: string): string {
  // JSON-encode the URL for safe embedding; escape `<` so a URL can
  // never break out of the script element.
  const targetJson = JSON.stringify(finalUrl).replace(/</g, "\\u003c");
  // The embedded proxy base stays ABSOLUTE when the app origin is
  // known, even though the bootstrap no longer navigates the frame
  // itself (round 3): the document it runs in is sandboxed into an
  // opaque origin, so a self-navigation went out as a cross-site
  // request, the SameSite=Lax session cookies were withheld, and
  // the auth-gated proxy's answer was a page the frame must refuse
  // — the "This content is blocked" failure on in-page link clicks
  // and GET form submits (live-proven 2026-11-22). The panel now
  // drives those loads from the `navigate` message instead. The
  // absolute base still matters for anything in this document that
  // resolves the proxy path: injectProxyBootstrap inserts
  // <base href="<target URL>"> into the same document, so a
  // root-relative URL would resolve against the TARGET origin
  // (e.g. https://en.wikipedia.org/api/studio/browser/proxy?...),
  // not ours. The route handler passes its own request origin; the
  // relative path remains the fallback for callers that cannot
  // know it.
  const proxyBase = proxyOrigin
    ? `${proxyOrigin.replace(/\/+$/, "")}${BROWSER_PROXY_PATH}`
    : BROWSER_PROXY_PATH;
  return [
    "<script>",
    "(function () {",
    `  var TARGET = ${targetJson};`,
    `  var PROXY = ${JSON.stringify(proxyBase)};`,
    `  var SOURCE = ${JSON.stringify(BROWSER_PROXY_MESSAGE_SOURCE)};`,
    "  function proxied(u) { return PROXY + '?url=' + encodeURIComponent(u); }",
    "  function resolve(u) { try { return new URL(u, TARGET).toString(); } catch (e) { return null; } }",
    "  function post(type, url) {",
    "    try { parent.postMessage({ source: SOURCE, type: type, url: url }, '*'); } catch (e) {}",
    "  }",
    "  post('landed', TARGET);",
    "  document.addEventListener('click', function (ev) {",
    "    var node = ev.target;",
    "    var a = node && node.closest ? node.closest('a[href]') : null;",
    "    if (!a) return;",
    "    var href = a.getAttribute('href');",
    "    if (!href || href.charAt(0) === '#') return;",
    "    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) return;",
    "    var abs = resolve(href);",
    "    if (!abs || !/^https?:/i.test(abs)) return;",
    "    ev.preventDefault();",
    "    if (a.getAttribute('target') === '_blank') { post('external', abs); return; }",
    "    post('navigate', abs);",
    "  }, true);",
    "  document.addEventListener('submit', function (ev) {",
    "    var form = ev.target;",
    "    if (!form || form.tagName !== 'FORM') return;",
    "    var action = resolve(form.getAttribute('action') || TARGET);",
    "    if (!action) return;",
    "    var method = (form.getAttribute('method') || 'GET').toUpperCase();",
    "    ev.preventDefault();",
    "    if (method !== 'GET') { post('external', action); return; }",
    "    try {",
    "      var qs = new URLSearchParams(new FormData(form)).toString();",
    "      var dest = qs ? action + (action.indexOf('?') >= 0 ? '&' : '?') + qs : action;",
    "      post('navigate', dest);",
    "    } catch (e) { post('external', action); }",
    "  }, true);",
    "})();",
    "</script>",
  ].join("\n");
}

/**
 * Rewrite an upstream HTML document for proxied display:
 *   - drops the document's own <base> (ours replaces it) and any
 *     meta-delivered CSP (a meta CSP could block the bootstrap script;
 *     frame-ancestors is header-only, so nothing protective is lost);
 *   - injects `<base href="<final URL>">` so relative subresources
 *     resolve against the real origin, plus the bootstrap script,
 *     immediately after the opening <head> tag (or <html>, or at the
 *     very start when the document has neither).
 */
export function injectProxyBootstrap(html: string, finalUrl: string, proxyOrigin?: string): string {
  const baseHref = finalUrl.replace(/"/g, "&quot;");
  const injection = `<base href="${baseHref}">\n${buildProxyBootstrapScript(finalUrl, proxyOrigin)}`;
  const cleaned = html
    .replace(/<base\b[^>]*>/gi, "")
    .replace(
      /<meta\b[^>]*http-equiv\s*=\s*["']?\s*content-security-policy\s*["']?[^>]*>/gi,
      "",
    );
  const headMatch = cleaned.match(/<head\b[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const at = headMatch.index + headMatch[0].length;
    return `${cleaned.slice(0, at)}\n${injection}${cleaned.slice(at)}`;
  }
  const htmlMatch = cleaned.match(/<html\b[^>]*>/i);
  if (htmlMatch && htmlMatch.index !== undefined) {
    const at = htmlMatch.index + htmlMatch[0].length;
    return `${cleaned.slice(0, at)}\n<head>${injection}</head>${cleaned.slice(at)}`;
  }
  return `${injection}\n${cleaned}`;
}

/**
 * Copy upstream response headers into a fresh Headers, dropping the
 * stripped set and stamping the proxied-document CSP. Used for every
 * proxied response (the CSP sandbox is inert for non-HTML payloads and
 * protective when a navigation lands on something HTML-like).
 */
export function buildProxyResponseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  upstream.forEach((value, key) => {
    if (STRIPPED_PROXY_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    out.set(key, value);
  });
  out.set("Content-Security-Policy", PROXIED_DOCUMENT_CSP);
  out.set("Cache-Control", "no-store");
  return out;
}

// ─── Proxy error documents ──────────────────────────────────────
//
// Policy blocks, unreachable upstreams, and redirect loops used to be
// returned as raw JSON — which the panel iframe rendered as an
// unstyled blob of text. The route now serves a small self-contained
// HTML document instead: same sandboxed opaque origin as proxied
// pages, token-neutral styling (the iframe has a white background),
// the reason, the attempted address, and an "open externally" link
// for cases where a real browser tab is the honest fallback.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ProxyErrorPageOptions {
  /** Short heading, e.g. "This address can't be shown". */
  title: string;
  /** Human-readable explanation of what failed and why. */
  message: string;
  /** The address that was attempted (displayed, escaped). */
  url?: string | null;
  /** Optional recovery hint, e.g. "The site took too long to respond." */
  hint?: string;
}

/**
 * Build the HTML document served for proxy errors. `url` is only
 * rendered as an "open in a new tab" link when it is a plain
 * http(s) URL — anything else is shown as text only.
 */
export function buildProxyErrorPage(opts: ProxyErrorPageOptions): string {
  const title = escapeHtml(opts.title);
  const message = escapeHtml(opts.message);
  const hint = opts.hint ? escapeHtml(opts.hint) : null;
  const safeUrl =
    opts.url && /^https?:\/\//i.test(opts.url) ? opts.url : null;
  const urlHtml = opts.url
    ? `<p class="url">${escapeHtml(opts.url)}</p>`
    : "";
  const hintHtml = hint ? `<p class="hint">${hint}</p>` : "";
  const linkHtml = safeUrl
    ? `<p class="actions"><a class="btn" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Open in a new tab</a></p>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — LiTT Studio</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #ffffff; color: #1f2937;
  }
  .card {
    max-width: 26rem; margin: 1.5rem; padding: 1.75rem 1.5rem;
    border: 1px solid #e5e7eb; border-radius: 0.875rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    text-align: center;
  }
  .eyebrow {
    margin: 0 0 0.5rem; font-size: 0.6875rem; font-weight: 600;
    letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280;
  }
  h1 { margin: 0 0 0.625rem; font-size: 1rem; font-weight: 600; color: #111827; }
  .message { margin: 0 0 0.75rem; font-size: 0.8125rem; line-height: 1.55; color: #4b5563; }
  .url {
    margin: 0 0 0.75rem; padding: 0.375rem 0.625rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.75rem; color: #374151;
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.375rem;
    overflow-wrap: anywhere;
  }
  .hint { margin: 0 0 0.75rem; font-size: 0.75rem; color: #6b7280; }
  .actions { margin: 0; }
  .btn {
    display: inline-block; padding: 0.4375rem 0.875rem;
    font-size: 0.75rem; font-weight: 500; text-decoration: none;
    color: #ffffff; background: #111827; border-radius: 0.5rem;
  }
  .btn:hover { background: #374151; }
</style>
</head>
<body>
  <main class="card" role="alert">
    <p class="eyebrow">LiTT Studio Browser</p>
    <h1>${title}</h1>
    <p class="message">${message}</p>
    ${urlHtml}
    ${hintHtml}
    ${linkHtml}
  </main>
</body>
</html>`;
}
