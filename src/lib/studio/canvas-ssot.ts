/**
 * canvas-ssot.ts — the bridge between the visual canvas document
 * (.litt/canvas.json) and the authoritative workspace files.
 *
 * Workspace files are canonical. The canvas document is editor state plus a
 * pending-changes source. Materialization is one-way: canvas → index.html,
 * guarded by content hashes of BOTH the document and the emitted file bytes
 * so that:
 *  - canvas edits that were never written to index.html are detectable
 *    ("pending" / "unapplied") and block publish;
 *  - index.html edits made outside the canvas are detectable even when the
 *    materialization marker survives ("conflict") and are never overwritten
 *    automatically;
 *  - a canvas the user explicitly abandoned ("keep files") is recorded as
 *    superseded — preserved, but no longer blocking.
 *
 * This module is pure and shared: identical hashing on client and server.
 */

export const CANVAS_DOC_PATH = ".litt/canvas.json";
export const ENTRY_FILE_PATH = "index.html";
export const CANVAS_MARKER = "LITT-CANVAS-MATERIALIZED:v1";
export const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";

/** Sentinel for compare-and-swap writes: "the file must not exist". */
export const CAS_ABSENT = "absent";

/** Structural view of the canvas document — keeps this module free of
 *  imports from the builder (which is a client component tree). */
export interface CanvasDocLike {
  nodes: Record<string, { children?: string[] }>;
  rootNodeIds: string[];
  status?: "superseded";
  supersededAt?: number;
  supersededDocHash?: string;
  supersededFileHash?: string | null;
  materialization?: {
    docHash: string;
    fileHash: string;
    materializedAt: number;
  };
  [key: string]: unknown;
}

// ── Hashing ──────────────────────────────────────────────────────────────
// crypto.subtle is available in every runtime Next.js 16 supports (modern
// browsers and Node >= 18.18 expose it globally), so the SAME algorithm runs
// on both sides of the wire — a hard requirement for hash comparison.

export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("crypto.subtle is unavailable in this runtime");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deterministic JSON: object keys sorted recursively, arrays keep order. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Fields excluded from the content hash: identity, bookkeeping, and the
 * materialization/supersede records themselves. Hashing them would make the
 * doc look "changed" every time an apply or resolution is stamped.
 */
const DOC_META_FIELDS = new Set([
  "id",
  "projectId",
  "conversationId",
  "version",
  "updatedAt",
  "status",
  "supersededAt",
  "supersededDocHash",
  "supersededFileHash",
  "materialization",
]);

export function docContent(doc: CanvasDocLike): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (!DOC_META_FIELDS.has(key)) out[key] = value;
  }
  return out;
}

export async function canvasDocHash(doc: CanvasDocLike): Promise<string> {
  return sha256Hex(canonicalize(docContent(doc)));
}

// ── Marker ───────────────────────────────────────────────────────────────
// Injected as the first line of a materialized index.html. It announces that
// the file is canvas-generated and pins the document hash it came from. The
// authoritative integrity check is the fileBytes hash in the materialization
// record — the marker is presence/identity evidence, not integrity.

const MARKER_RE = new RegExp(`<!--\\s*${CANVAS_MARKER}:doc=([0-9a-f]{64})\\s*-->`);

export function injectCanvasMarker(html: string, docHash: string): string {
  return `<!-- ${CANVAS_MARKER}:doc=${docHash} -->\n${html}`;
}

export function extractMarkedDocHash(html: string): string | null {
  return MARKER_RE.exec(html)?.[1] ?? null;
}

// ── Contentfulness ───────────────────────────────────────────────────────
// A freshly seeded document has a single empty root. It carries no user work
// and must never block preview/publish.

export function isCanvasDocContentful(doc: CanvasDocLike): boolean {
  return doc.rootNodeIds.some((id) => (doc.nodes[id]?.children?.length ?? 0) > 0);
}

// ── Classification ───────────────────────────────────────────────────────

export type CanvasFileState =
  /** No canvas.json, or a document with no user content. */
  | "absent"
  /** User resolved a divergence with "keep files" — doc preserved, dormant. */
  | "superseded"
  /** Document and index.html both match the last materialization. */
  | "clean"
  /** Document changed since materialization; index.html is untouched — safe
   *  to regenerate automatically. */
  | "pending"
  /** Document has content but was never materialized, and index.html is
   *  absent, still the welcome seed, or was generated from this same doc —
   *  safe to materialize. */
  | "unapplied"
  /** index.html diverged from the materialization record, or a foreign
   *  hand/agent-written index.html exists next to canvas content, or the
   *  materialized file vanished. Never auto-overwritten. */
  | "conflict";

