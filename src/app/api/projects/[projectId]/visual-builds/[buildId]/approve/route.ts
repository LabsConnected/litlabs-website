import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { getVisualBuild, updateVisualBuild } from "@/lib/visual-builds/repository";

async function postHandler(
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

  const updated = await updateVisualBuild(buildId, {
    status: "complete",
    summary: { ...build.summary, approvalState: "approved", approvedAt: new Date().toISOString() },
  });

  return NextResponse.json({ build: updated });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = withRateLimit(postHandler, 20, 60);
