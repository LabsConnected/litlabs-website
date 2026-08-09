import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, updateProjectRuntime } from "@/lib/projects/project-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/studio-projects/[projectId]/preview
 * Return the current preview status and proxy URL for the project.
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

  return NextResponse.json({
    runtimeStatus: project.runtimeStatus,
    previewUrl: project.previewUrl,
    runtimeError: project.runtimeError,
    framework: project.framework,
    developmentCommand: project.developmentCommand,
    packageManager: project.packageManager,
  });
}

/**
 * POST /api/studio-projects/[projectId]/preview
 * Mark the project preview as ready and return the LiTT-owned proxy URL.
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
  if (!project.workspaceId || !project.workspaceRoot) {
    return NextResponse.json({ error: "Workspace not provisioned" }, { status: 409 });
  }

  const proxyUrl = `/api/studio-projects/${projectId}/preview/proxy`;
  const updated = await updateProjectRuntime(projectId, userId, {
    runtimeStatus: "ready",
    previewUrl: proxyUrl,
    runtimeError: null,
  });

  return NextResponse.json({
    runtimeStatus: updated?.runtimeStatus ?? "ready",
    previewUrl: proxyUrl,
  });
}
