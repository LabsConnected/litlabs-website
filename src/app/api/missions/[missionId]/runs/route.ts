import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { listRuns, createRun, getMission, type MissionResult } from "@/lib/missions";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ missionId: string }>; }

/**
 * GET /api/missions/[missionId]/runs
 * List runs for a mission.
 */
async function getHandler(req: NextRequest, ctx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { missionId } = await ctx.params;
  return toResponse(await listRuns(userId, missionId));
}

/**
 * POST /api/missions/[missionId]/runs
 * Start a new run for a mission.
 */
async function postHandler(req: NextRequest, ctx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { missionId } = await ctx.params;
  // Verify the mission exists and belongs to the user
  const missionResult = await getMission(userId, missionId);
  if (!missionResult.ok) return toResponse(missionResult);
  return toResponse(await createRun({
    ownerId: userId,
    missionId,
    projectId: missionResult.data!.project_id,
  }));
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
