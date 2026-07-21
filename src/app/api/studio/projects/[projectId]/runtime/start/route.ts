import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/studio/projects/[projectId]/runtime/start
 * Marks the runtime as starting, then ready.
 * Requires workspace_status = ready.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const { projectId } = await params;

    const { data: project, error: fetchError } = await sb
      .from("studio_projects")
      .select("workspace_status, user_id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.workspace_status !== "ready") {
      return NextResponse.json(
        { error: "Workspace must be ready before starting runtime" },
        { status: 400 },
      );
    }

    await sb
      .from("studio_projects")
      .update({
        runtime_status: "starting",
        runtime_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", userId);

    // In a full implementation, this would start a dev server.
    // For now, we simulate it by marking as ready.
    const previewUrl = `https://${projectId.slice(0, 8)}.preview.litlab.dev`;

    await sb
      .from("studio_projects")
      .update({
        runtime_status: "ready",
        preview_url: previewUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", userId);

    return NextResponse.json({
      runtime: {
        status: "ready",
        previewUrl,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Runtime start failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
