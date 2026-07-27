/**
 * Canvas repository — server-side CRUD for canvases, blocks, and
 * revisions. Uses the Supabase admin client (service role, bypasses
 * RLS). Every mutation records a CanvasRevision for undo/redo.
 *
 * Undo strategy: each revision stores the operations applied. To
 * undo, we reverse the operations (block.add → block.delete,
 * block.update → restore previousContent, etc.) and insert a new
 * revision with the reversed operations. The canvas version is
 * always bumped to match the latest revision.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  Canvas,
  CanvasBlock,
  CanvasRevision,
  CanvasOperation,
  CanvasActor,
  CanvasType,
  BlockType,
  CanvasRow,
  CanvasBlockRow,
  CanvasRevisionRow,
  rowToCanvas,
  rowToCanvasBlock,
  rowToCanvasRevision,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase admin client is not configured");
  return client;
}

function genId(): string {
  return crypto.randomUUID();
}

// ─── Canvas CRUD ─────────────────────────────────────────────────

export interface CreateCanvasInput {
  userId: string;
  projectId?: string | null;
  missionId?: string | null;
  conversationId?: string | null;
  title: string;
  type?: CanvasType;
  metadata?: Record<string, unknown>;
}

export async function createCanvas(
  input: CreateCanvasInput,
  actor: CanvasActor = "user",
  sourceMessageId?: string,
): Promise<{ canvas: Canvas; blocks: CanvasBlock[] }> {
  const sb = admin();
  const canvasId = genId();
  const now = new Date().toISOString();

  // Insert canvas row
  const { data: canvasRow, error: canvasErr } = await sb
    .from("canvases")
    .insert({
      id: canvasId,
      user_id: input.userId,
      project_id: input.projectId ?? null,
      mission_id: input.missionId ?? null,
      conversation_id: input.conversationId ?? null,
      title: input.title,
      type: input.type ?? "document",
      status: "active",
      version: 1,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (canvasErr || !canvasRow) {
    throw new Error(`Failed to create canvas: ${canvasErr?.message ?? "unknown"}`);
  }

  const canvas = rowToCanvas(canvasRow as CanvasRow);

  // Record initial revision
  const op: CanvasOperation = {
    op: "canvas.create",
    canvasId,
    title: input.title,
    type: input.type ?? "document",
  };
  await recordRevision(canvasId, 1, actor, sourceMessageId, "Canvas created", [op], []);

  return { canvas, blocks: [] };
}

export async function getCanvas(canvasId: string): Promise<Canvas | null> {
  const sb = admin();
  const { data, error } = await sb
    .from("canvases")
    .select("*")
    .eq("id", canvasId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToCanvas(data as CanvasRow);
}

export async function listCanvases(
  userId: string,
  filters?: { projectId?: string; conversationId?: string; status?: "active" | "archived" },
): Promise<Canvas[]> {
  const sb = admin();
  let query = sb.from("canvases").select("*").eq("user_id", userId);
  if (filters?.projectId) query = query.eq("project_id", filters.projectId);
  if (filters?.conversationId) query = query.eq("conversation_id", filters.conversationId);
  if (filters?.status) query = query.eq("status", filters.status);
  query = query.order("updated_at", { ascending: false });

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as CanvasRow[]).map(rowToCanvas);
}

export async function renameCanvas(
  canvasId: string,
  newTitle: string,
  actor: CanvasActor = "user",
  sourceMessageId?: string,
): Promise<Canvas | null> {
  const sb = admin();
  const { data: existing } = await sb
    .from("canvases")
    .select("title, version")
    .eq("id", canvasId)
    .single();
  if (!existing) return null;

  const previousTitle = (existing as CanvasRow).title;
  const nextVersion = (existing as CanvasRow).version + 1;

  const { data, error } = await sb
    .from("canvases")
    .update({ title: newTitle, version: nextVersion })
    .eq("id", canvasId)
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to rename canvas: ${error?.message}`);

  const op: CanvasOperation = {
    op: "canvas.rename",
    previousTitle,
    newTitle,
  };
  await recordRevision(canvasId, nextVersion, actor, sourceMessageId, `Renamed to "${newTitle}"`, [op], null);

  return rowToCanvas(data as CanvasRow);
}

export async function archiveCanvas(canvasId: string): Promise<void> {
  const sb = admin();
  await sb.from("canvases").update({ status: "archived" }).eq("id", canvasId);
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  const sb = admin();
  await sb.from("canvases").delete().eq("id", canvasId);
}

// ─── Block CRUD ──────────────────────────────────────────────────

export interface AddBlockInput {
  type: BlockType;
  content: Record<string, unknown>;
  position?: number;
  metadata?: Record<string, unknown>;
}

export async function addBlocks(
  canvasId: string,
  userId: string,
  blocks: AddBlockInput[],
  actor: CanvasActor = "user",
  sourceMessageId?: string,
): Promise<CanvasBlock[]> {
  if (blocks.length === 0) return [];
  const sb = admin();

  // Get current max position
  const { data: existing } = await sb
    .from("canvas_blocks")
    .select("position")
    .eq("canvas_id", canvasId)
    .order("position", { ascending: false })
    .limit(1);

  let nextPos = 0;
  if (existing && existing.length > 0) {
    nextPos = (existing[0] as CanvasBlockRow).position + 1;
  }

  const now = new Date().toISOString();
  const rows = blocks.map((b, i) => ({
    id: genId(),
    canvas_id: canvasId,
    user_id: userId,
    type: b.type,
    content: b.content,
    position: b.position ?? nextPos + i,
    metadata: b.metadata ?? {},
    created_at: now,
    updated_at: now,
  }));

  const { data, error } = await sb.from("canvas_blocks").insert(rows).select();
  if (error || !data) throw new Error(`Failed to add blocks: ${error?.message}`);

  const created = (data as CanvasBlockRow[]).map(rowToCanvasBlock);

  // Record revision
  const ops: CanvasOperation[] = created.map((b) => ({
    op: "block.add",
    blockId: b.id,
    type: b.type,
    content: b.content,
    position: b.position,
  }));
  const summary = `Added ${created.length} block${created.length > 1 ? "s" : ""}`;
  await bumpVersionAndRecord(canvasId, actor, sourceMessageId, summary, ops);

  return created;
}

export async function updateBlock(
  canvasId: string,
  blockId: string,
  patch: Record<string, unknown>,
  actor: CanvasActor = "user",
  sourceMessageId?: string,
): Promise<CanvasBlock | null> {
  const sb = admin();

  // Fetch previous content for undo
  const { data: prev } = await sb
    .from("canvas_blocks")
    .select("content")
    .eq("id", blockId)
    .eq("canvas_id", canvasId)
    .single();
  if (!prev) return null;
  const previousContent = (prev as CanvasBlockRow).content;

  const { data, error } = await sb
    .from("canvas_blocks")
    .update({ content: { ...previousContent, ...patch } })
    .eq("id", blockId)
    .eq("canvas_id", canvasId)
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to update block: ${error?.message}`);

  const op: CanvasOperation = {
    op: "block.update",
    blockId,
    patch,
    previousContent,
  };
  await bumpVersionAndRecord(canvasId, actor, sourceMessageId, "Updated block", [op]);

  return rowToCanvasBlock(data as CanvasBlockRow);
}

export async function deleteBlock(
  canvasId: string,
  blockId: string,
  actor: CanvasActor = "user",
  sourceMessageId?: string,
): Promise<void> {
  const sb = admin();

  // Fetch previous content + position for undo
  const { data: prev } = await sb
    .from("canvas_blocks")
    .select("content, position")
    .eq("id", blockId)
    .eq("canvas_id", canvasId)
    .single();
  if (!prev) return;
  const prevRow = prev as CanvasBlockRow;

  await sb.from("canvas_blocks").delete().eq("id", blockId).eq("canvas_id", canvasId);

  const op: CanvasOperation = {
    op: "block.delete",
    blockId,
    previousContent: prevRow.content,
    previousPosition: prevRow.position,
  };
  await bumpVersionAndRecord(canvasId, actor, sourceMessageId, "Deleted block", [op]);
}

export async function reorderBlock(
  canvasId: string,
  blockId: string,
  newPosition: number,
  actor: CanvasActor = "user",
  sourceMessageId?: string,
): Promise<void> {
  const sb = admin();

  const { data: prev } = await sb
    .from("canvas_blocks")
    .select("position")
    .eq("id", blockId)
    .eq("canvas_id", canvasId)
    .single();
  if (!prev) return;
  const previousPosition = (prev as CanvasBlockRow).position;

  await sb
    .from("canvas_blocks")
    .update({ position: newPosition })
    .eq("id", blockId)
    .eq("canvas_id", canvasId);

  const op: CanvasOperation = {
    op: "block.reorder",
    blockId,
    previousPosition,
    newPosition,
  };
  await bumpVersionAndRecord(canvasId, actor, sourceMessageId, "Reordered block", [op]);
}

export async function listBlocks(canvasId: string): Promise<CanvasBlock[]> {
  const sb = admin();
  const { data, error } = await sb
    .from("canvas_blocks")
    .select("*")
    .eq("canvas_id", canvasId)
    .order("position", { ascending: true });

  if (error || !data) return [];
  return (data as CanvasBlockRow[]).map(rowToCanvasBlock);
}

// ─── Revisions + Undo/Redo ───────────────────────────────────────

export async function listRevisions(canvasId: string): Promise<CanvasRevision[]> {
  const sb = admin();
  const { data, error } = await sb
    .from("canvas_revisions")
    .select("*")
    .eq("canvas_id", canvasId)
    .order("version", { ascending: false });

  if (error || !data) return [];
  return (data as CanvasRevisionRow[]).map(rowToCanvasRevision);
}

export async function undo(
  canvasId: string,
  actor: CanvasActor = "user",
): Promise<{ undone: CanvasRevision; canvas: Canvas | null }> {
  const sb = admin();

  // Get the latest revision
  const { data: latest } = await sb
    .from("canvas_revisions")
    .select("*")
    .eq("canvas_id", canvasId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) throw new Error("No revisions to undo");
  const latestRev = rowToCanvasRevision(latest as CanvasRevisionRow);

  // Only version 1 (canvas.create) — nothing to undo
  if (latestRev.version <= 1) throw new Error("Already at initial version");

  // Reverse each operation (in reverse order)
  const reversedOps: CanvasOperation[] = [];
  for (const op of [...latestRev.operations].reverse()) {
    reversedOps.push(reverseOperation(op));
  }

  // Apply reversed operations
  for (const op of reversedOps) {
    await applyOperation(canvasId, op);
  }

  // Get the canvas to find userId
  const { data: canvasRow } = await sb
    .from("canvases")
    .select("*")
    .eq("id", canvasId)
    .single();
  const canvas = canvasRow ? rowToCanvas(canvasRow as CanvasRow) : null;

  // Record the undo as a new revision
  const nextVersion = latestRev.version + 1;
  const undoRev = await recordRevision(
    canvasId,
    nextVersion,
    actor,
    undefined,
    `Undo: ${latestRev.summary}`,
    reversedOps,
    null,
  );

  // Bump canvas version
  await sb.from("canvases").update({ version: nextVersion }).eq("id", canvasId);

  return { undone: undoRev, canvas };
}

// ─── Internal helpers ────────────────────────────────────────────

async function recordRevision(
  canvasId: string,
  version: number,
  actor: CanvasActor,
  sourceMessageId: string | undefined,
  summary: string,
  operations: CanvasOperation[],
  snapshot: Record<string, unknown>[] | null,
): Promise<CanvasRevision> {
  const sb = admin();
  const { data, error } = await sb
    .from("canvas_revisions")
    .insert({
      id: genId(),
      canvas_id: canvasId,
      version,
      actor,
      source_message_id: sourceMessageId ?? null,
      summary,
      operations,
      snapshot,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to record revision: ${error?.message}`);
  return rowToCanvasRevision(data as CanvasRevisionRow);
}

async function bumpVersionAndRecord(
  canvasId: string,
  actor: CanvasActor,
  sourceMessageId: string | undefined,
  summary: string,
  operations: CanvasOperation[],
): Promise<void> {
  const sb = admin();
  const { data: canvas } = await sb
    .from("canvases")
    .select("version")
    .eq("id", canvasId)
    .single();
  if (!canvas) throw new Error("Canvas not found");

  const nextVersion = (canvas as CanvasRow).version + 1;
  await sb.from("canvases").update({ version: nextVersion }).eq("id", canvasId);
  await recordRevision(canvasId, nextVersion, actor, sourceMessageId, summary, operations, null);
}

function reverseOperation(op: CanvasOperation): CanvasOperation {
  switch (op.op) {
    case "block.add":
      return {
        op: "block.delete",
        blockId: op.blockId,
        previousContent: op.content,
        previousPosition: op.position,
      };
    case "block.delete":
      return {
        op: "block.add",
        blockId: op.blockId,
        type: op.previousContent.type as BlockType ?? "paragraph",
        content: op.previousContent,
        position: op.previousPosition,
      };
    case "block.update":
      return {
        op: "block.update",
        blockId: op.blockId,
        patch: op.previousContent,
        previousContent: op.patch,
      };
    case "block.reorder":
      return {
        op: "block.reorder",
        blockId: op.blockId,
        previousPosition: op.newPosition,
        newPosition: op.previousPosition,
      };
    case "canvas.rename":
      return {
        op: "canvas.rename",
        previousTitle: op.newTitle,
        newTitle: op.previousTitle,
      };
    case "canvas.create":
      // Cannot undo canvas creation via operations — caller handles
      return op;
  }
}

async function applyOperation(canvasId: string, op: CanvasOperation): Promise<void> {
  const sb = admin();
  switch (op.op) {
    case "block.add": {
      await sb.from("canvas_blocks").insert({
        id: op.blockId,
        canvas_id: canvasId,
        user_id: "", // userId not needed for undo operations
        type: op.type,
        content: op.content,
        position: op.position,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      break;
    }
    case "block.delete": {
      await sb.from("canvas_blocks").delete().eq("id", op.blockId).eq("canvas_id", canvasId);
      break;
    }
    case "block.update": {
      await sb
        .from("canvas_blocks")
        .update({ content: op.patch })
        .eq("id", op.blockId)
        .eq("canvas_id", canvasId);
      break;
    }
    case "block.reorder": {
      await sb
        .from("canvas_blocks")
        .update({ position: op.newPosition })
        .eq("id", op.blockId)
        .eq("canvas_id", canvasId);
      break;
    }
    case "canvas.rename": {
      await sb.from("canvases").update({ title: op.newTitle }).eq("id", canvasId);
      break;
    }
    case "canvas.create":
      // No-op for apply
      break;
  }
}
