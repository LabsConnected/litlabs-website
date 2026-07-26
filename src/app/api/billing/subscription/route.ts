import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PLANS, type PlanId } from "@/config/plans";
import { getCreditBalances } from "@/lib/wallet-ledger";

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
        balances: { monthly: 0, purchased: 0, beta_promotional: 0, total: 0 },
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
        balances: { monthly: 0, purchased: 0, beta_promotional: 0, total: 0 },
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

    let balances = { monthly: 0, purchased: 0, beta_promotional: 0, total: 0 };
    try {
      const creditBalances = await getCreditBalances(clerkId);
      balances = {
        monthly: creditBalances.monthly,
        purchased: creditBalances.purchased,
        beta_promotional: creditBalances.betaPromotional,
        total: creditBalances.total,
      };
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
