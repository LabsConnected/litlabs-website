import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

/**
 * POST /api/account/purge-expired
 *
 * Triggers GDPR retention cleanup: deletes audit_events older than 90 days
 * and rate_limit_store entries older than 1 hour. Intended to be called by
 * an external scheduler (e.g. Vercel Cron, GitHub Actions) if pg_cron is
 * not available on the Supabase instance.
 *
 * Requires authentication — only the service role or an admin should call this.
 * The route checks for a valid Clerk session; in practice it should be called
 * with a service-role API key from a cron job, not from the browser.
 */
async function handler(req: NextRequest) {
  // Allow cron invocation via CRON_SECRET header, or authenticated admin
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (cronSecret && expectedSecret && cronSecret === expectedSecret) {
    // Cron invocation — proceed
  } else {
    // Fall back to auth check (manual admin trigger)
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Only allow owner to trigger manually (check is_owner flag)
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
    const { data, error } = await supabaseAdmin.rpc("purge_expired_data");

    if (error) {
      return NextResponse.json(
        { error: "Cleanup failed", details: error.message },
        { status: 500 },
      );
    }

    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      success: true,
      auditEventsDeleted: result?.audit_events_deleted ?? 0,
      rateLimitDeleted: result?.rate_limit_deleted ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Cleanup failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 5, 60);
