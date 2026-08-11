import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PLANS, type PlanId } from "@/config/plans";
import { getCreditBalances } from "@/lib/wallet-ledger";
import { withRateLimit } from "@/lib/rate-limiter";
import { isOwnerClerkId, getActiveSimulation, type SimulatedPlan } from "@/lib/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
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

    // Owner override + test-mode simulation
    const owner = isOwnerClerkId(clerkId);
    let simulation: SimulatedPlan | null = null;
    let simulatedZeroBalance = false;
    if (owner) {
      simulation = await getActiveSimulation();
      if (simulation && simulation !== "owner" && simulation !== "zero_bits") {
        // Simulate a customer tier — override the plan
        planId = simulation as PlanId;
      } else if (!simulation || simulation === "owner") {
        // Owner with no simulation → Pro Builder level
        planId = "pro_builder_beta";
      }
      if (simulation === "zero_bits") {
        planId = "pro_builder_beta";
        simulatedZeroBalance = true;
      }
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

    // If simulating zero-bits, override the displayed balance to 0
    if (simulatedZeroBalance) {
      balances = { monthly: 0, purchased: 0, beta_promotional: 0, total: 0 };
    }

    return NextResponse.json({
      plan: PLANS[planId],
      subscription: sub ?? null,
      balances,
      isOwner: owner,
      simulation,
      testMode: simulation !== null && simulation !== "owner",
      simulatedZeroBalance,
    });
  } catch {
    return NextResponse.json({ error: "Failed to load subscription" }, { status: 500 });
  }
}

export const GET = withRateLimit(handler, 30, 60);
