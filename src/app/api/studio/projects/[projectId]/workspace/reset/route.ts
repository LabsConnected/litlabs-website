import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/studio/projects/[projectId]/workspace/reset
 * Resets the workspace to not_prepared and clears workspace metadata.
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

    const { error } = await sb
      .from("studio_projects")
      .update({
        workspace_status: "not_prepared",
        workspace_id: null,
        workspace_root: null,
        workspace_error: null,
        workspace_prepared_at: null,
        runtime_status: "stopped",
        preview_url: null,
        runtime_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ workspace: { status: "not_prepared" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workspace reset failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
