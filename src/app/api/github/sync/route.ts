import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getInstallationOctokit } from "@/lib/github-app";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const installationId = body.installation_id;
  const fullReconcile = body.full === true;

  if (!installationId) {
    return NextResponse.json(
      { error: "Missing installation_id" },
      { status: 400 },
    );
  }

  const id = typeof installationId === "number" ? installationId : parseInt(installationId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid installation_id" }, { status: 400 });
  }

  const { data: instRow, error: instError } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id, user_id")
    .eq("user_id", userId)
    .eq("installation_id", id)
    .single();
  if (instError || !instRow) {
    return NextResponse.json({ error: "Installation not found for user" }, { status: 404 });
  }

  const syncRunId = crypto.randomUUID();
  const startedAt = new Date();
  const results: Array<{ repo: string; status: string; error?: string }> = [];

  try {
    await supabaseAdmin.from("integration_sync_runs").insert({
      id: syncRunId,
      integration_account_id: null,
      integration_project_id: null,
      provider: "github",
      status: "running",
      started_at: startedAt.toISOString(),
    });

    const octokit = await getInstallationOctokit(id);

    // Paginate all repositories accessible to the installation
    const repos: Array<{
      id: number;
      full_name: string;
      name: string;
      owner: { login: string };
      default_branch: string;
      private: boolean;
      html_url: string;
    }> = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const { data: pageData } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: perPage,
        page,
      });
      repos.push(...(pageData.repositories || []));
      if ((pageData.repositories || []).length < perPage) break;
      page++;
      if (page > 20) break;
    }

    // Find or create integration_account for this GitHub installation
    const { data: account } = await supabaseAdmin
      .from("integration_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "github")
      .eq("provider_account_id", String(id))
      .single();

    let accountId = account?.id;
    if (!accountId) {
      const { data: newAccount } = await supabaseAdmin
        .from("integration_accounts")
        .insert({
          user_id: userId,
          provider: "github",
          provider_account_id: String(id),
          provider_account_name: `Installation #${id}`,
          status: "connected",
          last_connected_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      accountId = newAccount?.id;
    } else {
      await supabaseAdmin
        .from("integration_accounts")
        .update({
          status: "connected",
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", accountId);
    }

    for (const repo of repos) {
      try {
        // Get latest commit on default branch
        let latestCommitSha: string | null = null;
        let latestCommitMessage: string | null = null;
        let latestCommitAuthor: string | null = null;
        let latestCommitDate: string | null = null;

        try {
          const { data: commit } = await octokit.rest.repos.getCommit({
            owner: repo.owner.login,
            repo: repo.name,
            ref: repo.default_branch,
          });
          latestCommitSha = commit.sha;
          latestCommitMessage = commit.commit.message;
          latestCommitAuthor = commit.commit.author?.name ?? null;
          latestCommitDate = commit.commit.author?.date ?? null;
        } catch {
          // Repo may be empty
        }

        // Get open PRs count
        let openPrsCount = 0;
        try {
          const { data: prs } = await octokit.rest.pulls.list({
            owner: repo.owner.login,
            repo: repo.name,
            state: "open",
            per_page: 1,
          });
          openPrsCount = prs.length;
        } catch {
          // Non-fatal
        }

        // Get open issues count
        let openIssuesCount = 0;
        try {
          const { data: issues } = await octokit.rest.issues.listForRepo({
            owner: repo.owner.login,
            repo: repo.name,
            state: "open",
            per_page: 1,
          });
          openIssuesCount = issues.length;
        } catch {
          // Non-fatal
        }

        // Get latest workflow run
        let actionsStatus: Record<string, unknown> = {};
        try {
          const { data: runs } = await octokit.rest.actions.listWorkflowRunsForRepo({
            owner: repo.owner.login,
            repo: repo.name,
            per_page: 1,
          });
          if (runs.workflow_runs && runs.workflow_runs.length > 0) {
            const run = runs.workflow_runs[0];
            actionsStatus = {
              workflow: run.name,
              status: run.status,
              conclusion: run.conclusion,
              html_url: run.html_url,
              updated_at: new Date().toISOString(),
            };
          }
        } catch {
          // Actions may not be enabled
        }

        // Upsert integration_project
        const { data: existing } = await supabaseAdmin
          .from("integration_projects")
          .select("id")
          .eq("user_id", userId)
          .eq("repository_id", repo.id)
          .single();

        if (existing) {
          await supabaseAdmin
            .from("integration_projects")
            .update({
              integration_account_id: accountId,
              repository_full_name: repo.full_name,
              repository_html_url: repo.html_url,
              repository_private: repo.private,
              default_branch: repo.default_branch,
              working_branch: repo.default_branch,
              latest_commit_sha: latestCommitSha,
              latest_commit_message: latestCommitMessage,
              latest_commit_author: latestCommitAuthor,
              latest_commit_date: latestCommitDate,
              open_prs_count: openPrsCount,
              open_issues_count: openIssuesCount,
              github_actions_status: actionsStatus,
              last_synced_at: new Date().toISOString(),
              sync_status: "synced",
              sync_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await supabaseAdmin
            .from("integration_projects")
            .insert({
              user_id: userId,
              integration_account_id: accountId,
              provider: "github",
              repository_id: repo.id,
              repository_full_name: repo.full_name,
              repository_html_url: repo.html_url,
              repository_private: repo.private,
              default_branch: repo.default_branch,
              working_branch: repo.default_branch,
              latest_commit_sha: latestCommitSha,
              latest_commit_message: latestCommitMessage,
              latest_commit_author: latestCommitAuthor,
              latest_commit_date: latestCommitDate,
              open_prs_count: openPrsCount,
              open_issues_count: openIssuesCount,
              github_actions_status: actionsStatus,
              last_synced_at: new Date().toISOString(),
              sync_status: "synced",
            });
        }

        results.push({ repo: repo.full_name, status: "synced" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({ repo: repo.full_name, status: "error", error: message });
      }
    }

    // If full reconcile, remove projects for repos no longer accessible
    if (fullReconcile && accountId) {
      const syncedRepoIds = repos.map((r) => r.id);
      const { data: existingProjects } = await supabaseAdmin
        .from("integration_projects")
        .select("id, repository_id")
        .eq("user_id", userId)
        .eq("integration_account_id", accountId);

      if (existingProjects) {
        for (const proj of existingProjects) {
          if (proj.repository_id && !syncedRepoIds.includes(proj.repository_id)) {
            await supabaseAdmin
              .from("integration_projects")
              .delete()
              .eq("id", proj.id);
          }
        }
      }
    }

    const completedAt = new Date();
    await supabaseAdmin
      .from("integration_sync_runs")
      .update({
        status: "completed",
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        result: { repos_synced: results.filter((r) => r.status === "synced").length, repos_errored: results.filter((r) => r.status === "error").length },
      })
      .eq("id", syncRunId);

    return NextResponse.json({
      synced: results.filter((r) => r.status === "synced").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    const completedAt = new Date();
    await supabaseAdmin
      .from("integration_sync_runs")
      .update({
        status: "failed",
        completed_at: completedAt.toISOString(),
        duration_ms: completedAt.getTime() - startedAt.getTime(),
        error: message,
      })
      .eq("id", syncRunId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
