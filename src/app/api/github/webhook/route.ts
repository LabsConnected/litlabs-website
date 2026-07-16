import { NextRequest, NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/github-app";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/github/webhook
 * Receives GitHub App webhook events: push, repository, installation.
 * Verifies signature, stores audit event, and syncs affected projects.
 */
export async function POST(request: NextRequest) {
  const payload = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";
  const event = request.headers.get("x-github-event") || "unknown";

  try {
    if (!verifyWebhookSignature(payload, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook error";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const data = JSON.parse(payload);
  const sb = supabaseAdmin;

  // Store webhook events for audit. Keep this lightweight.
  if (sb) {
    try {
      await sb.from("github_webhook_events").insert({
        event,
        payload: data,
        delivery_id: request.headers.get("x-github-delivery"),
        created_at: new Date().toISOString(),
      });
    } catch {
      // Non-fatal: continue processing even if audit insert fails.
    }
  }

  // Handle installation events to keep our records in sync.
  if (event === "installation" && data.installation) {
    const action = data.action;
    const installationId = data.installation.id;
    if (action === "deleted" && sb) {
      await sb
        .from("github_installations")
        .delete()
        .eq("installation_id", installationId);
    }
    return NextResponse.json({ received: true, event, action });
  }

  // Handle push events — update the latest_commit_sha for matching projects
  if (event === "push" && data.repository && data.ref && sb) {
    const repoId = data.repository.id;
    const ref = data.ref as string; // e.g. "refs/heads/main"
    const branch = ref.replace("refs/heads/", "");
    const commitSha = data.after as string | undefined;

    let projectsUpdated = 0;
    // Find all studio_projects tracking this repo on this branch
    try {
      const { data: projects } = await sb
        .from("studio_projects")
        .select("id, github_branch, scan_status")
        .eq("github_repository_id", repoId)
        .eq("github_branch", branch);

      if (projects && projects.length > 0) {
        projectsUpdated = projects.length;
        // Update each project's latest_commit_sha
        for (const project of projects) {
          await sb
            .from("studio_projects")
            .update({
              latest_commit_sha: commitSha ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", project.id);
        }
      }
    } catch {
      // Non-fatal: sync will catch up on next manual refresh
    }

    return NextResponse.json({
      received: true,
      event,
      branch,
      commitSha,
      projectsUpdated,
    });
  }

  // Handle repository events (rename, transfer, delete)
  if (event === "repository" && data.repository && sb) {
    const action = data.action;
    const repoId = data.repository.id;

    if (action === "deleted" || action === "transferred") {
      try {
        // Mark projects as needing sync or delete them
        if (action === "deleted") {
          await sb
            .from("studio_projects")
            .delete()
            .eq("github_repository_id", repoId);
        }
      } catch {
        // Non-fatal
      }
    } else if (action === "renamed" && data.changes) {
      // Update the repo name/full_name if the repo was renamed
      const newName = data.repository.name;
      const newFullName = data.repository.full_name;
      const newOwner = data.repository.owner?.login;
      try {
        await sb
          .from("studio_projects")
          .update({
            github_repo: newName,
            github_full_name: newFullName,
            github_owner: newOwner,
            updated_at: new Date().toISOString(),
          })
          .eq("github_repository_id", repoId);
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json({ received: true, event, action });
  }

  if (event === "pull_request" && data.pull_request) {
    // Future logic: update PR status, notify agent, etc.
    return NextResponse.json({ received: true, event });
  }

  return NextResponse.json({ received: true, event });
}
