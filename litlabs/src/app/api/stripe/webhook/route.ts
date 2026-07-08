// Stripe webhook handler — credits wallet on coin pack purchases
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";

// Map Stripe product IDs to plan tiers. Add more as you create them.
const PRODUCT_TO_PLAN: Record<string, string> = {
  prod_UqLClkd2zQbOBc: "basic",
  prod_UoIJ3gU5CzKIWn: "elite",
};

function planFromSubscription(sub: Stripe.Subscription): string {
  const item = sub.items?.data?.[0];
  const productId =
    typeof item?.price?.product === "string"
      ? item.price.product
      : item?.price?.product?.id;
  if (productId && PRODUCT_TO_PLAN[productId]) {
    return PRODUCT_TO_PLAN[productId];
  }
  const nickname = item?.price?.nickname;
  if (nickname) return nickname.toLowerCase();
  return "pro";
}

async function creditCoinPack(
  clerkId: string,
  coinAmount: number,
  sessionId: string,
) {
  if (!isAdminSupabaseConfigured()) {
    return;
  }
  const sb = getAdminSupabase();
  const { data: user, error: userError } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  if (userError || !user) {
    // Throw so the webhook returns non-2xx and Stripe retries — the user
    // record may not exist yet due to a race with Clerk sync, and silently
    // returning would drop the purchased coins for good.
    throw new Error(
      `Cannot credit coins: user ${clerkId} not found (${userError?.message ?? "no row"})`,
    );
  }
  const { data: wallet, error: walletError } = await sb
    .from("wallets")
    .select("balance")
    .eq("user_id", user.id)
    .maybeSingle();
  // A read failure must not be treated as a zero balance — that would wipe
  // the user's existing coins on the subsequent update.
  if (walletError) {
    throw new Error(`Failed to read wallet balance: ${walletError.message}`);
  }
  const currentBalance = wallet?.balance || 0;
  const newBalance = currentBalance + coinAmount;
  // Upsert so a missing wallet row is created rather than silently updating
  // zero rows (which would drop the credited coins).
  const { error: updateError } = await sb.from("wallets").upsert(
    {
      user_id: user.id,
      balance: newBalance,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (updateError) {
    throw new Error(`Failed to credit wallet: ${updateError.message}`);
  }
  const { error: txError } = await sb.from("transactions").insert({
    user_id: user.id,
    type: "purchase",
    amount: coinAmount,
    balance_after: newBalance,
    description: `Purchased ${coinAmount} LiTBit Coins via Stripe`,
    metadata: { stripe_session_id: sessionId },
  });
  if (txError) {
    throw new Error(`Failed to record purchase transaction: ${txError.message}`);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = process.env.STRIPE_SECRET_KEY;

  if (!key) {
    return NextResponse.json({ error: "No secret key" }, { status: 500 });
  }

  if (!signingSecret) {
    return NextResponse.json({ error: "No webhook secret" }, { status: 500 });
  }

  const stripe = new Stripe(key, { apiVersion: "2025-08-27.basil" });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig || "", signingSecret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[stripe/webhook] Signature verification failed:", message);
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 },
    );
  }

  const sb = isAdminSupabaseConfigured() ? getAdminSupabase() : null;

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
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
        if (!sb) break;
        const sub = event.data.object as Stripe.Subscription;
        const subMeta = sub.metadata || {};
        const subClerkId = subMeta.clerk_id;
        let subUserId: string | null = null;
        if (subClerkId) {
          const { data: subUser } = await sb
            .from("users")
            .select("id")
            .eq("clerk_id", subClerkId)
            .single();
          subUserId = subUser?.id ?? null;
        }
        if (!subUserId && sub.customer && typeof sub.customer === "object") {
          const { data: subMatch } = await sb
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_customer_id", (sub.customer as Stripe.Customer).id)
            .single();
          subUserId = subMatch?.user_id ?? null;
        }
        if (subUserId) {
          const { error: upsertError } = await sb.from("subscriptions").upsert(
            {
              user_id: subUserId,
              stripe_customer_id:
                typeof sub.customer === "string"
                  ? sub.customer
                  : sub.customer?.id,
              stripe_subscription_id: sub.id,
              plan: planFromSubscription(sub),
              status: sub.status,
              current_period_start: sub.items?.data?.[0]?.current_period_start
                ? new Date(sub.items.data[0].current_period_start * 1000).toISOString()
                : null,
              current_period_end: sub.items?.data?.[0]?.current_period_end
                ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id", ignoreDuplicates: false },
          );
          if (upsertError) {
            throw new Error(
              `Failed to upsert subscription: ${upsertError.message}`,
            );
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        if (!sb) break;
        const delSub = event.data.object as Stripe.Subscription;
        const { data: delMatch } = await sb
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", delSub.id)
          .single();
        if (delMatch) {
          const { error: delError } = await sb
            .from("subscriptions")
            .update({
              status: "canceled",
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", delMatch.user_id);
          if (delError) {
            throw new Error(
              `Failed to mark subscription canceled: ${delError.message}`,
            );
          }
        }
        break;
      }

      case "invoice.payment_succeeded": {
        if (!sb) break;
        const inv = event.data.object as Stripe.Invoice;
        const invSubId = inv.parent?.subscription_details?.subscription;
        if (invSubId && typeof invSubId === "string") {
          const { data: invMatch } = await sb
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_subscription_id", invSubId)
            .single();
          if (invMatch) {
            const { error: invError } = await sb
              .from("subscriptions")
              .update({
                status: "active",
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", invMatch.user_id);
            if (invError) {
              throw new Error(
                `Failed to mark subscription active: ${invError.message}`,
              );
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        if (!sb) break;
        const failInv = event.data.object as Stripe.Invoice;
        const failSubId = failInv.parent?.subscription_details?.subscription;
        if (failSubId && typeof failSubId === "string") {
          const { data: failMatch } = await sb
            .from("subscriptions")
            .select("user_id")
            .eq("stripe_subscription_id", failSubId)
            .single();
          if (failMatch) {
            const { error: failError } = await sb
              .from("subscriptions")
              .update({
                status: "past_due",
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", failMatch.user_id);
            if (failError) {
              throw new Error(
                `Failed to mark subscription past_due: ${failError.message}`,
              );
            }
          }
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[stripe/webhook] Error processing ${event.type}:`, err);
    // Return a non-2xx so Stripe retries delivery. Previously this returned
    // 200 and the failed side effect (e.g. coin credit) was lost silently.
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to process ${event.type}: ${message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
