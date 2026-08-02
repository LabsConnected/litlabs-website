import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCanvas, renameCanvas, deleteCanvas, archiveCanvas, listBlocks } from "@/lib/canvas/repository";

/**
 * GET /api/canvases/[canvasId]
 * Get a single canvas with all its blocks.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { canvasId } = await params;
    const canvas = await getCanvas(canvasId);
    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
    }
    if (canvas.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const blocks = await listBlocks(canvasId);
    return NextResponse.json({ canvas, blocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/canvases/[canvasId]
 * Update canvas metadata (title, status).
 *
 * Body: { title?: string, status?: "active" | "archived" }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { canvasId } = await params;
    const canvas = await getCanvas(canvasId);
    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
    }
    if (canvas.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const actor = (body.actor as "user" | "litt" | "spark" | "system") ?? "user";
    const sourceMessageId = body.sourceMessageId as string | undefined;

    if (typeof body.title === "string" && body.title !== canvas.title) {
      const updated = await renameCanvas(canvasId, body.title, actor, sourceMessageId);
      return NextResponse.json({ canvas: updated });
    }

    if (body.status === "archived") {
      await archiveCanvas(canvasId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ canvas });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/canvases/[canvasId]
 * Permanently delete a canvas and all its blocks + revisions.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { canvasId } = await params;
    const canvas = await getCanvas(canvasId);
    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
    }
    if (canvas.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await deleteCanvas(canvasId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
