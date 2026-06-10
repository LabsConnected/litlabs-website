// Stripe webhook handler — credits wallet on coin pack purchases
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

async function creditCoinPack(clerkId: string, coinAmount: number, sessionId: string) {
  if (!isAdminSupabaseConfigured()) {
    console.log("[Webhook] Supabase not configured — skipping wallet credit");
    return;
  }
  try {
    const sb = getAdminSupabase();
    // Find user
    const { data: user } = await sb.from("users").select("id").eq("clerk_id", clerkId).single();
    if (!user) {
      console.error("[Webhook] User not found for clerk_id:", clerkId);
      return;
    }
    // Get current wallet
    const { data: wallet } = await sb.from("wallets").select("balance").eq("user_id", user.id).single();
    const currentBalance = wallet?.balance || 0;
    const newBalance = currentBalance + coinAmount;
    // Update wallet
    await sb.from("wallets").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("user_id", user.id);
    // Record transaction
    await sb.from("transactions").insert({
      user_id: user.id,
      type: "purchase",
      amount: coinAmount,
      balance_after: newBalance,
      description: `Purchased ${coinAmount} LiTBit Coins via Stripe`,
      metadata: { stripe_session_id: sessionId },
    });
    console.log(`[Webhook] Credited ${coinAmount} coins to ${clerkId}. New balance: ${newBalance}`);
  } catch (err) {
    console.error("[Webhook] Failed to credit coin pack:", err);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
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

  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

  // Verify webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig || "", signingSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  // Process event
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      console.log("Checkout completed:", session.id, "Email:", session.customer_email);
      const meta = session.metadata || {};
      const coinAmount = parseInt(meta.coin_amount || "0", 10);
      const clerkId = meta.clerk_id;
      if (coinAmount > 0 && clerkId) {
        await creditCoinPack(clerkId, coinAmount, session.id);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      console.log("Subscription:", sub.id, "Status:", sub.status);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      console.log("Subscription cancelled:", sub.id);
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log("Payment succeeded:", invoice.id);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      console.log("Payment failed:", invoice.id);
      break;
    }
    default:
      console.log("Unhandled event:", event.type);
  }

  return NextResponse.json({ received: true });
}
