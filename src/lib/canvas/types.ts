/**
 * Canvas system types — artifact-backed structured work surfaces.
 *
 * A Canvas is a collection of typed, independently-editable blocks
 * bound to a conversation (and optionally a project + mission).
 * Every mutation is recorded in a CanvasRevision for undo/redo.
 *
 * @see supabase/migrations/20260728000000_canvas_system.sql
 */

import { z } from "zod";

// ─── Canvas ──────────────────────────────────────────────────────

export const CanvasTypeSchema = z.enum([
  "document",
  "website",
  "code",
  "research",
  "marketing",
  "planning",
  "notes",
  "custom",
]);
export type CanvasType = z.infer<typeof CanvasTypeSchema>;

export const CanvasStatusSchema = z.enum(["active", "archived"]);
export type CanvasStatus = z.infer<typeof CanvasStatusSchema>;

export const CanvasSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  projectId: z.string().uuid().nullable(),
  missionId: z.string().uuid().nullable(),
  conversationId: z.string().nullable(),
  title: z.string(),
  type: CanvasTypeSchema,
  status: CanvasStatusSchema,
  version: z.number().int().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Canvas = z.infer<typeof CanvasSchema>;

// ─── Canvas blocks ───────────────────────────────────────────────

export const BlockTypeSchema = z.enum([
  "heading",
  "paragraph",
  "checklist",
  "task",
  "code",
  "note",
  "decision",
  "image",
  "file",
  "preview",
]);
export type BlockType = z.infer<typeof BlockTypeSchema>;

// Per-type content schemas. The `content` JSONB column stores one of
// these depending on the block `type`. Validation happens in the
// repository layer before insert.

export const HeadingContentSchema = z.object({
  text: z.string(),
  level: z.number().int().min(1).max(6).default(2),
});
export type HeadingContent = z.infer<typeof HeadingContentSchema>;

export const ParagraphContentSchema = z.object({
  text: z.string(),
});
export type ParagraphContent = z.infer<typeof ParagraphContentSchema>;

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  checked: z.boolean().default(false),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const ChecklistContentSchema = z.object({
  items: z.array(ChecklistItemSchema),
});
export type ChecklistContent = z.infer<typeof ChecklistContentSchema>;

export const TaskContentSchema = z.object({
  title: z.string(),
  description: z.string().default(""),
  status: z.enum(["todo", "in_progress", "done", "blocked"]).default("todo"),
  assignee: z.string().optional(),
  taskId: z.string().uuid().nullable().default(null),
});
export type TaskContent = z.infer<typeof TaskContentSchema>;

export const CodeContentSchema = z.object({
  language: z.string().default("text"),
  code: z.string(),
  filename: z.string().optional(),
});
export type CodeContent = z.infer<typeof CodeContentSchema>;

export const NoteContentSchema = z.object({
  text: z.string(),
  pinned: z.boolean().default(false),
});
export type NoteContent = z.infer<typeof NoteContentSchema>;

export const DecisionContentSchema = z.object({
  title: z.string(),
  rationale: z.string().default(""),
  decidedAt: z.string().optional(),
});
export type DecisionContent = z.infer<typeof DecisionContentSchema>;

export const ImageContentSchema = z.object({
  url: z.string(),
  alt: z.string().default(""),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type ImageContent = z.infer<typeof ImageContentSchema>;

export const FileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  language: z.string().default("text"),
});
export type FileContent = z.infer<typeof FileContentSchema>;

export const PreviewContentSchema = z.object({
  url: z.string(),
  label: z.string().default("Preview"),
});
export type PreviewContent = z.infer<typeof PreviewContentSchema>;

export const CanvasBlockSchema = z.object({
  id: z.string().uuid(),
  canvasId: z.string().uuid(),
  userId: z.string(),
  type: BlockTypeSchema,
  content: z.record(z.string(), z.unknown()),
  position: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CanvasBlock = z.infer<typeof CanvasBlockSchema>;

// ─── Canvas revisions ────────────────────────────────────────────

export const CanvasActorSchema = z.enum(["user", "litt", "spark", "system"]);
export type CanvasActor = z.infer<typeof CanvasActorSchema>;

// Operations recorded in a revision. Each operation describes what
// changed so the UI can render a diff and undo can reverse it.
export const CanvasOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("canvas.create"),
    canvasId: z.string().uuid(),
    title: z.string(),
    type: CanvasTypeSchema,
  }),
  z.object({
    op: z.literal("block.add"),
    blockId: z.string().uuid(),
    type: BlockTypeSchema,
    content: z.record(z.string(), z.unknown()),
    position: z.number(),
  }),
  z.object({
    op: z.literal("block.update"),
    blockId: z.string().uuid(),
    patch: z.record(z.string(), z.unknown()),
    previousContent: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal("block.delete"),
    blockId: z.string().uuid(),
    previousContent: z.record(z.string(), z.unknown()),
    previousPosition: z.number(),
  }),
  z.object({
    op: z.literal("block.reorder"),
    blockId: z.string().uuid(),
    previousPosition: z.number(),
    newPosition: z.number(),
  }),
  z.object({
    op: z.literal("canvas.rename"),
    previousTitle: z.string(),
    newTitle: z.string(),
  }),
]);
export type CanvasOperation = z.infer<typeof CanvasOperationSchema>;

