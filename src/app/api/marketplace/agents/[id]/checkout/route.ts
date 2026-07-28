import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

async function handler(
  req: NextRequest,
  ctx?: { params: Promise<{ id: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ctx?.params) {
    return NextResponse.json({ error: "Missing route params" }, { status: 400 });
  }
  const { id: agentId } = await ctx.params;

  // Look up user in Supabase
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();

  if (userError || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Load the active agent version from DB — never trust client for price
  const { data: version, error: versionError } = await supabaseAdmin
    .from("agent_versions")
    .select(
      "id, agent_id, version, system_prompt, stripe_price_id, price_cents, status, features",
    )
    .eq("agent_id", agentId)
    .eq("status", "active")
    .order("published_at", { ascending: false })
    .limit(1)
    .single();

  if (versionError || !version) {
    return NextResponse.json({ error: "Agent not found or not active" }, { status: 404 });
  }

  if (!version.stripe_price_id) {
    return NextResponse.json(
      {
        error: "Stripe product not configured for this agent. Run attach_stripe_prices.sql.",
        setup_required: true,
      },
      { status: 501 },
    );
  }

  // Check if user already owns this agent
  const { data: existing } = await supabaseAdmin
    .from("agent_entitlements")
    .select("id")
    .eq("user_id", user.id)
    .eq("agent_version_id", version.id)
    .eq("status", "active")
    .single();

  if (existing) {
    return NextResponse.json({ error: "Already purchased" }, { status: 409 });
  }

  // Look up agent slug for metadata
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("slug")
    .eq("id", agentId)
    .single();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY.", setup_required: true },
      { status: 501 },
    );
  }

  const origin = req.headers.get("origin") || "https://litlabs.net";

  const stripeParams = new URLSearchParams();
  stripeParams.append("mode", "payment");
  stripeParams.append("line_items[0][price]", version.stripe_price_id);
  stripeParams.append("line_items[0][quantity]", "1");
  stripeParams.append(
    "success_url",
    `${origin}/marketplace?purchased=${agent.slug}`,
  );
  stripeParams.append("cancel_url", `${origin}/marketplace?canceled=true`);
  stripeParams.append("metadata[clerk_id]", clerkId);
  stripeParams.append("metadata[agent_version_id]", version.id);
  stripeParams.append("metadata[agent_slug]", agent.slug);
  stripeParams.append("billing_address_collection", "auto");
  stripeParams.append("automatic_tax[enabled]", "false");

  const stripeResponse = await fetch(
    "https://api.stripe.com/v1/checkout/sessions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: stripeParams.toString(),
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
}

export const POST = withRateLimit(handler, 10, 60);
