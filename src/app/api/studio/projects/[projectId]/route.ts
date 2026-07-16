import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/studio/projects/[projectId]
 * Get a single studio project with its scan summary.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const { projectId } = await params;
    const { data, error } = await sb
      .from("studio_projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/studio/projects/[projectId]
 * Update project settings (branch, root_directory, settings jsonb, etc.)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const { projectId } = await params;
    const body = await request.json();

    // Only allow updating safe fields
    const allowed: Record<string, unknown> = {};
    if (body.github_branch !== undefined) allowed.github_branch = body.github_branch;
    if (body.root_directory !== undefined) allowed.root_directory = body.root_directory;
    if (body.settings !== undefined) allowed.settings = body.settings;
    if (body.name !== undefined) allowed.name = body.name;
    if (body.slug !== undefined) allowed.slug = body.slug;
    allowed.updated_at = new Date().toISOString();

    if (Object.keys(allowed).length <= 1) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("studio_projects")
      .update(allowed)
      .eq("id", projectId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ project: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/studio/projects/[projectId]
 * Delete a project and all its files/scans (cascaded by FK).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ deleted: false });

  try {
    const { projectId } = await params;
    const { error } = await sb
      .from("studio_projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
