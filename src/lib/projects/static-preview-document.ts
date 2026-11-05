import { parse, serialize, type DefaultTreeAdapterTypes } from "parse5";

/** Resolve only same-workspace text assets; never fetch an external URL. */
function assetPath(reference: string, entryPath: string, extension: RegExp): string | null {
  if (!reference || /^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//") || reference.includes("\\")) return null;
  try {
    const url = new URL(reference, `https://workspace.invalid/${entryPath}`);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!extension.test(path) || path.split("/").some((part) => !part || part.startsWith(".") || part.includes("\\"))) return null;
    return path;
  } catch { return null; }
}

/**
 * Non-script subresource file types the sandboxed preview legitimately
 * fetches by URL: images, fonts, media, favicons/app manifests and caption
 * tracks. Like scripts, these requests arrive from the opaque origin with
 * no session, so they must be issued under the token-authorized prefix.
 */
const SUBRESOURCE_EXT =
  /\.(?:png|jpe?g|webp|gif|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|m4v|mp3|wav|ogg|oga|m4a|flac|aac|vtt|webmanifest)$/i;

const CSS_URL_RE = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * Same-workspace url() references inside a CSS source (document <style>
 * block, a style attribute, or a fetched stylesheet) resolved against
 * `basePath` — the document path for inline CSS, the stylesheet's own
 * workspace path for linked CSS. Shared by the transform (rewrite) and the
 * manifest (authorization) so the two can never drift.
 */
export function extractCssUrls(css: string, basePath: string): string[] {
  const paths: string[] = [];
  for (const m of css.matchAll(CSS_URL_RE)) {
    const path = assetPath(m[2], basePath, SUBRESOURCE_EXT);
    if (path) paths.push(path);
  }
  return paths;
}

/** Rewrite resolvable url() refs inside CSS text to token-authorized URLs. */
function rewriteCssUrls(css: string, basePath: string, assetBase: string): { text: string; changed: boolean } {
  let changed = false;
  const text = css.replace(CSS_URL_RE, (raw, quote: string, ref: string) => {
    const path = assetPath(ref, basePath, SUBRESOURCE_EXT);
    if (!path) return raw;
    changed = true;
    return `url(${quote}${assetBase}${path}${quote})`;
  });
  return { text, changed };
}

/** Parse a srcset into `{ url, descriptor }` candidates. */
function parseSrcset(srcset: string): Array<{ url: string; descriptor: string }> {
  return srcset
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, ...rest] = entry.split(/\s+/);
      return { url, descriptor: rest.join(" ") };
    });
}

/** Rewrite each srcset candidate's URL; descriptors pass through untouched. */
function rewriteSrcset(srcset: string, entryPath: string, assetBase: string): { value: string; changed: boolean } {
  let changed = false;
  const value = parseSrcset(srcset)
    .map(({ url, descriptor }) => {
      const path = assetPath(url, entryPath, SUBRESOURCE_EXT);
      if (path) {
        changed = true;
        return `${assetBase}${path}${descriptor ? ` ${descriptor}` : ""}`;
      }
      return descriptor ? `${url} ${descriptor}` : url;
    })
    .join(", ");
  return { value, changed };
}

