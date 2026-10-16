import "server-only";
import {
  getProject,
  updateProjectWorkspace,
  claimProvisioningLock,
  recoverStaleProvisioning,
  ensureCanonicalStudioProject,
  touchProvisioningHeartbeat,
} from "@/lib/projects/project-repository";
import {
  getWorkspaceInternal,
  prepareWorkspaceInternal,
} from "@/lib/terminal-internal-client";
import { getInstallationTokenForClone } from "@/lib/github-app";
import { isManagedSourceType, isStaticTemplateId } from "@/lib/projects/project-source";
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

const PROVISIONING_POLL_MS = 500;
const PROVISIONING_WAIT_MS = 120_000;

/**
 * How often the lock owner bumps the row while a prepare is in flight.
 * The heartbeat is the liveness signal that distinguishes "actively
 * provisioning" from "the process holding this lock is gone".
 */
export const PROVISIONING_HEARTBEAT_MS = 10_000;

/**
 * A "provisioning" row whose updated_at has not moved in this long is
 * dead: the owner crashed, was redeployed, or its invocation was killed
 * mid-prepare. Comfortably above the heartbeat interval so transient
 * write slowness never gets a live job reclaimed by an observer.
 */
export const PROVISIONING_LOCK_DEAD_MS = 45_000;

/**
 * Beat the provisioning lock while this process owns it. Returns a stop
 * function — the caller must invoke it when the prepare settles.
 *
 * Only the claim winner may run this: the heartbeat is conditioned on
 * workspace_status='provisioning', so an observer firing it would keep a
 * dead owner's lock looking alive forever.
 */
function startProvisioningHeartbeat(projectId: string, userId: string, provisioningToken: string): () => void {
  const timer = setInterval(() => {
    void touchProvisioningHeartbeat(projectId, userId, provisioningToken);
  }, PROVISIONING_HEARTBEAT_MS);
  // The heartbeat must never keep a Node process alive by itself
  // (tests, one-shot scripts).
  (timer as { unref?: () => void }).unref?.();
  return () => clearInterval(timer);
}

function workspaceProvisioningError(project: CanonicalProject): Error {
  return new Error(project.workspaceError || "Workspace provisioning failed");
}

function sanitizeProvisioningError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "Workspace provisioning failed");
  return raw
    .replace(/https?:\/\/[^\s]+/gi, "[redacted endpoint]")
    .replace(/(?:api[-_]?key|token|secret|password)\s*[=:]\s*[^\s,}]+/gi, "credential=[redacted]")
    .slice(0, 500) || "Workspace provisioning failed";
}

/**
 * Observe an existing provisioning owner. This deliberately does not claim
 * or POST another prepare request: the owner must be allowed to finish, or a
 * stale lock must be recovered before a new owner is elected.
 */
async function waitForProvisioning(
  projectId: string,
  userId: string,
): Promise<string | null> {
  const deadline = Date.now() + PROVISIONING_WAIT_MS;

  while (Date.now() < deadline) {
    const current = await getProject(projectId, userId);
    if (!current) throw new Error("Project not found");
    if (current.workspaceStatus === "ready" && current.workspaceId) {
      return current.workspaceId;
    }
    if (current.workspaceStatus === "failed") {
      throw workspaceProvisioningError(current);
    }
    if (current.workspaceStatus !== "provisioning") return null;

    // Dead-owner detection. A live owner heartbeats updated_at while its
    // prepare runs; a row frozen past the dead-lock window means the
    // process holding the lock is gone (crash, redeploy, killed
    // invocation). Recover it now — inside the observation loop, not
    // after the full wait — and return null so the caller claims the
    // freed lock itself. recoverStaleProvisioning's conditional UPDATE
    // only matches a row that is still stale, so an owner that heartbeats
    // between our read and the reclaim is never touched.
    const lockAgeMs = Date.now() - Date.parse(current.updatedAt);
    if (lockAgeMs > PROVISIONING_LOCK_DEAD_MS) {
      const recovered = await recoverStaleProvisioning(
        projectId,
        userId,
        PROVISIONING_LOCK_DEAD_MS,
      );
      if (recovered) return null;
    }

    await new Promise((resolve) => setTimeout(resolve, PROVISIONING_POLL_MS));
  }

  // The lock owner did not finish in time. Only now is it safe to recover the
  // stale lock and let the caller below attempt one new claim.
  await recoverStaleProvisioning(projectId, userId, PROVISIONING_WAIT_MS);
  const current = await getProject(projectId, userId);
  if (current?.workspaceStatus === "ready" && current.workspaceId) {
    return current.workspaceId;
  }
  if (current?.workspaceStatus === "failed") {
    throw workspaceProvisioningError(current);
  }
  return null;
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
  // All callers, including file recovery, use the same lock owner. In
  // particular, this function must never claim a lock and then throw without
  // transitioning it to failed.
  return provisionWorkspaceForProject(projectId, userId);
}

