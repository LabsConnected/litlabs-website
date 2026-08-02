import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { listVisualBuilds } from "@/lib/visual-builds/repository";
import { VisualBuildRequestSchema } from "@/lib/visual-builds/types";
import { runVisualBuild } from "@/lib/visual-builds/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function getHandler(
  _request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(_request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await ctx!.params;
  const builds = await listVisualBuilds(projectId);
  return NextResponse.json({ builds });
}

async function postHandler(
  request: NextRequest,
  ctx: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId } = await ctx!.params;
  const body = await request.json().catch(() => null);
  const parsed = VisualBuildRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid visual build request", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await runVisualBuild({ projectId, userId, request: parsed.data });
    return NextResponse.json({
      build: result.build,
      missionId: result.missionId,
      runId: result.runId,
      plan: result.plan,
      manifest: result.manifest,
      review: result.review,
      captures: result.captures,
      complete: result.complete,
      repairApplied: result.repairApplied,
      changedFiles: result.changedFiles,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Visual build failed" }, { status: 500 });
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 20, 60);
