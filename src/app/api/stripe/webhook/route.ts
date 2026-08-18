// Stripe webhook handler — idempotent event processing, plan-based credit grants
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { PLANS, type PlanId } from "@/config/plans";
import { confirmBookingPayment, recordAudit } from "@/lib/business-operations";

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

async function creditCreditPack(
  clerkId: string,
  creditAmount: number,
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
    // Use credit_ledger (atomic, idempotent). No legacy fallback —
    // the non-atomic read-then-write on wallets was a race condition.
    const { error } = await sb.rpc("grant_credits", {
      p_user_id: user.id,
      p_amount: creditAmount,
      p_category: "purchase",
      p_balance_bucket: "purchased",
      p_description: `Purchased ${creditAmount} LiTTBits via Stripe`,
      p_idempotency_key: `creditpack_${sessionId}`,
      p_reference_type: "stripe_checkout",
      p_reference_id: sessionId,
    });
    if (error) {
      // Credit ledger grant failed — error is captured in Supabase response
    }
  } catch {
    // Credit grant error — non-fatal, Stripe event already recorded
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
        const productType = meta.product_type;
        const clerkId = meta.clerk_id;

        // ── Agent purchase fulfillment ──
        // Marketplace agent purchases use a transactional RPC that verifies
        // the paid amount and creates the order + entitlement atomically.
        // The RPC claims the Stripe event at the start (idempotent).
        // The RPC fulfills the exact pending order created at checkout time.
        if (productType === "agent" && clerkId && sb) {
          const agentId = meta.agent_id;
          const agentVersionId = meta.agent_version_id;
          const marketplaceOrderId = meta.marketplace_order_id;
          if (!agentId || !agentVersionId || !marketplaceOrderId) {
            throw new Error("Agent purchase missing required metadata");
          }
          const amountTotal = session.amount_total ?? 0;
          const currency = session.currency ?? "usd";
          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id ?? null;
          const { error: rpcError } = await sb.rpc("fulfill_agent_purchase", {
            p_stripe_event_id: event.id,
            p_stripe_event_type: event.type,
            p_clerk_id: clerkId,
            p_agent_id: agentId,
            p_agent_version_id: agentVersionId,
            p_marketplace_order_id: marketplaceOrderId,
            p_stripe_session_id: session.id,
            p_stripe_payment_intent_id: paymentIntentId,
            p_stripe_charge_id: null,
            p_amount_cents: amountTotal,
            p_currency: currency,
          });
          if (rpcError) {
            throw new Error(`fulfill_agent_purchase failed: ${rpcError.message}`);
          }

          // ── Auto-provision the private agent instance ──
          // After creating the entitlement, create or activate the
          // user_agents row so the buyer can immediately open the agent
          // in Studio. This is idempotent — if the instance already
          // exists (e.g., from a previous install), it's reactivated.
          const { data: agentUser } = await sb
            .from("users")
            .select("id")
            .eq("clerk_id", clerkId)
            .maybeSingle();

          if (agentUser) {
            // Check if an instance already exists for this user + agent.
            const { data: existingInstance } = await sb
              .from("user_agents")
              .select("id")
              .eq("user_id", agentUser.id)
              .eq("agent_id", agentId)
              .maybeSingle();

            if (existingInstance) {
              // Reactivate the existing instance and update the version.
              await sb
                .from("user_agents")
                .update({
                  is_active: true,
                  status: "active",
                  agent_version_id: agentVersionId,
                  last_active_at: new Date().toISOString(),
                })
                .eq("id", existingInstance.id);
            } else {
              // Create a new private agent instance.
              const { data: agentTemplate } = await sb
                .from("agents")
                .select("display_name")
                .eq("id", agentId)
                .maybeSingle();

              await sb.from("user_agents").insert({
                user_id: agentUser.id,
                agent_id: agentId,
                agent_version_id: agentVersionId,
                name: agentTemplate?.display_name || "Agent",
                is_active: true,
                status: "active",
                approval_mode: "supervised",
                enabled_tools: [],
              });
            }
          }

          break;
        }

        // ── Credit pack / plan fulfillment (existing logic) ──
        const coinAmount = parseInt(meta.coin_amount || "0", 10);
        const planId = meta.plan_id as PlanId | undefined;
        if (coinAmount > 0 && clerkId) {
          await creditCreditPack(clerkId, coinAmount, session.id);
        }
        // If this was a one-time Founding Member purchase, grant permanent entitlement
        if (planId && clerkId && sb) {
          const plan = PLANS[planId];
          if (plan && plan.billingType === "one_time") {
            const { data: user } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", clerkId)
              .single();
            if (user) {
              // Founding Member: permanent Creator-level access, no monthly credits.
              // Do NOT call grantSubscriptionCredits — Founder has monthlyCredits: 0.
              // Record as a permanent entitlement (not a time-limited subscription).
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
        break;
      }

      case "checkout.session.expired": {
        // Mark the matching pending order as expired.
        // The RPC is idempotent — if the event was already processed, it returns
        // already_processed. If no pending order matches, it returns not_pending.
        if (!sb) break;
        const expiredSession = event.data.object as Stripe.Checkout.Session;
        const expiredMeta = expiredSession.metadata || {};
        const expiredOrderId = expiredMeta.marketplace_order_id;
        if (expiredOrderId && expiredMeta.product_type === "agent") {
          const { error: rpcError } = await sb.rpc("expire_pending_order", {
            p_order_id: expiredOrderId,
          });
          if (rpcError) {
            throw new Error(`expire_pending_order failed: ${rpcError.message}`);
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        // Mark the matching pending order as failed.
        // Look up by payment_intent_id first (primary), then by metadata.
        if (!sb) break;
        const failedIntent = event.data.object as Stripe.PaymentIntent;
        const failedPiId = failedIntent.id;
        // Try to find a pending order by payment intent ID
        const { data: failedOrder } = await sb
          .from("marketplace_orders")
          .select("id, status")
          .eq("stripe_payment_intent_id", failedPiId)
          .eq("status", "pending")
          .maybeSingle();
        if (failedOrder) {
          await sb
            .from("marketplace_orders")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", failedOrder.id);
        }
        break;
      }

      case "payment_intent.succeeded": {
        // ── Booking payment confirmation ──
        // Confirms a business booking after Stripe payment succeeds.
        // Only pending/pending_payment bookings are confirmed (idempotent —
        // already-confirmed bookings are NOT re-confirmed).
        // The booking_id and owner_id are passed via PaymentIntent metadata.
        const pi = event.data.object as Stripe.PaymentIntent;
        const piMeta = pi.metadata || {};
        const bookingId = piMeta.booking_id as string | undefined;
        const bookingOwnerId = piMeta.owner_id as string | undefined;
        if (bookingId && bookingOwnerId) {
          const result = await confirmBookingPayment(bookingOwnerId, bookingId, pi.id);
          void recordAudit({
            ownerId: bookingOwnerId,
            toolId: "stripe.webhook",
            action: "payment_intent.succeeded",
            targetId: bookingId,
            afterState: result.ok ? (result.data as unknown as Record<string, unknown>) : undefined,
            result: result.ok ? "success" : "error",
            errorMessage: result.error,
          });
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
        const refundProductType = refundMeta.product_type;
        const refundClerkId = refundMeta.clerk_id;
        const paymentIntentId = charge.payment_intent as string | undefined;

        // ── Agent refund: revoke entitlement, do NOT debit LBC ──
        // Primary lookup: search marketplace_orders by payment_intent_id.
        // This works even when Stripe metadata is absent, delayed, or incomplete.
        // Secondary evidence: metadata product_type === "agent".
        if (paymentIntentId) {
          const { data: agentOrder } = await sb
            .from("marketplace_orders")
            .select("id, status")
            .eq("stripe_payment_intent_id", paymentIntentId)
            .maybeSingle();

          if (agentOrder) {
            // Found a matching marketplace order — process as agent refund.
            // The RPC is idempotent (claims the Stripe event atomically).
            // It does NOT debit LBC — agent purchases are not credit packs.
            const { error: rpcError } = await sb.rpc("refund_agent_purchase", {
              p_stripe_event_id: event.id,
              p_stripe_event_type: event.type,
              p_stripe_payment_intent_id: paymentIntentId,
              p_stripe_refund_id: charge.refunds?.data?.[0]?.id ?? null,
            });
            if (rpcError) {
              throw new Error(`refund_agent_purchase failed: ${rpcError.message}`);
            }
            break;
          }
        }

        // Fallback: use metadata product_type as secondary evidence
        if (refundProductType === "agent" && paymentIntentId) {
          const { error: rpcError } = await sb.rpc("refund_agent_purchase", {
            p_stripe_event_id: event.id,
            p_stripe_event_type: event.type,
            p_stripe_payment_intent_id: paymentIntentId,
            p_stripe_refund_id: charge.refunds?.data?.[0]?.id ?? null,
          });
          if (rpcError) {
            throw new Error(`refund_agent_purchase failed: ${rpcError.message}`);
          }
          break;
        }

        // ── Plan / Founder refund: revoke entitlement ──
        // For plan refunds (including Founder), revoke the subscription
        // entitlement. Do NOT debit LiTTBits for Founder refunds — Founder
        // has 0 LiTTBits. For subscription plans, the credits were already
        // consumed; revoking access is the correct action.
        const refundPlanId = refundMeta.plan_id as PlanId | undefined;
        if (refundPlanId && refundClerkId) {
          const plan = PLANS[refundPlanId];
          if (plan) {
            const { data: refundUser } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", refundClerkId)
              .single();
            if (refundUser) {
              // Revoke the subscription/entitlement
              await sb
                .from("subscriptions")
                .update({
                  status: "refunded",
                  updated_at: new Date().toISOString(),
                })
                .eq("user_id", refundUser.id)
                .eq("plan", refundPlanId);

              // Do NOT debit LiTTBits for plan refunds (subscription OR
              // one_time). Subscription credits were already consumed
              // during the billing period — revoking access via status
              // "refunded" is the correct enforcement, not a credit
              // debit. Founder has 0 LiTTBits by definition. Debiting an
              // arbitrary dollar amount (amount_refunded/100) as LiTTBits
              // would be wrong accounting — LiTTBits are not 1:1 with USD
              // cents (6000 credits = $15, i.e. ~400 credits/dollar).
            }
          }
          break;
        }

        // ── Credit pack refund: debit the proportional LiTTBits share ──
        // Only debit for credit_pack refunds — never for agents or plans.
        // The total LiTTBits granted is carried in the charge metadata as
        // coin_amount (set at checkout time). LiTTBits are NOT 1:1 with
        // USD cents (6000 credits = $15, i.e. ~400 credits/dollar), so we
        // never derive LiTTBits directly from cents. Instead we claw back
        // the SAME PROPORTION of LiTTBits as the refund bears to the
        // original charge:
        //   debitLiTTBits = round(coinAmount * refundAmount / chargeAmount)
        // A full refund (refundAmount === chargeAmount) debits exactly
        // coinAmount. A partial refund debits only its proportional share,
        // so a 50% refund of a 2,000-LiTTBits pack debits 1,000 — never
        // the full 2,000.
        //
        // ── Refund amount + identity resolution (event-identity safe) ──
        // The charge.refunded event carries a Charge object (NOT a Refund).
        // Stripe's docs recommend "Listen to refund.created for information
        // about the refund." Since we handle charge.refunded, we must
        // resolve the triggering refund's amount without relying on
        // refunds.data[0] being the triggering refund.
        //
        // PRIMARY: event.data.previous_attributes.amount_refunded delta.
        //   The Charge's amount_refunded is cumulative. previous_attributes
        //   captures the cumulative total BEFORE this event, so:
        //     refundAmount = charge.amount_refunded - previous.amount_refunded
        //   This is the EXACT amount of the triggering refund — immune to
        //   concurrent partial-refund races where refunds.data[0] might be
        //   a newer, different refund. The idempotency key uses event.id
        //   (each charge.refunded event = exactly one refund, so event.id
        //   is per-refund and race-free).
        //
        // FALLBACK: charge.refunds.data[0].amount (most-recent refund).
        //   Used when previous_attributes is absent (older API versions or
        //   edge cases). Under normal sequential processing data[0] IS the
        //   triggering refund. Idempotency key uses refunds.data[0].id.
        //
        // NEVER: charge.amount_refunded alone (cumulative — would re-debit
        //   the full cumulative total on every event, the old over-debit
        //   bug). If neither source is available, fall back to the full
        //   coinAmount as a safe default (preserves prior behavior for
        //   malformed events — conservative over-debit is recoverable).
        if (refundProductType === "credit_pack" && refundClerkId) {
          const coinAmount = parseInt(refundMeta.coin_amount || "0", 10);
          if (coinAmount > 0) {
            const { data: refundUser } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", refundClerkId)
              .single();
            if (refundUser) {
              const chargeAmount = charge.amount ?? 0;
              const latestRefund = charge.refunds?.data?.[0];

              // Resolve the triggering refund's amount + identity.
              const prevAttrs = event.data.previous_attributes as
                | Partial<Stripe.Charge>
                | undefined;
              const prevAmountRefunded = prevAttrs?.amount_refunded;
              const hasPrevDelta =
                typeof prevAmountRefunded === "number" &&
                typeof charge.amount_refunded === "number";
              const deltaAmount = hasPrevDelta
                ? (charge.amount_refunded as number) -
                  (prevAmountRefunded as number)
                : undefined;

              // PRIMARY: previous_attributes delta (race-free).
              // FALLBACK: refunds.data[0].amount (most-recent refund).
              // NEVER: charge.amount_refunded alone (cumulative).
              const refundAmount = deltaAmount ?? latestRefund?.amount;
              // Idempotency: event.id when using delta (per-refund,
              // race-free); refunds.data[0].id as fallback.
              const refundId = hasPrevDelta
                ? event.id
                : latestRefund?.id ?? event.id;

              // Proportional clawback. Fall back to the full coinAmount
              // only when the proportion cannot be determined (missing
              // charge amount or refund amount) — preserves the prior
              // full-clawback behavior as a safe default and avoids
              // under-debiting on malformed events.
              let debitAmount = coinAmount;
              if (
                chargeAmount > 0 &&
                refundAmount !== undefined &&
                refundAmount > 0
              ) {
                debitAmount = Math.round(
                  (coinAmount * refundAmount) / chargeAmount,
                );
                if (debitAmount < 0) debitAmount = 0;
                if (debitAmount > coinAmount) debitAmount = coinAmount;
              }
              if (debitAmount > 0) {
                try {
                  await sb.rpc("debit_credits", {
                    p_user_id: refundUser.id,
                    p_amount: debitAmount,
                    p_category: "refund",
                    p_description: `Refund for charge ${charge.id}`,
                    p_idempotency_key: `refund_${refundId}`,
                  });
                } catch {
                  // Ledger not available — skip
                }
              }
            }
          }
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
