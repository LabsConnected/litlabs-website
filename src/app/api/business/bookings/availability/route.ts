import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { checkAvailability, type BusinessResult } from "@/lib/business-operations";

export const runtime = "nodejs";

/**
 * GET /api/business/bookings/availability?startTime=...&endTime=...
 * Check available time slots. Fail-closed: returns no slots if the check fails.
 */
async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  const url = new URL(req.url);
  const startTime = url.searchParams.get("startTime");
  const endTime = url.searchParams.get("endTime");
  if (!startTime || !endTime) {
    return typedError(400, "startTime and endTime query params are required");
  }

  return toResponse(await checkAvailability(userId, startTime, endTime));
}

export const GET = withRateLimit(getHandler, 60, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function toResponse<T>(result: BusinessResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
