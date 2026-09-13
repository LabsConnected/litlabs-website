import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { findLatestDeploymentForProject } from "@/lib/deployments/deployment-store";

/**
 * GET /api/studio-projects/[projectId]/deployments
 * Return the caller's most recent user-project deployment (any status), or
 * { deployment: null } when the project has never been deployed.
 *
 * Ownership is verified against the project row — a foreign user gets the
 * same 404 as a nonexistent project, so deployment existence cannot be
 * probed across tenants.
 *
 * This is the durable record of what the project.deploy tool did. Because
 * the approval-resume response can be severed by an edge timeout while the
 * server-side work still completes, clients that need the deployment
 * outcome should read it here rather than trusting only the resume body.
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

  const deployment = await findLatestDeploymentForProject(projectId, userId);
  return NextResponse.json({ deployment });
}
