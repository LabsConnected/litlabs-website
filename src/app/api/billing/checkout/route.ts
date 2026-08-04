import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PLANS, getStripePriceId, type PlanId } from "@/config/plans";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth(req);
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { planId } = body as { planId?: string };

    if (!planId) {
      return NextResponse.json({ error: "Missing planId" }, { status: 400 });
    }

    const plan = PLANS[planId as PlanId];
    if (!plan || !plan.enabled) {
      return NextResponse.json({ error: "Invalid or disabled plan" }, { status: 400 });
    }

    if (plan.billingType === "free") {
      return NextResponse.json({ error: "Free plan requires no checkout" }, { status: 400 });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: "Stripe is not configured. Set STRIPE_SECRET_KEY.", setup_required: true },
        { status: 501 },
      );
    }

    const priceId = getStripePriceId(plan);
    if (!priceId) {
      return NextResponse.json(
        {
          error: `Stripe price ID not configured for ${plan.name}. Set ${plan.stripePriceIdEnv} in your environment.`,
          setup_required: true,
        },
        { status: 501 },
      );
    }

    const origin = req.headers.get("origin") || "https://litlabs.net";
    const mode = plan.billingType === "one_time" ? "payment" : "subscription";

    const params = new URLSearchParams();
    params.append("mode", mode);
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", `${origin}/settings?section=billing&upgraded=${plan.id}`);
    params.append("cancel_url", `${origin}/pricing?canceled=true`);
    params.append("allow_promotion_codes", "true");
    params.append("billing_address_collection", "auto");
    // Automatic tax is disabled by default. Enable only after Stripe Tax
    // is fully configured (registrations, product tax codes, tax behavior).
    // See docs/STRIPE_CATALOG_WIRING.md for the configuration checklist.
    const autoTaxEnabled = process.env.STRIPE_AUTOMATIC_TAX_ENABLED === "true";
    params.append("automatic_tax[enabled]", autoTaxEnabled ? "true" : "false");
    params.append(`metadata[clerk_id]`, clerkId);
    params.append(`metadata[plan_id]`, plan.id);
    params.append(`metadata[product_type]`, "plan");
    if (mode === "subscription") {
      params.append("subscription_data[metadata][clerk_id]", clerkId);
      params.append("subscription_data[metadata][plan_id]", plan.id);
      params.append("subscription_data[metadata][product_type]", "plan");
    } else {
      // For one-time payments (Founder), propagate metadata to the
      // PaymentIntent so refund handlers can classify the charge.
      params.append("payment_intent_data[metadata][clerk_id]", clerkId);
      params.append("payment_intent_data[metadata][plan_id]", plan.id);
      params.append("payment_intent_data[metadata][product_type]", "plan");
    }

    // Idempotency: use clerkId + planId + timestamp window to prevent
    // duplicate checkout sessions from rapid double-clicks.
    const idempotencyKey = `billing_${clerkId}_${plan.id}_${Date.now()}`;

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": idempotencyKey,
        },
        body: params.toString(),
      },
    );

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return NextResponse.json(
        { error: session.error?.message || "Stripe error" },
        { status: stripeResponse.status },
      );
    }

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
