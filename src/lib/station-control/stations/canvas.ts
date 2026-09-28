/**
 * Station Control Bridge — canvas station (chunk C, server-only).
 *
 * Auth/data-access choice (documented per task):
 * The /api/canvases/* routes authenticate via Clerk's cookie-based auth()
 * (src/lib/auth.ts) — an agent-loop execution context cannot mint a session
 * cookie, and HTTP self-fetch to these routes from the agent loop would 401
 * (the same reason tool-handlers.ts calls services directly). Instead this
 * adapter imports the underlying data-access functions from
 * @/lib/canvas/repository (addBlocks / updateBlock / deleteBlock /
 * reorderBlock / listBlocks / getCanvas) and replicates the routes'
 * ownership check (canvas.userId === ctx.userId) before every operation.
 * ctx.userId is trusted server-side context, exactly like the tool handlers.
 */
import "server-only";

import { z } from "zod";

import { registerStationAction } from "../registry";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import {
  fail,
  ok,
  stationResultSchema,
} from "./creator-helpers";
import {
  addBlocks,
  deleteBlock,
  getCanvas,
  listBlocks,
  listCanvases,
  reorderBlock,
  updateBlock,
} from "@/lib/canvas/repository";
import {
  BlockTypeSchema,
  CodeContentSchema,
  ChecklistContentSchema,
  DecisionContentSchema,
  FileContentSchema,
  HeadingContentSchema,
  ImageContentSchema,
  NoteContentSchema,
  ParagraphContentSchema,
  PreviewContentSchema,
  TaskContentSchema,
} from "@/lib/canvas/types";

