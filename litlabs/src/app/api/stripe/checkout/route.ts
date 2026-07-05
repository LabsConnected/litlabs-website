// Stripe checkout session creation — supports both price IDs and ad-hoc price_data
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { priceId, mode = "payment", priceData } = body;

    const origin = req.headers.get("origin") || "https://litlabs.net";

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        {
          error:
            "Stripe is not configured. Set STRIPE_SECRET_KEY in your environment.",
          setup_required: true,
        },
        { status: 501 },
      );
    }

    const params = new URLSearchParams({
      mode,
      success_url: `${origin}/marketplace?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/marketplace?canceled=true`,
      allow_promotion_codes: "true",
      billing_address_collection: "auto",
      "automatic_tax[enabled]": "false",
    });

    // Ad-hoc pricing (coin packs, one-time purchases) — no pre-created products needed
    if (priceData && typeof priceData === "object") {
      const { amount, currency = "usd", name, description } = priceData;
      if (!amount || amount < 50) {
        return NextResponse.json(
          { error: "Invalid amount. Minimum 50 cents." },
          { status: 400 },
        );
      }
      params.append("line_items[0][price_data][currency]", currency);
      params.append("line_items[0][price_data][unit_amount]", String(amount));
      params.append(
        "line_items[0][price_data][product_data][name]",
        name || "LiTBit Coins",
      );
      if (description)
        params.append(
          "line_items[0][price_data][product_data][description]",
          description,
        );
      params.append("line_items[0][quantity]", "1");
    }
    // Pre-created price ID (subscriptions, etc.)
    else if (priceId && priceId.startsWith("price_")) {
      params.append("line_items[0][price]", priceId);
      params.append("line_items[0][quantity]", "1");
    } else {
      return NextResponse.json(
        {
          error:
            "Provide either priceId (price_xxx) or priceData { amount, currency, name }",
        },
        { status: 400 },
      );
    }

    // Metadata: always use authenticated clerk_id (never trust client-supplied value)
    const metadata: Record<string, string> = { clerk_id: clerkId };
    if (body.metadata && typeof body.metadata === "object") {
      Object.entries(body.metadata).forEach(([key, value]) => {
        if (key !== "clerk_id" && value !== undefined && value !== null) {
          metadata[key] = String(value);
        }
      });
    }
    Object.entries(metadata).forEach(([key, value]) => {
      params.append(`metadata[${key}]`, value);
    });

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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
