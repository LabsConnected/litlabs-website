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

/**
 * Renderable subresource extensions the preview may authorize: images,
 * fonts, media, captions, manifests and stylesheets. Anything else a
 * document references (logs, notes, env-style files) is never rewritten
 * and never enters the token manifest.
 */
export const PREVIEW_ASSET_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mov|mp3|wav|ogg|oga|vtt|webmanifest|css)$/i;

/** Attributes whose value is a same-workspace renderable asset reference. */
const ASSET_ATTRIBUTES: Record<string, string[]> = {
  img: ["src"],
  image: ["href", "xlink:href"],
  source: ["src"],
  video: ["src", "poster"],
  audio: ["src"],
  track: ["src"],
  embed: ["src"],
  object: ["data"],
  input: ["src"],
  use: ["href"],
};

const SRCSET_ATTRIBUTES = ["srcset", "imagesrcset"];

/** Rewrite every same-workspace URL inside a `srcset`/`imagesrcset` value. */
function rewriteSrcset(
  value: string,
  entryPath: string,
  assetBase: string,
): { value: string; changed: boolean } {
  let changed = false;
  const next = value
    .split(",")
    .map((candidate) => {
      const leading = /^\s*/.exec(candidate)?.[0] ?? "";
      const trimmed = candidate.trim();
      if (!trimmed) return candidate;
      const space = trimmed.search(/\s/);
      const url = space === -1 ? trimmed : trimmed.slice(0, space);
      const descriptor = space === -1 ? "" : trimmed.slice(space);
      const path = assetPath(url, entryPath, PREVIEW_ASSET_EXTENSION);
      if (!path) return candidate;
      changed = true;
      return `${leading}${assetBase}${path}${previewAssetSuffix(url)}${descriptor}`;
    })
    .join(",");
  return { value: next, changed };
}

const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Rewrite same-workspace `url(...)` references inside CSS text (inline
 * style attributes, <style> bodies, and stylesheets inlined by this
 * transform). Resolution is document-relative — exactly how the browser
 * resolves them once the CSS is embedded in the served document.
 */
export function rewriteCssAssetUrls(
  css: string,
  entryPath: string,
  assetBase: string,
): { css: string; changed: boolean } {
  let changed = false;
  const next = css.replace(CSS_URL_PATTERN, (whole, _quote: string, ref: string) => {
    const trimmed = ref.trim();
    const path = assetPath(trimmed, entryPath, PREVIEW_ASSET_EXTENSION);
    if (!path) return whole;
    changed = true;
    return `url(${assetBase}${path}${previewAssetSuffix(trimmed)})`;
  });
  return { css: next, changed };
}

/**
 * Resolve a same-workspace subresource reference to its workspace path,
 * or null when it is external, hidden, traversing, or not a renderable
 * asset type. Shared with preview-asset-manifest.ts so the signed asset
 * set can never drift from what the transform rewrites.
 */
export function previewAssetPath(
  reference: string,
  entryPath: string,
): string | null {
  return assetPath(reference, entryPath, PREVIEW_ASSET_EXTENSION);
}

/**
 * Query string + fragment of a reference that resolved to a workspace
 * asset. Preserved across rewriting: `url(icon.svg#gradient)` and
 * cache-busted `img.png?v=2` must keep their suffix or SVG fragment
 * references break. Resolution failures yield "" — callers only invoke
 * this after previewAssetPath succeeded.
 */
