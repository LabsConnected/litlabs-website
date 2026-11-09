// Stripe webhook handler — idempotent event processing, plan-based credit grants
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { PLANS, getStripePriceId, type PlanId } from "@/config/plans";
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

/**
 * Resolve a plan from a Stripe price ID using the configured STRIPE_PRICE_*
 * env vars (via PLANS + getStripePriceId). Returns null when the price is
 * unknown/unconfigured — callers fall back to subscription metadata.
 *
 * This is the entitlement source of truth for portal plan changes: an
 * upgrade/downgrade in the Stripe customer portal swaps the subscription's
 * price without touching checkout-time metadata.
 */
function planIdForStripePrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const plan of Object.values(PLANS)) {
    if (getStripePriceId(plan) === priceId) return plan.id;
  }
  return null;
}

/** The price actually billed on an invoice's primary line (basil shape). */
function invoiceLinePriceId(inv: Stripe.Invoice): string | null {
  const priceId = inv.lines?.data?.[0]?.pricing?.price_details?.price;
  return typeof priceId === "string" && priceId ? priceId : null;
}

interface RefundContext {
  clerkId?: string;
  /** Plan id claimed by checkout/invoice/PI metadata (never price-derived). */
  metaPlanId?: PlanId;
  /** Effective plan for sizing the credit debit. */
  planId?: PlanId | null;
  productType?: string;
  coinAmount?: number;
  /** Stripe subscription id when the charge paid a subscription invoice. */
  subscriptionId?: string | null;
  /** Internal user id resolved from the subscriptions row, when found. */
  userId?: string | null;
}

function metaString(
  meta: Record<string, string | undefined> | null | undefined,
  key: string,
): string | undefined {
  const v = meta?.[key];
  return typeof v === "string" && v ? v : undefined;
}

/**
 * The Stripe subscription id behind an invoice, tolerating both the basil
 * `parent.subscription_details.subscription` shape and the legacy
 * `invoice.subscription` field (string id or expanded object).
 */
function subscriptionIdFromInvoice(inv: Stripe.Invoice): string | null {
  const parentSub = inv.parent?.subscription_details?.subscription;
  const candidate =
    parentSub ??
    (inv as unknown as { subscription?: string | Stripe.Subscription | null })
      .subscription ??
    null;
  if (!candidate) return null;
  return typeof candidate === "string" ? candidate : candidate.id ?? null;
}

/**
 * Resolve what a refunded charge actually purchased.
 *
 * In the Basil API, Charge.invoice / PaymentIntent.invoice no longer exist —
 * the PaymentIntent → InvoicePayment → Invoice chain is the supported link.
 * Subscription invoice charges do NOT carry checkout metadata either: the
 * reliable path is payment_intent → invoicePayments → invoice
 * .subscription_details → the subscriptions row keyed by
 * stripe_subscription_id. One-time charges (Founder, credit packs) carry
 * their metadata on the PaymentIntent. Charge metadata is still read first
 * for legacy/direct flows.
 *
 * Stripe lookups are allowed to throw: a transient failure returns 500 so
 * Stripe redelivers the refund event instead of silently dropping it.
 */
