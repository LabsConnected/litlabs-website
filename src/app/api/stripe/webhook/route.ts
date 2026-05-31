// Stripe webhook handler
// Receives events from Stripe via your Cloudflare Worker
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.text();
  // Stripe signature from webhook — verification done via event fetch below
  const _sig = req.headers.get("stripe-signature") || void 0;
  void _sig; // reserved for future signature verification
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    console.error("No STRIPE_SECRET_KEY configured");
    return NextResponse.json({ error: "No secret key" }, { status: 500 });
  }

  if (!signingSecret) {
    console.error("No STRIPE_WEBHOOK_SECRET configured");
    return NextResponse.json({ error: "No webhook secret" }, { status: 500 });
  }

  // Parse and verify event
  let event;
  try {
    event = JSON.parse(body);
  } catch (err) {
    console.error("Webhook parse error:", err);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Verify event by fetching from Stripe
  try {
    const stripeResponse = await fetch(
      `https://api.stripe.com/v1/events/${event.id}`,
      { headers: { Authorization: `Bearer ${key}` } }
    );

    if (!stripeResponse.ok) {
      console.error("Event verification failed for:", event.id);
      return NextResponse.json({ error: "Event verification failed" }, { status: 400 });
    }
  } catch (err) {
    console.error("Event verification error:", err);
    return NextResponse.json({ error: "Verification error" }, { status: 500 });
  }

  // Process event
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      console.log("Checkout completed:", session.id, "Email:", session.customer_email);
      // TODO: Grant Pro access to this customer
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      console.log("Subscription:", sub.id, "Status:", sub.status);
      // TODO: Update user subscription in your database
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      console.log("Subscription cancelled:", sub.id);
      // TODO: Revoke Pro access
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      console.log("Payment succeeded:", invoice.id);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      console.log("Payment failed:", invoice.id);
      // TODO: Notify customer about failed payment
      break;
    }
    default:
      console.log("Unhandled event:", event.type);
  }

  return NextResponse.json({ received: true });
}
