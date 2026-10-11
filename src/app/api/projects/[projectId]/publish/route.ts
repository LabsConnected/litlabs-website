import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";

export const dynamic = "force-dynamic";

/**
 * Publish status + publish/unpublish actions for a user's static project.
 *
 * Security model:
 * - Clerk auth required; project ownership enforced via getProject()
 *   (returns null for non-owners → 404, indistinguishable from missing).
 * - Publish delegates to deployUserProject(), which re-verifies ownership
 *   through the workspace transport — defense in depth.
 * - Unpublish is a pure DB state change (status → "unpublished"); the
 *   serving route only answers `ready` deployments, so public access
 *   stops immediately.
 * - Zero subprocesses: pure HTTP + DB. Gate 1 guards untouched.
 *
 * POST /api/projects/[projectId]/publish   → publish (or republish)
 * DELETE /api/projects/[projectId]/publish → unpublish
 * GET /api/projects/[projectId]/publish    → current publish status
 */

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

async function requireOwner(
  req: NextRequest,
  projectId: string,
): Promise<{ userId: string } | NextResponse> {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const project = await getProject(projectId, userId);
  if (!project) {
    // 404 for both missing and not-owned — no ownership oracle.
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return { userId };
}

/**
 * GET — current publish status for this project.
 * Returns the latest deployment record (if any) with its public URL
 * when the deployment is live (`ready` + verified).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const owner = await requireOwner(req, projectId);
  if (owner instanceof NextResponse) return owner;

  const { listLatestDeploymentsForUser } = await import(
    "@/lib/deployments/deployment-store"
  );
  try {
    const all = await listLatestDeploymentsForUser(owner.userId);
    const latest = all.find((d) => d.projectId === projectId) ?? null;
    const deployment = latest
      ? {
          id: latest.id,
          status: latest.status,
          publicUrl:
            latest.status === "ready" && latest.urlVerified
              ? latest.publicUrl
              : null,
          urlVerified: latest.urlVerified,
          fileCount: latest.fileCount,
        }
      : null;
    return NextResponse.json({
      published: deployment?.status === "ready" && !!deployment.publicUrl,
      deployment,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to load publish status." },
      { status: 500 },
    );
  }
}

/**
 * POST — publish (or republish) this project.
 * Builds a server-side workspace transport for the authenticated owner,
 * then runs the deploy pipeline. The hosting backend resolves the live
 * URL from real infrastructure — never from caller input.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const owner = await requireOwner(req, projectId);
  if (owner instanceof NextResponse) return owner;

  const { createWorkspaceTransport } = await import(
    "@/lib/litt-intelligence/workspace-transport"
  );
  const { deployUserProject } = await import("@/lib/deployments/deploy-service");
  const { supabaseDeploymentStore } = await import(
    "@/lib/deployments/deployment-store"
  );

  let transport;
  try {
    transport = await createWorkspaceTransport(projectId, owner.userId);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Workspace unavailable.",
        detail: err instanceof Error ? err.message : "provisioning failed",
      },
      { status: 409 },
    );
  }

  const result = await deployUserProject(
    { userId: owner.userId, projectId, transport },
    { store: supabaseDeploymentStore },
  );

  if (!result.ok) {
    return NextResponse.json(
      {
        error: "Publish failed.",
        detail: result.message,
        errorClass: result.errorClass,
        retryable: result.retryable,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    published: true,
    deploymentId: result.deploymentId,
    publicUrl: result.publicUrl,
    reused: result.reused,
    fileCount: result.fileCount,
  });
}

/**
 * DELETE — unpublish the project's live deployment.
 * Body: { deploymentId: string }. Ownership is enforced twice: by
 * requireOwner (project) and by unpublishDeployment (deployment row).
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { projectId } = await params;
  const owner = await requireOwner(req, projectId);
  if (owner instanceof NextResponse) return owner;

  let body: { deploymentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.deploymentId) {
    return NextResponse.json({ error: "deploymentId is required." }, { status: 400 });
  }

  const { unpublishDeployment } = await import("@/lib/deployments/deploy-service");
  const { supabaseDeploymentStore } = await import(
    "@/lib/deployments/deployment-store"
  );

  const result = await unpublishDeployment(
    { userId: owner.userId, projectId, deploymentId: body.deploymentId },
    { store: supabaseDeploymentStore },
  );

  if (!result.ok) {
    const status = result.message.startsWith("Forbidden") ? 403 : 400;
    return NextResponse.json({ error: result.message }, { status });
  }

  return NextResponse.json({ unpublished: true, deploymentId: result.deploymentId });
}
