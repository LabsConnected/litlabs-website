import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getInstallationOctokit } from "@/lib/github-app";

/**
 * GET /api/projects/[projectId]
 * Fetch a single project with its connection state.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ project: data });
}

/**
 * PATCH /api/projects/[projectId]
 * Update project fields: working_branch, selected_branch, status, connection_status.
 * When changing the working branch, verifies the branch exists via the GitHub API.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;
  const body = await request.json();
  const { working_branch, selected_branch, status, connection_status } = body;

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof working_branch === "string") update.working_branch = working_branch;
  if (typeof selected_branch === "string") update.selected_branch = selected_branch;
  if (typeof status === "string") update.status = status;
  if (typeof connection_status === "string") update.connection_status = connection_status;

  // Fetch the project first to verify ownership and get installation details
  const { data: project, error: fetchError } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, github_installation_id, owner, repository, working_branch")
    .eq("id", projectId)
    .single();

  if (fetchError || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (project.user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If changing working_branch, verify the branch exists in the repo
  if (working_branch && working_branch !== project.working_branch) {
    try {
      const octokit = await getInstallationOctokit(project.github_installation_id);
      await octokit.rest.repos.getBranch({
        owner: project.owner,
        repo: project.repository,
        branch: working_branch,
      });
    } catch {
      return NextResponse.json(
        { error: `Branch "${working_branch}" not found in ${project.owner}/${project.repository}` },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabaseAdmin
    .from("projects")
    .update(update)
    .eq("id", projectId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data });
}

/**
 * DELETE /api/projects/[projectId]
 * Remove a project. Does not delete the GitHub installation.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  const { error } = await supabaseAdmin
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
