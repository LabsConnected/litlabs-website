import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateBlock, deleteBlock, reorderBlock } from "@/lib/canvas/repository";
import { getCanvas } from "@/lib/canvas/repository";

async function checkOwnership(canvasId: string, userId: string) {
  const canvas = await getCanvas(canvasId);
  if (!canvas) return { error: NextResponse.json({ error: "Canvas not found" }, { status: 404 }) };
  if (canvas.userId !== userId) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { canvas };
}

/**
 * PATCH /api/canvases/[canvasId]/blocks/[blockId]
 * Update a block's content or position.
 *
 * Body: { patch?: Record<string, unknown>, position?: number,
 *         actor?: CanvasActor, sourceMessageId?: string }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ canvasId: string; blockId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { canvasId, blockId } = await params;
    const ownership = await checkOwnership(canvasId, userId);
    if ("error" in ownership) return ownership.error;

    const body = await req.json().catch(() => ({}));
    const actor = (body.actor as "user" | "litt" | "spark" | "system") ?? "user";
    const sourceMessageId = body.sourceMessageId as string | undefined;

    if (typeof body.position === "number") {
      await reorderBlock(canvasId, blockId, body.position, actor, sourceMessageId);
    }

    let block = null;
    if (body.patch && typeof body.patch === "object") {
      block = await updateBlock(canvasId, blockId, body.patch, actor, sourceMessageId);
    }

    return NextResponse.json({ block });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/canvases/[canvasId]/blocks/[blockId]
 * Delete a block from the canvas.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ canvasId: string; blockId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { canvasId, blockId } = await params;
    const ownership = await checkOwnership(canvasId, userId);
    if ("error" in ownership) return ownership.error;

    const body = await req.json().catch(() => ({}));
    const actor = (body.actor as "user" | "litt" | "spark" | "system") ?? "user";
    const sourceMessageId = body.sourceMessageId as string | undefined;

    await deleteBlock(canvasId, blockId, actor, sourceMessageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
