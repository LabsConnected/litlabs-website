import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { getCanvas } from "@/lib/canvas/repository";
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

    // Already linked to a project
    if (canvas.projectId) {
      return NextResponse.json({
        projectId: canvas.projectId,
        message: "Canvas is already linked to a project",
      });
    }

    const body = await req.json().catch(() => ({}));
    const name =
      (typeof body.name === "string" && body.name.trim()) ||
      canvas.title?.trim() ||
      "Promoted canvas";

    // Create a blank project (throws on error)
    const project = await createBlankProject({
      userId,
      name,
      templateId: "blank-static",
    });

    // Match POST /api/studio-projects: provision the durable workspace at
    // create time so the promoted project opens ready — but post-response
    // via after(). Awaiting it inline parked the promote on the full
    // prepare budget (up to ~180s); a failure leaves workspace_status=
    // failed and first-open / GET workspace recovery retries it.
    after(async () => {
      try {
        const { provisionWorkspaceForProject } = await import("@/lib/studio/workspace-recovery");
        await provisionWorkspaceForProject(project.id, userId);
      } catch (provisionErr) {
        // Provisioning failure is surfaced via workspace_status on the row.
        console.error(
          `[promote] post-create provisioning failed for ${project.id}:`,
          provisionErr instanceof Error ? provisionErr.message : provisionErr,
        );
      }
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
