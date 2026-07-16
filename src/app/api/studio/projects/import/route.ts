import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getInstallationOctokit } from "@/lib/github-app";
import { scanRepository, scanResultToSummary } from "@/lib/repo-scanner";

/**
 * POST /api/studio/projects/import
 * Import a GitHub repository as a studio project and trigger an initial scan.
 *
 * Body:
 *   { installation_id, repository_id, owner, repo, default_branch, branch? }
 *
 * Flow:
 *   1. Verify the installation belongs to the user
 *   2. Upsert the studio_projects row
 *   3. Run the repo scanner via the installation octokit
 *   4. Update the project with scan results
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const body = await request.json();
    const {
      installation_id,
      repository_id,
      owner,
      repo,
      default_branch = "main",
      branch,
    } = body;

    if (!installation_id || !repository_id || !owner || !repo) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify the user owns this installation
    const { data: inst, error: instError } = await sb
      .from("github_installations")
      .select("installation_id")
      .eq("user_id", userId)
      .eq("installation_id", installation_id)
      .single();
    if (instError || !inst) {
      return NextResponse.json({ error: "Installation not found" }, { status: 404 });
    }

    const workingBranch = branch || default_branch;
    const slug = repo.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    // Upsert the project row
    const { data: project, error: projectError } = await sb
      .from("studio_projects")
      .upsert(
        {
          user_id: userId,
          name: repo,
          slug,
          github_installation_id: installation_id,
          github_repository_id: repository_id,
          github_owner: owner,
          github_repo: repo,
          github_full_name: `${owner}/${repo}`,
          github_default_branch: default_branch,
          github_branch: workingBranch,
          scan_status: "scanning",
        },
        { onConflict: "user_id,github_repository_id" },
      )
      .select()
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: projectError?.message ?? "Failed to create project" },
        { status: 500 },
      );
    }

    // Create a scan record
    const { data: scanRecord } = await sb
      .from("project_scans")
      .insert({
        project_id: project.id,
        status: "scanning",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    // Run the scan asynchronously — don't block the response
    scanRepositoryAsync(sb, project.id, installation_id, owner, repo, workingBranch, scanRecord?.id)
      .catch(() => {
        // Non-fatal: scan status will be updated by the async handler
      });

    return NextResponse.json({
      project,
      scanStarted: true,
      message: "Repository import started. Scan will complete in the background.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to import project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Run the scan in the background and update the project + scan records.
 */
async function scanRepositoryAsync(
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

    // Update the project with scan results
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
        scan_summary: summary,
        last_scanned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    // Update the scan record
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
