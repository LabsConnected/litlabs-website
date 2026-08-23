import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getProject,
  updateProjectWorkspace,
  claimProvisioningLock,
  recoverStaleProvisioning,
  ensureCanonicalStudioProject,
} from "@/lib/projects/project-repository";
import {
  getWorkspaceInternal,
  prepareWorkspaceInternal,
} from "@/lib/terminal-internal-client";
import { getInstallationTokenForClone } from "@/lib/github-app";
import type { CanonicalProject } from "@/lib/projects/types";

/**
 * GET /api/studio-projects/[projectId]/workspace
 *
 * Returns the current workspace state for a project.
 * Verifies ownership. Does NOT expose the raw filesystem path to the browser
 * — only returns workspaceId and status.
 *
 * If the terminal server lost the workspace (restart, crash), this endpoint
 * AUTO-RE-PREPARES instead of just resetting to not_prepared. This means
 * Railway restarts no longer require the user to manually click "Prepare".
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  const project = await getProject(projectId, userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If no workspace is provisioned, return not_prepared
  if (!project.workspaceId) {
    return NextResponse.json({
      workspaceId: null,
      workspaceStatus: project.workspaceStatus,
      workspaceError: project.workspaceError,
    });
  }

  // Verify workspace still exists on terminal-server
  try {
    const ws = await getWorkspaceInternal(project.workspaceId, userId);
    if (!ws) {
      // Terminal no longer has this workspace (restart, crash, eviction).
      // AUTO-RE-PREPARE instead of just resetting to not_prepared.
      return await autoReprepare(project, projectId, userId);
    }

    // Return sanitized metadata — no raw filesystem path to browser
    return NextResponse.json({
      workspaceId: ws.workspaceId,
      workspaceStatus: ws.ready ? "ready" : "preparing",
      branch: ws.branch,
      commitSha: ws.commitSha,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to query workspace";
    // If the error is a key/config issue, don't try to re-prepare
    if (message.includes("TERMINAL_INTERNAL_SERVICE_KEY")) {
      return NextResponse.json(
        {
          workspaceId: project.workspaceId,
          workspaceStatus: "error",
          workspaceError: message,
        },
        { status: 502 },
      );
    }
    // For other errors (network, timeout), try auto-re-prepare
    return await autoReprepare(project, projectId, userId);
  }
}

/**
 * Auto-re-prepare a workspace that was lost on the terminal server.
 * This handles Railway restarts, crashes, and workspace evictions without
 * requiring the user to manually click "Prepare".
 */
async function autoReprepare(
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>,
  projectId: string,
  userId: string,
) {
  // Reset the stale workspace record
  await updateProjectWorkspace(projectId, userId, {
    workspaceId: null,
    workspaceStatus: "not_prepared",
    workspaceRoot: null,
    workspaceError: null,
  });

  // Recover any stale provisioning locks
  await recoverStaleProvisioning(projectId, userId);

  // Ensure canonical project row exists
  let canonical: CanonicalProject;
  try {
    canonical = await ensureCanonicalStudioProject(projectId, userId);
  } catch {
    // If we can't ensure canonical, return not_prepared so the client can retry
    return NextResponse.json({
      workspaceId: null,
      workspaceStatus: "not_prepared",
      workspaceError: "Workspace was lost and could not be re-prepared automatically. Click Prepare to retry.",
    });
  }

  if (canonical.workspaceStatus === "provisioning") {
    // Another request is already provisioning — tell client to poll
    return NextResponse.json({
      workspaceId: null,
      workspaceStatus: "provisioning",
      workspaceError: null,
    });
  }

  // Claim the provisioning lock
  const claimed = await claimProvisioningLock(projectId, userId);
  if (!claimed) {
    return NextResponse.json({
      workspaceId: null,
      workspaceStatus: "provisioning",
      workspaceError: null,
    });
  }

  // Provision the workspace
  try {
    let result;
    if (project.sourceType === "blank") {
      result = await prepareWorkspaceInternal({
        sourceType: "blank",
        userId,
        projectId,
        templateId: project.templateId ?? "blank-static",
      });
    } else if (
      project.sourceType === "github" &&
      project.githubInstallationId &&
      project.githubOwner &&
      project.githubRepo
    ) {
      const githubToken = await getInstallationTokenForClone({
        installationId: project.githubInstallationId,
        owner: project.githubOwner,
        repo: project.githubRepo,
      });
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
      // No valid source — return not_prepared
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "failed",
        workspaceError: "Project has no valid source for workspace provisioning",
      });
      return NextResponse.json({
        workspaceId: null,
        workspaceStatus: "failed",
        workspaceError: "Project has no valid source for workspace provisioning",
      });
    }

    // Success — update the project record
    await updateProjectWorkspace(projectId, userId, {
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      workspaceError: null,
    });

    return NextResponse.json({
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      branch: result.branch,
      commitSha: result.commitSha,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace re-preparation failed";
    await updateProjectWorkspace(projectId, userId, {
      workspaceStatus: "failed",
      workspaceError: message,
    });
    return NextResponse.json({
      workspaceId: null,
      workspaceStatus: "failed",
      workspaceError: message,
    });
  }
}
