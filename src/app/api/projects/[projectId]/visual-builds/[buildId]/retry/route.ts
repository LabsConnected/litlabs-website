import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { withRateLimit } from "@/lib/rate-limiter";
import { getVisualBuild } from "@/lib/visual-builds/repository";
import { VisualBuildRequestSchema } from "@/lib/visual-builds/types";
import { runVisualBuild } from "@/lib/visual-builds/orchestrator";

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

  const parsed = VisualBuildRequestSchema.safeParse(build.request);
  if (!parsed.success) {
    return NextResponse.json({ error: "Stored build request is invalid" }, { status: 500 });
  }

  const rerun = await runVisualBuild({ projectId, userId, request: parsed.data });
  return NextResponse.json({ build: rerun.build, manifest: rerun.manifest, review: rerun.review, captures: rerun.captures });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = withRateLimit(postHandler, 20, 60);
