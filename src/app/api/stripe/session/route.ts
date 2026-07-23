import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
    return NextResponse.json({ error: "Invalid checkout session" }, { status: 400 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 501 });
  }

  try {
    const stripe = new Stripe(secretKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items.data.price.product"],
    });

    if (session.metadata?.clerk_id !== userId) {
      return NextResponse.json({ error: "Checkout session not found" }, { status: 403 });
    }

    return NextResponse.json({
      id: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_details?.email ?? session.customer_email,
      currency: session.currency,
      subtotal: session.amount_subtotal,
      total: session.amount_total,
      created: session.created,
      items: (session.line_items?.data ?? []).map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        amountTotal: item.amount_total,
      })),
    });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      return NextResponse.json({ error: "Checkout session not found" }, { status: 404 });
    }
    console.error("Unable to retrieve Stripe checkout session", error);
    return NextResponse.json({ error: "Unable to load receipt" }, { status: 500 });
  }
}