/**
 * Provision a workspace for a project from scratch (or re-provision if lost).
 *
 * This is the single shared entry point for workspace provisioning used by:
 * - /api/studio-projects/[projectId]/workspace/prepare (explicit prepare)
 * - /api/studio-projects/[projectId]/preview POST (auto-provision before starting dev server)
 *
 * It is idempotent: if the workspace is already ready AND alive on the terminal
 * server, it returns immediately. If the workspace is missing or stale, it
 * claims the provisioning lock and provisions a fresh one.
 *
 * Returns the (possibly new) workspaceId. Throws on provisioning failure.
 */
export async function provisionWorkspaceForProject(
  projectId: string,
  userId: string,
): Promise<string> {
  const project = await getProject(projectId, userId);
  if (!project) throw new Error("Project not found");
  if (project.userId !== userId) throw new Error("Forbidden");

  // GitHub-backed projects are mirrors: the repo is the source of truth, so a
  // "ready" workspace must be re-synced on provision — otherwise the preview
  // serves stale files forever (the fetch/pull only happens inside
  // prepareWorkspace). Managed workspaces ARE the source of truth, so the
  // early return below is safe for them.
  const isGithubMirror =
    project.sourceType === "github" &&
    project.githubInstallationId &&
    project.githubOwner &&
    project.githubRepo;

  // If the workspace is already ready in DB, verify it still exists on the
  // terminal server. Railway restarts/crashes can lose in-memory workspaces.
  if (project.workspaceId && project.workspaceStatus === "ready" && !isGithubMirror) {
    const ws = await getWorkspaceInternal(project.workspaceId, userId).catch(() => null);
    if (ws && ws.ready) {
      return project.workspaceId;
    }
    // Workspace lost on terminal-server — reset the status only.
    // workspaceId/workspaceRoot stay as adoption hints so the
    // durable source on the volume is reattached, not replaced.
    await updateProjectWorkspace(projectId, userId, {
      workspaceStatus: "not_prepared",
      workspaceError: null,
    });
  }

  // GitHub mirror refresh: an existing, alive workspace is re-synced to the
  // latest repo state via prepareWorkspace (fetch/pull). Best-effort — if the
  // pull fails (e.g. uncommitted agent work blocks it), keep serving the
  // existing workspace instead of breaking the preview.
  if (isGithubMirror && project.workspaceId && project.workspaceStatus === "ready") {
    const ws = await getWorkspaceInternal(project.workspaceId, userId).catch(() => null);
    if (ws && ws.ready) {
      try {
        const githubToken = await getInstallationTokenForClone({
          installationId: project.githubInstallationId!,
          owner: project.githubOwner!,
          repo: project.githubRepo!,
        });
        const result = await prepareWorkspaceInternal({
          sourceType: "github",
          userId,
          projectId,
          installationId: project.githubInstallationId!,
          owner: project.githubOwner!,
          repo: project.githubRepo!,
          branch: project.githubBranch ?? "main",
          commitSha: project.latestCommitSha,
          githubToken,
          existingRoot: project.workspaceRoot,
          existingWorkspaceId: project.workspaceId,
        });
        await updateProjectWorkspace(projectId, userId, {
          workspaceId: result.workspaceId,
          workspaceStatus: "ready",
          workspaceRoot: result.root,
          workspaceBranch: result.branch ?? null,
          workspacePreparedAt: new Date().toISOString(),
          workspaceError: null,
        });
        return result.workspaceId;
      } catch (err) {
        console.warn(
          `[provisionWorkspaceForProject] GitHub refresh failed for project ${projectId}; serving existing workspace:`,
          err instanceof Error ? err.message : err,
        );
        return project.workspaceId;
      }
    }
    // Workspace lost on terminal-server — reset the status only and fall
    // through to the full re-provision below.
    await updateProjectWorkspace(projectId, userId, {
      workspaceStatus: "not_prepared",
      workspaceError: null,
    });
  }

  // Recover dead provisioning locks before attempting a fresh claim.
  // Live owners heartbeat updated_at, so the dead-lock window — not the
  // old 5-minute timeout — is the safe reclaim threshold: an interrupted
  // lock frees in ~45s instead of hanging every caller for 120s+.
  await recoverStaleProvisioning(projectId, userId, PROVISIONING_LOCK_DEAD_MS);

  // Ensure the project exists as a canonical studio_projects row.
  let canonical: CanonicalProject;
  try {
    canonical = await ensureCanonicalStudioProject(projectId, userId);
  } catch {
    throw new Error("Could not establish canonical project record for provisioning");
  }

  // If another request is already provisioning, observe it. Do not turn a
  // single in-flight prepare into a repeated POST retry storm.
  if (canonical.workspaceStatus === "provisioning") {
    const completed = await waitForProvisioning(projectId, userId);
    if (completed) return completed;
  }

  // Atomically claim the provisioning lock.
  const claimed = await claimProvisioningLock(projectId, userId);
  let owner = claimed;
  if (!claimed) {
    const completed = await waitForProvisioning(projectId, userId);
    if (completed) return completed;
    // A stale lock may have been recovered between the initial read and the
    // atomic claim. Re-read once and claim only if it is now claimable.
    const refreshed = await getProject(projectId, userId);
    if (refreshed?.workspaceStatus === "ready" && refreshed.workspaceId) {
      return refreshed.workspaceId;
    }
    if (!refreshed || refreshed.workspaceStatus === "provisioning") {
      throw new Error("Workspace provisioning did not settle");
    }
    const retryClaim = await claimProvisioningLock(projectId, userId);
    if (!retryClaim) throw new Error("Workspace provisioning did not settle");
    owner = retryClaim;
  }

  // We own the lock — provision the workspace. The heartbeat proves
  // liveness to observers for the whole prepare: without it a prepare
  // running longer than the dead-lock window looks identical to a crashed
  // process and gets reclaimed mid-flight.
  const provisioningToken = owner?.workspaceProvisioningToken;
  if (!provisioningToken) {
    throw new Error("Workspace provisioning claim did not return an ownership token");
  }
  const stopHeartbeat = startProvisioningHeartbeat(projectId, userId, provisioningToken);
  try {
    // Use the row returned by the atomic claim so adoption hints and source
    // metadata cannot come from the stale pre-lock read.
    const provisioningProject = {
      ...project,
      // The atomic claim result is authoritative for mutable workspace
      // adoption fields, while the original project remains the source of
      // truth for immutable source/template metadata in legacy test/migration
      // paths that may return a partial claim row.
      workspaceId: owner?.workspaceId ?? project.workspaceId,
      workspaceRoot: owner?.workspaceRoot ?? project.workspaceRoot,
    };
    const adoption = {
      existingRoot: provisioningProject.workspaceRoot,
      existingWorkspaceId: provisioningProject.workspaceId,
    };

    let result;
    if (isManagedSourceType(provisioningProject.sourceType)) {
      const templateId = provisioningProject.templateId ?? "blank-static";
      // Static-site templates (no build step) provision via the gitless
      // "static" path — Gate 1 blocks all git operations in production.
      // Framework templates keep the "managed" (git-backed) path.
      const provisionSourceType = isStaticTemplateId(templateId) ? "static" : "managed";
      result = await prepareWorkspaceInternal({
        sourceType: provisionSourceType,
        userId,
        projectId,
        templateId,
        ...adoption,
      });
    } else if (
      provisioningProject.sourceType === "github" &&
      provisioningProject.githubInstallationId &&
      provisioningProject.githubOwner &&
      provisioningProject.githubRepo
    ) {
      const githubToken = await getInstallationTokenForClone({
        installationId: provisioningProject.githubInstallationId,
        owner: provisioningProject.githubOwner,
        repo: provisioningProject.githubRepo,
      });
      result = await prepareWorkspaceInternal({
        sourceType: "github",
        userId,
        projectId,
        installationId: provisioningProject.githubInstallationId,
        owner: provisioningProject.githubOwner,
        repo: provisioningProject.githubRepo,
        branch: provisioningProject.githubBranch ?? "main",
        commitSha: provisioningProject.latestCommitSha,
        githubToken,
        ...adoption,
      });
    } else {
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "failed",
        workspaceError: "Project has no valid source for workspace provisioning",
        workspaceProvisioningToken: null,
        expectedProvisioningToken: provisioningToken,
      });
      throw new Error("Project has no valid source for workspace provisioning");
    }

    const persisted = await updateProjectWorkspace(projectId, userId, {
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      workspaceBranch: result.branch ?? null,
      workspacePreparedAt: new Date().toISOString(),
      workspaceError: null,
      workspaceProvisioningToken: null,
      expectedProvisioningToken: provisioningToken,
    });
    if (!persisted) {
      throw new Error("Workspace provisioned but the project record could not be persisted");
    }

    return result.workspaceId;
  } catch (err) {
    const message = sanitizeProvisioningError(err);
    try {
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "failed",
        workspaceError: message,
        workspaceProvisioningToken: null,
        expectedProvisioningToken: provisioningToken,
      });
    } catch {
      // The write failure is already logged inside updateProjectWorkspace —
      // don't let it mask the provisioning error being rethrown below.
    }
    throw new Error(message);
  } finally {
    stopHeartbeat();
  }
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
