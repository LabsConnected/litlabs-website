import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/studio/projects/[projectId]/files
 * List all indexed files for a project. Supports optional ?path= prefix filter.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const { projectId } = await params;
    const pathPrefix = request.nextUrl.searchParams.get("path");

    // Verify project ownership
    const { data: project, error: projectError } = await sb
      .from("studio_projects")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();
    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let query = sb
      .from("project_files")
      .select("id, path, file_type, language, size_bytes, sha, is_generated, is_ignored, updated_at")
      .eq("project_id", projectId)
      .order("path", { ascending: true });

    if (pathPrefix) {
      query = query.like("path", `${pathPrefix}%`);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ files: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list files";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
