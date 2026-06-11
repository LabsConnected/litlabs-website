// Stripe checkout session creation
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { priceId, mode = "subscription" } = body;

    const origin = req.headers.get("origin") || "https://litlabs.net";

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        {
          error: "Stripe is not configured. Contact support.",
          setup_required: true,
        },
        { status: 501 }
      );
    }

    if (!priceId || !priceId.startsWith("price_")) {
      return NextResponse.json(
        { error: "Invalid price ID." },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      mode,
      "success_url": `${origin}/marketplace?success=true&session_id={CHECKOUT_SESSION_ID}`,
      "cancel_url": `${origin}/marketplace?canceled=true`,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "allow_promotion_codes": "true",
      "billing_address_collection": "auto",
    });

    // Pass metadata for coin pack tracking (clerk_id, coin_amount)
    if (body.metadata && typeof body.metadata === "object") {
      Object.entries(body.metadata).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.append(`metadata[${key}]`, String(value));
        }
      });
    }

    // If user email is provided, pass it to prefill
    if (body.email) {
      params.append("customer_email", body.email);
    }

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      // Stripe error:
      return NextResponse.json(
        { error: session.error?.message || "Stripe error" },
        { status: stripeResponse.status }
      );
    }

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    // Stripe checkout error:
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
