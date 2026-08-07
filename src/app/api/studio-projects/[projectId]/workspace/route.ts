import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, updateProjectWorkspace } from "@/lib/projects/project-repository";
import { getWorkspaceInternal } from "@/lib/terminal-internal-client";

/**
 * GET /api/studio-projects/[projectId]/workspace
 *
 * Returns the current workspace state for a project.
 * Verifies ownership. Does NOT expose the raw filesystem path to the browser
 * — only returns workspaceId and status.
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
      // Terminal no longer has this workspace. Reset the project so the
      // client can re-prepare instead of being stuck on a stale "ready" state.
      await updateProjectWorkspace(projectId, userId, {
        workspaceId: null,
        workspaceStatus: "not_prepared",
        workspaceRoot: null,
        workspaceError: "Workspace not found on terminal server — re-prepare to continue",
      });
      return NextResponse.json({
        workspaceId: null,
        workspaceStatus: "not_prepared",
        workspaceError: "Workspace not found on terminal server — re-prepare to continue",
      });
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
    return NextResponse.json(
      {
        workspaceId: project.workspaceId,
        workspaceStatus: "error",
        workspaceError: message,
      },
      { status: 502 },
    );
  }
}
