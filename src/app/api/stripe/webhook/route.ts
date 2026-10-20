// Stripe webhook handler — idempotent event processing, plan-based credit grants
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { PLANS, type PlanId } from "@/config/plans";
import { confirmBookingPayment, recordAudit } from "@/lib/business-operations";

type SbAdmin = NonNullable<ReturnType<typeof getAdminSupabase>>;

/**
 * A "processing" claim older than this is assumed abandoned — the holder's
 * function crashed, timed out, or was killed before reaching the catch
 * block, so the claim was never marked "failed" and would otherwise block
 * this event forever while telling Stripe (via a 200 "replayed" response on
 * retry) that nothing further needs to happen. Generous relative to typical
 * serverless function timeouts; still well inside Stripe's retry window.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;

function isStaleProcessingClaim(existing: { result: string; processed_at: string }): boolean {
  return (
    existing.result === "processing" &&
    Date.now() - new Date(existing.processed_at).getTime() > STALE_CLAIM_MS
  );
}

/**
 * Atomically claim a Stripe event for processing.
 *
 * The prior check-then-insert pattern raced: two concurrent deliveries of
 * the same event both passed the SELECT and both processed, producing
 * duplicate side effects. stripe_events.stripe_event_id is UNIQUE, so the
 * INSERT itself is the claim — a duplicate-key error means another
 * delivery holds or completed it.
 *
 * Outcomes:
 *   "claimed"      — this delivery owns the event; process it.
 *   "processed"    — a prior delivery finished; acknowledge, do nothing.
 *   "claimed-else" — another delivery owns or is processing it; ack.
 *   "unclaimable"  — the claim could not be made; Stripe must retry (500).
 */
async function claimStripeEvent(
  sb: SbAdmin,
  eventId: string,
  eventType: string,
): Promise<"claimed" | "processed" | "claimed-else" | "unclaimable"> {
  const { data: existing } = await sb
    .from("stripe_events")
    .select("id, result, processed_at")
    .eq("stripe_event_id", eventId)
    .maybeSingle();

  if (existing?.result === "processed") return "processed";

  if (!existing) {
    const { error } = await sb.from("stripe_events").insert({
      stripe_event_id: eventId,
      event_type: eventType,
      result: "processing",
    });
    if (!error) return "claimed";
    // 23505 = unique_violation — a concurrent delivery already claimed it.
    if ((error as { code?: string }).code === "23505") return "claimed-else";
    return "unclaimable";
  }

  if (existing.result === "failed") {
    // Retryable: reclaim only if no other delivery has beaten us to it.
    const { data: reclaimed } = await sb
      .from("stripe_events")
      .update({ result: "processing" })
      .eq("id", existing.id)
      .eq("result", "failed")
      .select("id");
    return reclaimed && reclaimed.length > 0 ? "claimed" : "claimed-else";
  }

  if (isStaleProcessingClaim(existing)) {
    // Reclaim using the observed processed_at as an optimistic-concurrency
    // token. If two deliveries race to reclaim the same stale snapshot,
    // only the first to actually commit wins: its UPDATE moves
    // processed_at forward, so the second's WHERE (pinned to the OLD
    // timestamp) no longer matches and it correctly loses the claim.
    const { data: reclaimed } = await sb
      .from("stripe_events")
      .update({ result: "processing", processed_at: new Date().toISOString() })
      .eq("id", existing.id)
      .eq("result", "processing")
      .eq("processed_at", existing.processed_at)
      .select("id");
    return reclaimed && reclaimed.length > 0 ? "claimed" : "claimed-else";
  }

  // "processing" (not yet stale) — another delivery owns it.
  return "claimed-else";
}

