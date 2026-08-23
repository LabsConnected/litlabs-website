import "server-only";
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
 * Shared workspace recovery logic.
 *
 * When the DB says workspace_status === "ready" but the terminal server
 * has lost the workspace (restart, crash, eviction), this module
 * re-provisions automatically instead of returning an error to the user.
 *
 * Used by:
 * - /api/studio-projects/[projectId]/files/route.ts (GET + POST)
 * - /api/studio-projects/[projectId]/workspace/route.ts (GET)
 */

export interface RecoveredWorkspace {
  workspaceId: string;
  reprepared: boolean;
}

/**
 * Check whether a workspace still exists on the terminal server.
 * If it doesn't, re-provision it automatically.
 * Returns the (possibly new) workspaceId.
 */
export async function ensureWorkspaceAlive(
  projectId: string,
  userId: string,
  currentWorkspaceId: string,
): Promise<RecoveredWorkspace> {
  // First check if the workspace still exists on the terminal server
  const ws = await getWorkspaceInternal(currentWorkspaceId, userId).catch(() => null);
  if (ws) {
    return { workspaceId: currentWorkspaceId, reprepared: false };
  }

  // Workspace was lost — re-prepare
  await reprepareWorkspace(projectId, userId);
  const project = await getProject(projectId, userId);
  if (!project?.workspaceId) {
    throw new Error("Workspace recovery failed: no workspace ID after re-preparation");
  }
  return { workspaceId: project.workspaceId, reprepared: true };
}

/**
 * Re-prepare a workspace from scratch.
 * Clears stale DB records, claims the provisioning lock, and provisions.
 * Throws if provisioning fails.
 */
export async function reprepareWorkspace(
  projectId: string,
  userId: string,
): Promise<string> {
  const project = await getProject(projectId, userId);
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.userId !== userId) {
    throw new Error("Forbidden");
  }

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
    throw new Error("Could not establish canonical project record for re-preparation");
  }

  if (canonical.workspaceStatus === "provisioning") {
    // Another request is already provisioning — wait for it
    const refreshed = await getProject(projectId, userId);
    if (refreshed?.workspaceId && refreshed.workspaceStatus === "ready") {
      return refreshed.workspaceId;
    }
    throw new Error("Workspace provisioning is already in progress");
  }

  // Claim the provisioning lock
  const claimed = await claimProvisioningLock(projectId, userId);
  if (!claimed) {
    // Another request won the race — check if it already finished
    const refreshed = await getProject(projectId, userId);
    if (refreshed?.workspaceId && refreshed.workspaceStatus === "ready") {
      return refreshed.workspaceId;
    }
    throw new Error("Workspace provisioning is already in progress");
  }

  // Provision the workspace
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
    await updateProjectWorkspace(projectId, userId, {
      workspaceStatus: "failed",
      workspaceError: "Project has no valid source for workspace provisioning",
    });
    throw new Error("Project has no valid source for workspace provisioning");
  }

  // Persist the new workspace
  await updateProjectWorkspace(projectId, userId, {
    workspaceId: result.workspaceId,
    workspaceStatus: "ready",
    workspaceRoot: result.root,
    workspacePreparedAt: new Date().toISOString(),
    workspaceError: null,
  });

  return result.workspaceId;
}

/**
 * Normalize raw terminal-server error text into a clean user-facing message.
 * Prevents nested JSON like {"error":"Workspace not found"} from reaching the UI.
 */
export function normalizeFileError(text: string): string {
  // Try to parse nested JSON error
  try {
    const parsed = JSON.parse(text);
    if (parsed.error && typeof parsed.error === "string") {
      if (parsed.error.toLowerCase().includes("workspace not found")) {
        return "Workspace is not available. It may have been reset — please refresh.";
      }
      return parsed.error;
    }
  } catch {
    // Not JSON — fall through
  }

  const lower = text.toLowerCase();
  if (lower.includes("workspace not found")) {
    return "Workspace is not available. It may have been reset — please refresh.";
  }
  if (lower.includes("unauthorized") || lower.includes("forbidden")) {
    return "You do not have access to this workspace.";
  }
  return text || "Unknown error";
}
