import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/project/active
 *
 * Returns the user's active project. Resolution order:
 * 1. user_active_project table (explicitly set by the user)
 * 2. resolveCurrentProject fallback (most recently updated project)
 *
 * This is the SINGLE source of truth for active project identity,
 * shared by Dashboard (Mission Control) and Studio.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // 1. Check user_active_project table
  const { data: activeRecord } = await admin
    .from("user_active_project")
    .select("project_id, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (activeRecord?.project_id) {
    // Resolve the full project details
    const project = await resolveCurrentProject({
      explicitProjectId: activeRecord.project_id,
      userId,
    });
    if (project) {
      return NextResponse.json({
        projectId: project.projectId,
        projectName: project.projectName,
        repositoryFullName: project.repositoryFullName,
        repositoryOwner: project.repositoryOwner,
        repositoryName: project.repositoryName,
        branch: project.activeBranch ?? project.defaultBranch,
        source: project.source,
      });
    }
  }

  // 2. Fallback: resolve most recently updated project
  const project = await resolveCurrentProject({ userId });
  if (project) {
    // Auto-populate the active project table
    await admin
      .from("user_active_project")
      .upsert({
        user_id: userId,
        project_id: project.projectId,
        updated_at: new Date().toISOString(),
      });

    return NextResponse.json({
      projectId: project.projectId,
      projectName: project.projectName,
      repositoryFullName: project.repositoryFullName,
      repositoryOwner: project.repositoryOwner,
      repositoryName: project.repositoryName,
      branch: project.activeBranch ?? project.defaultBranch,
      source: project.source,
    });
  }

  return NextResponse.json({ projectId: null });
}

/**
 * POST /api/project/active
 *
 * Sets the user's active project. Both Dashboard and Studio call this
 * when the user selects a project, ensuring the active project is
 * synchronized across all surfaces.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.projectId || typeof body.projectId !== "string") {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Verify the project belongs to the user
  const project = await resolveCurrentProject({
    explicitProjectId: body.projectId,
    userId,
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { error } = await admin
    .from("user_active_project")
    .upsert({
      user_id: userId,
      project_id: body.projectId,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    projectId: body.projectId,
    projectName: project.projectName,
  });
}
