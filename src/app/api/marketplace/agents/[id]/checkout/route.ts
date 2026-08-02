// Marketplace agent checkout — server-priced, secure.
//
// POST /api/marketplace/agents/[id]/checkout
//
// Creates a Stripe Checkout session for purchasing a premium agent.
// The browser sends only the agent ID in the URL — no price, no metadata,
// no email. The server:
//   1. Authenticates with Clerk and resolves the internal user.
//   2. Validates the agent is public and listed (available or beta).
//   3. Loads the latest published agent version from the database (never
//      trusts client input for price, slug, or version status).
//   4. Validates that a Stripe Price ID is configured.
//   5. Checks for existing active entitlement (prevents duplicate purchases).
//   6. Calls create_pending_agent_order() RPC to atomically create the
//      pending order AND its order item (with agent_id) in one transaction.
//   7. Stores the database order ID in Stripe metadata.
//   8. Uses the Idempotency-Key HTTP header (not the form body).
//   9. Puts classification metadata on both the Checkout Session and
//      the PaymentIntent (so refund handlers can find the order).
//  10. Uses trusted APP_URL configuration for return URLs — never request Origin.
//  11. Returns a sanitized checkout URL on success.
//
// Private or unlisted agents return 404 — they must not reveal product existence.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

const MARKETPLACE_CHECKOUT_VERSION = "marketplace-agent-v1";

function getAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://litlabs.net");

  let url = raw.trim();
  url = url.replace(/\/+$/, "");

  if (process.env.NODE_ENV === "production" && !url.startsWith("https://")) {
    throw new Error("Production app URL must use HTTPS");
  }

  return url;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

function conflict(message: string) {
  return NextResponse.json({ error: message }, { status: 409 });
}

function serverError() {
  return NextResponse.json({ error: "Unable to create checkout session" }, { status: 500 });
}

function stripeFailure() {
  return NextResponse.json({ error: "Unable to create checkout session" }, { status: 502 });
}

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) return unauthorized();

  const { id: agentId } = await ctx.params;

  // 2. Resolve internal user server-side.
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();

  if (userError || !user) {
    return notFound("User not found");
  }

  // 3. Validate the agent is public.
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, slug, is_public")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent || !agent.is_public) {
    return notFound("Agent not found or not available for purchase");
  }

  // 4. Validate the marketplace listing is available or beta.
  const { data: listing } = await supabaseAdmin
    .from("marketplace_items")
    .select("status, item_type")
    .eq("agent_id", agentId)
    .eq("item_type", "agent")
    .maybeSingle();

  if (!listing || (listing.status !== "available" && listing.status !== "beta")) {
    return notFound("Agent not found or not available for purchase");
  }

  // 5. Load the latest published agent version from the database.
  const { data: version, error: versionError } = await supabaseAdmin
    .from("agent_versions")
    .select("id, agent_id, version, stripe_price_id, price_cents, currency, status")
    .eq("agent_id", agentId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError || !version) {
    return notFound("Agent not found or not available for purchase");
  }

  // 6. Validate that a Stripe Price ID is configured.
  if (!version.stripe_price_id) {
    return NextResponse.json({ error: "Agent is not yet available for purchase" }, { status: 501 });
  }

  if (!version.stripe_price_id.startsWith("price_")) {
    console.error("[marketplace/checkout] Invalid Stripe Price ID for agent version", version.id);
    return serverError();
  }

  // 7. Check for existing active entitlement (prevent duplicate purchases).
  const { data: existing } = await supabaseAdmin
    .from("agent_entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("agent_id", agentId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return conflict("You already own this agent");
  }

  // 8. Call create_pending_agent_order() RPC to atomically create the
  //    pending order AND its order item (with agent_id) in one transaction.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data: orderResult, error: orderError } = await supabaseAdmin.rpc(
    "create_pending_agent_order",
    {
      p_user_id: user.id,
      p_agent_id: agentId,
      p_agent_version_id: version.id,
      p_price_cents: version.price_cents,
      p_currency: version.currency,
      p_expires_at: expiresAt,
    },
  );

  if (orderError || !orderResult) {
    console.error("[marketplace/checkout] create_pending_agent_order RPC failed", orderError?.message);
    return serverError();
  }

  const orderId = orderResult.order_id as string;

  // 9. Build Stripe Checkout session parameters.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error("[marketplace/checkout] STRIPE_SECRET_KEY not configured");
    return serverError();
  }

  let appUrl: string;
  try {
    appUrl = getAppUrl();
  } catch {
    return serverError();
  }

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("line_items[0][price]", version.stripe_price_id);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${appUrl}/marketplace?purchased=${agent.slug}`);
  params.append("cancel_url", `${appUrl}/marketplace?canceled=true`);

  params.append("metadata[checkout_version]", MARKETPLACE_CHECKOUT_VERSION);
  params.append("metadata[product_type]", "agent");
  params.append("metadata[marketplace_order_id]", orderId);
  params.append("metadata[agent_id]", agentId);
  params.append("metadata[agent_version_id]", version.id);
  params.append("metadata[clerk_id]", clerkId);

  params.append("payment_intent_data[metadata][product_type]", "agent");
  params.append("payment_intent_data[metadata][marketplace_order_id]", orderId);
  params.append("payment_intent_data[metadata][agent_id]", agentId);
  params.append("payment_intent_data[metadata][agent_version_id]", version.id);
  params.append("payment_intent_data[metadata][clerk_id]", clerkId);

  params.append("billing_address_collection", "auto");
  params.append("automatic_tax[enabled]", "false");

  // 10. Create the Stripe Checkout session.
  let stripeResponse: Response;
  try {
    stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `marketplace_order_${orderId}`,
      },
      body: params.toString(),
    });
  } catch {
    console.error("[marketplace/checkout] Stripe request failed");
    return stripeFailure();
  }

  if (!stripeResponse.ok) {
    console.error("[marketplace/checkout] Stripe returned non-2xx", stripeResponse.status);
    return stripeFailure();
  }

  const session = (await stripeResponse.json()) as { id?: string; url?: string };

  if (
    typeof session.id !== "string" ||
    typeof session.url !== "string" ||
    !session.url.startsWith("https://checkout.stripe.com/")
  ) {
    console.error("[marketplace/checkout] Stripe returned 2xx without a valid checkout URL/session id");
    return stripeFailure();
  }

  // 12. Store the Stripe checkout session ID on the pending order.
  await supabaseAdmin
    .from("marketplace_orders")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", orderId);

  return NextResponse.json({ url: session.url, sessionId: session.id });
}

export const POST = withRateLimit(handler, 10, 60);
