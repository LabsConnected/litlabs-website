import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { ProjectReadiness } from "@/app/studio/types/project-readiness";

/**
 * GET /api/studio/projects/[projectId]/readiness
 * Returns the full readiness state for a project, covering:
 *   github, repository, scan, workspace, terminal, runtime
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
    const { data: project, error } = await sb
      .from("studio_projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const workspaceStatus = (project.workspace_status ?? "not_prepared") as ProjectReadiness["workspace"]["status"];
    const runtimeStatus = (project.runtime_status ?? "stopped") as ProjectReadiness["runtime"]["status"];
    const scanStatus = (project.scan_status ?? "pending") as ProjectReadiness["scan"]["status"];

    const readiness: ProjectReadiness = {
      projectId: project.id,

      github: {
        status: project.github_installation_id ? "connected" : "missing",
        installationId: project.github_installation_id ?? null,
      },

      repository: {
        status: project.github_repository_id ? "imported" : "missing",
        fullName: project.github_full_name ?? null,
        defaultBranch: project.github_branch ?? project.github_default_branch ?? null,
        commitSha: project.latest_commit_sha ?? null,
      },

      scan: {
        status: scanStatus,
        error: project.scan_error ?? null,
      },

      workspace: {
        status: workspaceStatus,
        workspaceId: project.workspace_id ?? null,
        root: project.workspace_root ?? null,
        error: project.workspace_error ?? null,
      },

      terminal: {
        status: workspaceStatus === "ready" ? "project_ready" : "local_only",
      },

      runtime: {
        status: runtimeStatus,
        previewUrl: project.preview_url ?? null,
      },
    };

    return NextResponse.json({ readiness });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load project readiness";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