export const CanvasRevisionSchema = z.object({
  id: z.string().uuid(),
  canvasId: z.string().uuid(),
  version: z.number().int().min(1),
  actor: CanvasActorSchema,
  sourceMessageId: z.string().nullable(),
  summary: z.string(),
  operations: z.array(CanvasOperationSchema),
  snapshot: z.array(z.record(z.string(), z.unknown())).nullable(),
  createdAt: z.string(),
});
export type CanvasRevision = z.infer<typeof CanvasRevisionSchema>;

// ─── Canvas focus state (client-side) ────────────────────────────

export const CanvasFocusStateSchema = z.object({
  activeCanvasId: z.string().uuid().nullable(),
  recentCanvasIds: z.array(z.string().uuid()).default([]),
  pinnedCanvasIds: z.array(z.string().uuid()).default([]),
  lastModifiedCanvasId: z.string().uuid().nullable(),
  lastReferencedBlockId: z.string().uuid().nullable(),
});
export type CanvasFocusState = z.infer<typeof CanvasFocusStateSchema>;

// ─── Artifact actions (returned by chat API) ─────────────────────
// These are the actions LiTT can propose alongside a text response.
// The client executes them against the Canvas API.

export const ArtifactActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("canvas.create"),
    title: z.string(),
    canvasType: CanvasTypeSchema,
    initialBlocks: z.array(
      z.object({
        type: BlockTypeSchema,
        content: z.record(z.string(), z.unknown()),
      }),
    ).default([]),
  }),
  z.object({
    type: z.literal("canvas.append"),
    canvasId: z.string().uuid(),
    blocks: z.array(
      z.object({
        type: BlockTypeSchema,
        content: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
  z.object({
    type: z.literal("canvas.update_block"),
    canvasId: z.string().uuid(),
    blockId: z.string().uuid(),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("canvas.delete_block"),
    canvasId: z.string().uuid(),
    blockId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("canvas.rename"),
    canvasId: z.string().uuid(),
    title: z.string(),
  }),
  z.object({
    type: z.literal("task.create"),
    canvasId: z.string().uuid().optional(),
    title: z.string(),
    description: z.string().default(""),
  }),
  z.object({
    type: z.literal("project.promote"),
    canvasId: z.string().uuid(),
  }),
]);
export type ArtifactAction = z.infer<typeof ArtifactActionSchema>;

// ─── Chat response contract ──────────────────────────────────────
// The extended chat response shape. The text streams first; actions
// are returned at the end so the UI can render them as chips.

export const LiTTResponseSchema = z.object({
  message: z.string(),
  actions: z.array(ArtifactActionSchema).default([]),
});
export type LiTTResponse = z.infer<typeof LiTTResponseSchema>;

// ─── DB row shapes (snake_case from Supabase) ────────────────────

export interface CanvasRow {
  id: string;
  user_id: string;
  project_id: string | null;
  mission_id: string | null;
  conversation_id: string | null;
  title: string;
  type: CanvasType;
  status: CanvasStatus;
  version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CanvasBlockRow {
  id: string;
  canvas_id: string;
  user_id: string;
  type: BlockType;
  content: Record<string, unknown>;
  position: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CanvasRevisionRow {
  id: string;
  canvas_id: string;
  version: number;
  actor: CanvasActor;
  source_message_id: string | null;
  summary: string;
  operations: CanvasOperation[];
  snapshot: Record<string, unknown>[] | null;
  created_at: string;
}

// ─── Row → domain mappers ────────────────────────────────────────

export function rowToCanvas(row: CanvasRow): Canvas {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    missionId: row.mission_id,
    conversationId: row.conversation_id,
    title: row.title,
    type: row.type,
    status: row.status,
    version: row.version,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCanvasBlock(row: CanvasBlockRow): CanvasBlock {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    userId: row.user_id,
    type: row.type,
    content: row.content ?? {},
    position: row.position,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToCanvasRevision(row: CanvasRevisionRow): CanvasRevision {
  return {
    id: row.id,
    canvasId: row.canvas_id,
    version: row.version,
    actor: row.actor,
    sourceMessageId: row.source_message_id,
    summary: row.summary,
    operations: row.operations ?? [],
    snapshot: row.snapshot,
    createdAt: row.created_at,
  };
}
