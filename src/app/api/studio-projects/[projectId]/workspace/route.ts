import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { getWorkspaceInternal } from "@/lib/terminal-internal-client";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

/** Return workspace state, auto-recovering a lost terminal workspace. */
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

  if (!project.workspaceId) {
    if (project.workspaceStatus === "provisioning") {
      try {
        const workspaceId = await provisionWorkspaceForProject(projectId, userId);
        const refreshed = await getProject(projectId, userId);
        return NextResponse.json({
          workspaceId,
          workspaceStatus: "ready",
          branch: refreshed?.workspaceBranch ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Workspace provisioning failed";
        const refreshed = await getProject(projectId, userId);
        return NextResponse.json({
          workspaceId: refreshed?.workspaceId ?? null,
          workspaceStatus: refreshed?.workspaceStatus ?? "failed",
          workspaceError: refreshed?.workspaceError ?? message,
        }, { status: 503 });
      }
    }
    return NextResponse.json({
      workspaceId: null,
      workspaceStatus: project.workspaceStatus,
      workspaceError: project.workspaceError,
    });
  }

  try {
    const ws = await getWorkspaceInternal(project.workspaceId, userId);
    if (ws) {
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

  try {
    const workspaceId = await provisionWorkspaceForProject(projectId, userId);
    const refreshed = await getProject(projectId, userId);
    return NextResponse.json({
      workspaceId,
      workspaceStatus: "ready",
      branch: refreshed?.workspaceBranch ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace recovery failed";
    const refreshed = await getProject(projectId, userId);
    return NextResponse.json({
      workspaceId: refreshed?.workspaceId ?? null,
      workspaceStatus: refreshed?.workspaceStatus ?? "failed",
      workspaceError: refreshed?.workspaceError ?? message,
    }, { status: 503 });
  }
}
