import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import {
  findLatestDeploymentForProject,
  findLatestDeploymentForProjectTarget,
  listDeploymentHistoryForProject,
} from "@/lib/deployments/deployment-store";
import {
  getHostingBackend,
  HOSTING_DISPLAY_NAME,
  HOSTING_TARGET,
  stablePublicUrlFor,
} from "@/lib/deployments/litt-hosting";
import { NETLIFY_TARGET } from "@/lib/deployments/deploy-targets";
import { getNetlifyConnection } from "@/lib/netlify-connection";

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
 * Copy rule: the LiTT Hosting fields name "LiTT Hosting" only — its
 * infrastructure providers never appear. The Netlify fields are the one
 * deliberate exception: Netlify is a user-selected publish target (the
 * user's own account), so it is named exactly as the user chose it.
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

  // Per-target latest records: a project can be live on LiTT Hosting and
  // on Netlify independently, and the Deploy surface shows each target's
  // own state. Plus the Netlify connection state (never the token) so the
  // surface can offer a connect-first state instead of a doomed deploy.
  const [littDeployment, netlifyDeployment, netlifyConnection, history] =
    await Promise.all([
      findLatestDeploymentForProjectTarget(projectId, userId, HOSTING_TARGET),
      findLatestDeploymentForProjectTarget(projectId, userId, NETLIFY_TARGET),
      getNetlifyConnection(userId).catch(() => null),
      listDeploymentHistoryForProject(projectId, userId).catch(() => []),
    ]);

  const hostingCheck = getHostingBackend().isConfigured();
  // ACC-01 F8a: the project's ONE stable public address, present only
  // when the LiTT Hosting deployment is actually live (ready +
  // URL-verified) — the Deploy surface presents this as the project's
  // public address; per-deployment publicUrls stay on their records as
  // immutable snapshot links (history). Best-effort: an unresolvable
  // hosting base yields null, never a guessed origin.
  const stablePublicUrl =
    littDeployment && littDeployment.status === "ready" && littDeployment.urlVerified
      ? await stablePublicUrlFor(projectId).catch(() => null)
      : null;
  return NextResponse.json({
    deployment,
    stablePublicUrl,
    latestByTarget: {
      [HOSTING_TARGET]: littDeployment,
      [NETLIFY_TARGET]: netlifyDeployment,
    },
    // Recent deployment history across targets (Kimi wiring item 5) —
    // reporting only; no rollback action is offered anywhere because
    // no rollback path exists.
    history,
    netlifyConnection: {
      connected: !!netlifyConnection,
      accountName: netlifyConnection?.accountName ?? null,
    },
    // Canonical project state, so the Studio inspector can show preview
    // truth from the SAME derivation /projects uses (describeProjectState)
    // next to the deployment record. Without it the inspector could only
    // say "Not deployed yet / No preview yet" about a project whose
    // preview is ready — deployment and preview are different facts and
    // the response now carries both.
    project: {
      workspaceStatus: project.workspaceStatus,
      runtimeStatus: project.runtimeStatus,
      workspaceError: project.workspaceError,
      runtimeError: project.runtimeError,
      previewUrl: project.previewUrl,
      updatedAt: project.updatedAt,
    },
    hosting: {
      name: HOSTING_DISPLAY_NAME,
      target: HOSTING_TARGET,
      configured: hostingCheck.ok,
      ...(!hostingCheck.ok ? { reason: hostingCheck.reason } : {}),
    },
  });
}
