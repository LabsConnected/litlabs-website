import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstallationOctokit } from "@/lib/github-app";
import { scanRepository, scanResultToSummary } from "@/lib/repo-scanner";

/**
 * POST /api/studio/projects/[projectId]/scan
 * Trigger a re-scan of the repository. Updates scan_status, scan_summary,
 * framework, commands, and latest_commit_sha.
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

    // Load the project
    const { data: project, error: projectError } = await sb
      .from("studio_projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();
    if (projectError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!project.github_installation_id || !project.github_owner || !project.github_repo) {
      return NextResponse.json({ error: "Project is not GitHub-backed" }, { status: 400 });
    }

    // Set scanning status
    await sb
      .from("studio_projects")
      .update({ scan_status: "scanning", scan_error: null, updated_at: new Date().toISOString() })
      .eq("id", projectId);

    // Create scan record
    const { data: scanRecord } = await sb
      .from("project_scans")
      .insert({
        project_id: projectId,
        status: "scanning",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Run scan in background
    runScan(
      sb,
      projectId,
      project.github_installation_id,
      project.github_owner,
      project.github_repo,
      project.github_branch || project.github_default_branch || "main",
      scanRecord?.id,
    ).catch(() => {
      // Error handled inside runScan
    });

    return NextResponse.json({
      scanStarted: true,
      message: "Scan started. Results will be available shortly.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start scan";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function runScan(
  sb: SupabaseClient,
  projectId: string,
  installationId: number,
  owner: string,
  repo: string,
  branch: string,
  scanId?: string,
): Promise<void> {
  try {
    const octokit = await getInstallationOctokit(installationId);
    const result = await scanRepository(octokit, owner, repo, branch);
    const summary = scanResultToSummary(result);

    await sb
      .from("studio_projects")
      .update({
        framework: result.framework,
        package_manager: result.packageManager,
        root_directory: result.rootDirectory,
        development_command: result.developmentCommand,
        build_command: result.buildCommand,
        test_command: result.testCommand,
        install_command: result.installCommand,
        latest_commit_sha: result.latestCommitSha,
        scan_status: "ready",
        scan_error: null,
        scan_summary: summary,
        last_scanned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (scanId) {
      await sb
        .from("project_scans")
        .update({
          status: "completed",
          commit_sha: result.latestCommitSha,
          result: summary,
          completed_at: new Date().toISOString(),
        })
        .eq("id", scanId);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Scan failed";
    await sb
      .from("studio_projects")
      .update({
        scan_status: "failed",
        scan_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (scanId) {
      await sb
        .from("project_scans")
        .update({
          status: "failed",
          error: errorMsg,
          completed_at: new Date().toISOString(),
        })
        .eq("id", scanId);
    }
  }
}