async function markEventProcessed(
  sb: SbAdmin,
  eventId: string,
  result: string,
): Promise<void> {
  await sb
    .from("stripe_events")
    .update({ result })
    .eq("stripe_event_id", eventId);
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

  // fulfill_agent_purchase / refund_agent_purchase atomically claim this
  // SAME stripe_events row themselves (INSERT ... ON CONFLICT DO NOTHING)
  // as their own idempotency gate. If the generic claim below also
  // inserted a row first, those RPCs would see it as already-claimed and
  // silently skip all real work (order/entitlement creation, or
  // revocation on refund) — deterministically, not just under a race. So:
  // determine up front whether this event will be handled by one of those
  // self-claiming RPCs, and if so, skip the generic claim entirely and let
  // the RPC be the sole, atomic source of truth for it.
  let agentOrderForRefund: { id: string } | null = null;
  let delegatesToSelfClaimingRpc = false;

  if (sb && event.type === "checkout.session.completed") {
    const sessionMeta = (event.data.object as Stripe.Checkout.Session).metadata || {};
    // Mirrors the exact condition the switch below uses to route to
    // fulfill_agent_purchase — checkout.session.completed has no DB-lookup
    // fallback, so metadata is authoritative here.
    delegatesToSelfClaimingRpc = sessionMeta.product_type === "agent" && !!sessionMeta.clerk_id;
  } else if (sb && event.type === "charge.refunded") {
    const refundCharge = event.data.object as Stripe.Charge;
    const refundChargeMeta = refundCharge.metadata || {};
    const refundPaymentIntentId = refundCharge.payment_intent as string | undefined;
    if (refundPaymentIntentId) {
      const { data: agentOrder } = await sb
        .from("marketplace_orders")
        .select("id")
        .eq("stripe_payment_intent_id", refundPaymentIntentId)
        .maybeSingle();
      if (agentOrder) {
        agentOrderForRefund = agentOrder as { id: string };
        delegatesToSelfClaimingRpc = true;
      }
    }
    // Metadata fallback — same secondary evidence the switch below uses.
    if (!delegatesToSelfClaimingRpc && refundChargeMeta.product_type === "agent" && refundPaymentIntentId) {
      delegatesToSelfClaimingRpc = true;
    }
  }

  // Idempotency: atomically claim the event before processing. Concurrent
  // deliveries of the same event cannot produce duplicate side effects.
  // Skipped when the event delegates to a self-claiming RPC (see above) —
  // that RPC's own claim is the sole gate for those events.
  if (sb && !delegatesToSelfClaimingRpc) {
    const claim = await claimStripeEvent(sb, event.id, event.type);
    if (claim === "unclaimable") {
      return NextResponse.json(
        { error: "Webhook processing failed" },
        { status: 500 },
      );
    }
    if (claim !== "claimed") {
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
          const { data: fulfillData, error: rpcError } = await sb.rpc("fulfill_agent_purchase", {
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

          // A prior delivery already claimed and fulfilled this event —
          // nothing new landed, so there's nothing to provision.
          if ((fulfillData as { status?: string } | null)?.status === "already_processed") {
            break;
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
        // Primary evidence: marketplace_orders matched by payment_intent_id
        // (reused from the pre-claim lookup above — this works even when
        // Stripe metadata is absent, delayed, or incomplete).
        // Secondary evidence: metadata product_type === "agent".
        if (agentOrderForRefund) {
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
        //
        // Stripe does NOT copy subscription/invoice metadata onto Charge
        // objects, so plan_id/clerk_id are absent on subscription refunds —
        // those events used to silently skip both the revocation and the
        // prorated debit. Fall back to the subscriptions row keyed by the
        // charge's customer id.
        let refundPlanId = refundMeta.plan_id as PlanId | undefined;
        let refundUserId: string | null = null;
        const chargeCustomerId =
          typeof charge.customer === "string" ? charge.customer : charge.customer?.id ?? null;

        if (!refundPlanId && chargeCustomerId) {
          const { data: refundSub } = await sb
            .from("subscriptions")
            .select("plan, user_id")
            .eq("stripe_customer_id", chargeCustomerId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (refundSub?.plan && refundSub.plan in PLANS) {
            refundPlanId = refundSub.plan as PlanId;
            refundUserId = refundSub.user_id;
          }
        }

        if (refundPlanId && (refundClerkId || refundUserId)) {
          const plan = PLANS[refundPlanId];
          if (plan) {
            const refundUser = refundUserId
              ? { id: refundUserId }
              : (
                  await sb
                    .from("users")
                    .select("id")
                    .eq("clerk_id", refundClerkId)
                    .single()
                ).data;
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

              // For one_time plans (Founder), do NOT debit LiTTBits —
              // Founder has 0 LiTTBits. For subscription plans, debit
              // a prorated amount of the monthly credit grant based on the
              // fraction of the charge that was refunded.
              if (plan.billingType === "subscription" && plan.monthlyCredits > 0 && charge.amount > 0) {
                const debitBits = Math.round(
                  (charge.amount_refunded / charge.amount) * plan.monthlyCredits,
                );
                if (debitBits > 0) {
                  try {
                    await sb.rpc("debit_credits", {
                      p_user_id: refundUser.id,
                      p_amount: debitBits,
                      p_category: "refund",
                      p_description: `Refund for charge ${charge.id}`,
                      // Per-refund key: charge.id is shared across partial
                      // refunds of one charge, which would replay as a
                      // no-op and under-debit.
                      p_idempotency_key: `refund_${charge.refunds?.data?.[0]?.id ?? `${charge.id}_${charge.amount_refunded}`}`,
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

        // ── Credit pack refund: debit LBC ──
        // Only debit LBC for credit_pack refunds — never for agents or plans.
        if (refundProductType === "credit_pack" && refundClerkId) {
          const { data: refundUser } = await sb
            .from("users")
            .select("id")
            .eq("clerk_id", refundClerkId)
            .single();
          if (refundUser) {
            // The original credit pack's LiTTBit grant is stored on the
            // PaymentIntent/Charge metadata. Debit the same fraction of
            // that grant as the refunded amount / original charge amount.
            const coinAmount = refundMeta.coin_amount
              ? parseInt(refundMeta.coin_amount, 10)
              : NaN;
            if (coinAmount > 0 && charge.amount > 0) {
              const debitBits = Math.round(
                (charge.amount_refunded / charge.amount) * coinAmount,
              );
              if (debitBits > 0) {
                try {
                  await sb.rpc("debit_credits", {
                    p_user_id: refundUser.id,
                    p_amount: debitBits,
                    p_category: "refund",
                    p_description: `Refund for charge ${charge.id}`,
                    p_idempotency_key: `refund_${charge.refunds?.data?.[0]?.id ?? `${charge.id}_${charge.amount_refunded}`}`,
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
    // Mark the claimed event failed so a Stripe retry can reclaim and
    // reprocess it (claimStripeEvent re-claims only rows in "failed").
    // Skipped when delegated: we never took the generic claim, and the
    // RPC's own claim is a single Postgres transaction — if it threw, that
    // transaction (including its claim INSERT) already rolled back, so
    // there's no row of ours to mark and nothing to undo.
    if (sb && !delegatesToSelfClaimingRpc) {
      try {
        await markEventProcessed(sb, event.id, "failed");
      } catch {
        // Non-fatal — Stripe still retries the 500.
      }
    }
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }

  // Mark event as processed (idempotency). Skipped when delegated — the
  // RPC owns that row and already recorded its own completion.
  if (sb && !delegatesToSelfClaimingRpc) {
    try {
      await markEventProcessed(sb, event.id, result);
    } catch {
      // Non-fatal if we can't record the event
    }
  }

  return NextResponse.json({ received: true });
}
