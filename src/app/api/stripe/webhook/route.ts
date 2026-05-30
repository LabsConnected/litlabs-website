// Stripe webhook handler for subscription events
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || !sig) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  try {
    // Verify and parse the event via Stripe API
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
    }

    // In production, you'd use the stripe SDK to constructEvent
    // For webhook verification, use Stripe's library
    // This is a simplified handler - in prod use: stripe.webhooks.constructEvent(body, sig, webhookSecret)
    const event = JSON.parse(body);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // TODO: Update user subscription status in your database
        // await updateUserSubscription(session.customer_email, {
        //   status: "active",
        //   stripeCustomerId: session.customer,
        //   stripeSubscriptionId: session.subscription,
        // });
        console.log("Checkout completed for:", session.customer_email);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        // TODO: Update user subscription in database
        console.log("Subscription updated:", subscription.id, subscription.status);
        break;
      }
      case "invoice.payment_failed": {
        // TODO: Handle failed payment - notify user
        console.log("Payment failed for invoice:", event.data.object.id);
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook error:", err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 400 });
  }
}
