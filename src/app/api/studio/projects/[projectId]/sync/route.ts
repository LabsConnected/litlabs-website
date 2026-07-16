import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Octokit } from "@octokit/rest";
import { getInstallationOctokit } from "@/lib/github-app";
import { scanRepository, scanResultToSummary } from "@/lib/repo-scanner";

/**
 * POST /api/studio/projects/[projectId]/sync
 * Sync the project from GitHub — fetch the latest commit, update the file
 * tree in project_files, and refresh scan_summary.
 *
 * Optionally pass { skip_scan: true } to only update the commit SHA + file
 * tree without running the full scanner.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const { projectId } = await params;
    let skipScan = false;
    try {
      const body = await request.json();
      skipScan = !!body.skip_scan;
    } catch {
      // No body or invalid JSON — that's fine, default to full sync
    }

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

    const branch = project.github_branch || project.github_default_branch || "main";
    const octokit = await getInstallationOctokit(project.github_installation_id);

    // Get the latest commit SHA
    const { data: branchData } = await octokit.rest.repos.getBranch({
      owner: project.github_owner,
      repo: project.github_repo,
      branch,
    });
    const latestSha = branchData.commit.sha;

    // If the commit hasn't changed and we're not forcing, skip
    if (project.latest_commit_sha === latestSha && skipScan) {
      return NextResponse.json({
        synced: true,
        upToDate: true,
        latestCommitSha: latestSha,
      });
    }

    // Update the file tree in project_files
    await updateFileTree(sb, projectId, octokit, project.github_owner, project.github_repo, latestSha);

    if (skipScan) {
      // Just update the commit SHA
      await sb
        .from("studio_projects")
        .update({
          latest_commit_sha: latestSha,
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);

      return NextResponse.json({
        synced: true,
        latestCommitSha: latestSha,
        scanSkipped: true,
      });
    }

    // Full sync: run the scanner too
    await sb
      .from("studio_projects")
      .update({ scan_status: "scanning", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    const result = await scanRepository(octokit, project.github_owner, project.github_repo, branch);
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
        latest_commit_sha: latestSha,
        scan_status: "ready",
        scan_error: null,
        scan_summary: summary,
        last_scanned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    return NextResponse.json({
      synced: true,
      latestCommitSha: latestSha,
      scanSummary: summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to sync project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Fetch the repo tree and upsert file rows into project_files.
 */
async function updateFileTree(
  sb: SupabaseClient,
  projectId: string,
  octokit: Octokit,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<void> {
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: "1",
  });

  const files = (treeData.tree || [])
    .filter((t) => t.type === "blob" && t.path)
    .map((t) => ({
      project_id: projectId,
      path: t.path!,
      file_type: t.path!.split(".").pop() || null,
      size_bytes: t.size ?? null,
      sha: t.sha ?? null,
    }));

  if (files.length === 0) return;

  // Upsert in batches of 100 to avoid payload limits
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100);
    await sb
      .from("project_files")
      .upsert(batch, { onConflict: "project_id,path" });
  }
}
