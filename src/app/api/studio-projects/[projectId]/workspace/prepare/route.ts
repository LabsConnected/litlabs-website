import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

/**
 * POST /api/studio-projects/[projectId]/workspace/prepare
 *
 * The shared provisioning service owns the database lock and all terminal
 * preparation. This route is intentionally only an authenticated adapter;
 * it must not maintain a second prepare implementation.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const workspaceId = await provisionWorkspaceForProject(projectId, userId);
    const refreshed = await getProject(projectId, userId);
    return NextResponse.json({
      workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: refreshed?.workspaceRoot ?? null,
      branch: refreshed?.workspaceBranch ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
