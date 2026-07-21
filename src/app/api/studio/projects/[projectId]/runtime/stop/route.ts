import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/studio/projects/[projectId]/runtime/stop
 * Stops the runtime and clears the preview URL.
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
        runtime_status: "stopped",
        preview_url: null,
        runtime_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ runtime: { status: "stopped" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Runtime stop failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
