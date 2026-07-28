// Stripe webhook handler — idempotent event processing, plan-based credit grants
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { PLANS, type PlanId } from "@/config/plans";

async function isEventProcessed(sb: NonNullable<ReturnType<typeof getAdminSupabase>>, eventId: string): Promise<boolean> {
  const { data } = await sb
    .from("stripe_events")
    .select("id")
    .eq("stripe_event_id", eventId)
    .single();
  return !!data;
}

async function markEventProcessed(
  sb: NonNullable<ReturnType<typeof getAdminSupabase>>,
  eventId: string,
  eventType: string,
  result: string,
): Promise<void> {
  await sb.from("stripe_events").insert({
    stripe_event_id: eventId,
    event_type: eventType,
    result,
  });
}

async function creditCoinPack(
  clerkId: string,
  coinAmount: number,
  sessionId: string,
) {
  if (!isAdminSupabaseConfigured()) {
    return;
  }
  try {
    const sb = getAdminSupabase();
    const { data: user } = await sb
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) {
      return;
    }
    // Try credit_ledger first (new system)
    try {
      await sb.rpc("grant_credits", {
        p_user_id: user.id,
        p_amount: coinAmount,
        p_category: "purchase",
        p_balance_bucket: "purchased",
        p_description: `Purchased ${coinAmount} LiTTBits via Stripe`,
        p_idempotency_key: `coinpack_${sessionId}`,
        p_reference_type: "stripe_checkout",
        p_reference_id: sessionId,
      });
      return;
    } catch {
      // Ledger not available — fall through to legacy wallet update
    }
    const { data: wallet } = await sb
      .from("wallets")
      .select("balance")
      .eq("user_id", user.id)
      .single();
    const currentBalance = wallet?.balance || 0;
    const newBalance = currentBalance + coinAmount;
    await sb
      .from("wallets")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    await sb.from("transactions").insert({
      user_id: user.id,
      type: "purchase",
      amount: coinAmount,
      balance_after: newBalance,
      description: `Purchased ${coinAmount} LiTTBits via Stripe`,
      metadata: { stripe_session_id: sessionId, idempotency_key: `coinpack_${sessionId}` },
    });
  } catch (_err) {
  }
}

