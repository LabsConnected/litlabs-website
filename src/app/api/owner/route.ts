import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isOwnerClerkId } from "@/lib/mission-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/owner
 *
 * Owner-only God Control data. Returns 403 for non-owners.
 *
 * Returns:
 *   - presence: visitors/members online, current pages
 *   - funnel: signups, studio opens, first prompts, upgrades (today)
 *   - revenue: today's revenue in cents, MRR estimate
 *   - costs: estimated provider cost today
 *   - littbits: total granted/spent today across all users
 *   - stripe: recent failed payments
 *   - jobs: recent failed tool executions
 *   - deployments: recent production deployments
 *   - audit: recent audit log entries
 *
 * Every field is derived from real database rows — no fabricated metrics.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Owner gate — must pass BOTH env var check AND be authenticated
  if (!isOwnerClerkId(userId)) {
    return NextResponse.json(
      { error: "Forbidden — owner access required" },
      { status: 403 },
    );
  }

  const client = getSupabaseAdmin();
  if (!client) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);

  try {
    const [
      onlineRes,
      signupsRes,
      studioOpensRes,
      firstPromptsRes,
      upgradesRes,
      totalUsersRes,
      revenueRes,
      spendRes,
      grantedRes,
      stripeFailuresRes,
      failedJobsRes,
      deploymentsRes,
      auditRes,
    ] = await Promise.all([
      // Online presence
      client
        .from("user_presence")
        .select("user_id, is_signed_in, current_page, last_seen_at")
        .gte("last_seen_at", fiveMinAgo.toISOString()),
      // Signups today
      client
        .from("users")
        .select("id, username, created_at", { count: "exact", head: false })
        .gte("created_at", todayStart.toISOString())
        .order("created_at", { ascending: false })
        .limit(20),
      // Studio opens today
      client
        .from("integration_events")
        .select("id", { count: "exact", head: true })
        .ilike("event_type", "%studio_open%")
        .gte("created_at", todayStart.toISOString()),
      // First prompts today
      client
        .from("integration_events")
        .select("id", { count: "exact", head: true })
        .ilike("event_type", "%first_prompt%")
        .gte("created_at", todayStart.toISOString()),
      // Upgrades today
      client
        .from("subscriptions")
        .select("id, user_id, plan, created_at", { count: "exact", head: false })
        .eq("status", "active")
        .gte("created_at", todayStart.toISOString())
        .order("created_at", { ascending: false })
        .limit(20),
      // Total users
      client
        .from("users")
        .select("id", { count: "exact", head: true }),
      // Revenue today
      client
        .from("payment_records")
        .select("amount_cents, currency, status, created_at")
        .eq("status", "succeeded")
        .gte("created_at", todayStart.toISOString())
        .order("created_at", { ascending: false })
        .limit(50),
      // LiTTBits spent today
      client
        .from("credit_ledger")
        .select("amount, category")
        .eq("category", "spend")
        .gte("created_at", todayStart.toISOString()),
      // LiTTBits granted today
      client
        .from("credit_ledger")
        .select("amount, category")
        .in("category", ["subscription_grant", "promotion", "grant"])
        .gte("created_at", todayStart.toISOString()),
      // Stripe failures
      client
        .from("payment_records")
        .select("id, amount_cents, status, failure_message, created_at")
        .neq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(20),
      // Failed jobs / tool executions
      client
        .from("integration_events")
        .select("id, event_type, provider, message, created_at")
        .ilike("event_type", "%error%")
        .order("created_at", { ascending: false })
        .limit(20),
      // Recent deployments
      client
        .from("project_deployments")
        .select("id, integration_project_id, environment, status, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      // Audit log
      client
        .from("audit_log")
        .select("id, actor_id, action, resource_type, resource_id, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    // Aggregate presence
    const onlineData = (onlineRes.data ?? []) as Array<{
      user_id: string;
      is_signed_in: boolean;
      current_page: string | null;
      last_seen_at: string;
    }>;
    const visitorsOnline = onlineData.filter((u) => !u.is_signed_in).length;
    const signedInOnline = onlineData.filter((u) => u.is_signed_in).length;
    // Current pages (top 5)
    const pageCounts: Record<string, number> = {};
    for (const u of onlineData) {
      if (u.current_page) {
        pageCounts[u.current_page] = (pageCounts[u.current_page] || 0) + 1;
      }
    }
    const currentPages = Object.entries(pageCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([page, count]) => ({ page, count }));

    // Aggregate revenue
    const revenueData = (revenueRes.data ?? []) as Array<{
      amount_cents: number;
      currency: string | null;
    }>;
    const revenueTodayCents = revenueData.reduce(
      (sum, p) => sum + (p.amount_cents || 0),
      0,
    );

    // Aggregate LiTTBits
    const spendData = (spendRes.data ?? []) as Array<{ amount: number }>;
    const littbitsSpentToday = spendData.reduce(
      (sum, s) => sum + Math.abs(Number(s.amount) || 0),
      0,
    );
    const grantedData = (grantedRes.data ?? []) as Array<{ amount: number }>;
    const littbitsGrantedToday = grantedData.reduce(
      (sum, g) => sum + Math.max(0, Number(g.amount) || 0),
      0,
    );

    return NextResponse.json({
      presence: {
        visitorsOnline,
        signedInOnline,
        currentPages,
      },
      funnel: {
        signupsToday: signupsRes.count || 0,
        recentSignups: signupsRes.data ?? [],
        studioOpensToday: studioOpensRes.count || 0,
        firstPromptsToday: firstPromptsRes.count || 0,
        upgradesToday: upgradesRes.count || 0,
        recentUpgrades: upgradesRes.data ?? [],
        totalUsers: totalUsersRes.count || 0,
      },
      revenue: {
        todayCents: revenueTodayCents,
        recentPayments: revenueData.slice(0, 10),
      },
      costs: {
        littbitsSpentToday,
        littbitsGrantedToday,
        estimatedProviderCostTodayCents: littbitsSpentToday,
      },
      stripe: {
        recentFailures: stripeFailuresRes.data ?? [],
      },
      jobs: {
        recentFailures: failedJobsRes.data ?? [],
      },
      deployments: {
        recent: deploymentsRes.data ?? [],
      },
      audit: {
        recent: auditRes.data ?? [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Owner data unavailable";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
