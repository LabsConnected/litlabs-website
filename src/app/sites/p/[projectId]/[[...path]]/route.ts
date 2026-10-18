import { NextRequest, NextResponse } from "next/server";

import { findLatestReadyForProject } from "@/lib/deployments/deployment-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /sites/p/[projectId]/[...path] — the STABLE public project URL.
 *
 * Paid-beta publishing model: republishing a project must preserve the
 * same customer-facing URL. This route resolves the project's newest
 * `ready` deployment and internally rewrites to the per-revision serving
 * route, so:
 *
 *   /sites/p/<projectId>/        → latest ready revision's index.html
 *   /sites/p/<projectId>/a.png   → same file inside that revision
 *
 * The visible URL never changes across republishes; per-revision links
 * (/sites/<deploymentId>/…) keep working independently. Unpublishing the
 * newest revision transparently falls back to the previous ready one —
 * the site then serves the last-good revision rather than a hard 404.
 *
 * Same trust posture as the per-revision route: deliberately public (a
 * deployment is a capability URL), only `ready` rows resolve, storage
 * errors surface as generic 503, everything downstream (CSP sandbox,
 * nosniff, no-store, badge injection) is inherited unchanged.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; path?: string[] }> },
) {
  const { projectId, path } = await params;

  if (!projectId || !/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let latest: Awaited<ReturnType<typeof findLatestReadyForProject>>;
  try {
    latest = await findLatestReadyForProject(projectId);
  } catch {
    return new NextResponse("Service unavailable", { status: 503 });
  }
  if (!latest) {
    return new NextResponse("Not found", { status: 404 });
  }

  const suffix = Array.isArray(path) && path.length ? `/${path.join("/")}` : "/";
  const target = new URL(
    `/sites/${latest.id}${suffix}`,
    request.nextUrl.origin,
  );
  return NextResponse.rewrite(target);
}
