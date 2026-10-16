import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { getWorkspaceInternal } from "@/lib/terminal-internal-client";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

/**
 * Re-kick recovery for a failed workspace at most this often. A fresh
 * failure means a provisioning attempt just finished badly — kicking
 * again on every read would hammer the terminal server. Past this age the
 * row self-heals on the next read.
 */
const FAILED_RECOVERY_BACKOFF_MS = 30_000;

/**
 * Schedule provisioning without parking the response. after() keeps the
 * work inside the request lifecycle — the platform drains it rather than
 * a detached fire-and-forget promise. provisionWorkspaceForProject is
 * idempotent (atomic provisioning lock + adoption-first prepare), so
 * concurrent kicks collapse onto one real prepare.
 */
function kickRecovery(projectId: string, userId: string): void {
  after(() =>
    provisionWorkspaceForProject(projectId, userId).catch((err) => {
      console.error(
        `[workspace] background recovery failed for ${projectId}:`,
        err instanceof Error ? err.message : err,
      );
    }),
  );
}

/**
 * GET /api/studio-projects/[projectId]/workspace
 *
 * Return workspace state and initiate recovery for every recoverable
 * state — not_prepared (never started), provisioning (possibly
 * interrupted), failed, and lost-on-terminal-server — without blocking
 * the response on the prepare. The response reports the truthful state;
 * the next read converges through provisioning → ready as the background
 * provision settles.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Whether the stored workspace state itself needs recovery work.
  // "provisioning" is included: if the lock owner died mid-prepare the
  // background run reclaims the dead lock instead of every reader
  // observing a stuck lock for the full wait window.
  const failedRetryDue =
    Number.isNaN(Date.parse(project.updatedAt)) ||
    Date.now() - Date.parse(project.updatedAt) > FAILED_RECOVERY_BACKOFF_MS;
  const statusNeedsRecovery =
    project.workspaceStatus === "provisioning" ||
    project.workspaceStatus === "not_prepared" ||
    (project.workspaceStatus === "failed" && failedRetryDue);

  if (!project.workspaceId) {
    if (statusNeedsRecovery) kickRecovery(projectId, userId);
    return NextResponse.json({
      workspaceId: null,
      workspaceStatus: project.workspaceStatus,
      workspaceError: project.workspaceError,
    });
  }

  try {
    const ws = await getWorkspaceInternal(project.workspaceId, userId);
    if (ws) {
      // The workspace is alive; still kick when the stored status is
      // stale (e.g. "failed" on a row whose workspace is in fact ready)
      // so the provisioner can reconcile the record.
      if (statusNeedsRecovery) kickRecovery(projectId, userId);
      return NextResponse.json({
        workspaceId: ws.workspaceId,
        workspaceStatus: ws.ready ? "ready" : "preparing",
        branch: ws.branch,
        commitSha: ws.commitSha,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to query workspace";
    if (message.includes("TERMINAL_INTERNAL_SERVICE_KEY")) {
      // Sanitize: never expose internal env var names to clients
      return NextResponse.json({
        workspaceId: project.workspaceId,
        workspaceStatus: "error",
        workspaceError: "Workspace unavailable — Retry.",
      }, { status: 502 });
    }
  }

  // The DB says the workspace exists but the terminal server lost it —
  // kick adoption-first re-provisioning in the background. The workspaceId
  // stays on the row as the adoption hint, so the reattached workspace
  // keeps the project's files.
  kickRecovery(projectId, userId);
  return NextResponse.json({
    workspaceId: project.workspaceId,
    workspaceStatus: "provisioning",
    workspaceError: null,
  });
}
