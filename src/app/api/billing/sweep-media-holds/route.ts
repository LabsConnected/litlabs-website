import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * POST /api/billing/sweep-media-holds
 *
 * Deletes media-cap holds whose jobs failed, and unsettled holds older than
 * 24 hours that never completed. claim_media_cap_slot already ignores those
 * unsettled holds after 24 hours; this route removes the leftover rows when
 * pg_cron is not installed.
 *
 * Cron calls send x-cron-secret. A signed-in owner can run it by hand.
 */
async function handler(req: NextRequest) {
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // Cron invocation — proceed
  } else {
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

  try {
    const { data, error } = await supabaseAdmin.rpc("sweep_expired_media_cap_holds", {
      p_now: new Date().toISOString(),
      p_max_age: "24 hours",
    });

    if (error) {
      return NextResponse.json(
        { error: "Sweep failed", details: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      removed: typeof data === "number" ? data : 0,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 5, 60);
