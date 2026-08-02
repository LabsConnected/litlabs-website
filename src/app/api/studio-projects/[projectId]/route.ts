import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getProject,
  deleteProject,
} from "@/lib/projects/project-repository";

/**
 * GET /api/studio-projects/[projectId]
 * Fetch a single canonical project. Verifies ownership.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const project = await getProject(projectId, userId);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ project });
}

/**
 * DELETE /api/studio-projects/[projectId]
 * Delete a canonical project. Only deletes from studio_projects.
 * Does NOT delete from the legacy projects table.
 *
 * Ownership is verified twice:
 * 1. getProject() checks that the project exists AND belongs to the caller
 * 2. deleteProject() scopes the DELETE WHERE clause to both id AND user_id
 *
 * Returns a generic 404 for both "not found" and "not owned" so a foreign
 * user cannot determine whether the project exists.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  // Pre-check: verify ownership before attempting deletion.
  // This catches unauthorized access even if the Supabase delete query
  // has an unexpected behavior with .select() / .maybeSingle().
  const project = await getProject(projectId, userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const success = await deleteProject(projectId, userId);

  if (!success) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
