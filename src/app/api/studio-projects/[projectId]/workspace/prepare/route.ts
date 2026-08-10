import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { CanonicalProject } from "@/lib/projects/types";
import {
  getProject,
  updateProjectWorkspace,
  ensureCanonicalStudioProject,
  claimProvisioningLock,
  recoverStaleProvisioning,
} from "@/lib/projects/project-repository";
import { prepareWorkspaceInternal, getWorkspaceInternal } from "@/lib/terminal-internal-client";
import { getInstallationToken } from "@/lib/github-app";

/**
 * POST /api/studio-projects/[projectId]/workspace/prepare
 *
 * Provisions an isolated workspace on the terminal service.
 * The browser calls this endpoint; Next.js calls terminal-server internally.
 *
 * The workspace is bound to the authenticated user and the canonical project.
 * Returns the workspace descriptor (workspaceId, status, root).
 *
 * Provisioning is guarded by a database-backed atomic lock:
 *   not_prepared/failed → provisioning (only one caller wins)
 *   provisioning → ready (on success)
 *   provisioning → failed (on error)
 *
 * This works across separate serverless instances unlike an in-memory Map.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  // Verify the user owns this project (checks both studio_projects and legacy)
  const project = await getProject(projectId, userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If workspace is already ready in DB, verify it still exists on terminal-server.
  // Railway restarts/crashes can lose in-memory workspaces while DB still says "ready".
  if (project.workspaceId && project.workspaceStatus === "ready") {
    try {
      const ws = await getWorkspaceInternal(project.workspaceId, userId);
      if (ws && ws.ready) {
        // Workspace confirmed alive on terminal-server — return immediately
        return NextResponse.json({
          workspaceId: project.workspaceId,
          workspaceStatus: "ready",
          workspaceRoot: project.workspaceRoot,
        });
      }
      // Workspace lost on terminal-server — fall through to re-provision
      // Reset stale DB record so provisioning can proceed
      await updateProjectWorkspace(projectId, userId, {
        workspaceId: null,
        workspaceStatus: "not_prepared",
        workspaceRoot: null,
        workspaceError: null,
      });
    } catch {
      // If verification fails due to config issues, don't re-provision
      // (the error will surface again during provisioning)
      // Fall through to re-provision for network errors
      await updateProjectWorkspace(projectId, userId, {
        workspaceId: null,
        workspaceStatus: "not_prepared",
        workspaceRoot: null,
        workspaceError: null,
      });
    }
  }

  // Recover stale provisioning locks before checking status.
  // If a previous serverless invocation crashed after claiming the lock,
  // the row stays `provisioning` forever without this recovery step.
  await recoverStaleProvisioning(projectId, userId);

  // Ensure the project exists as a canonical studio_projects row before
  // we try to lock or update it. Legacy projects are migrated here explicitly.
  let canonical: CanonicalProject;
  try {
    canonical = await ensureCanonicalStudioProject(projectId, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not establish canonical project record";
    return NextResponse.json(
      {
        error: message,
        projectId,
        userId,
      },
      { status: 500 },
    );
  }

  // If already provisioning, tell the client to poll
  if (canonical.workspaceStatus === "provisioning") {
    return NextResponse.json(
      {
        code: "PROVISIONING_IN_PROGRESS",
        error: "Workspace provisioning is already in progress.",
        workspaceStatus: "provisioning",
      },
      { status: 409 },
    );
  }

  // Atomically claim the provisioning lock.
  // Only one request can transition not_prepared/failed → provisioning.
  const claimed = await claimProvisioningLock(projectId, userId);
  if (!claimed) {
    // Another request won the race or status is not claimable
    return NextResponse.json(
      {
        code: "PROVISIONING_IN_PROGRESS",
        error: "Workspace provisioning is already in progress.",
        workspaceStatus: "provisioning",
      },
      { status: 409 },
    );
  }

  // We own the lock — proceed with provisioning
  try {
    let result;
    if (project.sourceType === "blank") {
      result = await prepareWorkspaceInternal({
        sourceType: "blank",
        userId,
        projectId,
        templateId: project.templateId ?? "blank-static",
      });
    } else if (project.sourceType === "github" && project.githubInstallationId && project.githubOwner && project.githubRepo) {
      // Generate a short-lived installation token so the terminal server can
      // clone private repositories. The token is never returned to the client
      // or logged — it is only passed to the internal workspace prepare call.
      const githubToken = await getInstallationToken(project.githubInstallationId);
      result = await prepareWorkspaceInternal({
        sourceType: "github",
        userId,
        projectId,
        installationId: project.githubInstallationId,
        owner: project.githubOwner,
        repo: project.githubRepo,
        branch: project.githubBranch ?? "main",
        commitSha: project.latestCommitSha,
        githubToken,
      });
    } else {
      // Mark as failed — no valid source
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "failed",
        workspaceError: "Project has no valid source for workspace provisioning",
      });
      return NextResponse.json(
        { error: "Project has no valid source for workspace provisioning" },
        { status: 400 },
      );
    }

    // Persist the workspace ID and root — transitions provisioning → ready
    await updateProjectWorkspace(projectId, userId, {
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      workspacePreparedAt: new Date().toISOString(),
      workspaceError: null,
    });

    return NextResponse.json({
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      branch: result.branch,
      commitSha: result.commitSha,
    });
  } catch (err) {
    // Transition provisioning → failed, releasing the lock
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    await updateProjectWorkspace(projectId, userId, {
      workspaceStatus: "failed",
      workspaceError: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