export function previewAssetSuffix(reference: string): string {
  try {
    const url = new URL(reference, "https://workspace.invalid/x");
    return `${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

/**
 * Collect the workspace asset paths referenced by url(...) inside CSS
 * text, resolved document-relative — the same resolution the transform
 * applies when it rewrites (or embeds) the stylesheet. Used by
 * preview-asset-manifest.ts so the signed set covers css-referenced
 * fonts/images exactly as the served document will request them.
 */
export function cssAssetPaths(css: string, documentPath: string): string[] {
  const paths = new Set<string>();
  for (const match of css.matchAll(CSS_URL_PATTERN)) {
    const path = previewAssetPath(match[2].trim(), documentPath);
    if (path) paths.add(path);
  }
  return [...paths];
}

/**
 * Scan a static HTML document for the workspace references the preview
 * asset manifest must authorize: its scripts (with module flags) and the
 * same-workspace HTML documents it links to (in-frame navigation targets).
 * Uses exactly the transform's resolution and validation rules, so the
 * manifest can never drift from what the transform rewrites. Exposed for
 * preview-asset-manifest.ts; the transform itself walks the same rules
 * while rewriting.
 */
export type PreviewDocumentScan = {
  scripts: PreviewScriptAsset[];
  linkedDocuments: string[];
  /** Same-workspace renderable assets the document references by URL. */
  assets: string[];
  /** Same-workspace stylesheets (embedded at serve; scanned for url()s). */
  stylesheets: string[];
};

export function scanPreviewDocument(
  html: string,
  documentPath: string,
): PreviewDocumentScan {
  const document = parse(html);
  const scripts: PreviewScriptAsset[] = [];
  const linkedDocuments: string[] = [];
  const assets = new Set<string>();
  const stylesheets: string[] = [];
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const attr = (name: string) => child.attrs.find((attribute) => attribute.name === name);
      const attrValue = (name: string) => attr(name)?.value;
      if (child.tagName === "script" && attr("src") && SCRIPT_TYPES.includes(attrValue("type"))) {
        const path = assetPath(attrValue("src")!, documentPath, /\.(?:js|mjs)$/i);
        if (path) scripts.push({ path, module: attrValue("type") === "module" });
      } else if (child.tagName === "a" && attr("href")) {
        const path = assetPath(attrValue("href")!, documentPath, /\.html?$/i);
        if (path) linkedDocuments.push(path);
      } else if (child.tagName === "link" && attr("rel")?.value.toLowerCase() === "stylesheet" && attr("disabled") === undefined) {
        const path = assetPath(attrValue("href")!, documentPath, /\.css$/i);
        if (path) stylesheets.push(path);
      } else {
        const assetAttrs = ASSET_ATTRIBUTES[child.tagName];
        if (assetAttrs) {
          for (const name of assetAttrs) {
            const value = attrValue(name);
            if (!value) continue;
            // input[type=image] only; other input types carry no asset.
            if (child.tagName === "input" && attrValue("type")?.toLowerCase() !== "image") continue;
            const path = previewAssetPath(value, documentPath);
            if (path) assets.add(path);
          }
        }
        for (const name of SRCSET_ATTRIBUTES) {
          const value = attrValue(name);
          if (!value) continue;
          for (const candidate of value.split(",")) {
            const trimmed = candidate.trim();
            if (!trimmed) continue;
            const space = trimmed.search(/\s/);
            const url = space === -1 ? trimmed : trimmed.slice(0, space);
            const path = previewAssetPath(url, documentPath);
            if (path) assets.add(path);
          }
        }
        // url() references inside inline style attributes and <style> bodies.
        const styleValue = child.tagName === "style"
          ? child.childNodes.map((n) => ("value" in n ? String(n.value) : "")).join("")
          : attrValue("style");
        if (styleValue) {
          for (const match of styleValue.matchAll(CSS_URL_PATTERN)) {
            const path = previewAssetPath(match[2].trim(), documentPath);
            if (path) assets.add(path);
          }
        }
      }
      visit(child);
    }
  };
  visit(document);
  return { scripts, linkedDocuments, assets: [...assets].sort(), stylesheets: [...new Set(stylesheets)].sort() };
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
            // url() references inside the embedded sheet resolve against the
            // served document, so they must be token-authorized the same way.
            const rewritten = rewriteCssAssetUrls(content, entryPath, options.assetBase);
            child.childNodes = [{ nodeName: "#text", value: rewritten.css.replace(/<\/style/gi, "\\3c /style"), parentNode: child }];
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
      }
      // Renderable subresources (images, fonts, media, posters): rewrite
      // same-workspace references onto the token-authorized prefix so the
      // opaque-origin iframe can fetch them without a session cookie.
      const assetAttrs = ASSET_ATTRIBUTES[child.tagName];
      if (assetAttrs) {
        for (const name of assetAttrs) {
          const attribute = attr(name);
          if (!attribute) continue;
          if (child.tagName === "input" && attr("type")?.value.toLowerCase() !== "image") continue;
          const path = previewAssetPath(attribute.value, entryPath);
          if (path) {
            attribute.value = `${options.assetBase}${path}${previewAssetSuffix(attribute.value)}`;
            changed = true;
          }
        }
      }
      for (const name of SRCSET_ATTRIBUTES) {
        const attribute = attr(name);
        if (!attribute) continue;
        const rewritten = rewriteSrcset(attribute.value, entryPath, options.assetBase);
        if (rewritten.changed) {
          attribute.value = rewritten.value;
          changed = true;
        }
      }
      // <style> bodies authored in the document get their url()s rewritten
      // here; stylesheets converted above were already rewritten at embed
      // time (marked with data-preview-file) and must not be rewritten twice.
      if (child.tagName === "style" && !attr("data-preview-file")) {
        for (const node of child.childNodes) {
          if (!("value" in node) || typeof node.value !== "string") continue;
          const rewritten = rewriteCssAssetUrls(node.value, entryPath, options.assetBase);
          if (rewritten.changed) {
            node.value = rewritten.css;
            changed = true;
          }
        }
      }
      const inlineStyle = attr("style");
      if (inlineStyle) {
        const rewritten = rewriteCssAssetUrls(inlineStyle.value, entryPath, options.assetBase);
        if (rewritten.changed) {
          inlineStyle.value = rewritten.css;
          changed = true;
        }
      }
      await visit(child);
    }
  };
  await visit(document);
  return { html: changed ? serialize(document) : html, scriptAssets };
}
