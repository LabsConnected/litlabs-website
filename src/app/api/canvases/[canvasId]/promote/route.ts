import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCanvas, listBlocks } from "@/lib/canvas/repository";
import { createBlankProject } from "@/lib/projects/project-repository";

/**
 * POST /api/canvases/[canvasId]/promote
 * Promote a canvas into a canonical project.
 *
 * This creates a blank studio_project and links the canvas to it
 * via the canvas.project_id column.
 *
 * Body: { name?: string } — defaults to canvas.title
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

    // Already linked to a project
    if (canvas.projectId) {
      return NextResponse.json({
        projectId: canvas.projectId,
        message: "Canvas is already linked to a project",
      });
    }

    const body = await req.json().catch(() => ({}));
    const name = (body.name as string) || canvas.title;

    // Create a blank project (throws on error)
    const project = await createBlankProject({
      userId,
      name,
      templateId: "blank-static",
    });

    // Link the canvas to the new project
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const sb = getSupabaseAdmin();
    if (sb) {
      await sb.from("canvases").update({ project_id: project.id }).eq("id", canvasId);
    }

    return NextResponse.json({
      projectId: project.id,
      project,
      canvasId,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
