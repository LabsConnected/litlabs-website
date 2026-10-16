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

/**
 * Stripe rejects a Checkout expires_at sooner than 30 minutes. 31 minutes
 * stays above that floor. The reservation lease uses the same window so a
 * crashed create cannot outlive the payable session, and an open session
 * does not trap a plan switch for 24 hours.
 */
const CHECKOUT_SESSION_TTL_SECONDS = 31 * 60;
const STRIPE_HTTP_TIMEOUT_MS = 20_000;

type ReservationDecision = {
  action?: string;
  url?: string;
  session_id?: string;
  token?: string;
  expire_session_id?: string | null;
  previous_url?: string | null;
  previous_plan_id?: string | null;
  previous_price_id?: string | null;
  previous_expires_at?: string | null;
};

type ExpireResult = "expired" | "completed" | "error";

async function expireStripeCheckoutSession(
  stripeKey: string,
  sessionId: string,
): Promise<ExpireResult> {
  try {
    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}` },
        signal: AbortSignal.timeout(STRIPE_HTTP_TIMEOUT_MS),
      },
    );
    if (response.ok) return "expired";
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const message = body?.error?.message ?? "";
    if (
      response.status === 404 ||
      /status of [`']?expired/i.test(message) ||
      /already expired/i.test(message)
    ) {
      return "expired";
    }
    if (/status of [`']?complete/i.test(message) || /has been paid/i.test(message)) {
      return "completed";
    }
    return "error";
  } catch {
    return "error";
  }
}

async function restoreOpenReservation(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  clerkId: string,
  decision: ReservationDecision,
): Promise<void> {
  if (
    decision.expire_session_id &&
    decision.token &&
    decision.previous_plan_id &&
    decision.previous_price_id &&
    decision.previous_expires_at
  ) {
    await admin.rpc("restore_open_checkout_reservation", {
      p_clerk_id: clerkId,
      p_token: decision.token,
      p_session_id: decision.expire_session_id,
      p_url: decision.previous_url ?? "",
      p_plan_id: decision.previous_plan_id,
      p_price_id: decision.previous_price_id,
      p_open_until: decision.previous_expires_at,
    });
    return;
  }
  if (decision.token) {
    await admin.rpc("abort_checkout_reservation", {
      p_clerk_id: clerkId,
      p_token: decision.token,
    });
  }
}

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
    let decision: ReservationDecision | null = null;
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
          p_lease_seconds: CHECKOUT_SESSION_TTL_SECONDS,
        },
      );
      if (reservationError) {
        return NextResponse.json({ error: "Database not configured" }, { status: 503 });
      }
      decision = (Array.isArray(reservation) ? reservation[0] : reservation) as ReservationDecision | null;
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
      if (
        (decision?.action !== "create" && decision?.action !== "replace") ||
        typeof decision.token !== "string"
      ) {
        return NextResponse.json({ error: "Database not configured" }, { status: 503 });
      }
      reservationToken = decision.token;
      const previousSessionId =
        typeof decision.expire_session_id === "string" && decision.expire_session_id
          ? decision.expire_session_id
          : null;
      if (previousSessionId) {
        const expired = await expireStripeCheckoutSession(stripeKey, previousSessionId);
        if (expired !== "expired") {
          await restoreOpenReservation(admin, clerkId, decision);
          if (expired === "completed") {
            return NextResponse.json(
              {
                error: "The previous checkout already completed. Wait for the subscription before starting another plan.",
                code: "checkout_completed",
              },
              { status: 409 },
            );
          }
          return NextResponse.json(
            { error: "Could not expire the previous checkout session." },
            { status: 503 },
          );
        }
      }
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
    let idempotencyKey = `billing_${clerkId}_${priceId}_${bucket}`;
    // A replaced or orphaned session in the same 10-minute bucket would
    // replay the session we just expired if the key stayed the same.
    if (decision?.expire_session_id) {
      idempotencyKey += `_after_${decision.expire_session_id}`;
    }
    params.append(
      "expires_at",
      String(Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS),
    );

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
        signal: AbortSignal.timeout(STRIPE_HTTP_TIMEOUT_MS),
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
      const openUntil = new Date(Date.now() + CHECKOUT_SESSION_TTL_SECONDS * 1000).toISOString();
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
        await expireStripeCheckoutSession(stripeKey, session.id);
        await admin.rpc("abort_checkout_reservation", {
          p_clerk_id: clerkId,
          p_token: reservationToken,
        });
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