const blockTypeEnum = z.enum([
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

/** Per-type content validation so bad props fail fast instead of shipping corrupt blocks. */
const contentSchemas: Record<string, z.ZodType> = {
  heading: HeadingContentSchema,
  paragraph: ParagraphContentSchema,
  checklist: ChecklistContentSchema,
  task: TaskContentSchema,
  code: CodeContentSchema,
  note: NoteContentSchema,
  decision: DecisionContentSchema,
  image: ImageContentSchema,
  file: FileContentSchema,
  preview: PreviewContentSchema,
};

async function resolveCanvasId(
  ctx: StationExecutionContext,
): Promise<{ canvasId: string } | StationResult> {
  const canvases = await listCanvases(ctx.userId, {
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
  });
  const active = canvases.find((c) => c.status !== "archived") ?? canvases[0];
  if (!active) {
    return fail(
      "No canvas exists for this project/conversation yet. Create one in Studio first, then retry.",
      "not_implemented",
    );
  }
  return { canvasId: active.id };
}

async function checkOwnership(
  ctx: StationExecutionContext,
  canvasId: string,
): Promise<StationResult | null> {
  const canvas = await getCanvas(canvasId);
  if (!canvas) return fail("Canvas not found", "not_implemented");
  if (canvas.userId !== ctx.userId) return fail("Forbidden: canvas belongs to another user", "permission_denied");
  return null;
}

const positionSchema = z.object({ x: z.number(), y: z.number() }).passthrough();

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown (zod v4: bare z.ZodType infers
 * unknown — same pattern as chunk B's browser.ts). The executor safeParses
 * raw args against argsSchema before invoking execute, so the cast to the
 * erased StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

defineAction({
  id: "canvas.addNode",
  station: "canvas",
  description:
    "Add a block node to the active canvas (the user's most recent canvas for this project/conversation).",
  argsSchema: z.object({
    type: blockTypeEnum,
    props: z.record(z.string(), z.unknown()).optional(),
    position: z.number().optional(),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const resolved = await resolveCanvasId(ctx);
    if ("success" in resolved && !resolved.success) return resolved;
    const canvasId = (resolved as { canvasId: string }).canvasId;
    const denied = await checkOwnership(ctx, canvasId);
    if (denied) return denied;

    const type = BlockTypeSchema.parse(args.type);
    const props = args.props ?? {};
    const schema = contentSchemas[args.type];
    if (schema) {
      const parsed = schema.safeParse(props);
      if (!parsed.success) {
        return fail(
          `Invalid content for block type "${args.type}": ${parsed.error.issues.map((i) => i.message).join("; ")}`,
          "invalid_args",
        );
      }
    }
    try {
      const [block] = await addBlocks(
        canvasId,
        ctx.userId,
        [{ type, content: props, position: args.position }],
        "litt",
        undefined,
      );
      if (!block) return fail("Canvas rejected the new block", "execution_failed");
      ctx.reportLiveState({ station: "canvas", action: "canvas.addNode", nodeId: block.id });
      return ok({ nodeId: block.id, type: block.type, position: block.position });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to add canvas node", "execution_failed");
    }
  },
});

defineAction({
  id: "canvas.removeNode",
  station: "canvas",
  description: "Delete a block node from the active canvas.",
  argsSchema: z.object({ nodeId: z.string().min(1) }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const resolved = await resolveCanvasId(ctx);
    if ("success" in resolved && !resolved.success) return resolved;
    const canvasId = (resolved as { canvasId: string }).canvasId;
    const denied = await checkOwnership(ctx, canvasId);
    if (denied) return denied;
    try {
      await deleteBlock(canvasId, args.nodeId, "litt", undefined);
      ctx.reportLiveState({ station: "canvas", action: "canvas.removeNode", nodeId: args.nodeId });
      return ok({ nodeId: args.nodeId });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to remove canvas node", "execution_failed");
    }
  },
});

defineAction({
  id: "canvas.moveNode",
  station: "canvas",
  description: "Move a canvas block to a new ordinal position.",
  argsSchema: z.object({
    nodeId: z.string().min(1),
    position: z.number().int().min(0),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const resolved = await resolveCanvasId(ctx);
    if ("success" in resolved && !resolved.success) return resolved;
    const canvasId = (resolved as { canvasId: string }).canvasId;
    const denied = await checkOwnership(ctx, canvasId);
    if (denied) return denied;
    try {
      await reorderBlock(canvasId, args.nodeId, args.position, "litt", undefined);
      return ok({ nodeId: args.nodeId, position: args.position });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to move canvas node", "execution_failed");
    }
  },
});

defineAction({
  id: "canvas.editNode",
  station: "canvas",
  description: "Patch a canvas block's content props (merged over existing content).",
  argsSchema: z.object({
    nodeId: z.string().min(1),
    props: z.record(z.string(), z.unknown()),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const resolved = await resolveCanvasId(ctx);
    if ("success" in resolved && !resolved.success) return resolved;
    const canvasId = (resolved as { canvasId: string }).canvasId;
    const denied = await checkOwnership(ctx, canvasId);
    if (denied) return denied;
    try {
      const block = await updateBlock(canvasId, args.nodeId, args.props, "litt", undefined);
      if (!block) return fail("Canvas node not found", "not_implemented");
      return ok({ nodeId: block.id, type: block.type });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to edit canvas node", "execution_failed");
    }
  },
});

defineAction({
  id: "canvas.selectNode",
  station: "canvas",
  description: "Read a canvas block's current type/content/position (honest read, no mutation).",
  argsSchema: z.object({ nodeId: z.string().min(1) }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    const resolved = await resolveCanvasId(ctx);
    if ("success" in resolved && !resolved.success) return resolved;
    const canvasId = (resolved as { canvasId: string }).canvasId;
    const denied = await checkOwnership(ctx, canvasId);
    if (denied) return denied;
    try {
      const blocks = await listBlocks(canvasId);
      const block = blocks.find((b) => b.id === args.nodeId);
      if (!block) return fail("Canvas node not found", "not_implemented");
      return ok({ node: { id: block.id, type: block.type, content: block.content, position: block.position } });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to read canvas node", "execution_failed");
    }
  },
});

defineAction({
  id: "canvas.exportNode",
  station: "canvas",
  description:
    "Export a canvas block. format=json serializes the block server-side (real). png and other render formats are not implemented — no server-side renderer exists, so this fails honestly instead of faking a render.",
  argsSchema: z.object({
    nodeId: z.string().min(1),
    format: z.enum(["json", "png", "svg", "html"]),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.format !== "json") {
      return fail(
        `canvas.exportNode does not support format "${args.format}": no server-side block renderer exists.`,
        "not_implemented",
      );
    }
    const resolved = await resolveCanvasId(ctx);
    if ("success" in resolved && !resolved.success) return resolved;
    const canvasId = (resolved as { canvasId: string }).canvasId;
    const denied = await checkOwnership(ctx, canvasId);
    if (denied) return denied;
    try {
      const blocks = await listBlocks(canvasId);
      const block = blocks.find((b) => b.id === args.nodeId);
      if (!block) return fail("Canvas node not found", "not_implemented");
      return ok({
        format: "json",
        node: { id: block.id, type: block.type, content: block.content, position: block.position },
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to export canvas node", "execution_failed");
    }
  },
});

// Re-exported so image.sendToCanvas can resolve canvas ids the same way.
export { resolveCanvasId };
export type { StationExecutionContext as CanvasStationContext };
export { positionSchema };