async function grantSubscriptionCredits(
  sb: NonNullable<ReturnType<typeof getAdminSupabase>>,
  userId: string,
  planId: PlanId,
  idempotencyKey: string,
  expiresAt?: string | null,
): Promise<void> {
  const plan = PLANS[planId];
  if (!plan || plan.monthlyCredits <= 0) return;
  try {
    await sb.rpc("grant_credits", {
      p_user_id: userId,
      p_amount: plan.monthlyCredits,
      p_category: "subscription_grant",
      p_balance_bucket: "monthly",
      p_description: `${plan.name} monthly grant — ${plan.monthlyCredits} LiTTBits`,
      p_idempotency_key: idempotencyKey,
      p_reference_type: "subscription",
      p_expires_at: expiresAt ?? undefined,
    });
  } catch (_err) {
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
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 },
    );
  }

  const sb = isAdminSupabaseConfigured() ? getAdminSupabase() : null;

  // Idempotency: check if event already processed
  if (sb) {
    if (await isEventProcessed(sb, event.id)) {
      return NextResponse.json({ received: true, replayed: true });
    }
  }

  const result = "processed";

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = session.metadata || {};
        const coinAmount = parseInt(meta.coin_amount || "0", 10);
        const clerkId = meta.clerk_id;
        const planId = meta.plan_id as PlanId | undefined;
        if (coinAmount > 0 && clerkId) {
          await creditCoinPack(clerkId, coinAmount, session.id);
        }
        // If this was a one-time founder purchase, grant credits
        if (planId && clerkId && sb) {
          const plan = PLANS[planId];
          if (plan && plan.billingType === "one_time") {
            const { data: user } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", clerkId)
              .single();
            if (user) {
              await grantSubscriptionCredits(sb, user.id, planId, `founder_${session.id}`);
              // Record as a permanent subscription
              await sb.from("subscriptions").upsert({
                user_id: user.id,
                stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
                plan: planId,
                status: "active",
                updated_at: new Date().toISOString(),
              }, { onConflict: "user_id", ignoreDuplicates: false });
            }
          }
        }
        // Marketplace agent purchase — call Postgres RPC for transactional fulfillment
        const agentVersionId = meta.agent_version_id;
        const agentSlug = meta.agent_slug;
        if (agentVersionId && agentSlug && clerkId && sb) {
          const paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null;
          const { error: rpcError } = await sb.rpc("fulfill_agent_purchase", {
            p_stripe_event_id: event.id,
            p_stripe_event_type: event.type,
            p_clerk_id: clerkId,
            p_agent_version_id: agentVersionId,
            p_agent_slug: agentSlug,
            p_stripe_session_id: session.id,
            p_stripe_payment_intent_id: paymentIntentId,
            p_stripe_charge_id: null,
            p_amount_cents: session.amount_total ?? 0,
            p_currency: session.currency ?? "usd",
          });
          if (rpcError) {
            // RPC failed — do not mark event as processed; Stripe will retry
            return NextResponse.json(
              { error: "Agent purchase fulfillment failed" },
              { status: 500 },
            );
          }
          // RPC already marked the event as processed internally
          return NextResponse.json({ received: true });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        if (!sb) break;
        const sub = event.data.object as Stripe.Subscription;
        const subMeta = sub.metadata || {};
        const subClerkId = subMeta.clerk_id;
        const subPlanId = (subMeta.plan_id as PlanId) || null;
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
          const planId: PlanId = subPlanId ?? "creator_beta";
          await sb.from("subscriptions").upsert(
            {
              user_id: subUserId,
              stripe_customer_id:
                typeof sub.customer === "string"
                  ? sub.customer
                  : sub.customer?.id,
              stripe_subscription_id: sub.id,
              plan: planId,
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
          await sb
            .from("subscriptions")
            .update({
              status: "canceled",
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", delMatch.user_id);
        }
        break;
      }

      case "invoice.paid": {
        if (!sb) break;
        const inv = event.data.object as Stripe.Invoice;
        const invSubId = inv.parent?.subscription_details?.subscription;
        if (invSubId && typeof invSubId === "string") {
          const { data: invMatch } = await sb
            .from("subscriptions")
            .select("user_id, plan")
            .eq("stripe_subscription_id", invSubId)
            .single();
          if (invMatch) {
            await sb
              .from("subscriptions")
              .update({
                status: "active",
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", invMatch.user_id);
            // Invoice payment is the only source of subscription grants. This
            // prevents the first billing period from being granted twice.
            const planId = (invMatch.plan as PlanId) || "creator_beta";
            const periodEnd = inv.lines.data[0]?.period?.end;
            await grantSubscriptionCredits(
              sb,
              invMatch.user_id,
              planId,
              `invoice_grant_${inv.id}`,
              periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            );
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
            await sb
              .from("subscriptions")
              .update({
                status: "past_due",
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", failMatch.user_id);
          }
        }
        break;
      }

      case "charge.refunded": {
        if (!sb) break;
        const charge = event.data.object as Stripe.Charge;
        const refundMeta = charge.metadata || {};
        const refundClerkId = refundMeta.clerk_id;
        if (refundClerkId) {
          const { data: refundUser } = await sb
            .from("users")
            .select("id")
            .eq("clerk_id", refundClerkId)
            .single();
          if (refundUser) {
            // Debit the refunded amount from purchased balance via ledger
            try {
              await sb.rpc("debit_credits", {
                p_user_id: refundUser.id,
                // Stripe amount is in cents; convert to LiTTBits (1:1 with USD cents in this system).
                p_amount: charge.amount_refunded / 100,
                p_category: "refund",
                p_description: `Refund for charge ${charge.id}`,
                p_idempotency_key: `refund_${charge.id}`,
              });
            } catch {
              // Ledger not available — skip
            }
          }
        }
        // Marketplace agent refund — call Postgres RPC for transactional revocation
        const paymentIntentId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : null;
        if (paymentIntentId && sb) {
          const refundId = charge.refunds?.data[0]?.id ?? null;
          const { error: rpcError } = await sb.rpc("refund_agent_purchase", {
            p_stripe_event_id: event.id,
            p_stripe_event_type: event.type,
            p_stripe_payment_intent_id: paymentIntentId,
            p_stripe_refund_id: refundId,
          });
          if (rpcError) {
            return NextResponse.json(
              { error: "Agent refund processing failed" },
              { status: 500 },
            );
          }
          return NextResponse.json({ received: true });
        }
        break;
      }
    }
  } catch (_err) {
    // Do not acknowledge or record failed events. Stripe must retry them.
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }

  // Mark event as processed (idempotency)
  if (sb) {
    try {
      await markEventProcessed(sb, event.id, event.type, result);
    } catch {
      // Non-fatal if we can't record the event
    }
  }

  return NextResponse.json({ received: true });
}
