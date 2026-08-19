import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getMission, updateMissionStatus, type MissionResult, type Mission } from "@/lib/missions";

export const runtime = "nodejs";

interface RouteParams { params: Promise<{ missionId: string }>; }

/**
 * GET /api/missions/[missionId]
 */
async function getHandler(req: NextRequest, ctx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { missionId } = await ctx.params;
  return toResponse(await getMission(userId, missionId));
}

/**
 * PATCH /api/missions/[missionId]
 * Update mission status (e.g. draft -> ready, ready -> running).
 */
async function patchHandler(req: NextRequest, ctx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { missionId } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return typedError(400, "Invalid JSON body"); }
  const status = body.status as Mission["status"] | undefined;
  if (!status) return typedError(400, "status is required");
  return toResponse(await updateMissionStatus(userId, missionId, status));
}

export const GET = withRateLimit(getHandler, 60, 60);
export const PATCH = withRateLimit(patchHandler, 20, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}
function toResponse<T>(result: MissionResult<T>): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true, data: result.data });
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
