import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject, updateProjectWorkspace } from "@/lib/projects/project-repository";
import { prepareWorkspaceInternal } from "@/lib/terminal-internal-client";

/**
 * POST /api/studio-projects/[projectId]/workspace/prepare
 *
 * Provisions an isolated workspace on the Railway terminal service.
 * The browser calls this endpoint; Next.js calls terminal-server internally.
 *
 * The workspace is bound to the authenticated user and the canonical project.
 * Returns the workspace descriptor (workspaceId, status, root).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await params;

  // Verify the user owns this project
  const project = await getProject(projectId, userId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (project.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If workspace is already ready, return it
  if (project.workspaceId && project.workspaceStatus === "ready") {
    return NextResponse.json({
      workspaceId: project.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: project.workspaceRoot,
    });
  }

  // Mark as provisioning
  await updateProjectWorkspace(projectId, userId, {
    workspaceStatus: "provisioning",
    workspaceError: null,
  });

  try {
    let result;
    if (project.sourceType === "blank") {
      result = await prepareWorkspaceInternal({
        sourceType: "blank",
        userId,
        projectId,
        templateId: project.templateId ?? "blank-static",
      });
    } else if (project.sourceType === "github" && project.githubInstallationId && project.githubOwner && project.githubRepo) {
      result = await prepareWorkspaceInternal({
        sourceType: "github",
        userId,
        projectId,
        installationId: project.githubInstallationId,
        owner: project.githubOwner,
        repo: project.githubRepo,
        branch: project.githubBranch ?? "main",
        commitSha: project.latestCommitSha,
      });
    } else {
      // Mark as failed
      await updateProjectWorkspace(projectId, userId, {
        workspaceStatus: "failed",
        workspaceError: "Project has no valid source for workspace provisioning",
      });
      return NextResponse.json(
        { error: "Project has no valid source for workspace provisioning" },
        { status: 400 },
      );
    }

    // Persist the workspace ID and root to the canonical project
    await updateProjectWorkspace(projectId, userId, {
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      workspacePreparedAt: new Date().toISOString(),
      workspaceError: null,
    });

    return NextResponse.json({
      workspaceId: result.workspaceId,
      workspaceStatus: "ready",
      workspaceRoot: result.root,
      branch: result.branch,
      commitSha: result.commitSha,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace provisioning failed";
    await updateProjectWorkspace(projectId, userId, {
      workspaceStatus: "failed",
      workspaceError: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
