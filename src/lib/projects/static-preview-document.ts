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
 * An opaque-origin iframe cannot send SameSite session cookies with asset
 * requests. Embed local styles/scripts during the owner's authenticated HTML
 * read. File access stays bound to that owner's verified workspace; cookies,
 * access checks and sandbox privileges remain unchanged.
 */
export async function inlineStaticPreviewTextAssets(
  html: string,
  entryPath: string,
  read: (path: string) => Promise<string | null>,
): Promise<string> {
  const document = parse(html);
  let changed = false;
  let assetCount = 0;
  const cache = new Map<string, string | null>();
  const visit = async (node: DefaultTreeAdapterTypes.Node): Promise<void> => {
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const attr = (name: string) => child.attrs.find((attribute) => attribute.name === name)?.value;
      const stylesheet = child.tagName === "link" && attr("rel")?.toLowerCase() === "stylesheet" && attr("disabled") === undefined;
      const script = child.tagName === "script" && attr("src") && [undefined, "", "text/javascript", "application/javascript", "module"].includes(attr("type"));
      const reference = stylesheet ? attr("href") : script ? attr("src") : undefined;
      const path = reference ? assetPath(reference, entryPath, stylesheet ? /\.css$/i : /\.(?:js|mjs)$/i) : null;
      if (path && assetCount < 16) {
        assetCount++;
        if (!cache.has(path)) cache.set(path, await read(path).catch(() => null));
        const content = cache.get(path);
        if (content != null && content.length <= 512_000) {
          child.tagName = child.nodeName = stylesheet ? "style" : "script";
          child.attrs = child.attrs.filter((attribute) => !(stylesheet ? ["href", "rel", "integrity", "crossorigin"] : ["src", "integrity", "crossorigin"]).includes(attribute.name));
          child.attrs.push({ name: "data-preview-file", value: path });
          const value = stylesheet ? content.replace(/<\/style/gi, "\\3c /style") : content.replace(/<\/script/gi, "<\\/script");
          child.childNodes = [{ nodeName: "#text", value, parentNode: child }];
          changed = true;
        }
      }
      await visit(child);
    }
  };
  await visit(document);
  return changed ? serialize(document) : html;
}
