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
import { getInstallationTokenForClone } from "@/lib/github-app";
import { isManagedSourceType } from "@/lib/projects/project-source";

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
      // Workspace lost on terminal-server (restart, crash, eviction) —
      // fall through to re-provision. Reset ONLY the status: the recorded
      // workspaceId and workspaceRoot are the adoption hints that let
      // re-provisioning find the durable source still sitting on the
      // volume. Nulling them here is what used to strand a legacy
      // workspace at a path nothing could name any more, so the user
      // came back to an empty project.
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "not_prepared",
        workspaceError: null,
      });
    } catch {
      // Terminal server unreachable — same reset, same reasoning.
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "not_prepared",
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
    // Adoption hints — see WorkspaceAdoptionHints. Passing the
    // project's recorded workspace lets the terminal server reuse
    // durable source that already exists on the volume instead of
    // provisioning an empty directory next to it.
    const adoption = {
      existingRoot: project.workspaceRoot,
      existingWorkspaceId: project.workspaceId,
    };

    let result;
    if (isManagedSourceType(project.sourceType)) {
      // Managed source: LiTT owns the files. "blank" and "template"
      // are both managed — "template" previously fell through to the
      // "no valid source" branch and could never be provisioned.
      result = await prepareWorkspaceInternal({
        sourceType: "managed",
        userId,
        projectId,
        templateId: project.templateId ?? "blank-static",
        ...adoption,
      });
    } else if (project.sourceType === "github" && project.githubInstallationId && project.githubOwner && project.githubRepo) {
      // Generate a short-lived installation token so the terminal server can
      // clone private repositories. The token is never returned to the client
      // or logged — it is only passed to the internal workspace prepare call.
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
        ...adoption,
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
    // Persist the branch the workspace actually reports. Without this
    // a managed project has a real `main` branch on disk but renders
    // "—", because github_branch is NULL for a project with no GitHub.
    // A failed write must surface as an error — reporting "ready" while the
    // row still says provisioning strands the workspace (the lock only
    // matches not_prepared/failed) and the next token request 409s.
    const persisted = await updateProjectWorkspace(projectId, userId, {
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      workspaceBranch: result.branch ?? null,
      workspacePreparedAt: new Date().toISOString(),
      workspaceError: null,
    });
    if (!persisted) {
      throw new Error("Workspace provisioned but the project record could not be persisted");
    }

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
    try {
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "failed",
        workspaceError: message,
      });
    } catch {
      // The write failure is already logged inside updateProjectWorkspace —
      // don't let it mask the provisioning error the user needs to see.
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
