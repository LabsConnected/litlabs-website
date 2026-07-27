import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createCanvas, listCanvases } from "@/lib/canvas/repository";
import { CanvasTypeSchema } from "@/lib/canvas/types";

/**
 * GET /api/canvases
 * List canvases for the authenticated user.
 * Optional query params: ?projectId=...&conversationId=...&status=active|archived
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const conversationId = url.searchParams.get("conversationId") ?? undefined;
    const status = url.searchParams.get("status") as "active" | "archived" | null;

    const canvases = await listCanvases(userId, {
      projectId,
      conversationId,
      status: status ?? undefined,
    });
    return NextResponse.json({ canvases });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/canvases
 * Create a new canvas.
 *
 * Body:
 *   { title: string, type?: CanvasType, projectId?, missionId?, conversationId?,
 *     initialBlocks?: [{ type: BlockType, content: Record<string, unknown> }],
 *     actor?: "user" | "litt" | "spark" | "system",
 *     sourceMessageId?: string }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const title = body.title as string;
    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Missing title" }, { status: 400 });
    }

    const typeResult = CanvasTypeSchema.safeParse(body.type ?? "document");
    if (!typeResult.success) {
      return NextResponse.json({ error: "Invalid canvas type" }, { status: 400 });
    }

    const actor = (body.actor as "user" | "litt" | "spark" | "system") ?? "user";
    const sourceMessageId = body.sourceMessageId as string | undefined;

    const { canvas } = await createCanvas(
      {
        userId,
        title,
        type: typeResult.data,
        projectId: body.projectId ?? null,
        missionId: body.missionId ?? null,
        conversationId: body.conversationId ?? null,
      },
      actor,
      sourceMessageId,
    );

    // Add initial blocks if provided
    let blocks: Awaited<ReturnType<typeof import("@/lib/canvas/repository").addBlocks>> = [];
    if (Array.isArray(body.initialBlocks) && body.initialBlocks.length > 0) {
      const { addBlocks } = await import("@/lib/canvas/repository");
      blocks = await addBlocks(canvas.id, userId, body.initialBlocks, actor, sourceMessageId);
    }

    return NextResponse.json({ canvas, blocks }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