function tokenizedDocumentHref(reference: string, entryPath: string, assetBase: string): string | null {
  if (reference.startsWith("#")) return null;
  const path = assetPath(reference, entryPath, /\.html?$/i);
  if (!path) return null;
  try {
    const url = new URL(reference, `https://workspace.invalid/${entryPath}`);
    return `${assetBase}${path}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** Script `type` values whose `src` the preview loads as a workspace script. */
const SCRIPT_TYPES: Array<string | undefined> = [undefined, "", "text/javascript", "application/javascript", "module"];

export type PreviewScriptAsset = { path: string; module: boolean };

export type PreviewDocumentScan = {
  scripts: PreviewScriptAsset[];
  linkedDocuments: string[];
  /** Same-workspace non-script subresources the document fetches by URL. */
  subresources: string[];
  /** Same-workspace stylesheets (their own url() closure needs authorization too). */
  stylesheets: string[];
};

/**
 * Scan a static HTML document for the workspace references the preview
 * asset manifest must authorize: its scripts (with module flags), the
 * same-workspace HTML documents it links to (in-frame navigation targets),
 * the non-script subresources it fetches by URL (<img>/<source>/<video>/
 * <audio> src, srcset and poster, icon/manifest links, and url() refs in
 * inline styles) and its linked stylesheets (whose own url() closure the
 * manifest must also cover). Uses exactly the transform's resolution and
 * validation rules, so the manifest can never drift from what the
 * transform rewrites.
 */
export function scanPreviewDocument(html: string, documentPath: string): PreviewDocumentScan {
  const document = parse(html);
  const scripts: PreviewScriptAsset[] = [];
  const linkedDocuments: string[] = [];
  const subresources = new Set<string>();
  const stylesheets = new Set<string>();
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const attr = (name: string) => child.attrs.find((attribute) => attribute.name === name);
      if (child.tagName === "script" && attr("src") && SCRIPT_TYPES.includes(attr("type")?.value)) {
        const path = assetPath(attr("src")!.value, documentPath, /\.(?:js|mjs)$/i);
        if (path) scripts.push({ path, module: attr("type")?.value === "module" });
      } else if (child.tagName === "a" && attr("href")) {
        const path = assetPath(attr("href")!.value, documentPath, /\.html?$/i);
        if (path) linkedDocuments.push(path);
      } else if (child.tagName === "link" && attr("href")) {
        const rel = attr("rel")?.value.toLowerCase() ?? "";
        if (rel === "stylesheet" && attr("disabled") === undefined) {
          const path = assetPath(attr("href")!.value, documentPath, /\.css$/i);
          if (path) stylesheets.add(path);
        } else {
          const path = assetPath(attr("href")!.value, documentPath, SUBRESOURCE_EXT);
          if (path) subresources.add(path);
        }
      } else {
        for (const attrName of ["src", "poster"] as const) {
          const value = attr(attrName)?.value;
          if (!value) continue;
          const path = assetPath(value, documentPath, SUBRESOURCE_EXT);
          if (path) subresources.add(path);
        }
        const srcset = attr("srcset")?.value;
        if (srcset) {
          for (const { url } of parseSrcset(srcset)) {
            const path = assetPath(url, documentPath, SUBRESOURCE_EXT);
            if (path) subresources.add(path);
          }
        }
        const style = attr("style")?.value;
        if (style) for (const p of extractCssUrls(style, documentPath)) subresources.add(p);
        if (child.tagName === "style") {
          for (const textNode of child.childNodes) {
            if ("value" in textNode && typeof textNode.value === "string") {
              for (const p of extractCssUrls(textNode.value, documentPath)) subresources.add(p);
            }
          }
        }
      }
      visit(child);
    }
  };
  visit(document);
  return { scripts, linkedDocuments, subresources: [...subresources], stylesheets: [...stylesheets] };
}

/**
 * Prepare an owner's static HTML document for the sandboxed preview iframe.
 *
 * The iframe has an opaque origin, so the browser cannot send the owner's
 * session cookie with subresource requests. Two different asset kinds need
 * two different treatments:
 *
 * - Scripts are NEVER inlined or relocated. Any transformation of script
 *   execution breaks native semantics: browsers ignore `defer` on inline
 *   classic scripts, and no static placement reproduces the shared
 *   post-parse queue that deferred classic scripts and module scripts
 *   execute in, in document order (cross-type global dependencies break in
 *   one direction or the other). Instead, a same-workspace script `src` is
 *   rewritten to a token-authorized preview URL (`assetBase` + the resolved
 *   workspace path) and every attribute (`defer`, `async`, `type`,
 *   `integrity`, `crossorigin`, ...) is left exactly as authored, so the
 *   browser itself applies native parsing, deferral, module-graph and
 *   ordering semantics. The token travels in the URL PATH, so relative
 *   module imports resolve inside the authorized prefix automatically.
 *
 * - Stylesheets carry no execution semantics, so they keep the established
 *   #661 treatment: same-workspace CSS is embedded during the owner's
 *   authenticated HTML read, subject to the existing count/size caps.
 *   url() refs inside embedded CSS are reissued under the token prefix
 *   (the browser resolves them against the document URL, which is the
 *   session path the opaque origin cannot authenticate).
 *
 * - Non-script subresources (<img>/<source>/<video>/<audio> src, srcset and
 *   poster, icon/manifest links, and url() refs in <style> blocks and
 *   style attributes) follow the script rule: reissued under the token
 *   prefix. The opaque-origin iframe carries no session cookie on
 *   subresource fetches, so any reference left on the session path is a
 *   guaranteed failed load (verified: every workspace <img> 401s).
 *
 * File access stays bound to the owner's verified workspace; the sandbox,
 * CSP and ownership checks are unchanged.
 */
export async function prepareStaticPreviewDocument(
  html: string,
  entryPath: string,
  options: {
    /** URL prefix for token-authorized asset requests, ending in "/". */
    assetBase: string;
    /** Reads a same-workspace stylesheet during the authenticated request. */
    readStylesheet: (path: string) => Promise<string | null>;
  },
): Promise<{ html: string; scriptAssets: PreviewScriptAsset[] }> {
  const document = parse(html);
  let changed = false;
  let stylesheetCount = 0;
  const scriptAssets: PreviewScriptAsset[] = [];
  const cache = new Map<string, string | null>();
  const visit = async (node: DefaultTreeAdapterTypes.Node): Promise<void> => {
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const attr = (name: string) => child.attrs.find((attribute) => attribute.name === name);
      const stylesheet = child.tagName === "link" && attr("rel")?.value.toLowerCase() === "stylesheet" && attr("disabled") === undefined;
      const script = child.tagName === "script" && attr("src") && SCRIPT_TYPES.includes(attr("type")?.value);
      if (stylesheet) {
        const path = assetPath(attr("href")!.value, entryPath, /\.css$/i);
        if (path && stylesheetCount < 16) {
          stylesheetCount++;
          if (!cache.has(path)) cache.set(path, await options.readStylesheet(path).catch(() => null));
          const content = cache.get(path);
          if (content != null && content.length <= 512_000) {
            child.tagName = child.nodeName = "style";
            child.attrs = child.attrs.filter((attribute) => !["href", "rel", "integrity", "crossorigin"].includes(attribute.name));
            child.attrs.push({ name: "data-preview-file", value: path });
            // url() refs inside embedded CSS resolve against the DOCUMENT —
            // without a token URL they hit the session path and 401.
            const rewritten = rewriteCssUrls(content.replace(/<\/style/gi, "\\3c /style"), path, options.assetBase);
            child.childNodes = [{ nodeName: "#text", value: rewritten.text, parentNode: child }];
            changed = true;
          } else {
            // Not embeddable: issue a token-authorized fetch instead of the
            // guaranteed-401 session URL the opaque origin would produce.
            attr("href")!.value = `${options.assetBase}${path}`;
            changed = true;
          }
        }
      } else if (script) {
        const path = assetPath(attr("src")!.value, entryPath, /\.(?:js|mjs)$/i);
        if (path) {
          // Keep the script external and untouched except for its URL: the
          // browser fetches it through the token-authorized preview route
          // and executes it with exactly the semantics the author declared.
          attr("src")!.value = `${options.assetBase}${path}`;
          scriptAssets.push({ path, module: attr("type")?.value === "module" });
          changed = true;
        }
      } else if (child.tagName === "a" && attr("href")) {
        const href = tokenizedDocumentHref(attr("href")!.value, entryPath, options.assetBase);
        if (href) {
          // Same-workspace navigation must retain the opaque-origin bearer;
          // external and fragment-only links remain untouched.
          attr("href")!.value = href;
          changed = true;
        }
      } else {
        // Non-script subresources (<img>, <source>, <video>, <audio>, icon/
        // manifest links, inline CSS url()s) are fetched from the opaque
        // origin with no session — reissue them under the token prefix just
        // like scripts, or every workspace image renders as a failed load.
        if (child.tagName === "link" && attr("href")) {
          const path = assetPath(attr("href")!.value, entryPath, SUBRESOURCE_EXT);
          if (path) {
            attr("href")!.value = `${options.assetBase}${path}`;
            changed = true;
          }
        } else {
          for (const attrName of ["src", "poster"] as const) {
            const attribute = attr(attrName);
            if (!attribute?.value) continue;
            const path = assetPath(attribute.value, entryPath, SUBRESOURCE_EXT);
            if (path) {
              attribute.value = `${options.assetBase}${path}`;
              changed = true;
            }
          }
          const srcsetAttr = attr("srcset");
          if (srcsetAttr?.value) {
            const rewritten = rewriteSrcset(srcsetAttr.value, entryPath, options.assetBase);
            if (rewritten.changed) {
              srcsetAttr.value = rewritten.value;
              changed = true;
            }
          }
          const styleAttr = attr("style");
          if (styleAttr?.value.includes("url(")) {
            const rewritten = rewriteCssUrls(styleAttr.value, entryPath, options.assetBase);
            if (rewritten.changed) {
              styleAttr.value = rewritten.text;
              changed = true;
            }
          }
          if (child.tagName === "style") {
            for (const textNode of child.childNodes) {
              if ("value" in textNode && typeof textNode.value === "string" && textNode.value.includes("url(")) {
                const rewritten = rewriteCssUrls(textNode.value, entryPath, options.assetBase);
                if (rewritten.changed) {
                  textNode.value = rewritten.text;
                  changed = true;
                }
              }
            }
          }
        }
      }
      await visit(child);
    }
  };
  await visit(document);
  return { html: changed ? serialize(document) : html, scriptAssets };
}
