import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/github/connection-state
 * Returns the user's GitHub connection state: installations, repositories,
 * and projects with their connection status.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projectId = request.nextUrl.searchParams.get("project_id");

  try {
    // Fetch installations for this user
    const { data: installations, error: instError } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, setup_action, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (instError) throw instError;

    // Fetch projects for this user
    let projectsQuery = supabaseAdmin
      .from("projects")
      .select(
        "id, owner, repository, working_branch, selected_branch, status, connection_status, connection_error, connected_at, github_installation_id, repository_id, repository_full_name, repository_private",
      )
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (projectId) {
      projectsQuery = projectsQuery.eq("id", projectId);
    }

    const { data: projects, error: projError } = await projectsQuery;

    if (projError) throw projError;

    return NextResponse.json({
      installations: (installations || []).map((i) => ({
        installationId: i.installation_id,
        setupAction: i.setup_action,
        updatedAt: i.updated_at,
      })),
      projects: (projects || []).map((p) => ({
        id: p.id,
        owner: p.owner,
        repository: p.repository,
        workingBranch: p.working_branch,
        selectedBranch: p.selected_branch,
        status: p.status,
        connectionStatus: p.connection_status,
        connectionError: p.connection_error,
        connectedAt: p.connected_at,
        installationId: p.github_installation_id,
        repositoryId: p.repository_id,
        repositoryFullName: p.repository_full_name,
        repositoryPrivate: p.repository_private,
      })),
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/github/connection-state
 * Update connection status for a specific project (e.g. mark as connected/disconnected).
 */
export async function PATCH(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { project_id, connection_status, connection_error } = body;

  if (!project_id) {
    return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
  }

  const validStatuses = ["connected", "connecting", "disconnected", "error"];
  if (!validStatuses.includes(connection_status)) {
    return NextResponse.json({ error: "Invalid connection_status" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    connection_status,
    updated_at: new Date().toISOString(),
  };

  if (connection_status === "connected") {
    update.connected_at = new Date().toISOString();
    update.connection_error = null;
  } else if (connection_status === "disconnected") {
    update.disconnected_at = new Date().toISOString();
  } else if (connection_status === "error" && connection_error) {
    update.connection_error = connection_error;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .update(update)
      .eq("id", project_id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json({ project: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
