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
import { prepareWorkspaceInternal } from "@/lib/terminal-internal-client";
import { getInstallationToken } from "@/lib/github-app";
<<<<<<< HEAD
=======

/**
 * In-memory single-flight lock for workspace preparation.
 *
 * Keyed by `userId:projectId`. If a provisioning operation is already
 * in progress for the same project, concurrent requests receive a 409
 * PROVISIONING_IN_PROGRESS instead of starting a duplicate clone.
 *
 * In a serverless environment (Vercel), each invocation may be a separate
 * instance, so this lock is best-effort within a single instance. The
 * terminal server's prepareWorkspace is also idempotent — it checks for
 * an existing workspace by projectId before cloning — which provides a
 * second layer of protection against duplicate clones.
 */
const provisioningLocks = new Map<string, Promise<{ workspaceId: string; workspaceStatus: string; workspaceRoot: string; branch?: string; commitSha?: string }>>();
>>>>>>> abb47e31 (WIP: apply pending studio-essentials changes)

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

  // If workspace is already ready, return it immediately
  if (project.workspaceId && project.workspaceStatus === "ready") {
    return NextResponse.json({
      workspaceId: project.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: project.workspaceRoot,
    });
  }

<<<<<<< HEAD
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
=======
  // Single-flight: if provisioning is already in progress for this project,
  // return 409 so the client can poll instead of starting a duplicate clone.
  const lockKey = `${userId}:${projectId}`;
  const existing = provisioningLocks.get(lockKey);
  if (existing) {
    return NextResponse.json(
      {
        code: "PROVISIONING_IN_PROGRESS",
        error: "Workspace provisioning is already in progress.",
        workspaceStatus: "provisioning",
      },
      { status: 409 },
    );
  }

  // Start provisioning and store the promise so concurrent requests can detect it
  const provisioningPromise = doProvision(project, projectId, userId);
  provisioningLocks.set(lockKey, provisioningPromise);

  try {
    const result = await provisioningPromise;
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    provisioningLocks.delete(lockKey);
  }
}

async function doProvision(
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>,
  projectId: string,
  userId: string,
): Promise<{ workspaceId: string; workspaceStatus: string; workspaceRoot: string; branch?: string; commitSha?: string }> {
  // Mark as provisioning
  await updateProjectWorkspace(projectId, userId, {
    workspaceStatus: "provisioning",
    workspaceError: null,
  });
>>>>>>> abb47e31 (WIP: apply pending studio-essentials changes)

  // Recover stale provisioning locks before checking status.
  // If a previous serverless invocation crashed after claiming the lock,
  // the row stays `provisioning` forever without this recovery step.
  await recoverStaleProvisioning(projectId, userId);

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
      throw new Error("Project has no valid source for workspace provisioning");
    }

    // Persist the workspace ID and root — transitions provisioning → ready
    await updateProjectWorkspace(projectId, userId, {
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      workspacePreparedAt: new Date().toISOString(),
      workspaceError: null,
    });

    return {
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      branch: result.branch,
      commitSha: result.commitSha,
    };
  } catch (err) {
    // Transition provisioning → failed, releasing the lock
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    await updateProjectWorkspace(projectId, userId, {
      workspaceStatus: "failed",
      workspaceError: message,
    });
    throw err;
  }
}
