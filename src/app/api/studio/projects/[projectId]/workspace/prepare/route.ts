import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createTerminalToken } from "@/lib/terminal-auth";

const RUNNER_URL = process.env.TERMINAL_SERVER_URL || "http://localhost:4001";

/**
 * POST /api/studio/projects/[projectId]/workspace/prepare
 *
 * 1. Verifies project ownership and scan readiness
 * 2. Calls the Workspace Runner to clone the repository
 * 3. Persists the workspace ID and root in the database
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

    // Fetch the project, verifying ownership
    const { data: project, error: fetchError } = await sb
      .from("studio_projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Verify scan is ready before allowing workspace preparation
    if (project.scan_status !== "ready") {
      return NextResponse.json(
        { error: "Repository scan must be ready before preparing workspace" },
        { status: 400 },
      );
    }

    // Set workspace to provisioning
    await sb
      .from("studio_projects")
      .update({
        workspace_status: "provisioning",
        workspace_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", userId);

    try {
      const [owner, repo] = (project.github_repo ?? "").split("/");
      const branch = project.github_default_branch ?? "main";
      const installationId = project.github_installation_id ?? 0;

      if (!owner || !repo) {
        throw new Error("GitHub repository information missing");
      }

      const { token } = createTerminalToken(userId);
      const runnerRes = await fetch(`${RUNNER_URL}/v1/workspaces/prepare`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          projectId,
          installationId,
          owner,
          repo,
          branch,
          commitSha: project.github_commit_sha ?? null,
        }),
      });

      if (!runnerRes.ok) {
        const runnerErr = await runnerRes.json();
        throw new Error(runnerErr.error ?? "Runner failed to prepare workspace");
      }

      const runnerData = await runnerRes.json();
      const workspace = runnerData.workspace;

      await sb
        .from("studio_projects")
        .update({
          workspace_status: "ready",
          workspace_id: workspace.workspaceId,
          workspace_root: workspace.root,
          workspace_error: null,
          workspace_prepared_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId)
        .eq("user_id", userId);

      return NextResponse.json({
        workspace: {
          status: "ready",
          workspaceId: workspace.workspaceId,
          root: workspace.root,
        },
      });
    } catch (error) {
      await sb
        .from("studio_projects")
        .update({
          workspace_status: "failed",
          workspace_error: error instanceof Error ? error.message : "Workspace provisioning failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId)
        .eq("user_id", userId);

      throw error;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workspace preparation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
