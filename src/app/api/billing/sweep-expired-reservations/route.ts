import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { reservationSweepEnabled, runReservationSweep } from "@/lib/billing/reservation-sweep";

/**
 * GET|POST /api/billing/sweep-expired-reservations
 *
 * Code-only. Not registered in vercel.json. pg_cron is not scheduled.
 * The handler does not call the database unless
 * BILLING_RESERVATION_SWEEP_ENABLED=1.
 *
 * Auth matches /api/billing/sweep-media-holds: Bearer CRON_SECRET,
 * x-cron-secret, or the signed-in support owner. Enabling the flag is a
 * later, explicit step. This draft does not enable it.
 */
function cronAuthorized(req: NextRequest): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret && headerSecret === expectedSecret) return true;
  const authorization = req.headers.get("authorization") ?? "";
  return authorization === `Bearer ${expectedSecret}`;
}

async function handler(req: NextRequest) {
  if (!cronAuthorized(req)) {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("clerk_id", clerkId)
      .single();
    if (!user || user.email !== "support@litlabs.net") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (!reservationSweepEnabled()) {
    return NextResponse.json(
      { enabled: false, ran: false, reason: "BILLING_RESERVATION_SWEEP_ENABLED is not 1" },
      { status: 503 },
    );
  }

  try {
    const result = await runReservationSweep(supabaseAdmin);
    return NextResponse.json({ ...result, ran: true, timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

export const GET = withRateLimit(handler, 5, 60);
export const POST = withRateLimit(handler, 5, 60);
