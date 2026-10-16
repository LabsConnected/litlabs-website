// Stripe webhook handler — idempotent event processing, plan-based credit grants
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  getAdminSupabase,
  isAdminSupabaseConfigured,
} from "@/lib/supabase-admin";
import { PLANS, type PlanId } from "@/config/plans";
import { confirmBookingPayment, recordAudit } from "@/lib/business-operations";

// Retry budget is 5×2s plus an 8s Stripe fallback. Stay under Stripe's
// webhook deadline so a slow grant returns 500 instead of a platform kill.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type AdminClient = NonNullable<ReturnType<typeof getAdminSupabase>>;

type DbError = { code?: string; message?: string } | null;

const STALE_CLAIM_MS = 120_000;

function isUniqueViolation(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === "23505" ||
    /duplicate key|unique constraint/i.test(error.message ?? "")
  );
}

function isMissingRow(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST116" ||
    /0 rows|Cannot coerce the result to a single JSON object/i.test(
      error.message ?? "",
    )
  );
}

function priceIdOf(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("price_")) return value;
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string"
  ) {
    const id = (value as { id: string }).id;
    if (id.startsWith("price_")) return id;
  }
  return null;
}

type PriceCarrier = {
  price?: unknown;
  pricing?: { price_details?: { price?: unknown } };
};

function priceIdFromSubscription(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as PriceCarrier | undefined;
  if (!item) return null;
  return (
    priceIdOf(item.price) ||
    priceIdOf(item.pricing?.price_details?.price) ||
    null
  );
}

function priceIdFromInvoice(inv: Stripe.Invoice): string | null {
  for (const line of inv.lines?.data ?? []) {
    const carrier = line as Stripe.InvoiceLineItem & PriceCarrier;
    const id =
      priceIdOf(carrier.price) ||
      priceIdOf(carrier.pricing?.price_details?.price);
    if (id) return id;
  }
  return null;
}

function planIdFromMetadata(raw: unknown): PlanId | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !(raw in PLANS) || raw === "owner") {
    throw new Error(`[stripe] unrecognized plan_id metadata: ${String(raw)}`);
  }
  return raw as PlanId;
}

function planIdFromPrice(priceId: string | null): PlanId | null {
  if (!priceId) return null;
  for (const plan of Object.values(PLANS)) {
    if (!plan.stripePriceIdEnv) continue;
    const configured = process.env[plan.stripePriceIdEnv];
    if (configured && configured === priceId) return plan.id;
  }
  return null;
}

/**
 * Never guess a plan. Metadata wins when it names a real plan; otherwise
 * the Stripe price must match STRIPE_PRICE_*. Disagreeing sources fail.
 * Subscription updates do not use this directly: the price id wins there,
 * because checkout metadata stays on the original plan after a price change.
 */
function resolveBillablePlan(
  metadataPlan: unknown,
  priceId: string | null,
  context: string,
): PlanId {
  const fromMeta = planIdFromMetadata(metadataPlan);
  const fromPrice = planIdFromPrice(priceId);
  if (fromMeta && fromPrice && fromMeta !== fromPrice) {
    throw new Error(
      `[stripe] ${context}: plan_id ${fromMeta} does not match price ${priceId} (${fromPrice})`,
    );
  }
  const plan = fromMeta ?? fromPrice;
  if (!plan) {
    throw new Error(
      `[stripe] ${context}: cannot resolve plan (metadata missing, price ${priceId ?? "missing"} unmatched)`,
    );
  }
  return plan;
}

/**
 * The subscription item price is the plan. Metadata is only a fallback
 * when the price is not in the env map, so a Creator→Pro price change
 * does not 500 on stale `plan_id` metadata.
 *
 * #662 (head 702b9bbd, which contains #658's grant-race commits) still
 * throws when metadata and price disagree inside resolveBillablePlan.
 * Subscription events go through this function instead: the price wins.
 * A non-proration invoice.paid still throws if its price disagrees with
 * the plan stored on the row. Unmapped prices are still not guessed.
 */
function resolveSubscriptionPlan(
  metadataPlan: unknown,
  priceId: string | null,
  context: string,
): PlanId {
  const fromPrice = planIdFromPrice(priceId);
  if (fromPrice) return fromPrice;
  return resolveBillablePlan(metadataPlan, null, context);
}

function subscriptionCreditAllowance(plan: string | null | undefined): number {
  if (!plan || !(plan in PLANS)) return 0;
  const def = PLANS[plan as PlanId];
  if (def.billingType !== "subscription" || def.monthlyCredits <= 0) return 0;
  return def.monthlyCredits;
}

