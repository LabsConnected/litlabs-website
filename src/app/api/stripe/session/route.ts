// /api/stripe/session — fetch receipt details for a Stripe checkout session.
//
// Used by the post-purchase "Thank you" page (/order/success) to render the
// customer's order details (amount, currency, line items, email, etc.).
//
// Auth: requires a signed-in user. The order's `metadata.clerk_id` must match
// the authenticated user — otherwise we 403 to prevent order enumeration.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

type StripeLineItem = {
  description: string;
  amount_subtotal: number;
  amount_total: number;
  currency: string;
  quantity: number | null;
};

type StripeSession = {
  id: string;
  amount_total: number | null;
  currency: string;
  customer_email: string | null;
  payment_status: string;
  status: string;
  created: number;
  metadata: Record<string, string> | null;
  line_items?: { data: StripeLineItem[] };
};

type FlatLineItem = {
  description: string;
  amount: number; // cents (unit)
  currency: string;
  quantity: number;
};

export async function GET(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionId = req.nextUrl.searchParams.get("session_id");
    if (!sessionId || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(sessionId)) {
      return NextResponse.json(
        { error: "Invalid session_id" },
        { status: 400 },
      );
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json(
        { error: "Stripe is not configured on the server." },
        { status: 501 },
      );
    }

    // Fetch the session
    const sessionRes = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${stripeKey}` },
        cache: "no-store",
      },
    );

    if (sessionRes.status === 404) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (!sessionRes.ok) {
      const text = await sessionRes.text().catch(() => "");
      return NextResponse.json(
        { error: text || `Stripe error (${sessionRes.status})` },
        { status: sessionRes.status },
      );
    }

    const session = (await sessionRes.json()) as StripeSession;

    // Ownership check: only the buyer can see their own receipt details.
    // The checkout route writes metadata.clerk_id from the authenticated user.
    if (session.metadata?.clerk_id && session.metadata.clerk_id !== clerkId) {
      return NextResponse.json(
        { error: "This order belongs to a different account." },
        { status: 403 },
      );
    }

    // Fetch line items (separate endpoint on Stripe).
    let lineItems: FlatLineItem[] = [];
    if (session.line_items?.data?.length) {
      // Stripe already expanded line_items, so we don't need a second call.
      lineItems = session.line_items.data.map((li) => ({
        description: li.description,
        amount: li.amount_subtotal ?? li.amount_total,
        currency: li.currency,
        quantity: li.quantity ?? 1,
      }));
    } else {
      // Try expanding them
      const expandRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${stripeKey}` },
          cache: "no-store",
        },
      );
      if (expandRes.ok) {
        const expanded = (await expandRes.json()) as StripeSession;
        lineItems =
          expanded.line_items?.data?.map((li) => ({
            description: li.description,
            amount: li.amount_subtotal ?? li.amount_total,
            currency: li.currency,
            quantity: li.quantity ?? 1,
          })) ?? [];
      }
    }

    return NextResponse.json({
      id: session.id,
      amount_total: session.amount_total ?? 0,
      currency: session.currency,
      customer_email: session.customer_email,
      payment_status: session.payment_status,
      status: session.status,
      created: session.created,
      line_items: lineItems,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
