import { scanPreviewDocument } from "./static-preview-document";

/**
 * Server-side preview asset manifest (security correction after Codex's
 * FAIL on 9da01ed0, whose bearer token authorized ANY workspace path).
 *
 * When the owner's authenticated request serves a preview document, the
 * server computes the complete set of workspace files that document's
 * preview may legitimately read, and signs that set into the capability
 * token (preview-token.ts, claim `ast`). The preview route then refuses
 * every token-mode request outside the set, so the token — necessarily
 * visible to the untrusted preview document — is a capability to READ
 * THE SITE'S OWN PUBLISHABLE ASSETS ONLY, never the workspace at large:
 * logs (QUALITY_LOG.md), notes, env-style files and unreferenced sources
 * are unreachable through it.
 *
 * The set is the reference closure of the entry document:
 * - the entry document itself;
 * - every same-workspace script it references (the transform's own
 *   resolution/validation rules, via scanPreviewDocument);
 * - the transitive import closure of those scripts: static imports,
 *   export-from, side-effect imports, and literal dynamic imports
 *   (import("./x.js")) — classic scripts are scanned too, because they
 *   can also dynamic-import at runtime;
 * - same-workspace HTML documents linked from any included document
 *   (in-frame navigation targets), with their own closures, recursively.
 *
 * Stylesheets are NOT in the manifest: they are embedded into the document
 * during the authenticated read and are never fetched by URL. Images and
 * other non-script subresources keep their pre-existing behavior (session
 * URLs only) and are likewise never authorized by the token.
 *
 * Bounds: at most MAX_DOCUMENTS documents and MAX_ASSETS total paths,
 * reference depth at most MAX_DEPTH. Anything beyond the bounds is simply
 * not authorized (its request fails closed with 403) — the bounds never
 * widen the set, they only cap it.
 */

const MAX_DOCUMENTS = 32;
const MAX_ASSETS = 128;
const MAX_DEPTH = 8;

const SPECIFIER_PATTERNS: RegExp[] = [
  /\b(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * Resolve a relative module specifier against the importing file's
 * workspace path, under the same safety rules the document transform
 * applies (no schemes, no backslashes, no hidden/dotted segments, scripts
 * only). Bare specifiers ("react") and non-relative URLs are not workspace
 * files and resolve to null.
 */
function resolveScriptReference(specifier: string, importerPath: string): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  if (specifier.includes("\\")) return null;
  try {
    const url = new URL(specifier, `https://workspace.invalid/${importerPath}`);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!/\.(?:js|mjs)$/i.test(path)) return null;
    if (path.split("/").some((part) => !part || part.startsWith(".") || part.includes("\\"))) return null;
    return path;
  } catch {
    return null;
  }
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

export async function collectPreviewAssetManifest(
  entryPath: string,
  entryHtml: string,
  readTextFile: (path: string) => Promise<string | null>,
): Promise<string[]> {
  const assets = new Set<string>([entryPath]);
  const visitedDocuments = new Set<string>([entryPath]);
  const scannedScripts = new Set<string>();
  const documentQueue: Array<{ path: string; html: string; depth: number }> = [
    { path: entryPath, html: entryHtml, depth: 0 },
  ];
  const scriptQueue: Array<{ path: string; depth: number }> = [];

  const addAsset = (path: string): boolean => {
    if (assets.size >= MAX_ASSETS) return false;
    assets.add(path);
    return true;
  };

  while (documentQueue.length > 0 || scriptQueue.length > 0) {
    while (documentQueue.length > 0) {
      const { path: documentPath, html, depth } = documentQueue.shift()!;
      const { scripts, linkedDocuments } = scanPreviewDocument(html, documentPath);
      for (const script of scripts) {
        if (addAsset(script.path)) {
          scriptQueue.push({ path: script.path, depth });
        }
      }
      if (depth >= MAX_DEPTH) continue;
      for (const linked of linkedDocuments) {
        if (visitedDocuments.has(linked) || visitedDocuments.size >= MAX_DOCUMENTS) continue;
        visitedDocuments.add(linked);
        if (!addAsset(linked)) continue;
        const content = await readTextFile(linked).catch(() => null);
        if (content != null) {
          documentQueue.push({ path: linked, html: content, depth: depth + 1 });
        }
      }
    }
    while (scriptQueue.length > 0) {
      const { path: scriptPath, depth } = scriptQueue.shift()!;
      if (scannedScripts.has(scriptPath)) continue;
      scannedScripts.add(scriptPath);
      if (depth >= MAX_DEPTH) continue;
      const content = await readTextFile(scriptPath).catch(() => null);
      if (content == null) continue;
      for (const specifier of extractImportSpecifiers(content)) {
        const resolved = resolveScriptReference(specifier, scriptPath);
        if (resolved && addAsset(resolved) && !scannedScripts.has(resolved)) {
          scriptQueue.push({ path: resolved, depth: depth + 1 });
        }
      }
    }
  }

  return [...assets].sort();
}
