import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, updateProjectRuntime } from "@/lib/projects/project-repository";
import { ensureWorkspaceAlive, provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";
import { SecretBroker } from "@/lib/terminal-v1/secret-broker";
import { extractClerkEnvFromSecrets } from "@/lib/preview-clerk-env";
import {
  startPreviewInternal,
  getPreviewStatusInternal,
  stopPreviewInternal,
  buildPreviewProxyUrl,
} from "@/lib/terminal-internal-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    // No workspace was ever provisioned for this project. This is the
    // "not_started" state — distinct from "stopped" (workspace exists but
    // dev server isn't running) and "unreachable" (runtime check failed).
    return NextResponse.json({
      runtimeStatus: "not_started",
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
      // Workspace exists in DB but the terminal server returned no status.
      // This is "stopped" — the dev server isn't running, not an error.
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
      runtimeErrorCode: runtimeStatus.errorCode,
      framework: runtimeStatus.framework ?? project.framework,
      developmentCommand: runtimeStatus.command ?? project.developmentCommand,
      packageManager: project.packageManager,
      logs: runtimeStatus.logs,
    });
  } catch (err) {
    // The runtime status check itself threw — the terminal server is
    // unreachable or returned an unexpected error. This is "unreachable",
    // NOT "stopped" (which means the dev server simply isn't running).
    return NextResponse.json({
      runtimeStatus: "unreachable",
      previewUrl: null,
      runtimeError: err instanceof Error ? err.message : "Preview runtime unreachable",
      runtimeErrorCode: null,
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

  // Auto-provision the workspace if it was never prepared. This is the fix
  // for the "Prepare preview" → 409 "Workspace not provisioned" loop: the
  // preview start endpoint now provisions the workspace itself so the user
  // never has to know what a "workspace" or "repository binding" is.
  let workspaceId = project.workspaceId;
  try {
    if (!workspaceId || !project.workspaceRoot) {
      workspaceId = await provisionWorkspaceForProject(projectId, userId);
    } else {
      const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
      workspaceId = recovered.workspaceId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: message,
    });
    return NextResponse.json({
      error: message,
      runtimeStatus: "failed",
      runtimeError: message,
    }, { status: 500 });
  }

  await updateProjectRuntime(projectId, userId, {
    runtimeStatus: "starting",
    previewUrl: null,
    runtimeError: null,
  });

  try {
    // Resolve the project's configured Clerk keys from its secret store
    // so the preview runtime gets the PROJECT's keys — not the terminal
    // server's container env (which is deliberately isolated since #444).
    // Fail-soft: if the store is unreachable, the preview's own Clerk
    // validation surfaces a structured configuration error.
    let projectEnv: Record<string, string> = {};
    try {
      const broker = new SecretBroker();
      const secrets = await broker.resolveForSandbox(userId, projectId);
      projectEnv = extractClerkEnvFromSecrets(secrets);
    } catch {
      projectEnv = {};
    }

    const result = await startPreviewInternal(workspaceId, userId, {
      framework: project.framework ?? undefined,
      command: project.developmentCommand ?? undefined,
      packageManager: project.packageManager ?? undefined,
      projectEnv,
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
    const errorCode = (err as { code?: string }).code ?? null;
    await updateProjectRuntime(projectId, userId, {
      runtimeStatus: "failed",
      previewUrl: null,
      runtimeError: message,
    });

    return NextResponse.json({
      error: message,
      runtimeStatus: "failed",
      runtimeError: message,
      runtimeErrorCode: errorCode,
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
