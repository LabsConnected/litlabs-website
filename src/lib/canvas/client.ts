/**
 * Canvas API client + file/block mapping for CanvasTool.
 *
 * CanvasTool treats each generated file as one `file`-type canvas block
 * (`content: { path, content, language }`, matching FileContentSchema).
 * This module is the only place that translates between the tool's
 * file model and the canvas REST API — all network access goes through
 * `apiFetch` (authenticated via the session cookie).
 *
 * Pure helpers (`blockToFile`, `fileToBlockInput`, `diffFilesAgainstBlocks`)
 * have no side effects and are unit-tested in `client.test.ts`.
 */

import { apiFetch } from "@/lib/api-response";
import type { Canvas, CanvasBlock } from "./types";

// ─── File model ──────────────────────────────────────────────────

/** A generated file as CanvasTool manages it. `blockId` links it to its server block. */
export interface CanvasFile {
  name: string;
  content: string;
  language: string;
  blockId?: string;
}

/** The block `content` shape for `file`-type blocks (see FileContentSchema). */
export interface FileBlockContent {
  path: string;
  content: string;
  language: string;
}

/**
 * Convert a server block to a CanvasFile. Returns null for non-`file`
 * blocks or blocks with malformed content — CanvasTool only manages
 * files and must never choke on (or delete) other block types.
 */
export function blockToFile(block: CanvasBlock): CanvasFile | null {
  if (block.type !== "file") return null;
  const c = block.content as Partial<FileBlockContent> | null | undefined;
  if (!c || typeof c.path !== "string" || typeof c.content !== "string") {
    return null;
  }
  return {
    name: c.path,
    content: c.content,
    language: typeof c.language === "string" ? c.language : "text",
    blockId: block.id,
  };
}

/** Build the POST /blocks payload for a file. */
export function fileToBlockInput(
  file: Pick<CanvasFile, "name" | "content" | "language">,
  position: number,
): { type: "file"; content: FileBlockContent; position: number } {
  return {
    type: "file",
    content: { path: file.name, content: file.content, language: file.language },
    position,
  };
}

// ─── Diff ─────────────────────────────────────────────────────────

export interface CanvasDiff {
  /** Files with no matching server block (matched by path). */
  toAdd: Array<{ file: Pick<CanvasFile, "name" | "content" | "language">; position: number }>;
  /** Files whose content differs from their server block. */
  toUpdate: Array<{ blockId: string; file: Pick<CanvasFile, "name" | "content" | "language"> }>;
  /** Server file-block ids with no matching local file. */
  toDelete: string[];
}

/**
 * Diff the local file list against the last-known server blocks.
 * Matching key is the file path (`content.path`). Non-`file` blocks
 * are ignored entirely — never updated or deleted by this tool.
 */
export function diffFilesAgainstBlocks(
  files: Pick<CanvasFile, "name" | "content" | "language">[],
  blocks: CanvasBlock[],
): CanvasDiff {
  const blockByPath = new Map<string, CanvasBlock>();
  for (const b of blocks) {
    if (b.type !== "file") continue;
    const p = (b.content as Partial<FileBlockContent> | null | undefined)?.path;
    if (typeof p === "string" && !blockByPath.has(p)) blockByPath.set(p, b);
  }

  const filePaths = new Set(files.map((f) => f.name));
  const toAdd: CanvasDiff["toAdd"] = [];
  const toUpdate: CanvasDiff["toUpdate"] = [];
  const toDelete: string[] = [];

  files.forEach((file, index) => {
    const existing = blockByPath.get(file.name);
    if (!existing) {
      toAdd.push({ file, position: index });
      return;
    }
    const c = existing.content as Partial<FileBlockContent> | null | undefined;
    if (c?.path !== file.name || c?.content !== file.content || c?.language !== file.language) {
      toUpdate.push({ blockId: existing.id, file });
    }
  });

  for (const [path, block] of blockByPath) {
    if (!filePaths.has(path)) toDelete.push(block.id);
  }

  return { toAdd, toUpdate, toDelete };
}

// ─── REST client ──────────────────────────────────────────────────

function enc(id: string): string {
  return encodeURIComponent(id);
}

export async function listCanvases(params: {
  projectId?: string;
  status?: "active" | "archived";
} = {}): Promise<Canvas[]> {
  const q = new URLSearchParams();
  if (params.projectId) q.set("projectId", params.projectId);
  if (params.status) q.set("status", params.status);
  const qs = q.toString();
  const data = await apiFetch<{ canvases?: Canvas[] }>(`/api/canvases${qs ? `?${qs}` : ""}`);
  return data.canvases ?? [];
}

export async function createCanvas(input: {
  title: string;
  projectId?: string | null;
}): Promise<{ canvas: Canvas; blocks: CanvasBlock[] }> {
  const data = await apiFetch<{ canvas: Canvas; blocks?: CanvasBlock[] }>(`/api/canvases`, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      type: "code",
      projectId: input.projectId ?? null,
      actor: "user",
    }),
  });
  return { canvas: data.canvas, blocks: data.blocks ?? [] };
}

export async function getCanvasWithBlocks(
  canvasId: string,
): Promise<{ canvas: Canvas; blocks: CanvasBlock[] }> {
  const data = await apiFetch<{ canvas: Canvas; blocks?: CanvasBlock[] }>(
    `/api/canvases/${enc(canvasId)}`,
  );
  return { canvas: data.canvas, blocks: data.blocks ?? [] };
}

export async function addFileBlocks(
  canvasId: string,
  inputs: Array<{ type: "file"; content: FileBlockContent; position: number }>,
): Promise<CanvasBlock[]> {
  const data = await apiFetch<{ blocks?: CanvasBlock[] }>(
    `/api/canvases/${enc(canvasId)}/blocks`,
    {
      method: "POST",
      body: JSON.stringify({ blocks: inputs, actor: "user" }),
    },
  );
  return data.blocks ?? [];
}

/**
 * Replace a file block's content. The repository merges `patch`
 * shallowly into the block's content object, so passing all three
 * file keys amounts to a full content replacement.
 */
export async function patchFileBlock(
  canvasId: string,
  blockId: string,
  file: Pick<CanvasFile, "name" | "content" | "language">,
): Promise<void> {
  await apiFetch(`/api/canvases/${enc(canvasId)}/blocks/${enc(blockId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      patch: { path: file.name, content: file.content, language: file.language },
      actor: "user",
    }),
  });
}

export async function deleteBlock(canvasId: string, blockId: string): Promise<void> {
  await apiFetch(`/api/canvases/${enc(canvasId)}/blocks/${enc(blockId)}`, {
    method: "DELETE",
    body: JSON.stringify({ actor: "user" }),
  });
}

export async function archiveCanvas(canvasId: string): Promise<void> {
  await apiFetch(`/api/canvases/${enc(canvasId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived", actor: "user" }),
  });
}
