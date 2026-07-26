import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PLANS, type PlanId } from "@/config/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({
        plan: PLANS.starter,
        subscription: null,
        balances: { monthly: 0, purchased: 0, beta_promotional: 9999, total: 9999 },
      });
    }

    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();

    if (!user) {
      return NextResponse.json({
        plan: PLANS.starter,
        subscription: null,
        balances: { monthly: 0, purchased: 0, beta_promotional: 9999, total: 9999 },
      });
    }

    const { data: sub } = await admin
      .from("subscriptions")
      .select("plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end")
      .eq("user_id", user.id)
      .single();

    let planId: PlanId = "starter";
    if (sub && sub.status === "active") {
      planId = sub.plan as PlanId;
      if (!PLANS[planId]) planId = "starter";
    }

    let balances = { monthly: 0, purchased: 0, beta_promotional: 9999, total: 9999 };
    try {
      const { data: balData } = await admin.rpc("get_user_balances", { p_user_id: user.id });
      if (balData) {
        const row = Array.isArray(balData) ? balData[0] : balData;
        if (row) {
          balances = {
            monthly: row.monthly ?? 0,
            purchased: row.purchased ?? 0,
            beta_promotional: row.beta_promotional ?? 9999,
            total: row.total ?? 9999,
          };
        }
      }
    } catch {
      // Ledger not yet migrated — fallback
    }

    return NextResponse.json({
      plan: PLANS[planId],
      subscription: sub ?? null,
      balances,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load subscription" }, { status: 500 });
  }
}
