import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

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

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: "Stripe is not configured" }, { status: 501 });
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Database not configured" }, { status: 503 });
    }

    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { data: sub } = await admin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    if (!sub?.stripe_customer_id) {
      return NextResponse.json({ error: "No Stripe customer found" }, { status: 404 });
    }

    let appUrl: string;
    try {
      appUrl = getAppUrl();
    } catch {
      return NextResponse.json({ error: "Server URL misconfiguration" }, { status: 500 });
    }

    const params = new URLSearchParams({
      customer: sub.stripe_customer_id,
      return_url: `${appUrl}/settings?section=billing`,
    });
    const portalConfig = process.env.STRIPE_PORTAL_CONFIG_ID?.trim();
    if (portalConfig) params.set("configuration", portalConfig);

    const response = await fetch(
      `https://api.stripe.com/v1/billing_portal/sessions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
    );

    const session = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: session.error?.message || "Failed to create portal session" },
        { status: response.status },
      );
    }

    return NextResponse.json({ url: session.url });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 10, 60);