async function resolveRefundContext(
  sb: NonNullable<ReturnType<typeof getAdminSupabase>>,
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<RefundContext> {
  const meta = (charge.metadata || {}) as Record<string, string | undefined>;
  const coinFrom = (v: string | undefined) => {
    if (!v) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const ctx: RefundContext = {
    clerkId: metaString(meta, "clerk_id"),
    metaPlanId: metaString(meta, "plan_id") as PlanId | undefined,
    productType: metaString(meta, "product_type"),
    coinAmount: coinFrom(metaString(meta, "coin_amount")),
    subscriptionId: null,
    userId: null,
  };

  const piRef = charge.payment_intent;
  const piId = typeof piRef === "string" ? piRef : piRef?.id ?? null;

  // PaymentIntent → InvoicePayment → Invoice. A PI can settle multiple
  // invoices (partial payments); prefer the first that pins a subscription.
  if (piId) {
    const ipList = await stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: piId },
      expand: ["data.invoice"],
      limit: 3,
    });
    let inv: Stripe.Invoice | null = null;
    for (const ip of ipList.data ?? []) {
      const invRef = ip.invoice;
      let candidate: Stripe.Invoice | null = null;
      if (typeof invRef === "string") {
        candidate = await stripe.invoices.retrieve(invRef);
      } else if (
        invRef &&
        typeof invRef === "object" &&
        !("deleted" in invRef && invRef.deleted)
      ) {
        candidate = invRef as Stripe.Invoice;
      }
      if (!candidate) continue;
      inv = candidate;
      if (subscriptionIdFromInvoice(candidate)) break;
    }

    if (inv) {
      const invMeta = (inv.parent?.subscription_details?.metadata ??
        {}) as Record<string, string | undefined>;
      ctx.subscriptionId = subscriptionIdFromInvoice(inv);
      ctx.clerkId ??= metaString(invMeta, "clerk_id");
      ctx.metaPlanId ??= metaString(invMeta, "plan_id") as PlanId | undefined;
      ctx.productType ??= metaString(invMeta, "product_type");
      ctx.coinAmount ??= coinFrom(metaString(invMeta, "coin_amount"));

      // The billed line price is the entitlement truth for this cycle; the
      // stored plan is the fallback when the price is not one we sell.
      const billedPlanId = planIdForStripePrice(invoiceLinePriceId(inv));
      if (ctx.subscriptionId) {
        const { data: subRow } = await sb
          .from("subscriptions")
          .select("user_id, plan")
          .eq("stripe_subscription_id", ctx.subscriptionId)
          .maybeSingle();
        if (subRow) {
          ctx.userId = subRow.user_id;
          ctx.planId =
            billedPlanId ??
            ((subRow.plan as PlanId | undefined) || null) ??
            ctx.metaPlanId ??
            null;
        } else {
          ctx.planId = billedPlanId ?? ctx.metaPlanId ?? null;
        }
      } else {
        ctx.planId = billedPlanId ?? ctx.metaPlanId ?? null;
      }
    }
  }

  // One-time charges are not linked to any invoice — their metadata lives
  // on the PaymentIntent. Fetch it only when what we have so far cannot
  // classify the purchase.
  const needsPiLookup =
    !!piId &&
    (!ctx.clerkId ||
      !ctx.productType ||
      (ctx.productType === "plan" && !ctx.metaPlanId && !ctx.planId) ||
      (ctx.productType === "credit_pack" && !ctx.coinAmount));
  if (needsPiLookup) {
    const pi = await stripe.paymentIntents.retrieve(piId);
    const piMeta = (pi.metadata || {}) as Record<string, string | undefined>;
    ctx.productType ??= metaString(piMeta, "product_type");
    ctx.clerkId ??= metaString(piMeta, "clerk_id");
    ctx.metaPlanId ??= metaString(piMeta, "plan_id") as PlanId | undefined;
    ctx.coinAmount ??= coinFrom(metaString(piMeta, "coin_amount"));
  }

  ctx.planId ??= ctx.metaPlanId ?? null;
  return ctx;
}

/**
 * Debit LiTTBits for a refunded charge.
 *
 * Each embedded Stripe refund object gets its own ledger idempotency key so
 * multiple partial refunds each debit their own prorated share exactly
 * once; when the refund list is not embedded, fall back to the cumulative
 * amount_refunded under the charge-level key (the pre-hardening behavior).
 * Debit failures are logged but not thrown — entitlement revocation is the
 * critical side effect and the ledger may legitimately refuse a debit when
 * the balance was already spent.
 */
async function debitRefundedCredits(
  sb: NonNullable<ReturnType<typeof getAdminSupabase>>,
  userId: string,
  creditsBase: number,
  charge: Stripe.Charge,
): Promise<void> {
  if (charge.amount <= 0 || creditsBase <= 0) return;
  const embedded = charge.refunds?.data ?? [];
  const attempts: { amount: number; key: string }[] = [];
  if (embedded.length > 0) {
    for (const r of embedded) {
      attempts.push({
        amount: Math.round((r.amount / charge.amount) * creditsBase),
        key: `refund_${r.id}`,
      });
    }
  } else if (charge.amount_refunded > 0) {
    attempts.push({
      amount: Math.round((charge.amount_refunded / charge.amount) * creditsBase),
      key: `refund_${charge.id}`,
    });
  }
  for (const a of attempts) {
    if (a.amount <= 0) continue;
    try {
      const { error } = await sb.rpc("debit_credits", {
        p_user_id: userId,
        p_amount: a.amount,
        p_category: "refund",
        p_description: `Refund for charge ${charge.id}`,
        p_idempotency_key: a.key,
      });
      if (error) {
        console.warn(
          `[stripe.webhook] refund debit failed for charge ${charge.id}: ${error.message}`,
        );
      }
    } catch (err) {
      console.warn(
        `[stripe.webhook] refund debit threw for charge ${charge.id}:`,
        err,
      );
    }
  }
}

