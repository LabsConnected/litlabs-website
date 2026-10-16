import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { PLANS, getStripePriceId, type PlanId } from "@/config/plans";
import { isFeatureEnabled } from "@/config/feature-flags";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Statuses that already entitle the user. A second Checkout would double-bill. */
const BLOCKING_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Double-clicks inside this window share one Stripe idempotency key. */
const CHECKOUT_IDEMPOTENCY_BUCKET_MS = 600_000;

export const runtime = "nodejs";

function getAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://www.litlabs.net");

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid app URL");
  }

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production app URL must use HTTPS");
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function handler(req: NextRequest) {
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

    // The founderCheckout flag was previously decorative: nothing read it, so
    // with STRIPE_PRICE_FOUNDER set in the environment a real $149 one-time
    // charge could still be created. Enforce it here as well as relying on
    // `plan.enabled` above.
    if (plan.id === "founder" && !isFeatureEnabled("founderCheckout")) {
      return NextResponse.json(
        { error: "The Founding Member tier is no longer available for purchase." },
        { status: 410 },
      );
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

    // Never trust the browser Origin for payment return URLs. Origin is a
    // request header and can be forged outside a normal browser flow.
    let appUrl: string;
    try {
      appUrl = getAppUrl();
    } catch {
      return NextResponse.json(
        { error: "Server URL misconfiguration" },
        { status: 500 },
      );
    }
    const mode = plan.billingType === "one_time" ? "payment" : "subscription";

    let storedCustomerId: string | null = null;
    let reservationToken: string | null = null;
    const admin = mode === "subscription" ? getSupabaseAdmin() : null;
    if (mode === "subscription") {
      if (!admin) {
        return NextResponse.json({ error: "Database not configured" }, { status: 503 });
      }
      const { data: user, error: userError } = await admin
        .from("users")
        .select("id")
        .eq("clerk_id", clerkId)
        .maybeSingle();
      if (userError) {
        return NextResponse.json({ error: "Database not configured" }, { status: 503 });
      }
      if (user) {
        const { data: sub, error: subError } = await admin
          .from("subscriptions")
          .select("status, stripe_customer_id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (subError) {
          return NextResponse.json({ error: "Database not configured" }, { status: 503 });
        }
        if (sub && BLOCKING_SUBSCRIPTION_STATUSES.has(sub.status)) {
          return NextResponse.json(
            {
              error: "You already have a subscription. Manage it in the billing portal.",
              code: "already_subscribed",
              portalPath: "/api/billing/portal",
            },
            { status: 409 },
          );
        }
        if (typeof sub?.stripe_customer_id === "string" && sub.stripe_customer_id) {
          storedCustomerId = sub.stripe_customer_id;
        }
      }

      const { data: reservation, error: reservationError } = await admin.rpc(
        "begin_checkout_reservation",
        {
          p_clerk_id: clerkId,
          p_user_id: user?.id ?? null,
          p_plan_id: plan.id,
          p_price_id: priceId,
          p_now: new Date().toISOString(),
          p_lease_seconds: 60,
        },
      );
      if (reservationError) {
        return NextResponse.json({ error: "Database not configured" }, { status: 503 });
      }
      const decision = (Array.isArray(reservation) ? reservation[0] : reservation) as {
        action?: string;
        url?: string;
        session_id?: string;
        token?: string;
      } | null;
      if (decision?.action === "already_subscribed") {
        return NextResponse.json(
          {
            error: "You already have a subscription. Manage it in the billing portal.",
            code: "already_subscribed",
            portalPath: "/api/billing/portal",
          },
          { status: 409 },
        );
      }
      if (decision?.action === "in_progress") {
        return NextResponse.json(
          {
            error: "A checkout is already open. Finish or wait for it to expire before starting another plan.",
            code: "checkout_in_progress",
          },
          { status: 409 },
        );
      }
      if (decision?.action === "reuse" && decision.url) {
        return NextResponse.json({ url: decision.url, sessionId: decision.session_id ?? null });
      }
      if (decision?.action !== "create" || typeof decision.token !== "string") {
        return NextResponse.json({ error: "Database not configured" }, { status: 503 });
      }
      reservationToken = decision.token;
    }

    const params = new URLSearchParams();
    params.append("mode", mode);
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("success_url", `${appUrl}/settings?section=billing&upgraded=${plan.id}`);
    params.append("cancel_url", `${appUrl}/pricing?canceled=true`);
    params.append("allow_promotion_codes", "true");
    params.append("billing_address_collection", "auto");
    if (storedCustomerId) {
      params.append("customer", storedCustomerId);
    }
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

    // Deterministic for the user, price, and a 10-minute bucket. A raw
    // millisecond timestamp made every click a new Stripe session.
    const bucket = Math.floor(Date.now() / CHECKOUT_IDEMPOTENCY_BUCKET_MS);
    const idempotencyKey = `billing_${clerkId}_${priceId}_${bucket}`;

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
      if (admin && reservationToken) {
        await admin.rpc("abort_checkout_reservation", {
          p_clerk_id: clerkId,
          p_token: reservationToken,
        });
      }
      return NextResponse.json(
        { error: session.error?.message || "Stripe error" },
        { status: stripeResponse.status },
      );
    }

    if (admin && reservationToken) {
      const openUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data: committed, error: commitError } = await admin.rpc(
        "commit_checkout_reservation",
        {
          p_clerk_id: clerkId,
          p_token: reservationToken,
          p_session_id: session.id,
          p_url: session.url,
          p_open_until: openUntil,
        },
      );
      if (commitError || committed !== true) {
        return NextResponse.json(
          {
            error: "A checkout is already open. Finish or wait for it to expire before starting another plan.",
            code: "checkout_in_progress",
          },
          { status: 409 },
        );
      }
    }

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 10, 60);
