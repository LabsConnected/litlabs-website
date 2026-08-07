import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getRun, resumeRun, listSteps, type MissionResult } from "@/lib/missions";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RouteParams { params: Promise<{ runId: string }>; }

/**
 * GET /api/missions/runs/[runId]
 * Get a run and its steps.
 */
async function getHandler(req: NextRequest, ctx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { runId } = await ctx.params;
  const [runResult, stepsResult] = await Promise.all([
    getRun(userId, runId),
    listSteps(userId, runId),
  ]);
  if (!runResult.ok) return toResponse(runResult);
  return NextResponse.json({
    ok: true,
    data: {
      run: runResult.data,
      steps: stepsResult.ok ? stepsResult.data : [],
    },
  });
}

/**
 * POST /api/missions/runs/[runId]
 * Resume a paused or failed run.
 */
async function postHandler(req: NextRequest, ctx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { runId } = await ctx.params;
  return toResponse(await resumeRun(userId, runId));
}

export const GET = withRateLimit(getHandler, 60, 60);
export const POST = withRateLimit(postHandler, 20, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}
function toResponse<T>(result: MissionResult<T>): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true, data: result.data });
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
