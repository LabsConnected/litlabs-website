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
): Promise<string> {
  const document = parse(html);
  let changed = false;
  let stylesheetCount = 0;
  const cache = new Map<string, string | null>();
  const visit = async (node: DefaultTreeAdapterTypes.Node): Promise<void> => {
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const attr = (name: string) => child.attrs.find((attribute) => attribute.name === name);
      const stylesheet = child.tagName === "link" && attr("rel")?.value.toLowerCase() === "stylesheet" && attr("disabled") === undefined;
      const script = child.tagName === "script" && attr("src") && [undefined, "", "text/javascript", "application/javascript", "module"].includes(attr("type")?.value);
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
            child.childNodes = [{ nodeName: "#text", value: content.replace(/<\/style/gi, "\\3c /style"), parentNode: child }];
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
          changed = true;
        }
      }
      await visit(child);
    }
  };
  await visit(document);
  return changed ? serialize(document) : html;
}
