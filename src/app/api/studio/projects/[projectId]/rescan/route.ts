import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getInstallationOctokit } from "@/lib/github-app";
import { scanRepository, scanResultToSummary } from "@/lib/repo-scanner";

/**
 * POST /api/studio/projects/[projectId]/rescan
 * Re-runs the repository scan synchronously. Used when a previous scan
 * got stuck in "scanning" due to Vercel function termination.
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

    const { data: project, error: fetchError } = await sb
      .from("studio_projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const installationId = project.github_installation_id;
    if (!installationId) {
      return NextResponse.json({ error: "No GitHub installation linked" }, { status: 400 });
    }

    const owner = project.github_owner;
    const repo = project.github_repo;
    const branch = project.github_branch ?? project.github_default_branch ?? "main";
    if (!owner || !repo) {
      return NextResponse.json({ error: "Repository info missing" }, { status: 400 });
    }

    // Set scanning status
    await sb
      .from("studio_projects")
      .update({ scan_status: "scanning", scan_error: null, updated_at: new Date().toISOString() })
      .eq("id", projectId);

    const { data: scanRecord } = await sb
      .from("project_scans")
      .insert({ project_id: projectId, status: "scanning", started_at: new Date().toISOString() })
      .select()
      .single();

    const SCAN_TIMEOUT_MS = 25_000;
    try {
      await Promise.race([
        (async () => {
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
              scan_summary: summary,
              last_scanned_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);

          if (scanRecord) {
            await sb
              .from("project_scans")
              .update({
                status: "completed",
                commit_sha: result.latestCommitSha,
                result: summary,
                completed_at: new Date().toISOString(),
              })
              .eq("id", scanRecord.id);
          }
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SCAN_TIMEOUT")), SCAN_TIMEOUT_MS),
        ),
      ]);

      return NextResponse.json({ scanCompleted: true, message: "Scan completed successfully." });
    } catch {
      // Timeout or error — status already set to "scanning" or "failed"
      return NextResponse.json({
        scanCompleted: false,
        message: "Scan timed out. Poll readiness for updates.",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Rescan failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
