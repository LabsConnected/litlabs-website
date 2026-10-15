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
 * reference depth at most MAX_DEPTH. Bounds never widen authorization. A
 * cap, timeout, read failure, or parser failure is reported in non-sensitive
 * diagnostics and fails closed before a bearer token is minted.
 */
import { parse } from "acorn";
import { scanPreviewDocument } from "./static-preview-document";

const MAX_DOCUMENTS = 32;
const MAX_ASSETS = 128;
const MAX_DEPTH = 8;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_DEADLINE_MS = 3_000;

type TruncationReason = "documents" | "assets" | "depth" | "timeout" | "read_failure" | "parse_failure";

type ManifestOptions = {
  concurrency?: number;
  deadlineMs?: number;
};

export type PreviewAssetManifest = {
  assets: string[];
  complete: boolean;
  truncated: boolean;
  truncationReasons: TruncationReason[];
  documentsVisited: number;
  scriptsScanned: number;
  readFailures: number;
  parseFailures: number;
  timedOut: boolean;
  durationMs: number;
};

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

function extractImportSpecifiers(source: string): { specifiers: string[]; parseFailed: boolean } {
  let ast: unknown;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  } catch {
    try {
      ast = parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
    } catch {
      return { specifiers: [], parseFailed: true };
    }
  }

  const specifiers: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const record = node as Record<string, unknown>;
    const type = record.type;
    if (
      (type === "ImportDeclaration" || type === "ExportNamedDeclaration" || type === "ExportAllDeclaration") &&
      record.source &&
      typeof record.source === "object"
    ) {
      const value = (record.source as Record<string, unknown>).value;
      if (typeof value === "string") specifiers.push(value);
    }
    if (type === "ImportExpression" && record.source && typeof record.source === "object") {
      const sourceNode = record.source as Record<string, unknown>;
      if (sourceNode.type === "Literal" && typeof sourceNode.value === "string") specifiers.push(sourceNode.value);
    }
    for (const [key, value] of Object.entries(record)) {
      if (key !== "type" && key !== "start" && key !== "end") visit(value);
    }
  };
  visit(ast);
  return { specifiers, parseFailed: false };
}

export async function collectPreviewAssetManifest(
  entryPath: string,
  entryHtml: string,
  readTextFile: (path: string) => Promise<string | null>,
  options: ManifestOptions = {},
): Promise<PreviewAssetManifest> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, Math.min(16, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY)));
  const deadlineMs = Math.max(1, options.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const deadlineAt = startedAt + deadlineMs;
  const assets = new Set<string>([entryPath]);
  const visitedDocuments = new Set<string>([entryPath]);
  const scannedScripts = new Set<string>();
  const documentQueue: Array<{ path: string; html: string; depth: number }> = [{ path: entryPath, html: entryHtml, depth: 0 }];
  const scriptQueue: Array<{ path: string; depth: number }> = [];
  const reasons = new Set<TruncationReason>();
  let readFailures = 0;
  let parseFailures = 0;
  let timedOut = false;

  const markTimeoutIfNeeded = () => {
    if (Date.now() >= deadlineAt) {
      timedOut = true;
      reasons.add("timeout");
    }
  };

  const addAsset = (path: string): boolean => {
    if (assets.has(path)) return true;
    if (assets.size >= MAX_ASSETS) {
      reasons.add("assets");
      return false;
    }
    assets.add(path);
    return true;
  };

  const readWithDeadline = async (path: string): Promise<string | null> => {
    markTimeoutIfNeeded();
    if (timedOut) return null;
    const remaining = Math.max(1, deadlineAt - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        readTextFile(path),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            reasons.add("timeout");
            resolve(null);
          }, remaining);
        }),
      ]);
    } catch {
      reasons.add("read_failure");
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const readMany = async (paths: string[]): Promise<Array<string | null>> => {
    const results = new Array<string | null>(paths.length);
    let next = 0;
    const worker = async () => {
      while (next < paths.length && !timedOut) {
        const index = next++;
        results[index] = await readWithDeadline(paths[index]);
        if (results[index] === null && !timedOut) {
          readFailures++;
          reasons.add("read_failure");
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
    return results;
  };

  while ((documentQueue.length > 0 || scriptQueue.length > 0) && !timedOut) {
    if (documentQueue.length > 0) {
      const documents = documentQueue.splice(0, concurrency);
      const linked: Array<{ path: string; depth: number }> = [];
      for (const { path, html, depth } of documents) {
        const scanned = scanPreviewDocument(html, path);
        for (const script of scanned.scripts) {
          if (addAsset(script.path)) scriptQueue.push({ path: script.path, depth });
        }
        if (depth >= MAX_DEPTH) {
          if (scanned.linkedDocuments.length > 0) reasons.add("depth");
          continue;
        }
        for (const linkedPath of scanned.linkedDocuments) {
          if (visitedDocuments.has(linkedPath)) continue;
          if (visitedDocuments.size >= MAX_DOCUMENTS) {
            reasons.add("documents");
            continue;
          }
          visitedDocuments.add(linkedPath);
          if (addAsset(linkedPath)) linked.push({ path: linkedPath, depth: depth + 1 });
        }
      }
      const contents = await readMany(linked.map((item) => item.path));
      for (let i = 0; i < linked.length; i++) {
        if (contents[i] !== null) documentQueue.push({ ...linked[i], html: contents[i]! });
      }
    }

    if (scriptQueue.length > 0 && !timedOut) {
      const scripts = scriptQueue.splice(0, concurrency);
      const contents = await readMany(scripts.map((item) => item.path));
      for (let i = 0; i < scripts.length; i++) {
        const content = contents[i];
        scannedScripts.add(scripts[i].path);
        if (content === null) continue;
        const extracted = extractImportSpecifiers(content);
        if (extracted.parseFailed) {
          parseFailures++;
          reasons.add("parse_failure");
          continue;
        }
        if (scripts[i].depth >= MAX_DEPTH) {
          if (extracted.specifiers.length > 0) reasons.add("depth");
          continue;
        }
        for (const specifier of extracted.specifiers) {
          const resolved = resolveScriptReference(specifier, scripts[i].path);
          if (resolved && addAsset(resolved) && !scannedScripts.has(resolved)) {
            scriptQueue.push({ path: resolved, depth: scripts[i].depth + 1 });
          }
        }
      }
    }
    markTimeoutIfNeeded();
  }

  const truncated = reasons.size > 0;
  return {
    assets: [...assets].sort(),
    complete: !truncated && readFailures === 0 && parseFailures === 0,
    truncated,
    truncationReasons: [...reasons].sort(),
    documentsVisited: visitedDocuments.size,
    scriptsScanned: scannedScripts.size,
    readFailures,
    parseFailures,
    timedOut,
    durationMs: Date.now() - startedAt,
  };
}
