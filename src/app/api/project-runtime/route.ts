import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { getProject } from "@/lib/projects/project-repository";
import type { ProjectRuntimeState, RuntimePhase, ProjectRuntimeError } from "@/lib/projects/runtime-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/project-runtime
 * GET /api/project-runtime?projectId=<id>
 *
 * Returns the canonical ProjectRuntimeState — the ONE source of truth for
 * the active project's runtime status. Every Studio panel consumes this.
 *
 * Resolution flow:
 * 1. Resolve the authenticated user.
 * 2. Resolve the active project (explicit ID or most recent).
 * 3. Confirm project membership.
 * 4. Resolve repository and branch.
 * 5. Resolve or provision the workspace.
 * 6. Compute the runtime phase.
 *
 * Terminal connection state is client-side (WebSocket) and is merged in
 * by the useProjectRuntime hook, not by this endpoint. This endpoint
 * reports workspace-level readiness. The hook combines workspace + terminal.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request).catch(() => ({ userId: null }));

  if (!userId) {
    return NextResponse.json({
      ...makeState("unauthenticated", {
        code: "UNAUTHENTICATED",
        message: "Sign in required to resolve project runtime.",
        recoveryHref: "/sign-in",
      }),
      lastCheckedAt: new Date().toISOString(),
    } satisfies ProjectRuntimeState);
  }

  const explicitProjectId = request.nextUrl.searchParams.get("projectId");
  const current = await resolveCurrentProject({ userId, explicitProjectId });

  if (!current) {
    return NextResponse.json({
      ...makeState("idle", {
        code: "NO_PROJECT",
        message: "No project selected. Create or select a project to begin.",
        recoveryHref: "/dashboard",
      }),
      lastCheckedAt: new Date().toISOString(),
    } satisfies ProjectRuntimeState);
  }

  // Fetch the full canonical project to get workspace details
  const project = await getProject(current.projectId, userId);
  if (!project) {
    return NextResponse.json({
      ...makeState("error", {
        code: "PROJECT_NOT_FOUND",
        message: "Project could not be resolved. It may have been deleted.",
        recoveryHref: "/dashboard",
      }),
      projectId: current.projectId,
      projectName: current.projectName,
      lastCheckedAt: new Date().toISOString(),
    } satisfies ProjectRuntimeState);
  }

  const repository = project.githubFullName ?? null;
  const branch = project.githubBranch ?? project.githubDefaultBranch ?? null;
  const workspaceId = project.workspaceId;
  const workspaceStatus = project.workspaceStatus;
  const workspacePath = project.workspaceRoot;

  // Determine workspace phase
  let phase: RuntimePhase;
  let error: ProjectRuntimeError | undefined;

  if (!workspaceId) {
    phase = "workspace_not_provisioned";
    error = {
      code: "WORKSPACE_NOT_PROVISIONED",
      message: `No workspace has been provisioned for "${project.name}". Connect a repository or start a blank project to provision one.`,
      recoveryAction: "provision_workspace",
      recoveryHref: "/settings",
    };
  } else if (workspaceStatus !== "ready") {
    phase = "workspace_not_ready";
    error = {
      code: "WORKSPACE_NOT_READY",
      message:
        project.workspaceError ??
        `Workspace status is "${workspaceStatus ?? "unknown"}". The workspace may still be initializing or may have failed.`,
      recoveryAction: "retry_workspace",
      recoveryHref: "/settings",
    };
  } else {
    // Workspace is ready — terminal connection is client-side
    phase = "ready";
  }

  const state: ProjectRuntimeState = {
    phase,
    executionAvailable: phase === "ready", // hook will refine with terminal state
    workspaceProvisioned: Boolean(workspaceId),
    terminalConnected: false, // client-side hook sets this
    terminalServerReachable: false, // client-side hook sets this
    projectId: project.id,
    projectName: project.name,
    repository,
    branch,
    sourceType: project.sourceType ?? (repository ? "github" : "blank"),
    workspaceId,
    workspacePath,
    workspaceStatus,
    terminalSessionId: null, // client-side hook sets this
    previewState: "idle",
    logsState: "idle",
    deploymentState: project.previewUrl ? "preview" : "none",
    // Separated: reads work when workspace is ready (via API, no terminal needed)
    readAccess: phase === "ready",
    // writeSurfaceAvailable = workspace provisioned (files writable via API)
    // The hook will also set this true if terminal connects (PTY writes)
    writeSurfaceAvailable: phase === "ready",
    writeAccess: phase === "ready", // legacy alias
    // Policy: writes always require approval. NOT derived from connection state.
    writeApprovalRequired: true,
    // Voice — client-side hook refines these
    voiceConfigured: false,
    voiceSessionConnected: false,
    lastCheckedAt: new Date().toISOString(),
    error,
  };

  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}

function makeState(phase: RuntimePhase, error?: ProjectRuntimeError): Omit<ProjectRuntimeState, "lastCheckedAt"> {
  return {
    phase,
    executionAvailable: false,
    workspaceProvisioned: false,
    terminalConnected: false,
    terminalServerReachable: false,
    projectId: null,
    projectName: null,
    repository: null,
    branch: null,
    sourceType: null,
    workspaceId: null,
    workspacePath: null,
    workspaceStatus: null,
    terminalSessionId: null,
    previewState: "idle",
    logsState: "idle",
    deploymentState: "none",
    readAccess: false,
    writeSurfaceAvailable: false,
    writeAccess: false,
    writeApprovalRequired: true,
    voiceConfigured: false,
    voiceSessionConnected: false,
    error,
  };
}
