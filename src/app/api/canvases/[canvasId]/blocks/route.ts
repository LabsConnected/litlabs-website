import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addBlocks, listBlocks } from "@/lib/canvas/repository";
import { getCanvas } from "@/lib/canvas/repository";
import { BlockTypeSchema } from "@/lib/canvas/types";

/**
 * GET /api/canvases/[canvasId]/blocks
 * List all blocks in a canvas, ordered by position.
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
    return NextResponse.json({ blocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/canvases/[canvasId]/blocks
 * Append blocks to a canvas.
 *
 * Body:
 *   { blocks: [{ type: BlockType, content: Record<string, unknown>, position?: number }],
 *     actor?: "user" | "litt" | "spark" | "system",
 *     sourceMessageId?: string }
 */
export async function POST(
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
    const rawBlocks = body.blocks as Array<{
      type: string;
      content: Record<string, unknown>;
      position?: number;
    }>;

    if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
      return NextResponse.json({ error: "Missing blocks array" }, { status: 400 });
    }

    // Validate block types
    for (const b of rawBlocks) {
      const result = BlockTypeSchema.safeParse(b.type);
      if (!result.success) {
        return NextResponse.json(
          { error: `Invalid block type: ${b.type}` },
          { status: 400 },
        );
      }
    }

    const actor = (body.actor as "user" | "litt" | "spark" | "system") ?? "user";
    const sourceMessageId = body.sourceMessageId as string | undefined;

    const blocks = await addBlocks(
      canvasId,
      userId,
      rawBlocks.map((b) => ({
        type: b.type as ReturnType<typeof BlockTypeSchema.parse>,
        content: b.content,
        position: b.position,
      })),
      actor,
      sourceMessageId,
    );

    return NextResponse.json({ blocks }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
