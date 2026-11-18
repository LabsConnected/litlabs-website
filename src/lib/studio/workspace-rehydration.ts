import "server-only";

import { createTerminalToken } from "@/lib/terminal-auth";
import { requireTerminalBaseUrl } from "@/lib/terminal-config";
import {
  findLatestDeploymentForProject,
  findLatestReadyDeploymentForProject,
  readDeploymentSnapshotFiles,
} from "@/lib/deployments/deployment-store";
import { isBinaryContentType } from "@/lib/deployments/user-deployment";

/**
 * Workspace rehydration: restore a lost workspace's contents from the
 * project's latest READY deployment snapshot.
 *
 * Why this exists (2026-11-14, Grand Haven): the terminal server lost a
 * hosted project's workspace contents; the files route's recovery
 * re-prepared the workspace onto the empty root, which silently seeded
 * the blank welcome scaffold — the deployed site survived only in the
 * Supabase deployment snapshot. When recovery re-creates a workspace
 * for a project that HAS deployments, the deployed content must win:
 * this module copies the snapshot back into the workspace so the
 * scaffold never masquerades as the project.
 *
 * The outcome is a three-way verdict, because "could not restore" must
 * be distinguishable from "nothing to restore":
 * - "restored": every snapshot file was written into the workspace.
 * - "no-deployments": the project has never deployed — the scaffold is
 *   the CORRECT content (brand-new project); callers keep today's
 *   starter behavior and attach no flags.
 * - "content-loss": the project HAS deployments but no complete ready
 *   snapshot could be written back (none ready, snapshot unreadable or
 *   incomplete, or a workspace write failed). `survivingDeploymentId`
 *   names the newest deployment record — the restore source a follow-up
 *   repair should target — so surfaces can flag the loss instead of
 *   calling the scaffold workspace "ready".
 *
 * This function NEVER throws: a failed restore must not fail the
 * recovery that surrounds it.
 */

export type WorkspaceRestoreOutcome =
  | { kind: "restored"; deploymentId: string; fileCount: number }
  | { kind: "no-deployments" }
  | { kind: "content-loss"; survivingDeploymentId: string | null; reason: string };

/**
 * Snapshot paths were validated at deploy time, but the snapshot is a
 * trust boundary of its own (written by older code, other targets):
 * never let a stored path escape the workspace or overwrite the
 * terminal's system directory.
 */
function isRestorablePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  return segments.every(
    (seg) => seg !== "" && seg !== "." && seg !== ".." && seg !== ".litt" && !seg.includes("\0"),
  );
}

async function writeWorkspaceFile(
  terminalBase: string,
  token: string,
  workspaceId: string,
  file: { path: string; content: string; encoding: string },
): Promise<void> {
  const resp = await fetch(`${terminalBase}/ws-files/write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({ path: file.path, content: file.content, encoding: file.encoding }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`Workspace write failed for ${file.path} (HTTP ${resp.status})`);
  }
}

export async function restoreWorkspaceFromLatestDeployment(args: {
  projectId: string;
  userId: string;
  workspaceId: string;
}): Promise<WorkspaceRestoreOutcome> {
  const { projectId, userId, workspaceId } = args;
  try {
    const latestAny = await findLatestDeploymentForProject(projectId, userId);
    if (!latestAny) return { kind: "no-deployments" };

    const latestReady = await findLatestReadyDeploymentForProject(projectId, userId);
    if (!latestReady) {
      return {
        kind: "content-loss",
        survivingDeploymentId: latestAny.id,
        reason: "Project has deployments but none is in the ready state",
      };
    }

    const files = await readDeploymentSnapshotFiles(latestReady.id);
    if (!files || files.length === 0) {
      return {
        kind: "content-loss",
        survivingDeploymentId: latestReady.id,
        reason: "Latest ready deployment snapshot is missing or empty",
      };
    }
    // Integrity: the record's fileCount was written with the snapshot.
    // A short read means a partial restore would silently ship a broken
    // site — refuse and report content loss instead.
    if (latestReady.fileCount > 0 && files.length !== latestReady.fileCount) {
      return {
        kind: "content-loss",
        survivingDeploymentId: latestReady.id,
        reason: `Deployment snapshot is incomplete (${files.length} of ${latestReady.fileCount} files readable)`,
      };
    }

    const restorable = files.filter((file) => isRestorablePath(file.path));
    if (restorable.length === 0) {
      return {
        kind: "content-loss",
        survivingDeploymentId: latestReady.id,
        reason: "Deployment snapshot contains no restorable file paths",
      };
    }

    const terminalBase = requireTerminalBaseUrl();
    const { token } = createTerminalToken(userId, { workspaceId, projectId });
    for (const file of restorable) {
      // The stored encoding column is authoritative; rows written
      // before it existed fall back to the content-type predicate —
      // the same rule the public /sites serving route applies.
      const encoding =
        file.encoding != null
          ? file.encoding
          : isBinaryContentType(file.contentType)
            ? "base64"
            : "utf-8";
      await writeWorkspaceFile(terminalBase, token, workspaceId, {
        path: file.path,
        content: file.content,
        encoding,
      });
    }

    return { kind: "restored", deploymentId: latestReady.id, fileCount: restorable.length };
  } catch (err) {
    // Last-resort verdict: a restore that blew up midway (store error,
    // terminal unreachable, a write rejected) leaves the workspace
    // unrestored. Name the newest deployment as the surviving copy when
    // one can be identified; the lookup itself may be the failure, so
    // this fallback is best-effort and swallows its own errors.
    let survivingDeploymentId: string | null = null;
    try {
      survivingDeploymentId =
        (await findLatestDeploymentForProject(projectId, userId))?.id ?? null;
    } catch {
      survivingDeploymentId = null;
    }
    return {
      kind: "content-loss",
      survivingDeploymentId,
      reason: err instanceof Error ? err.message : "Workspace restore failed",
    };
  }
}
