// Marketplace agent checkout — server-priced, secure.
//
// POST /api/marketplace/agents/[id]/checkout
//
// Creates a Stripe Checkout session for purchasing a premium agent.
// The browser sends only the agent ID in the URL — no price, no metadata,
// no email. The server:
//   1. Authenticates with Clerk and resolves the internal user.
//   2. Loads the published agent version from the database (never trusts
//      client input for price, slug, or version status).
//   3. Does NOT select system_prompt (not needed for checkout).
//   4. Validates that a Stripe Price ID is configured.
//   5. Checks for existing active entitlement (prevents duplicate purchases).
//   6. Creates a pending marketplace order before Stripe Checkout.
//   7. Stores the database order ID in Stripe metadata.
//   8. Uses trusted APP_URL configuration for return URLs — never request Origin.
//   9. Validates the Stripe Checkout session response (URL + session ID).
//  10. Returns a sanitized error on any failure.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

// Marketplace checkout version — stored in Stripe metadata for webhook classification.
const MARKETPLACE_CHECKOUT_VERSION = "marketplace-agent-v1";

/**
 * Resolves the trusted application URL for return redirects. Never reads the
 * request Origin header. localhost is allowed only in development.
 */
function getAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://litlabs.net");

  let url = raw.trim();
  url = url.replace(/\/+$/, "");

  if (
    process.env.NODE_ENV === "production" &&
    !url.startsWith("https://")
  ) {
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
  return NextResponse.json(
    { error: "Unable to create checkout session" },
    { status: 500 },
  );
}

function stripeFailure() {
  return NextResponse.json(
    { error: "Unable to create checkout session" },
    { status: 502 },
  );
}

async function handler(
  req: NextRequest,
  ctx?: { params: Promise<{ id: string }> },
) {
  // 1. Authenticate with Clerk.
  const { clerkId } = await auth();
  if (!clerkId) {
    return unauthorized();
  }

  if (!ctx?.params) {
    return NextResponse.json({ error: "Missing route params" }, { status: 400 });
  }
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

  // 3. Load the published agent version from the database.
  // Do NOT select system_prompt — it's not needed for checkout and should
  // not be exposed in the checkout flow.
  const { data: version, error: versionError } = await supabaseAdmin
    .from("agent_versions")
    .select(
      "id, agent_id, version, stripe_price_id, price_cents, currency, status",
    )
    .eq("agent_id", agentId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (versionError || !version) {
    return notFound("Agent not found or not available for purchase");
  }

  // 4. Validate that a Stripe Price ID is configured.
  if (!version.stripe_price_id) {
    return NextResponse.json(
      { error: "Agent is not yet available for purchase" },
      { status: 501 },
    );
  }

  // Validate Price ID format (must start with price_).
  if (!version.stripe_price_id.startsWith("price_")) {
    console.error(
      "[marketplace/checkout] Invalid Stripe Price ID for agent version",
      version.id,
    );
    return serverError();
  }

  // 5. Check for existing active entitlement (prevent duplicate purchases).
  const { data: existing } = await supabaseAdmin
    .from("agent_entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("agent_version_id", version.id)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return conflict("You already own this agent");
  }

  // 6. Look up agent slug for metadata (server-side only).
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("slug")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent) {
    return notFound("Agent not found");
  }

  // 7. Create a pending marketplace order before Stripe Checkout.
  // This order will be updated to 'paid' by the webhook RPC.
  const { data: order, error: orderError } = await supabaseAdmin
    .from("marketplace_orders")
    .insert({
      user_id: user.id,
      status: "pending",
      total_cents: version.price_cents,
      currency: version.currency,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error(
      "[marketplace/checkout] Failed to create pending order",
      orderError?.message,
    );
    return serverError();
  }

  // 8. Build Stripe Checkout session parameters.
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
  // Server-generated metadata — the browser cannot override these.
  params.append("metadata[checkout_version]", MARKETPLACE_CHECKOUT_VERSION);
  params.append("metadata[product_type]", "agent");
  params.append("metadata[marketplace_order_id]", order.id);
  params.append("metadata[agent_version_id]", version.id);
  params.append("metadata[clerk_id]", clerkId);
  // Idempotency key — prevents duplicate checkout sessions for the same order.
  params.append("idempotency_key", `marketplace_order_${order.id}`);
  params.append("billing_address_collection", "auto");
  params.append("automatic_tax[enabled]", "false");

  // 9. Create the Stripe Checkout session.
  let stripeResponse: Response;
  try {
    stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch {
    console.error("[marketplace/checkout] Stripe request failed");
    return stripeFailure();
  }

  if (!stripeResponse.ok) {
    console.error(
      "[marketplace/checkout] Stripe returned non-2xx",
      stripeResponse.status,
    );
    return stripeFailure();
  }

  const session = (await stripeResponse.json()) as {
    id?: string;
    url?: string;
  };

  // 10. Validate the Stripe Checkout session response.
  if (
    typeof session.id !== "string" ||
    typeof session.url !== "string" ||
    !session.url.startsWith("https://checkout.stripe.com/")
  ) {
    console.error(
      "[marketplace/checkout] Stripe returned 2xx without a valid checkout URL/session id",
    );
    return stripeFailure();
  }

  // 11. Store the Stripe checkout session ID on the pending order.
  await supabaseAdmin
    .from("marketplace_orders")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", order.id);

  return NextResponse.json({ url: session.url, sessionId: session.id });
}

export const POST = withRateLimit(handler, 10, 60);