function requireSubscriptionGrantPlan(
  plan: string | null | undefined,
  context: string,
): PlanId {
  if (!plan || !(plan in PLANS) || plan === "owner") {
    throw new Error(
      `[stripe] ${context}: subscription plan missing or unknown (${plan || "empty"})`,
    );
  }
  const resolved = plan as PlanId;
  const def = PLANS[resolved];
  if (def.billingType !== "subscription" || def.monthlyCredits <= 0) {
    throw new Error(
      `[stripe] ${context}: plan ${resolved} is not a monthly credit subscription`,
    );
  }
  return resolved;
}

/**
 * Statuses a late invoice.paid must not overwrite with "active".
 * `refunded` is local-only (plan refunds); the others match Stripe.
 */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set([
  "canceled",
  "past_due",
  "unpaid",
  "incomplete_expired",
  "refunded",
]);

/** Live Stripe statuses that mean "do not mark this subscription active". */
const LIVE_NON_ACTIVE_STATUSES = new Set([
  "canceled",
  "past_due",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);

function eventCreatedMs(event: Stripe.Event): number {
  return eventCreatedSeconds(event) * 1000;
}

/** Stripe `event.created` is whole seconds. Missing values use the current second. */
function eventCreatedSeconds(event: Stripe.Event): number {
  return typeof event.created === "number" && event.created > 0
    ? Math.floor(event.created)
    : Math.floor(Date.now() / 1000);
}

function eventTimestamp(event: Stripe.Event): string {
  return new Date(eventCreatedMs(event)).toISOString();
}

/** PostgREST may return bigint as a number or a string. */
function storedStripeEventSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
}

type ListedRefund = { id: string; amount: number; created: number };

/**
 * API version 2025-08-27.basil removed `refunds` from Charge. Load the
 * charge's succeeded refunds from the Stripe API instead of the webhook
 * payload.
 */
