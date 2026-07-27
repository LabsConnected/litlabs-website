import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { getAssetManifest, getPreviewCapture, getVisualBuild, getVisualReview, updateVisualBuild } from "@/lib/visual-builds/repository";
import { VisualBuildRequestSchema } from "@/lib/visual-builds/types";
import { runVisualBuild } from "@/lib/visual-builds/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getHandler(
  _request: NextRequest,
  ctx?: { params: Promise<{ projectId: string; buildId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, buildId } = await ctx!.params;
  const build = await getVisualBuild(buildId, projectId);
  if (!build) {
    return NextResponse.json({ error: "Visual build not found" }, { status: 404 });
  }

  const [manifest, review, capture] = await Promise.all([
    getAssetManifest(buildId),
    getVisualReview(buildId),
    getPreviewCapture(buildId),
  ]);

  return NextResponse.json({ build, manifest, review, capture });
}

async function postHandler(
  request: NextRequest,
  ctx?: { params: Promise<{ projectId: string; buildId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, buildId } = await ctx!.params;
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "approve") {
    const build = await getVisualBuild(buildId, projectId);
    if (!build) {
      return NextResponse.json({ error: "Visual build not found" }, { status: 404 });
    }
    const updated = await updateVisualBuild(buildId, {
      status: "complete",
      summary: { ...build.summary, approvalState: "approved", approvedAt: new Date().toISOString() },
    });
    return NextResponse.json({ build: updated });
  }

  if (action === "retry") {
    const build = await getVisualBuild(buildId, projectId);
    if (!build) {
      return NextResponse.json({ error: "Visual build not found" }, { status: 404 });
    }
    const parsed = VisualBuildRequestSchema.safeParse(build.request);
    if (!parsed.success) {
      return NextResponse.json({ error: "Stored build request is invalid" }, { status: 500 });
    }
    const rerun = await runVisualBuild({ projectId, userId, request: parsed.data });
    return NextResponse.json({ build: rerun.build, manifest: rerun.manifest, review: rerun.review, captures: rerun.captures });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 20, 60);
