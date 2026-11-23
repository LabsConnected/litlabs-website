import { NextRequest, NextResponse } from "next/server";

import { publishedFileResponse } from "@/lib/deployments/serve-published";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sites/[deploymentId]/[...path] — serve a deployed user project.
 *
 * This route is deliberately PUBLIC: it never calls auth(). That is what
 * makes a deployment a deployment. The preview proxy
 * (/api/studio-projects/[id]/preview/proxy) is the opposite —
 * authenticated, and pointed at a live dev process. A URL here is
 * independently reachable by anyone, which is why it can be
 * HTTP-verified before a deployment is reported live.
 *
 * Only `ready` deployments serve (enforced in readPublishedFile).
 * The serving semantics live in lib/deployments/serve-published, shared
 * with the project's stable address (/sites/project/[projectId]) —
 * this route serves ONE immutable snapshot; the stable route resolves
 * the latest ready snapshot first. Both keep working.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ deploymentId: string; path?: string[] }> },
) {
  const { deploymentId, path } = await params;

  if (!deploymentId || !/^[A-Za-z0-9_-]{1,64}$/.test(deploymentId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const requestPath = Array.isArray(path) ? path.join("/") : "";

  return publishedFileResponse({
    deploymentId,
    mountBase: `/sites/${deploymentId}`,
    requestPath,
  });
}