async function listSucceededRefunds(
  stripe: Stripe,
  chargeId: string,
): Promise<ListedRefund[]> {
  const collected: ListedRefund[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < 5; page += 1) {
    const pageResult = await stripe.refunds.list({
      charge: chargeId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const rows = pageResult?.data ?? [];
    for (const refund of rows) {
      if (refund.status && refund.status !== "succeeded") continue;
      if (!refund.id || refund.amount <= 0) continue;
      collected.push({
        id: refund.id,
        amount: refund.amount,
        created: refund.created ?? 0,
      });
    }
    if (!pageResult?.has_more) return collected;
    const lastId = rows[rows.length - 1]?.id;
    if (!lastId) return collected;
    startingAfter = lastId;
  }
  throw new Error(`[stripe] charge ${chargeId}: refund list exceeded 5 pages`);
}

/**
 * Refunds that existed when this charge.refunded snapshot was taken.
 * `amount_refunded` on the event is the cumulative total at that moment.
 * Walk oldest-first and stop at that total so a later partial refund is
 * not debited by an older event. Returns [] when the list cannot be
 * reconciled — the caller must retry rather than guess a charge-level key.
 */
function refundsInSnapshot(
  refunds: ListedRefund[],
  amountRefunded: number,
): ListedRefund[] {
  const ordered = [...refunds].sort(
    (a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const covered: ListedRefund[] = [];
  let sum = 0;
  for (const refund of ordered) {
    if (sum === amountRefunded) break;
    if (sum + refund.amount > amountRefunded) break;
    covered.push(refund);
    sum += refund.amount;
  }
  if (sum !== amountRefunded || covered.length === 0) return [];
  return covered;
}

function periodEndSeconds(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
}

async function ledgerHasIdempotencyKey(
  sb: AdminClient,
  userId: string,
  key: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("idempotency_key", key)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`[stripe] ledger lookup failed for ${key}: ${error.message}`);
  }
  return !!data;
}

async function ledgerHasReference(
  sb: AdminClient,
  userId: string,
  referenceId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .eq("reference_id", referenceId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[stripe] ledger lookup failed for ${referenceId}: ${error.message}`,
    );
  }
  return !!data;
}

async function refundAlreadyDebited(
  sb: AdminClient,
  userId: string,
  refundId: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("credit_ledger")
    .select("id")
    .eq("user_id", userId)
    .like("idempotency_key", `refund_${refundId}:%`)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[stripe] refund ${refundId}: ledger lookup failed: ${error.message}`,
    );
  }
  return !!data;
}

/**
 * Debit each succeeded refund in this event's amount_refunded snapshot
 * that does not already have a ledger row. The idempotency key is
 * `refund_{refundId}`. The webhook's event claim still runs first, so a
 * replay of the same event never reaches this function.
 */
async function debitRefundSnapshot(
  stripe: Stripe,
  sb: AdminClient,
  charge: Stripe.Charge,
  userId: string,
  credits: number,
  context: string,
): Promise<void> {
  if (charge.amount <= 0 || credits <= 0 || charge.amount_refunded <= 0) return;
  let listed: ListedRefund[];
  try {
    listed = await listSucceededRefunds(stripe, charge.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(
      `[stripe] charge.refunded ${charge.id}: refund list failed: ${message}`,
    );
  }
  const snapshot = refundsInSnapshot(listed, charge.amount_refunded);
  if (snapshot.length === 0) {
    throw new Error(
      `[stripe] charge.refunded ${charge.id}: refund list does not match amount_refunded ${charge.amount_refunded}; refusing a charge-level idempotency key`,
    );
  }
  for (const refund of snapshot) {
    if (await refundAlreadyDebited(sb, userId, refund.id)) continue;
    const debitBits = proratedRefundDebit(refund.amount, charge.amount, credits);
    if (debitBits <= 0) continue;
    await debitCreditsOrThrow(
      sb,
      {
        p_user_id: userId,
        p_amount: debitBits,
        p_category: "refund",
        p_description: `Refund ${refund.id} for charge ${charge.id}`,
        p_idempotency_key: `refund_${refund.id}`,
      },
      `${context} ${refund.id}`,
    );
  }
}

function proratedRefundDebit(
  refundAmount: number,
  chargeAmount: number,
  credits: number,
): number {
  if (chargeAmount <= 0 || refundAmount <= 0 || credits <= 0) return 0;
  return Math.round((refundAmount / chargeAmount) * credits);
}

/**
 * Agent purchase and agent-refund RPCs insert stripe_events themselves.
 * Pre-claiming those events makes the RPC see a conflict and skip the
 * fulfillment. Credit-pack and plan refunds do not have that RPC, so they
 * use the webhook claim. A charge.refunded with no agent metadata still
 * counts as an agent refund when a marketplace order owns the payment.
 */
async function eventClaimsItself(
  sb: AdminClient | null,
  event: Stripe.Event,
): Promise<boolean> {
  if (event.type === "checkout.session.completed") {
    const meta =
      (event.data.object as Stripe.Checkout.Session).metadata || {};
    return meta.product_type === "agent";
  }
  if (event.type !== "charge.refunded") return false;
  const charge = event.data.object as Stripe.Charge;
  if (charge.metadata?.product_type === "agent") return true;
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!sb || !paymentIntentId) return false;
  const { data, error } = await sb
    .from("marketplace_orders")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[stripe] charge.refunded ${charge.id}: agent-order lookup failed: ${error.message}`,
    );
  }
  return !!data;
}

async function isEventProcessed(sb: AdminClient, eventId: string): Promise<boolean> {
  const { data, error } = await sb
    .from("stripe_events")
    .select("id, result")
    .eq("stripe_event_id", eventId)
    .single();
  if (error && !isMissingRow(error)) {
    throw new Error(`[stripe] event lookup failed: ${error.message}`);
  }
  return !!data;
}

async function markEventProcessed(
  sb: AdminClient,
  eventId: string,
  eventType: string,
  result: string,
): Promise<void> {
  const { error } = await sb.from("stripe_events").insert({
    stripe_event_id: eventId,
    event_type: eventType,
    result,
  });
  if (!error || isUniqueViolation(error)) return;
  throw new Error(`[stripe] markEventProcessed failed: ${error.message}`);
}

type ClaimResult = "owned" | "duplicate" | "in_progress";

async function claimStripeEvent(
  sb: AdminClient,
  eventId: string,
  eventType: string,
  attempt = 0,
): Promise<ClaimResult> {
  const { error } = await sb.from("stripe_events").insert({
    stripe_event_id: eventId,
    event_type: eventType,
    result: "processing",
  });
  if (!error) return "owned";
  if (!isUniqueViolation(error)) {
    throw new Error(`[stripe] event claim failed: ${error.message}`);
  }

  const { data, error: readError } = await sb
    .from("stripe_events")
    .select("result, processed_at")
    .eq("stripe_event_id", eventId)
    .single();
  if (readError || !data) {
    throw new Error(
      `[stripe] event claim conflict for ${eventId} but the row was unreadable`,
    );
  }
  if (data.result !== "processing") return "duplicate";

  const processedAt = data.processed_at
    ? new Date(data.processed_at).getTime()
    : Number.NaN;
  const age = Date.now() - processedAt;
  if (attempt < 1 && Number.isFinite(age) && age > STALE_CLAIM_MS) {
    const { error: delError } = await sb
      .from("stripe_events")
      .delete()
      .eq("stripe_event_id", eventId);
    if (delError) {
      throw new Error(`[stripe] stale claim release failed: ${delError.message}`);
    }
    return claimStripeEvent(sb, eventId, eventType, attempt + 1);
  }
  return "in_progress";
}

async function finalizeStripeEvent(
  sb: AdminClient,
  eventId: string,
  result: string,
): Promise<void> {
  const { error } = await sb
    .from("stripe_events")
    .update({ result })
    .eq("stripe_event_id", eventId);
  if (error) {
    throw new Error(`[stripe] finalize stripe event failed: ${error.message}`);
  }
}

async function releaseStripeEvent(sb: AdminClient, eventId: string): Promise<void> {
  const { error } = await sb
    .from("stripe_events")
    .delete()
    .eq("stripe_event_id", eventId);
  if (error) {
    throw new Error(`[stripe] release stripe event failed: ${error.message}`);
  }
}

async function creditCreditPack(
  clerkId: string,
  creditAmount: number,
  sessionId: string,
) {
  if (!isAdminSupabaseConfigured()) {
    throw new Error("[stripe] credit pack grant: admin supabase is not configured");
  }
  const sb = getAdminSupabase();
  const { data: user, error: userError } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  if (userError || !user) {
    throw new Error(
      `[stripe] credit pack grant: user not found for clerk ${clerkId}: ${userError?.message ?? "no row"}`,
    );
  }
  // Idempotency key is the Checkout Session id, so a Stripe retry of a
  // failed grant cannot double-credit once the RPC has committed.
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
    throw new Error(`[stripe] credit pack grant_credits failed: ${error.message}`);
  }
}

async function debitCreditsOrThrow(
  sb: AdminClient,
  args: {
    p_user_id: string;
    p_amount: number;
    p_category: string;
    p_description: string;
    p_idempotency_key: string;
  },
  context: string,
): Promise<void> {
  const { data, error } = await sb.rpc("debit_credits", args);
  if (error) {
    throw new Error(`[stripe] ${context}: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { success?: boolean }
    | null
    | undefined;
  if (!row || row.success !== true) {
    throw new Error(`[stripe] ${context}: debit_credits returned success=false`);
  }
}

async function grantSubscriptionCredits(
  sb: NonNullable<ReturnType<typeof getAdminSupabase>>,
  userId: string,
  planId: PlanId,
  idempotencyKey: string,
  expiresAt?: string | null,
  referenceId?: string,
): Promise<void> {
  const plan = PLANS[planId];
  if (!plan || plan.monthlyCredits <= 0) return;
  try {
    // Supabase rpc() returns { data, error } — it does NOT throw on a
    // database error. Both must be treated as failures.
    const { error: rpcError } = await sb.rpc("grant_credits", {
      p_user_id: userId,
      p_amount: plan.monthlyCredits,
      p_category: "subscription_grant",
      p_balance_bucket: "monthly",
      p_description: `${plan.name} monthly grant — ${plan.monthlyCredits} LiTTBits`,
      p_idempotency_key: idempotencyKey,
      p_reference_type: "subscription",
      p_reference_id: referenceId,
      p_expires_at: expiresAt ?? undefined,
    });
    if (rpcError) {
      throw new Error(`grant_credits RPC error: ${rpcError.message}`);
    }
  } catch (err) {
    // Log AND propagate: a failed grant must surface as HTTP 500 so Stripe
    // retries. The per-invoice idempotency key makes retries safe (the RPC
    // returns granted=false instead of double-granting). Swallowing here
    // would permanently leave the customer without purchased credits.
    console.error(
      `[stripe] grantSubscriptionCredits failed for user ${userId} plan ${planId}:`,
      err,
    );
    throw err;
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
  let selfClaim = false;
  let ownedClaim = false;

  try {
    selfClaim = await eventClaimsItself(sb, event);
    if (sb && !selfClaim) {
      const claim = await claimStripeEvent(sb, event.id, event.type);
      if (claim === "duplicate") {
        return NextResponse.json({ received: true, replayed: true });
      }
      if (claim === "in_progress") {
        return NextResponse.json(
          { error: "Webhook event is already in progress" },
          { status: 500 },
        );
      }
      ownedClaim = true;
    } else if (sb && (await isEventProcessed(sb, event.id))) {
      return NextResponse.json({ received: true, replayed: true });
    }

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
            const { data: user, error: founderUserError } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", clerkId)
              .single();
            if (founderUserError && !isMissingRow(founderUserError)) {
              throw new Error(
                `[stripe] founder checkout ${session.id}: ${founderUserError.message}`,
              );
            }
            if (!user) {
              throw new Error(
                `[stripe] founder checkout ${session.id}: user not found`,
              );
            }
            if (user) {
              // Founding Member: permanent Creator-level access, no monthly credits.
              // Do NOT call grantSubscriptionCredits — Founder has monthlyCredits: 0.
              // Record as a permanent entitlement (not a time-limited subscription).
              const { error: founderError } = await sb.from("subscriptions").upsert({
                user_id: user.id,
                stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id ?? null,
                plan: planId,
                status: "active",
                updated_at: new Date().toISOString(),
              }, { onConflict: "user_id", ignoreDuplicates: false });
              if (founderError) {
                throw new Error(
                  `[stripe] founder entitlement upsert failed: ${founderError.message}`,
                );
              }
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
        if (!subUserId) {
          throw new Error(
            `[stripe] ${event.type} ${sub.id}: cannot resolve the customer to a user`,
          );
        }
        const { data: existingSub } = await sb
          .from("subscriptions")
          .select("plan, current_period_end, last_stripe_event_created")
          .eq("user_id", subUserId)
          .maybeSingle();
        // Order by the Stripe event second last applied to this row.
        // updated_at is the app wall clock and can land after a later
        // event.created (whole seconds), which dropped real downgrades.
        const storedEventSeconds = storedStripeEventSeconds(
          existingSub?.last_stripe_event_created,
        );
        const incomingSeconds = eventCreatedSeconds(event);
        if (storedEventSeconds !== null && incomingSeconds < storedEventSeconds) {
          console.warn(
            `[stripe] ${event.type} ${event.id}: skipping stale subscription event created ${incomingSeconds}; last applied Stripe event ${storedEventSeconds}`,
          );
          break;
        }
        // Same second: the payload and a sibling event are unordered.
        // The live subscription is the one to write.
        let applied = sub;
        if (storedEventSeconds !== null && incomingSeconds === storedEventSeconds) {
          try {
            applied = await stripe.subscriptions.retrieve(sub.id, undefined, {
              timeout: 8000,
            });
          } catch (readErr) {
            const message = readErr instanceof Error ? readErr.message : "unknown error";
            throw new Error(
              `[stripe] ${event.type} ${event.id}: same-second subscription re-read failed: ${message}`,
            );
          }
        }
        const appliedMeta = applied.metadata || {};
        const planId = resolveSubscriptionPlan(
          (appliedMeta.plan_id as PlanId) || subPlanId,
          priceIdFromSubscription(applied),
          `${event.type} ${sub.id}`,
        );
        // Grant the upgrade difference before writing the new plan. A retry
        // after a failed upsert still sees the old plan; the idempotency key
        // makes a second grant a no-op. Created events do not grant — the
        // first invoice.paid grants the full period. Downgrades grant nothing
        // until the next renewal.
        if (event.type === "customer.subscription.updated") {
          const previous = subscriptionCreditAllowance(existingSub?.plan);
          const next = subscriptionCreditAllowance(planId);
          const periodEnd = applied.items?.data?.[0]?.current_period_end ?? "na";
          const storedPeriod = periodEndSeconds(existingSub?.current_period_end);
          const incomingPeriod = periodEndSeconds(
            applied.items?.data?.[0]?.current_period_end,
          );
          // A new period is a renewal. invoice.paid grants that period once.
          // The delta is only the mid-cycle top-up, while the period end stays put.
          const periodRolled =
            storedPeriod !== null &&
            incomingPeriod !== null &&
            storedPeriod !== incomingPeriod;
          if (!periodRolled && previous > 0 && next > previous) {
            const delta = next - previous;
            const periodRef = `period_plan_${sub.id}_${periodEnd}_${planId}`;
            // A renewal invoice for this same period and plan already paid
            // the allowance. Do not add the delta on top.
            if (!(await ledgerHasReference(sb, subUserId, periodRef))) {
              const { error: upgradeError } = await sb.rpc("grant_credits", {
                p_user_id: subUserId,
                p_amount: delta,
                p_category: "subscription_grant",
                p_balance_bucket: "monthly",
                p_description: `Plan upgrade to ${planId} — ${delta} LiTTBits`,
                p_idempotency_key: `plan_upgrade_${sub.id}_${periodEnd}_${planId}`,
                p_reference_type: "subscription",
                p_reference_id: periodRef,
              });
              if (upgradeError) {
                throw new Error(
                  `[stripe] ${event.type} ${sub.id}: upgrade grant failed: ${upgradeError.message}`,
                );
              }
            }
          }
        }
        const { error: subUpsertError } = await sb.from("subscriptions").upsert(
          {
            user_id: subUserId,
            stripe_customer_id:
              typeof applied.customer === "string"
                ? applied.customer
                : applied.customer?.id,
            stripe_subscription_id: sub.id,
            plan: planId,
            status: applied.status,
            current_period_start: applied.items?.data?.[0]?.current_period_start
              ? new Date(applied.items.data[0].current_period_start * 1000).toISOString()
              : null,
            current_period_end: applied.items?.data?.[0]?.current_period_end
              ? new Date(applied.items.data[0].current_period_end * 1000).toISOString()
              : null,
            cancel_at_period_end: applied.cancel_at_period_end === true,
            last_stripe_event_created: incomingSeconds,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id", ignoreDuplicates: false },
        );
        if (subUpsertError) {
          throw new Error(
            `[stripe] ${event.type} ${sub.id}: subscription upsert failed: ${subUpsertError.message}`,
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        if (!sb) break;
        const delSub = event.data.object as Stripe.Subscription;
        const { data: delMatch } = await sb
          .from("subscriptions")
          .select("user_id, last_stripe_event_created")
          .eq("stripe_subscription_id", delSub.id)
          .single();
        if (!delMatch) {
          throw new Error(
            `[stripe] customer.subscription.deleted ${delSub.id}: no subscription row`,
          );
        }
        const storedDeleteSeconds = storedStripeEventSeconds(
          delMatch.last_stripe_event_created,
        );
        const deleteSeconds = eventCreatedSeconds(event);
        if (storedDeleteSeconds !== null && deleteSeconds < storedDeleteSeconds) {
          console.warn(
            `[stripe] customer.subscription.deleted ${event.id}: skipping stale subscription event created ${deleteSeconds}; last applied Stripe event ${storedDeleteSeconds}`,
          );
          break;
        }
        const { error: cancelError } = await sb
          .from("subscriptions")
          .update({
            status: "canceled",
            cancel_at_period_end: false,
            last_stripe_event_created: deleteSeconds,
            updated_at: eventTimestamp(event),
          })
          .eq("user_id", delMatch.user_id);
        if (cancelError) {
          throw new Error(
            `[stripe] customer.subscription.deleted ${delSub.id}: ${cancelError.message}`,
          );
        }
        break;
      }

      case "invoice.paid": {
        if (!sb) {
          throw new Error(
            `[stripe] invoice.paid ${event.id}: admin supabase is not configured`,
          );
        }
        const inv = event.data.object as Stripe.Invoice;
        const invSubId = inv.parent?.subscription_details?.subscription;
        if (typeof invSubId !== "string" || !invSubId) {
          // Malformed event: fail loudly so Stripe retries and we see it,
          // rather than silently dropping a paid invoice.
          throw new Error(
            `[stripe] invoice.paid ${event.id}: missing parent subscription id`,
          );
        }
        // The customer.subscription.created event is usually still in flight
        // when invoice.paid arrives: it performs a multi-query upsert while
        // this handler does a single SELECT, so without a wait the lookup
        // systematically misses.
        //
        // Timeout budget (guaranteed, not estimated): 5 sleeps × 2s = 10s
        // + Stripe API fallback (hard 8s timeout above) + DB ops ≈ 20s max.
        // Stays under Stripe's 30s webhook timeout even if every
        // dependency is slow.
        let invMatch: {
          user_id: string;
          plan: string;
          status?: string | null;
          last_stripe_event_created?: number | string | null;
        } | null = null;
        for (let attempt = 0; attempt < 6; attempt++) {
          const { data, error: lookupError } = await sb
            .from("subscriptions")
            .select("user_id, plan, status, last_stripe_event_created")
            .eq("stripe_subscription_id", invSubId)
            .single();
          if (lookupError && !isMissingRow(lookupError)) {
            throw new Error(
              `[stripe] invoice.paid ${event.id}: subscription lookup failed: ${lookupError.message}`,
            );
          }
          if (data) {
            invMatch = data;
            break;
          }
          // No sleep after the final attempt: 5 sleeps x 2s = 10s max.
          if (attempt < 5) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        // Self-healing fallback: if the subscription.created event was lost
        // or is still delayed, reconstruct the row from the Stripe API
        // instead of leaving the customer without credits.
        if (!invMatch) {
          console.warn(
            `[stripe] invoice.paid ${event.id}: subscription row missing after retries, resolving via Stripe API`,
          );
          try {
            // Bounded: 8s max for the Stripe API call. Combined with the
            // 10s retry loop, the worst case stays under Stripe's 30s
            // webhook timeout even if the API hangs.
            const fullSub = await stripe.subscriptions.retrieve(invSubId, undefined, {
              timeout: 8000,
            });
            // Resolve the user from the subscription's own metadata — no guessing.
            const clerkId: string | undefined =
              typeof fullSub.metadata?.clerk_id === "string"
                ? fullSub.metadata.clerk_id
                : undefined;
            if (clerkId) {
              const { data: u } = await sb
                .from("users")
                .select("id")
                .eq("clerk_id", clerkId)
                .single();
              if (u) {
                const planId = resolveSubscriptionPlan(
                  fullSub.metadata?.plan_id,
                  priceIdFromSubscription(fullSub),
                  `invoice.paid ${event.id} fallback`,
                );
                const { error: fallbackUpsertError } = await sb
                  .from("subscriptions")
                  .upsert(
                    {
                      user_id: u.id,
                      stripe_customer_id:
                        typeof inv.customer === "string"
                          ? inv.customer
                          : inv.customer?.id ?? null,
                      stripe_subscription_id: invSubId,
                      plan: planId,
                      status: fullSub.status,
                      current_period_start: fullSub.items?.data?.[0]?.current_period_start
                        ? new Date(
                            fullSub.items.data[0].current_period_start * 1000,
                          ).toISOString()
                        : null,
                      current_period_end: fullSub.items?.data?.[0]?.current_period_end
                        ? new Date(
                            fullSub.items.data[0].current_period_end * 1000,
                          ).toISOString()
                        : null,
                      cancel_at_period_end: fullSub.cancel_at_period_end === true,
                      last_stripe_event_created: eventCreatedSeconds(event),
                      updated_at: new Date().toISOString(),
                    },
                    // subscriptions.user_id is the unique row identity.
                    // stripe_subscription_id is additionally unique (see
                    // migration) but is not the conflict target: a user may
                    // already have a row whose subscription id is still null.
                    { onConflict: "user_id", ignoreDuplicates: false },
                  );
                if (fallbackUpsertError) {
                  // Do NOT proceed to grant: the row wasn't reconstructed.
                  // Throw so Stripe retries (recoverable, not silently dropped).
                  throw new Error(
                    `[stripe] invoice.paid ${event.id}: fallback upsert failed: ${fallbackUpsertError.message}`,
                  );
                }
                invMatch = {
                  user_id: u.id,
                  plan: planId,
                  status: fullSub.status,
                  last_stripe_event_created: eventCreatedSeconds(event),
                };
              }
            }
          } catch (fallbackErr) {
            console.error(
              `[stripe] invoice.paid ${event.id}: Stripe API fallback failed`,
              fallbackErr,
            );
          }
        }
        if (!invMatch) {
          // Do NOT return 200: Stripe must retry. The event is not marked
          // processed, so a retry will re-attempt the grant. Idempotency
          // (per-invoice key) prevents double-granting on retry.
          throw new Error(
            `[stripe] invoice.paid ${event.id}: no subscription row for ${invSubId} after retries+fallback`,
          );
        }
        // A late invoice.paid must not revive a newer canceled or past_due
        // row. Compare event.created with the last applied Stripe event
        // second, not updated_at, and re-read the subscription from Stripe
        // so a canceled/past_due object is never forced to active.
        // A failed re-read is 500: guessing "active" is the bug.
        const storedInvoiceSeconds = storedStripeEventSeconds(
          invMatch.last_stripe_event_created,
        );
        const invoiceSeconds = eventCreatedSeconds(event);
        const newerTerminalStatus =
          !!invMatch.status &&
          TERMINAL_SUBSCRIPTION_STATUSES.has(invMatch.status) &&
          storedInvoiceSeconds !== null &&
          storedInvoiceSeconds > invoiceSeconds;
        let liveStatus = "";
        try {
          const liveSub = await stripe.subscriptions.retrieve(
            invSubId,
            undefined,
            { timeout: 8000 },
          );
          liveStatus = liveSub.status ?? "";
        } catch (statusErr) {
          const message =
            statusErr instanceof Error ? statusErr.message : "unknown error";
          throw new Error(
            `[stripe] invoice.paid ${event.id}: subscription status re-read failed: ${message}`,
          );
        }
        const liveBlocksActive = LIVE_NON_ACTIVE_STATUSES.has(liveStatus);
        if (!newerTerminalStatus && !liveBlocksActive) {
          const { error: statusUpdateError } = await sb
            .from("subscriptions")
            .update({
              status: "active",
              last_stripe_event_created:
                storedInvoiceSeconds === null || invoiceSeconds >= storedInvoiceSeconds
                  ? invoiceSeconds
                  : storedInvoiceSeconds,
              updated_at: eventTimestamp(event),
            })
            .eq("user_id", invMatch.user_id);
          if (statusUpdateError) {
            throw new Error(
              `[stripe] invoice.paid ${event.id}: status update failed: ${statusUpdateError.message}`,
            );
          }
        } else {
          console.warn(
            `[stripe] invoice.paid ${event.id}: leaving status ${invMatch.status ?? "unknown"} (live ${liveStatus || "unknown"})`,
          );
        }
        // A proration invoice (plan change) must not grant the full monthly
        // amount. The upgrade delta is granted once on subscription.updated;
        // the next renewal (subscription_cycle) grants the plan stored then.
        if (inv.billing_reason === "subscription_update") {
          break;
        }
        // Invoice payment is the only source of full subscription grants.
        // This prevents the first billing period from being granted twice.
        // If the grant throws, the error propagates → HTTP 500 → Stripe
        // retries. The per-invoice idempotency key makes retries safe.
        const planId = requireSubscriptionGrantPlan(
          invMatch.plan,
          `invoice.paid ${event.id}`,
        );
        const pricedPlan = planIdFromPrice(priceIdFromInvoice(inv));
        if (pricedPlan && pricedPlan !== planId) {
          throw new Error(
            `[stripe] invoice.paid ${event.id}: price resolves to ${pricedPlan} but subscription plan is ${planId}`,
          );
        }
        const periodEnd = inv.lines.data[0]?.period?.end;
        const periodRef = `period_plan_${invSubId}_${periodEnd ?? "na"}_${planId}`;
        const upgradeKey = `plan_upgrade_${invSubId}_${periodEnd ?? "na"}_${planId}`;
        // The upgrade delta for this period and plan already landed.
        // Granting the full allowance again would stack the two events.
        if (await ledgerHasIdempotencyKey(sb, invMatch.user_id, upgradeKey)) {
          break;
        }
        await grantSubscriptionCredits(
          sb,
          invMatch.user_id,
          planId,
          `invoice_grant_${inv.id}`,
          periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          periodRef,
        );
        break;
      }

      case "invoice.payment_failed": {
        if (!sb) break;
        const failInv = event.data.object as Stripe.Invoice;
        const failSubId = failInv.parent?.subscription_details?.subscription;
        if (!failSubId || typeof failSubId !== "string") {
          throw new Error(
            `[stripe] invoice.payment_failed ${event.id}: missing subscription id`,
          );
        }
        const { data: failMatch, error: failLookupError } = await sb
          .from("subscriptions")
          .select("user_id, last_stripe_event_created")
          .eq("stripe_subscription_id", failSubId)
          .single();
        if (failLookupError && !isMissingRow(failLookupError)) {
          throw new Error(
            `[stripe] invoice.payment_failed ${event.id}: ${failLookupError.message}`,
          );
        }
        if (!failMatch) {
          throw new Error(
            `[stripe] invoice.payment_failed ${event.id}: no subscription row for ${failSubId}`,
          );
        }
        const storedFailSeconds = storedStripeEventSeconds(
          failMatch.last_stripe_event_created,
        );
        const failSeconds = eventCreatedSeconds(event);
        if (storedFailSeconds !== null && failSeconds < storedFailSeconds) {
          console.warn(
            `[stripe] invoice.payment_failed ${event.id}: skipping stale subscription event created ${failSeconds}; last applied Stripe event ${storedFailSeconds}`,
          );
          break;
        }
        const { error: pastDueError } = await sb
          .from("subscriptions")
          .update({
            status: "past_due",
            last_stripe_event_created: failSeconds,
            updated_at: eventTimestamp(event),
          })
          .eq("user_id", failMatch.user_id);
        if (pastDueError) {
          throw new Error(
            `[stripe] invoice.payment_failed ${event.id}: ${pastDueError.message}`,
          );
        }
        break;
      }

      case "charge.refunded": {
        if (!sb) {
          throw new Error(
            `[stripe] charge.refunded ${event.id}: admin supabase is not configured`,
          );
        }
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
            if (!refundUser) {
              throw new Error(
                `[stripe] charge.refunded ${charge.id}: user not found for plan refund`,
              );
            }
            // Revoke the subscription/entitlement
            const { error: revokeError } = await sb
              .from("subscriptions")
              .update({
                status: "refunded",
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", refundUser.id)
              .eq("plan", refundPlanId);
            if (revokeError) {
              throw new Error(
                `[stripe] charge.refunded ${charge.id}: entitlement revoke failed: ${revokeError.message}`,
              );
            }

            // For one_time plans (Founder), do NOT debit LiTTBits —
            // Founder has 0 LiTTBits. For subscription plans, debit
            // a prorated amount of the monthly credit grant based on the
            // fraction of the charge that was refunded.
            if (plan.billingType === "subscription" && plan.monthlyCredits > 0 && charge.amount > 0) {
              await debitRefundSnapshot(
                stripe,
                sb,
                charge,
                refundUser.id,
                plan.monthlyCredits,
                "plan refund",
              );
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
          if (!refundUser) {
            throw new Error(
              `[stripe] charge.refunded ${charge.id}: user not found for credit pack refund`,
            );
          }
          // The original credit pack's LiTTBit grant is stored on the
          // PaymentIntent/Charge metadata. Debit the same fraction of
          // that grant as the refunded amount / original charge amount.
          const coinAmount = refundMeta.coin_amount
            ? parseInt(refundMeta.coin_amount, 10)
            : NaN;
          if (coinAmount > 0 && charge.amount > 0) {
            await debitRefundSnapshot(
              stripe,
              sb,
              charge,
              refundUser.id,
              coinAmount,
              "credit pack refund",
            );
          }
        }
        break;
      }
    }

    if (sb && ownedClaim) {
      await finalizeStripeEvent(sb, event.id, "processed");
    } else if (sb && selfClaim) {
      await markEventProcessed(sb, event.id, event.type, "processed");
    }
  } catch (err) {
    console.error("[stripe] webhook processing failed", event.id, err);
    if (sb && ownedClaim) {
      try {
        await releaseStripeEvent(sb, event.id);
      } catch (releaseErr) {
        console.error("[stripe] failed to release event claim", event.id, releaseErr);
      }
    }
    // Do not acknowledge failed events. Stripe must retry them.
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
