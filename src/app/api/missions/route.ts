import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { createMission, listMissions, type MissionResult } from "@/lib/missions";

export const runtime = "nodejs";

/**
 * GET /api/missions?projectId=...
 * List missions for the authenticated user.
 */
async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") ?? undefined;
  return toResponse(await listMissions(userId, projectId));
}

/**
 * POST /api/missions
 * Create a new mission.
 */
async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return typedError(400, "Invalid JSON body"); }
  return toResponse(await createMission({
    ownerId: userId,
    projectId: String(body.projectId ?? ""),
    name: String(body.name ?? ""),
    description: body.description as string | undefined,
    graph: body.graph as Record<string, unknown> | undefined,
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
