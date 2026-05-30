// Stripe checkout session creation
import { NextRequest, NextResponse } from "next/server";

// Price IDs for Stripe (these would be set in Vercel env vars)
// For now we use placeholder IDs - user needs to replace with real Stripe Price IDs
const PRICES = {
  pro_monthly: process.env.STRIPE_PRO_PRICE_ID || "",
  pro_yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { priceId, mode = "subscription" } = body;

    // Get the origin for success/cancel URLs
    const origin = req.headers.get("origin") || "https://litlabs.net";

    // Check if Stripe is configured
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        {
          error: "Stripe is not configured yet. Set STRIPE_SECRET_KEY in Vercel environment variables.",
          setup_required: true,
        },
        { status: 501 }
      );
    }

    // Use provided price ID or default to pro monthly
    const finalPriceId = priceId || PRICES.pro_monthly;
    if (!finalPriceId) {
      return NextResponse.json(
        { error: "No price ID provided and no default configured." },
        { status: 400 }
      );
    }

    // Create checkout session via Stripe API
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode,
        "success_url": `${origin}/dashboard?success=true`,
        "cancel_url": `${origin}/settings/billing?canceled=true`,
        "line_items[0][price]": finalPriceId,
        "line_items[0][quantity]": "1",
        "allow_promotion_codes": "true",
        "billing_address_collection": "auto",
        "customer_email": body.email || "",
      }).toString(),
    });

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return NextResponse.json(
        { error: session.error?.message || "Stripe error" },
        { status: stripeResponse.status }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
