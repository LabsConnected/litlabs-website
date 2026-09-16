/**
 * URL/body normalization for the workspace-scoped preview proxy.
 *
 * Preview applications are not aware that they are mounted below
 * /preview/:workspaceId. Rewrite only explicit URL-bearing attributes in
 * HTML and absolute url() references in CSS. JavaScript and arbitrary text
 * are intentionally left untouched: guessing inside executable content can
 * change application behavior or leak data.
 */

const URL_ATTR = /(\s(?:src|href|action|poster|cite|formaction)\s*=\s*["'])\/(?!\/|preview\/)/gi;
const CSS_URL = /(url\(\s*["']?)\/(?!\/|preview\/)/gi;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;

export function previewPathPrefix(workspaceId: string): string {
  return `/preview/${encodeURIComponent(workspaceId)}`;
}

export function previewCookiePath(workspaceId: string): string {
  return previewPathPrefix(workspaceId);
}

/** Strip the proxy mount and never forward the access token to the app. */
export function previewTargetPath(requestUrl: string, workspaceId: string): string {
  const parsed = new URL(requestUrl || "/", "http://preview.invalid");
  const prefix = previewPathPrefix(workspaceId);
  const mountedPath = parsed.pathname;

  if (mountedPath === prefix) {
    parsed.pathname = "/";
  } else if (mountedPath.startsWith(`${prefix}/`)) {
    parsed.pathname = mountedPath.slice(prefix.length) || "/";
  }

  parsed.searchParams.delete("token");
  return `${parsed.pathname || "/"}${parsed.search}`;
}

/** Rewrite explicit root-relative document resources/navigation into this workspace. */
export function rewritePreviewDocument(body: string, workspaceId: string, contentType: string): string {
  const prefix = previewPathPrefix(workspaceId);
  const type = contentType.toLowerCase();

  if (type.includes("text/html")) {
    return body
      .replace(URL_ATTR, `$1${prefix}/`)
      // Inline CSS is rewritten only inside an actual <style> element; do
      // not scan scripts or prose for URL-looking text.
      .replace(STYLE_BLOCK, (_match, open: string, css: string, close: string) =>
        `${open}${css.replace(CSS_URL, `$1${prefix}/`)}${close}`,
      );
  }

  if (type.includes("text/css")) {
    return body.replace(CSS_URL, `$1${prefix}/`);
  }

  return body;
}
