import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/github-app";
import { supabaseAdmin } from "@/lib/supabase";

async function findUserIdForInstallation(installationId: number): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from("github_installations")
      .select("user_id")
      .eq("installation_id", installationId)
      .single();
    return data?.user_id ?? null;
  } catch {
    return null;
  }
}

async function logEvent(
  userId: string,
  projectId: string | null,
  provider: string,
  eventType: string,
  title: string,
  description: string | null,
  severity: string,
  actor: string | null,
  url: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    await supabaseAdmin.from("integration_events").insert({
      user_id: userId,
      integration_project_id: projectId,
      provider,
      event_type: eventType,
      title,
      description,
      severity,
      actor,
      url,
      metadata,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}

async function findProjectForRepo(
  userId: string,
  repoFullName: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("integration_projects")
    .select("id")
    .eq("user_id", userId)
    .eq("repository_full_name", repoFullName)
    .single();
  return data?.id ?? null;
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";
  const event = request.headers.get("x-github-event") || "unknown";
  const deliveryId = request.headers.get("x-github-delivery");

  try {
    if (!verifyWebhookSignature(payload, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const data = JSON.parse(payload);

  // Store all webhook events for audit
  try {
    await supabaseAdmin.from("github_webhook_events").insert({
      event,
      payload: data,
      delivery_id: deliveryId,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }

  const installationId: number | undefined = data.installation?.id;
  const userId = installationId ? await findUserIdForInstallation(installationId) : null;

  // Handle installation lifecycle events
  if (event === "installation" && data.installation) {
    const action = data.action;
    const instId = data.installation.id;
    if (action === "deleted") {
      await supabaseAdmin
        .from("github_installations")
        .delete()
        .eq("installation_id", instId);
      // Also mark integration account offline
      if (userId) {
        await supabaseAdmin
          .from("integration_accounts")
          .update({ status: "offline", updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("provider", "github")
          .eq("provider_account_id", String(instId));
      }
    }
    return NextResponse.json({ received: true, event, action });
  }

  // Handle installation_repositories — repos added or removed from installation
  if (event === "installation_repositories" && data.installation) {
    const instId = data.installation.id;
    const added: Array<{ full_name: string }> = data.repositories_added || [];
    const removed: Array<{ full_name: string }> = data.repositories_removed || [];
    if (userId) {
      for (const repo of added) {
        await logEvent(
          userId, null, "github", "repository_added",
          `Repository ${repo.full_name} added to installation`,
          `Installation #${instId} now has access to ${repo.full_name}`,
          "info", data.sender?.login, null,
          { installation_id: instId, repository: repo.full_name },
        );
      }
      for (const repo of removed) {
        await logEvent(
          userId, null, "github", "repository_removed",
          `Repository ${repo.full_name} removed from installation`,
          `Installation #${instId} lost access to ${repo.full_name}`,
          "warning", data.sender?.login, null,
          { installation_id: instId, repository: repo.full_name },
        );
      }
    }
    return NextResponse.json({ received: true, event, added: added.length, removed: removed.length });
  }

  // Push events
  if (event === "push" && data.repository && data.ref && userId) {
    const repoFullName = data.repository.full_name;
    const projectId = await findProjectForRepo(userId, repoFullName);
    const branch = data.ref.replace("refs/heads/", "");
    const commits: Array<{ id: string; message: string; author: { name: string; email: string } }> = data.commits || [];
    const headCommit = data.head_commit;

    // Update project's latest commit
    if (projectId && headCommit) {
      await supabaseAdmin
        .from("integration_projects")
        .update({
          latest_commit_sha: headCommit.id,
          latest_commit_message: headCommit.message,
          latest_commit_author: headCommit.author?.name,
          latest_commit_date: new Date().toISOString(),
          working_branch: branch,
          last_synced_at: new Date().toISOString(),
          sync_status: "synced",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);
    }

    await logEvent(
      userId, projectId, "github", "push",
      `${commits.length} commit${commits.length === 1 ? "" : "s"} pushed to ${branch}`,
      headCommit?.message?.slice(0, 200) || `${commits.length} commits`,
      "success", data.pusher?.name, headCommit?.url,
      { branch, commits: commits.length, repo: repoFullName },
    );
    return NextResponse.json({ received: true, event, commits: commits.length });
  }

  // Pull request events
  if (event === "pull_request" && data.pull_request && data.repository && userId) {
    const pr = data.pull_request;
    const action = data.action;
    const repoFullName = data.repository.full_name;
    const projectId = await findProjectForRepo(userId, repoFullName);

    // Update open PR count on project
    if (projectId && (action === "opened" || action === "reopened" || action === "closed")) {
      try {
        const { getInstallationOctokit } = await import("@/lib/github-app");
        if (installationId) {
          const octokit = await getInstallationOctokit(installationId);
          const { data: prs } = await octokit.rest.pulls.list({
            owner: data.repository.owner.login,
            repo: data.repository.name,
            state: "open",
            per_page: 1,
          });
          await supabaseAdmin
            .from("integration_projects")
            .update({
              open_prs_count: prs.length > 0 ? 1 : 0,
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);
        }
      } catch {
        // Non-fatal
      }
    }

    const severity = action === "closed" && pr.merged ? "success" : action === "closed" ? "info" : "info";
    await logEvent(
      userId, projectId, "github", "pull_request",
      `PR #${pr.number} ${action}: ${pr.title}`,
      `${pr.user?.login} ${action} pull request #${pr.number}`,
      severity, pr.user?.login, pr.html_url,
      { number: pr.number, action, merged: pr.merged, repo: repoFullName },
    );
    return NextResponse.json({ received: true, event, action, number: pr.number });
  }

  // Workflow run events (GitHub Actions)
  if (event === "workflow_run" && data.workflow_run && data.repository && userId) {
    const run = data.workflow_run;
    const action = data.action;
    const repoFullName = data.repository.full_name;
    const projectId = await findProjectForRepo(userId, repoFullName);
    const conclusion = run.conclusion;
    const severity = conclusion === "failure" ? "error" : conclusion === "success" ? "success" : "info";

    // Update project's GitHub Actions status
    if (projectId) {
      await supabaseAdmin
        .from("integration_projects")
        .update({
          github_actions_status: {
            workflow: run.name,
            status: run.status,
            conclusion: run.conclusion,
            html_url: run.html_url,
            updated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);
    }

    await logEvent(
      userId, projectId, "github", "workflow_run",
      `Build ${conclusion === "failure" ? "failed" : conclusion === "success" ? "passed" : action}: ${run.name}`,
      `Workflow "${run.name}" on ${repoFullName} — ${run.status}${conclusion ? ` (${conclusion})` : ""}`,
      severity, run.actor?.login, run.html_url,
      { workflow: run.name, status: run.status, conclusion, repo: repoFullName },
    );
    return NextResponse.json({ received: true, event, action, conclusion });
  }

  // Issues events
  if (event === "issues" && data.issue && data.repository && userId) {
    const issue = data.issue;
    const action = data.action;
    const repoFullName = data.repository.full_name;
    const projectId = await findProjectForRepo(userId, repoFullName);

    // Update open issues count
    if (projectId && (action === "opened" || action === "closed" || action === "reopened")) {
      try {
        const { getInstallationOctokit } = await import("@/lib/github-app");
        if (installationId) {
          const octokit = await getInstallationOctokit(installationId);
          const { data: issues } = await octokit.rest.issues.listForRepo({
            owner: data.repository.owner.login,
            repo: data.repository.name,
            state: "open",
            per_page: 1,
          });
          await supabaseAdmin
            .from("integration_projects")
            .update({
              open_issues_count: issues.length > 0 ? 1 : 0,
              updated_at: new Date().toISOString(),
            })
            .eq("id", projectId);
        }
      } catch {
        // Non-fatal
      }
    }

    await logEvent(
      userId, projectId, "github", "issues",
      `Issue #${issue.number} ${action}: ${issue.title}`,
      `${issue.user?.login} ${action} issue #${issue.number}`,
      action === "closed" ? "info" : "info", issue.user?.login, issue.html_url,
      { number: issue.number, action, repo: repoFullName },
    );
    return NextResponse.json({ received: true, event, action, number: issue.number });
  }

  // Repository events (renamed, transferred, deleted)
  if (event === "repository" && data.repository && userId) {
    const action = data.action;
    const repo = data.repository;
    const projectId = await findProjectForRepo(userId, repo.full_name);

    if (action === "deleted" && projectId) {
      await supabaseAdmin
        .from("integration_projects")
        .delete()
        .eq("id", projectId);
    }

    await logEvent(
      userId, projectId, "github", "repository",
      `Repository ${repo.full_name} ${action}`,
      `Repository ${repo.full_name} was ${action}`,
      action === "deleted" ? "warning" : "info",
      data.sender?.login, repo.html_url,
      { action, repo: repo.full_name },
    );
    return NextResponse.json({ received: true, event, action });
  }

  return NextResponse.json({ received: true, event });
}
