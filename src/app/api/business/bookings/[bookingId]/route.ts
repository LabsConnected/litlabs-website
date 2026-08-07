import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  getBooking,
  rescheduleBooking,
  cancelBooking,
  type BusinessResult,
} from "@/lib/business-operations";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ bookingId: string }>;
}

/**
 * GET /api/business/bookings/[bookingId]
 */
async function getHandler(req: NextRequest, routeCtx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { bookingId } = await routeCtx.params;
  return toResponse(await getBooking(userId, bookingId));
}

/**
 * PATCH /api/business/bookings/[bookingId]
 * Reschedule (body: { action: "reschedule", newStartTime, newEndTime })
 * or cancel (body: { action: "cancel" })
 */
async function patchHandler(req: NextRequest, routeCtx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  const { bookingId } = await routeCtx.params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return typedError(400, "Invalid JSON body");
  }

  const action = body.action;
  if (action === "reschedule") {
    const { newStartTime, newEndTime } = body as { newStartTime?: string; newEndTime?: string };
    if (!newStartTime || !newEndTime) return typedError(400, "newStartTime and newEndTime are required for reschedule");
    return toResponse(await rescheduleBooking(userId, bookingId, newStartTime, newEndTime));
  }
  if (action === "cancel") {
    return toResponse(await cancelBooking(userId, bookingId));
  }
  return typedError(400, "action must be 'reschedule' or 'cancel'");
}

export const GET = withRateLimit(getHandler, 60, 60);
export const PATCH = withRateLimit(patchHandler, 20, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function toResponse<T>(result: BusinessResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
