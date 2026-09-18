import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { findLatestDeploymentForProject } from "@/lib/deployments/deployment-store";
import {
  getHostingBackend,
  HOSTING_DISPLAY_NAME,
  HOSTING_TARGET,
} from "@/lib/deployments/litt-hosting";

/**
 * GET /api/studio-projects/[projectId]/deployments
 * Return the caller's most recent user-project deployment (any status), or
 * { deployment: null } when the project has never been deployed, plus the
 * LiTT Hosting capability block (whether publishing can run right now).
 *
 * Ownership is verified against the project row — a foreign user gets the
 * same 404 as a nonexistent project, so deployment existence cannot be
 * probed across tenants.
 *
 * This is the durable record of what the project.deploy tool did. Because
 * the approval-resume response can be severed by an edge timeout while the
 * server-side work still completes, clients that need the deployment
 * outcome should read it here rather than trusting only the resume body.
 *
 * Copy rule: the response names "LiTT Hosting" only. Infrastructure
 * provider names never appear here.
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

  const hostingCheck = getHostingBackend().isConfigured();
  return NextResponse.json({
    deployment,
    hosting: {
      name: HOSTING_DISPLAY_NAME,
      target: HOSTING_TARGET,
      configured: hostingCheck.ok,
      ...(!hostingCheck.ok ? { reason: hostingCheck.reason } : {}),
    },
  });
}
