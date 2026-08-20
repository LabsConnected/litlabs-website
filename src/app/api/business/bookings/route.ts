import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  findBookings,
  createBooking,
  checkAvailability,
  type BusinessResult,
  type BookingStatus,
} from "@/lib/business-operations";

export const runtime = "nodejs";

/**
 * GET /api/business/bookings?status=confirmed&fromDate=...&toDate=...
 * Find bookings by filters.
 */
async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as BookingStatus | null;
  const serviceId = url.searchParams.get("serviceId");
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");

  return toResponse(
    await findBookings(userId, {
      status: status ?? undefined,
      serviceId: serviceId ?? undefined,
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
    }),
  );
}

/**
 * POST /api/business/bookings
 * Create a booking atomically (checks availability + creates in one transaction).
 * Supports idempotency via the idempotency_key field.
 */
async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return typedError(400, "Invalid JSON body");
  }

  return toResponse(await createBooking(userId, body as Parameters<typeof createBooking>[1]));
}

export const GET = withRateLimit(getHandler, 60, 60);
export const POST = withRateLimit(postHandler, 20, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

function toResponse<T>(result: BusinessResult<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ ok: true, data: result.data });
  }
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