async function creditCreditPack(
  clerkId: string,
  creditAmount: number,
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
    .maybeSingle();
  if (userError) {
    // Do not mark a paid event processed while its recipient is unknown.
    // A redelivery uses the same grant idempotency key after DB recovery.
    throw new Error("Credit-pack user lookup failed");
  }
  if (!user) {
    // No entitlement target — permanent condition, do not retry.
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
    // A failed grant must be detectable AND safely retryable: throwing
    // makes the route return 500 so Stripe redelivers the event, and the
    // creditpack_<sessionId> idempotency key prevents duplicate credits
    // on redelivery. Silently recording "processed" here would under-grant
    // a paid purchase with no retry path.
    throw new Error(`grant_credits failed: ${error.message}`);
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
  const { error } = await sb.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: plan.monthlyCredits,
    p_category: "subscription_grant",
    p_balance_bucket: "monthly",
    p_description: `${plan.name} monthly grant — ${plan.monthlyCredits} LiTTBits`,
    p_idempotency_key: idempotencyKey,
    p_reference_type: "subscription",
    p_expires_at: expiresAt ?? undefined,
  });
  if (error) {
    // Same contract as creditCreditPack: fail the event (500 → Stripe
    // retry) rather than silently under-grant; the invoice_grant_<inv>
    // idempotency key dedupes any redelivery.
    throw new Error(`grant_credits failed: ${error.message}`);
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
        const metaPlanId = (subMeta.plan_id as PlanId) || null;
        // Portal upgrades/downgrades change the subscription's price without
        // touching checkout-time metadata — resolve the plan from the billed
        // price first, falling back to metadata only when the price is unknown.
        const subPlanId =
          planIdForStripePrice(sub.items?.data?.[0]?.price?.id) ?? metaPlanId;
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
        const subDetails = inv.parent?.subscription_details;
        const invSubId = subDetails?.subscription;
        if (invSubId && typeof invSubId === "string") {
          const { data: invMatch } = await sb
            .from("subscriptions")
            .select("user_id, plan")
            .eq("stripe_subscription_id", invSubId)
            .single();
          let grantUserId: string | null = invMatch?.user_id ?? null;
          let grantPlanId: PlanId | null =
            (invMatch?.plan as PlanId | undefined) ?? null;
          // The billed line price is the entitlement truth for this cycle:
          // a portal upgrade/downgrade can land here before
          // customer.subscription.updated is processed, so remap from the
          // price and fall back to the stored plan only when it is unknown.
          const billedPlanId = planIdForStripePrice(invoiceLinePriceId(inv));
          if (billedPlanId) grantPlanId = billedPlanId;
          if (!invMatch) {
            // First-cycle race: Stripe can deliver invoice.paid before
            // customer.subscription.created writes the row. Resolve the owner
            // from the subscription metadata propagated onto the invoice,
            // fetch the subscription only when that metadata is incomplete,
            // and upsert the same row the subscription handler would have —
            // then grant. Without this the first billing period is lost.
            const invMeta = (subDetails?.metadata ?? {}) as Record<
              string,
              string | undefined
            >;
            let clerkId = invMeta.clerk_id;
            let planId = (invMeta.plan_id as PlanId | undefined) ?? null;
            let fetchedSub: Stripe.Subscription | null = null;
            if (!clerkId || !planId) {
              try {
                fetchedSub = await stripe.subscriptions.retrieve(invSubId);
              } catch {
                fetchedSub = null;
              }
              clerkId ??= fetchedSub?.metadata?.clerk_id;
              planId ??=
                planIdForStripePrice(fetchedSub?.items?.data?.[0]?.price?.id) ??
                (fetchedSub?.metadata?.plan_id as PlanId | undefined) ??
                null;
            }
            if (clerkId) {
              const { data: invUser } = await sb
                .from("users")
                .select("id")
                .eq("clerk_id", clerkId)
                .single();
              if (invUser?.id) {
                grantUserId = invUser.id;
                grantPlanId = billedPlanId ?? planId ?? "creator_beta";
                const item = fetchedSub?.items?.data?.[0];
                const linePeriod = inv.lines?.data?.[0]?.period;
                await sb.from("subscriptions").upsert(
                  {
                    user_id: invUser.id,
                    stripe_customer_id:
                      typeof inv.customer === "string"
                        ? inv.customer
                        : (inv.customer as Stripe.Customer | null)?.id ?? null,
                    stripe_subscription_id: invSubId,
                    plan: grantPlanId,
                    status: fetchedSub?.status ?? "active",
                    current_period_start: item?.current_period_start
                      ? new Date(item.current_period_start * 1000).toISOString()
                      : linePeriod?.start
                        ? new Date(linePeriod.start * 1000).toISOString()
                        : null,
                    current_period_end: item?.current_period_end
                      ? new Date(item.current_period_end * 1000).toISOString()
                      : linePeriod?.end
                        ? new Date(linePeriod.end * 1000).toISOString()
                        : null,
                    updated_at: new Date().toISOString(),
                  },
                  { onConflict: "user_id", ignoreDuplicates: false },
                );
              }
            }
          }
          if (grantUserId) {
            await sb
              .from("subscriptions")
              .update({
                status: "active",
                // When the billed price resolved, write the remapped plan
                // back so the stored entitlement matches what was paid.
                ...(billedPlanId ? { plan: billedPlanId } : {}),
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", grantUserId);
            // Invoice payment is the only source of subscription grants. This
            // prevents the first billing period from being granted twice.
            const planId = grantPlanId ?? "creator_beta";
            const periodEnd = inv.lines.data[0]?.period?.end;
            await grantSubscriptionCredits(
              sb,
              grantUserId,
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
        const refundMeta = charge.metadata || {};
        if (refundMeta.product_type === "agent" && paymentIntentId) {
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

        // ── Resolve the refunded purchase ──
        // Subscription invoice charges carry no checkout metadata — resolve
        // via payment_intent → invoicePayments → subscription_details →
        // subscriptions row. One-time charges resolve via PaymentIntent
        // metadata.
        const refundCtx = await resolveRefundContext(sb, stripe, charge);
        const refundPlanId = refundCtx.planId ?? null;
        const refundPlan = refundPlanId ? PLANS[refundPlanId] : undefined;
        const isCreditPack = refundCtx.productType === "credit_pack";
        const isPlanRefund =
          !isCreditPack &&
          refundPlan != null &&
          (refundCtx.productType === "plan" ||
            refundCtx.subscriptionId != null ||
            refundCtx.metaPlanId != null);

        // ── Plan / Founder refund: revoke entitlement ──
        // For plan refunds (including Founder), revoke the subscription
        // entitlement. Do NOT debit LiTTBits for Founder refunds — Founder
        // has 0 LiTTBits. For subscription plans, debit the prorated share
        // of the monthly credit grant for the refunded amount.
        if (isPlanRefund && refundPlanId && refundPlan) {
          // Resolve the internal user: the subscriptions row already carries
          // it for subscription charges; metadata/PI paths resolve via
          // clerk_id → users.
          let refundUserId = refundCtx.userId ?? null;
          if (!refundUserId && refundCtx.clerkId) {
            const { data: refundUser } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", refundCtx.clerkId)
              .maybeSingle();
            refundUserId = refundUser?.id ?? null;
          }

          // Revoke the entitlement. When the refunded charge pinned a Stripe
          // subscription, revoke exactly that subscription's row — a customer
          // who has since resubscribed keeps the NEW subscription's
          // entitlement. Metadata-only (one-time) purchases fall back to
          // user+plan matching, the pre-hardening behavior.
          const revokeBase = sb.from("subscriptions").update({
            status: "refunded",
            updated_at: new Date().toISOString(),
          });
          const { error: revokeError } = refundCtx.subscriptionId
            ? await revokeBase.eq(
                "stripe_subscription_id",
                refundCtx.subscriptionId,
              )
            : refundUserId
              ? await revokeBase
                  .eq("user_id", refundUserId)
                  .eq("plan", refundCtx.metaPlanId ?? refundPlanId)
              : { error: null };
          if (revokeError) {
            // A failed revoke must be retryable — returning 500 lets Stripe
            // redeliver instead of leaving paid access active after a refund.
            throw new Error(
              `subscription refund revoke failed: ${revokeError.message}`,
            );
          }

          if (
            refundUserId &&
            refundPlan.billingType === "subscription" &&
            refundPlan.monthlyCredits > 0
          ) {
            await debitRefundedCredits(
              sb,
              refundUserId,
              refundPlan.monthlyCredits,
              charge,
            );
          }
          break;
        }

        // ── Credit pack refund: debit LBC ──
        // Only debit LBC for credit_pack refunds — never for agents or plans.
        if (isCreditPack && refundCtx.clerkId) {
          let refundUserId = refundCtx.userId ?? null;
          if (!refundUserId) {
            const { data: refundUser } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", refundCtx.clerkId)
              .maybeSingle();
            refundUserId = refundUser?.id ?? null;
          }
          if (refundUserId && refundCtx.coinAmount) {
            await debitRefundedCredits(
              sb,
              refundUserId,
              refundCtx.coinAmount,
              charge,
            );
          }
        } else if (!isPlanRefund && !isCreditPack) {
          console.warn(
            `[stripe.webhook] charge.refunded ${charge.id}: could not classify refunded charge`,
          );
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
