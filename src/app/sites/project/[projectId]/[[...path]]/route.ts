import { NextRequest, NextResponse } from "next/server";

import { findLatestReadyDeploymentForProjectPublic } from "@/lib/deployments/deployment-store";
import { publishedFileResponse } from "@/lib/deployments/serve-published";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sites/project/[projectId]/[...path] — the project's ONE stable
 * public address (ACC-01 F8a).
 *
 * Deliberately PUBLIC, like /sites/[deploymentId]: published sites are
 * public. The difference is resolution: instead of naming one immutable
 * snapshot, this address resolves the project's latest READY LiTT
 * Hosting deployment at request time and serves THAT snapshot — so the
 * address a user shares keeps working across republishes, always
 * showing the newest published version. Per-deployment snapshot URLs
 * keep working unchanged for anyone holding one.
 *
 * Only READY deployments may be served: the resolver returns nothing
 * when the project has never published (or its latest publish was
 * unpublished), and this route answers an honest 404 — never a stale
 * snapshot, never a guess.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; path?: string[] }> },
) {
  const { projectId, path } = await params;

  if (!projectId || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let deployment: Awaited<
    ReturnType<typeof findLatestReadyDeploymentForProjectPublic>
  >;
  try {
    deployment = await findLatestReadyDeploymentForProjectPublic(projectId);
  } catch {
    // A store error must not masquerade as "never published" — 503 with
    // Retry-After, same contract as the snapshot route's read failures.
    return new NextResponse("Service unavailable", {
      status: 503,
      headers: { "Retry-After": "1" },
    });
  }

  if (!deployment) {
    return new NextResponse("Not found", { status: 404 });
  }

  const requestPath = Array.isArray(path) ? path.join("/") : "";

  return publishedFileResponse({
    deploymentId: deployment.id,
    mountBase: `/sites/project/${projectId}`,
    requestPath,
  });
}