export interface CanvasClassifyInput {
  /** Raw .litt/canvas.json content. null = absent or unreadable. */
  canvasRaw: string | null;
  /** Raw index.html content. null = absent. */
  indexRaw: string | null;
}

export interface CanvasClassifyResult {
  state: CanvasFileState;
  /** Parsed document (null when absent/invalid). */
  doc: CanvasDocLike | null;
  docHash: string | null;
  indexHash: string | null;
  detail: string;
}

export async function classifyCanvasState(
  input: CanvasClassifyInput,
): Promise<CanvasClassifyResult> {
  const { canvasRaw, indexRaw } = input;
  const indexHash = indexRaw == null ? null : await sha256Hex(indexRaw);
  const markedDocHash = indexRaw ? extractMarkedDocHash(indexRaw) : null;
  const isWelcome = indexRaw?.includes(WELCOME_SCREEN_MARKER) ?? false;

  if (canvasRaw == null) {
    return { state: "absent", doc: null, docHash: null, indexHash, detail: "no canvas document" };
  }

  let doc: CanvasDocLike;
  try {
    const parsed = JSON.parse(canvasRaw) as CanvasDocLike;
    if (!parsed || typeof parsed !== "object" || !parsed.nodes || !Array.isArray(parsed.rootNodeIds)) {
      throw new Error("missing nodes/rootNodeIds");
    }
    doc = parsed;
  } catch {
    // An unreadable canvas document is unresolved state — fail closed so it
    // blocks publish until a human looks at it.
    return { state: "conflict", doc: null, docHash: null, indexHash, detail: "canvas document is not parseable" };
  }

  if (!isCanvasDocContentful(doc)) {
    return { state: "absent", doc, docHash: null, indexHash, detail: "canvas document has no content" };
  }

  const docHash = await canvasDocHash(doc);

  // A superseded doc is dormant ONLY while its content still matches the doc
  // that was superseded. Editing it afterwards clears the exemption by hash
  // mismatch — no mutation hook needed.
  if (doc.status === "superseded" && doc.supersededDocHash === docHash) {
    return { state: "superseded", doc, docHash, indexHash, detail: "canvas superseded by keep-files" };
  }

  const mat = doc.materialization;
  if (mat) {
    if (indexRaw == null) {
      return { state: "conflict", doc, docHash, indexHash, detail: "materialized index.html is missing" };
    }
    if (indexHash !== mat.fileHash) {
      return { state: "conflict", doc, docHash, indexHash, detail: "index.html changed outside the canvas" };
    }
    if (!markedDocHash) {
      return { state: "conflict", doc, docHash, indexHash, detail: "materialization marker stripped" };
    }
    return docHash === mat.docHash
      ? { state: "clean", doc, docHash, indexHash, detail: "canvas and files in sync" }
      : { state: "pending", doc, docHash, indexHash, detail: "canvas has unapplied changes" };
  }

  // Never materialized.
  if (indexRaw == null) {
    return { state: "unapplied", doc, docHash, indexHash, detail: "canvas never materialized; index.html absent" };
  }
  if (isWelcome) {
    return { state: "unapplied", doc, docHash, indexHash, detail: "canvas never materialized; index.html is the welcome seed" };
  }
  if (markedDocHash === docHash) {
    // File was generated from this exact doc but the record was lost —
    // regenerating is idempotent.
    return { state: "unapplied", doc, docHash, indexHash, detail: "marker matches doc; materialization record missing" };
  }
  return { state: "conflict", doc, docHash, indexHash, detail: "index.html was written outside the canvas" };
}

/** States in which canvas work exists that files do not yet reflect or that
 *  files contradict. Publishing is blocked until resolved. */
export function stateBlocksPublish(state: CanvasFileState): boolean {
  return state === "pending" || state === "unapplied" || state === "conflict";
}

/** States in which the apply route may regenerate index.html without an
 *  explicit user resolution. */
export function stateAllowsAutoApply(state: CanvasFileState): boolean {
  return state === "pending" || state === "unapplied";
}
