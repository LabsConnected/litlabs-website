"use client";

import { canvasToHtml } from "./canvas-to-html";
import type { CanvasDocument } from "./types";

/**
 * canvas-site-export — materializes the visual canvas into the real
 * project file `index.html` served by the workspace preview/publish
 * pipeline. Without this step the canvas is a mockup: the served site
 * keeps showing whatever file was there before (starter scaffold or an
 * older build).
 *
 * Write policy (no silent replacement of newer content):
 *   - absent index.html          → write
 *   - contains our marker        → we wrote it before → write
 *   - contains scaffold marker   → untouched starter → write
 *   - anything else              → foreign content → "conflict"
 *
 * The caller surfaces "conflict" instead of overwriting user-authored
 * files. A file only counts as "ours" when it carries GENERATED_SITE_MARKER.
 */

export const CANVAS_DOC_FILE = ".litt/canvas.json";
export const SITE_ENTRY_FILE = "index.html";
export const GENERATED_SITE_MARKER = "LITT-GENERATED-SITE";
const SCAFFOLD_MARKER = "LITT-WELCOME-SCREEN";

export type SiteExportResult =
  | { status: "written"; path: string }
  | { status: "conflict"; path: string; reason: string }
  | { status: "error"; reason: string };

export type CanvasSiteSyncResult =
  | SiteExportResult
  | { status: "no-canvas"; path: string };

async function filesAction(
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  try {
    const resp = await fetch(`/api/studio-projects/${projectId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: resp.ok, status: resp.status, json };
  } catch {
    return { ok: false, status: 0, json: {} };
  }
}

/** Read a workspace file; null when missing/unreadable. */
export async function readWorkspaceFile(
  projectId: string,
  path: string,
): Promise<string | null> {
  const res = await filesAction(projectId, { action: "read", path });
  if (!res.ok || typeof res.json.content !== "string") return null;
  return res.json.content;
}

/** True when the existing file is safe to overwrite with generated output. */
export function isOverwritableByGenerator(existing: string | null): boolean {
  if (existing == null || existing.trim().length === 0) return true;
  return (
    existing.includes(GENERATED_SITE_MARKER) ||
    existing.includes(SCAFFOLD_MARKER)
  );
}

/**
 * Generate site HTML from the canvas document. The marker comment makes
 * future exports idempotent — only files carrying it are treated as
 * generator-owned.
 */
export function buildSiteHtml(doc: CanvasDocument): string {
  return `<!-- ${GENERATED_SITE_MARKER}: rendered from .litt/canvas.json — edits made here are overwritten on export. -->\n${canvasToHtml(doc)}`;
}

/**
 * Write the canvas-rendered site to `index.html` in the project
 * workspace. Returns "conflict" (no write performed) when the existing
 * file is neither generated, scaffolded, nor empty.
 */
export async function exportCanvasToSite(
  projectId: string,
  doc: CanvasDocument,
): Promise<SiteExportResult> {
  const existing = await readWorkspaceFile(projectId, SITE_ENTRY_FILE);
  if (!isOverwritableByGenerator(existing)) {
    return {
      status: "conflict",
      path: SITE_ENTRY_FILE,
      reason:
        "index.html was written outside the canvas (or edited since the last export). " +
        "Open the Files tool to review it before overwriting.",
    };
  }

  const res = await filesAction(projectId, {
    action: "write",
    path: SITE_ENTRY_FILE,
    content: buildSiteHtml(doc),
  });
  if (!res.ok) {
    const msg = typeof res.json.error === "string" ? res.json.error : `HTTP ${res.status}`;
    return { status: "error", reason: msg };
  }
  return { status: "written", path: SITE_ENTRY_FILE };
}

/** Parse stored canvas JSON; null when absent, malformed, or shapeless. */
export function parseCanvasDocument(content: string | null): CanvasDocument | null {
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as CanvasDocument;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.nodes || !Array.isArray(parsed.rootNodeIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Compile the project's stored canvas document (.litt/canvas.json) into
 * the served `index.html`. This is the compile step for the save/publish
 * pipeline: callers that materialize the site (autosave, Publish) run it
 * so canvas work becomes real output instead of only a builder mockup.
 *
 * Returns "no-canvas" when the project has no (valid) canvas document —
 * file-built projects are unaffected. "conflict"/"error" mirror
 * exportCanvasToSite: a user-authored index.html is never overwritten.
 */
export async function syncCanvasSiteFromFile(
  projectId: string,
): Promise<CanvasSiteSyncResult> {
  const content = await readWorkspaceFile(projectId, CANVAS_DOC_FILE);
  const doc = parseCanvasDocument(content);
  if (!doc) return { status: "no-canvas", path: SITE_ENTRY_FILE };
  return exportCanvasToSite(projectId, doc);
}
