import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, updateProjectRuntime } from "@/lib/projects/project-repository";
import { ensureWorkspaceAlive } from "@/lib/studio/workspace-recovery";
import {
  startPreviewInternal,
  getPreviewStatusInternal,
  stopPreviewInternal,
  buildPreviewProxyUrl,
} from "@/lib/terminal-internal-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/studio-projects/[projectId]/preview
 * Return the current preview status. Does NOT trust DB alone —
 * asks the Railway terminal server for live runtime status.
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

  if (!project.workspaceId) {
    return NextResponse.json({
      runtimeStatus: "stopped",
      previewUrl: null,
      runtimeError: null,
      framework: project.framework,
      developmentCommand: project.developmentCommand,
      packageManager: project.packageManager,
      logs: [],
    });
  }

  try {
    const runtimeStatus = await getPreviewStatusInternal(project.workspaceId, userId);

    if (!runtimeStatus) {
      return NextResponse.json({
        runtimeStatus: "stopped",
        previewUrl: null,
        runtimeError: null,
        framework: project.framework,
        developmentCommand: project.developmentCommand,
        packageManager: project.packageManager,
        logs: [],
      });
    }

    const dbSaidReady = project.runtimeStatus === "ready";
    const actuallyReady = runtimeStatus.status === "ready";
    if (dbSaidReady && !actuallyReady) {
      await updateProjectRuntime(projectId, userId, {
        runtimeStatus: runtimeStatus.status,
        previewUrl: null,
        runtimeError: runtimeStatus.error,
      });
    }

    const previewUrl = actuallyReady
      ? buildPreviewProxyUrl(project.workspaceId)
      : null;

    return NextResponse.json({
      runtimeStatus: runtimeStatus.status,
      previewUrl,
      runtimeError: runtimeStatus.error,
      framework: runtimeStatus.framework ?? project.framework,
      developmentCommand: runtimeStatus.command ?? project.developmentCommand,
      packageManager: project.packageManager,
      logs: runtimeStatus.logs,
    });
  } catch (err) {
    return NextResponse.json({
      runtimeStatus: "stopped",
      previewUrl: null,
      runtimeError: err instanceof Error ? err.message : "Preview runtime unavailable",
      framework: project.framework,
      developmentCommand: project.developmentCommand,
      packageManager: project.packageManager,
      logs: [],
    });
  }
}

/**
 * POST /api/studio-projects/[projectId]/preview
 * Start (or restart) the preview dev server on the Railway terminal server.
 * Does NOT mark "ready" until the dev server passes an HTTP health probe.
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

  let workspaceId = project.workspaceId;
  try {
    const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
    workspaceId = recovered.workspaceId;
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Workspace recovery failed",
    }, { status: 500 });
  }

  await updateProjectRuntime(projectId, userId, {
    runtimeStatus: "starting",
    previewUrl: null,
    runtimeError: null,
  });

  try {
    const result = await startPreviewInternal(workspaceId, userId, {
      framework: project.framework ?? undefined,
      command: project.developmentCommand ?? undefined,
      packageManager: project.packageManager ?? undefined,
    });

    const previewUrl = result.status === "ready"
      ? buildPreviewProxyUrl(workspaceId)
      : null;

    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: result.status,
      previewUrl,
      runtimeError: null,
    });

    return NextResponse.json({
      runtimeStatus: result.status,
      previewUrl,
      framework: result.framework,
      developmentCommand: result.command,
      port: result.port,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Preview start failed";
    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: message,
    });

    return NextResponse.json({
      error: message,
      runtimeStatus: "failed",
    }, { status: 500 });
  }
}

/**
 * DELETE /api/studio-projects/[projectId]/preview
 * Stop the preview dev server.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  if (!project.workspaceId) {
    return NextResponse.json({ runtimeStatus: "stopped" });
  }

  try {
    await stopPreviewInternal(project.workspaceId, userId);
  } catch {
    // Best effort
  }

  await updateProjectRuntime(projectId, userId, {
    runtimeStatus: "stopped",
    previewUrl: null,
    runtimeError: null,
  });

  return NextResponse.json({ runtimeStatus: "stopped" });
}
