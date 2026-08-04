import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { undo, listRevisions, getCanvas } from "@/lib/canvas/repository";

/**
 * GET /api/canvases/[canvasId]/revisions
 * List all revisions for a canvas (newest first).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> },
) {
  const { userId } = await auth(req);
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

    const revisions = await listRevisions(canvasId);
    return NextResponse.json({ revisions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/canvases/[canvasId]/undo
 * Undo the latest revision.
 *
 * Body: { actor?: CanvasActor }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ canvasId: string }> },
) {
  const { userId } = await auth(req);
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

    const body = await req.json().catch(() => ({}));
    const actor = (body.actor as "user" | "litt" | "spark" | "system") ?? "user";

    const result = await undo(canvasId, actor);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
