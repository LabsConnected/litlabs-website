// Stripe webhook handler — idempotent event processing.
// Subscription credits are granted only from a settled invoice.paid, once per invoice id.
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

/** Incoming subscription id lost to the stored protected subscription. Ack it. */
class SupersededSubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupersededSubscriptionError";
  }
}

function isUniqueViolation(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === "23505" ||
    /duplicate key|unique constraint/i.test(error.message ?? "")
  );
}

function subscriptionAllowances(): Record<string, number> {
  const allowances: Record<string, number> = {};
  for (const plan of Object.values(PLANS)) {
    allowances[plan.id] = subscriptionCreditAllowance(plan.id);
  }
  return allowances;
}

function unixSecondsToIso(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000).toISOString();
}

function clerkIdFromInvoice(inv: Stripe.Invoice): string | undefined {
  const details = inv.parent?.subscription_details as
    | { metadata?: { clerk_id?: unknown } | null }
    | null
    | undefined;
  const fromDetails = details?.metadata?.clerk_id;
  if (typeof fromDetails === "string" && fromDetails.trim()) return fromDetails.trim();
  const fromInvoice = inv.metadata?.clerk_id;
  if (typeof fromInvoice === "string" && fromInvoice.trim()) return fromInvoice.trim();
  return undefined;
}

type ApplyOutcome = "applied" | "conflict" | "stale" | "recheck";

/**
 * One locked transaction decides identity, plan, ordering, and the grant.
 * A conflict throws SupersededSubscriptionError. The handler finalizes the
 * claim as superseded_subscription and returns 200 so Stripe stops retrying.
 * Any other database error throws, the claim is released, and Stripe retries.
 */
async function applySubscriptionEvent(
  sb: AdminClient,
  args: {
    userId: string;
    incomingSubscriptionId: string;
    event: Stripe.Event;
    authoritative: boolean;
    ordering: "skip_if_older" | "apply";
    requireExisting: boolean;
    plan: string | null;
    status: string | null;
    updatePlan: boolean;
    statusPolicy: "write" | "activate_unless_terminal" | "leave";
    liveStatus: string | null;
    stripeCustomerId: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean | null;
    incomingPlan: string | null;
    grantMode: "none" | "invoice_full";
    grantAmount: number | null;
    grantIdempotencyKey: string | null;
    grantDescription: string | null;
    grantReferenceId: string | null;
    grantExpiresAt: string | null;
    skipGrantIdempotencyKey: string | null;
  },
): Promise<{ outcome: ApplyOutcome; existingSubscriptionId?: string }> {
  const { data, error } = await sb.rpc("apply_subscription_event", {
    p_user_id: args.userId,
    p_incoming_subscription_id: args.incomingSubscriptionId,
    p_stripe_event_id: args.event.id,
    p_event_type: args.event.type,
    p_event_created: eventCreatedSeconds(args.event),
    p_authoritative: args.authoritative,
    p_ordering: args.ordering,
    p_require_existing: args.requireExisting,
    p_plan: args.plan,
    p_status: args.status,
    p_update_plan: args.updatePlan,
    p_status_policy: args.statusPolicy,
    p_live_status: args.liveStatus,
    p_stripe_customer_id: args.stripeCustomerId,
    p_period_start: args.periodStart,
    p_period_end: args.periodEnd,
    p_cancel_at_period_end: args.cancelAtPeriodEnd,
    p_incoming_plan: args.incomingPlan,
    p_grant_mode: args.grantMode,
    p_grant_amount: args.grantAmount,
    p_grant_idempotency_key: args.grantIdempotencyKey,
    p_grant_description: args.grantDescription,
    p_grant_reference_id: args.grantReferenceId,
    p_grant_expires_at: args.grantExpiresAt,
    p_skip_grant_idempotency_key: args.skipGrantIdempotencyKey,
    p_allowances: subscriptionAllowances(),
  });
  if (error) {
    throw new Error(
      `[stripe] ${args.event.type} ${args.event.id}: apply_subscription_event failed: ${error.message}`,
    );
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { outcome?: string; existing_subscription_id?: string }
    | null
    | undefined;
  const outcome = row?.outcome;
  if (
    outcome !== "applied" &&
    outcome !== "conflict" &&
    outcome !== "stale" &&
    outcome !== "recheck"
  ) {
    throw new Error(
      `[stripe] ${args.event.type} ${args.event.id}: apply_subscription_event returned no outcome`,
    );
  }
  if (outcome === "conflict") {
    console.error(
      `[stripe] ${args.event.type} ${args.event.id}: kept ${row?.existing_subscription_id}; refused overwrite by ${args.incomingSubscriptionId}`,
    );
    throw new SupersededSubscriptionError(
      `[stripe] ${args.event.type} ${args.event.id}: duplicate subscription ${args.incomingSubscriptionId} conflicts with ${row?.existing_subscription_id ?? "the stored subscription"}`,
    );
  }
  if (outcome === "stale") {
    console.warn(
      `[stripe] ${args.event.type} ${args.event.id}: subscription clock is newer than ${eventCreatedSeconds(args.event)}; plan is unchanged, status is reconciled from the live subscription`,
    );
  }
  return {
    outcome,
    existingSubscriptionId: row?.existing_subscription_id,
  };
}

/**
 * An invoice for a different subscription id must not grant, and must not
 * retry forever, when this user already holds a protected subscription.
 * The locked apply records the conflict and throws SupersededSubscriptionError.
 * No clerk id, or no other held id, leaves the caller on the retry path.
 */
async function acknowledgeIfSupersededInvoice(
  sb: AdminClient,
  event: Stripe.Event,
  clerkId: string,
  incomingSubscriptionId: string,
): Promise<void> {
  const { data: user, error: userError } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  if (userError) {
    throw new Error(
      `[stripe] ${event.type} ${event.id}: user lookup failed: ${userError.message}`,
    );
  }
  if (!user) return;
  const { data: held, error: heldError } = await sb
    .from("subscriptions")
    .select("stripe_subscription_id, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (heldError) {
    throw new Error(
      `[stripe] ${event.type} ${event.id}: subscription lookup failed: ${heldError.message}`,
    );
  }
  const heldId =
    typeof held?.stripe_subscription_id === "string" ? held.stripe_subscription_id.trim() : "";
  const status = typeof held?.status === "string" ? held.status : "";
  if (!heldId || heldId === incomingSubscriptionId) return;
  if (status === "canceled" || status === "incomplete_expired") return;
  await applySubscriptionEvent(sb, {
    userId: user.id,
    incomingSubscriptionId,
    event,
    authoritative: true,
    ordering: "apply",
    requireExisting: true,
    plan: null,
    status: null,
    updatePlan: false,
    statusPolicy: "leave",
    liveStatus: null,
    stripeCustomerId: null,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: null,
    incomingPlan: null,
    grantMode: "none",
    grantAmount: null,
    grantIdempotencyKey: null,
    grantDescription: null,
    grantReferenceId: null,
    grantExpiresAt: null,
    skipGrantIdempotencyKey: null,
  });
}

/**
 * A newer subscription event must not erase an invoice status, and a stale
 * event must not be acknowledged until the live Stripe status is stored.
 * This write does not change the plan and does not move
 * last_stripe_event_created, so an older plan change still cannot land.
 */
async function readLiveSubscription(
  stripe: Stripe,
  event: Stripe.Event,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  try {
    return await stripe.subscriptions.retrieve(subscriptionId, undefined, {
      timeout: 8000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(
      `[stripe] ${event.type} ${event.id}: live subscription re-read failed: ${message}`,
    );
  }
}

async function applyReconciledStatus(
  sb: AdminClient,
  event: Stripe.Event,
  userId: string,
  subscriptionId: string,
  status: string,
): Promise<void> {
  const decision = await applySubscriptionEvent(sb, {
    userId,
    incomingSubscriptionId: subscriptionId,
    event,
    authoritative: true,
    ordering: "apply",
    requireExisting: true,
    plan: null,
    status,
    updatePlan: false,
    statusPolicy: "write",
    liveStatus: status,
    stripeCustomerId: null,
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: null,
    incomingPlan: null,
    grantMode: "none",
    grantAmount: null,
    grantIdempotencyKey: null,
    grantDescription: null,
    grantReferenceId: null,
    grantExpiresAt: null,
    skipGrantIdempotencyKey: null,
  });
  if (decision.outcome !== "applied") {
    throw new Error(
      `[stripe] ${event.type} ${event.id}: status ${status} was not applied (${decision.outcome})`,
    );
  }
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

type InvoiceLineCredit = {
  plan: PlanId | null;
  amount: number | null;
};

/** Every invoice line that names a configured price, with its signed amount. */
function invoiceLineCredits(inv: Stripe.Invoice): InvoiceLineCredit[] {
  return (inv.lines?.data ?? []).map((line) => {
    const carrier = line as Stripe.InvoiceLineItem & PriceCarrier;
    const priceId =
      priceIdOf(carrier.price) ||
      priceIdOf(carrier.pricing?.price_details?.price);
    return {
      plan: planIdFromPrice(priceId),
      amount: typeof line.amount === "number" ? line.amount : null,
    };
  });
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
 * A settled invoice grants the plan on that invoice. The stored row is not
 * the source of the credit amount. Unmapped prices are still not guessed.
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

/**
 * Credit amount for one settled subscription invoice.
 * A base or renewal invoice grants that invoice's plan allowance.
 * A subscription_update invoice grants the upgrade delta only when its
 * lines show a negative amount on the old price and a positive amount on
 * the higher new price. Anything else, including a plan change that has
 * not settled, grants nothing. The figure does not read the stored plan
 * when the invoice itself names a price.
 */
function settledInvoiceCredit(
  inv: Stripe.Invoice,
  context: string,
): { amount: number; plan: PlanId; kind: "base" | "upgrade" } | null {
  // A $0 invoice can acknowledge a trial, coupon, or fully discounted period.
  // It cannot mint a full paid-period allowance.
  if (inv.amount_paid === 0 || inv.total === 0) return null;
  if (inv.billing_reason === "subscription_update") {
    const lines = invoiceLineCredits(inv);
    const previous = lines.find((line) => line.plan && (line.amount ?? 0) < 0);
    const next = lines.find((line) => line.plan && (line.amount ?? 0) > 0);
    if (!previous?.plan || !next?.plan || previous.plan === next.plan) return null;
    const delta =
      subscriptionCreditAllowance(next.plan) - subscriptionCreditAllowance(previous.plan);
    if (delta <= 0) return null;
    return { amount: delta, plan: requireSubscriptionGrantPlan(next.plan, context), kind: "upgrade" };
  }
  const priced = invoiceLineCredits(inv).find((line) => line.plan)?.plan ?? null;
  // Never fall back to the mutable subscription plan. An unpaid upgrade can
  // already have changed that row before a Creator renewal settles.
  const plan = requireSubscriptionGrantPlan(priced, context);
  const amount = subscriptionCreditAllowance(plan);
  if (amount <= 0) return null;
  return { amount, plan, kind: "base" };
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

/** Stripe `event.created` is whole seconds. Missing values use the current second. */
function eventCreatedSeconds(event: Stripe.Event): number {
  return typeof event.created === "number" && event.created > 0
    ? Math.floor(event.created)
    : Math.floor(Date.now() / 1000);
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

type ClaimOwnership = { status: ClaimResult; token: string };

/**
 * Claim, takeover, finalize, and release go through SQL so the claim token
 * is checked in the same statement as the write. A stale retry that loses
 * the token cannot delete or finalize the winner's row.
 */
async function claimStripeEvent(
  sb: AdminClient,
  eventId: string,
  eventType: string,
): Promise<ClaimOwnership> {
  const token = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data, error } = await sb.rpc("claim_stripe_event", {
    p_stripe_event_id: eventId,
    p_event_type: eventType,
    p_claim_token: token,
    p_stale_before: staleBefore,
  });
  if (error) {
    throw new Error(`[stripe] event claim failed: ${error.message}`);
  }
  if (data !== "owned" && data !== "duplicate" && data !== "in_progress") {
    throw new Error(`[stripe] event claim for ${eventId} returned ${String(data)}`);
  }
  return { status: data, token };
}

async function finalizeStripeEvent(
  sb: AdminClient,
  eventId: string,
  claimToken: string,
  result: string,
): Promise<void> {
  const { data, error } = await sb.rpc("finalize_stripe_event", {
    p_stripe_event_id: eventId,
    p_claim_token: claimToken,
    p_result: result,
  });
  if (error) {
    throw new Error(`[stripe] finalize stripe event failed: ${error.message}`);
  }
  if (data !== true) {
    throw new Error(
      `[stripe] finalize stripe event ${eventId} lost the claim token`,
    );
  }
}

async function releaseStripeEvent(
  sb: AdminClient,
  eventId: string,
  claimToken: string,
): Promise<void> {
  const { data, error } = await sb.rpc("release_stripe_event", {
    p_stripe_event_id: eventId,
    p_claim_token: claimToken,
  });
  if (error) {
    throw new Error(`[stripe] release stripe event failed: ${error.message}`);
  }
  if (data === "lost") {
    console.error(
      `[stripe] release skipped; claim ${eventId} is owned by another token`,
    );
    return;
  }
  if (data !== "released" && data !== "absent") {
    throw new Error(`[stripe] release stripe event ${eventId} returned ${String(data)}`);
  }
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent?.subscription_details?.subscription;
  if (typeof parent === "string" && parent) return parent;
  const legacy = (invoice as Stripe.Invoice & {
    subscription?: string | { id?: string } | null;
  }).subscription;
  if (typeof legacy === "string" && legacy) return legacy;
  if (legacy && typeof legacy === "object" && typeof legacy.id === "string") return legacy.id;
  return null;
}

/** Plan metadata for a subscription invoice charge. Charge metadata is often empty. */
async function subscriptionMetaForCharge(
  stripe: Stripe,
  charge: Stripe.Charge,
): Promise<{ planId: string | null; clerkId: string | null; subscriptionId: string | null }> {
  // Basil Charge types omit `invoice`. Webhook payloads still send it.
  const invoiceRef = (
    charge as Stripe.Charge & { invoice?: string | { id?: string } | null }
  ).invoice;
  const invoiceId = typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id ?? null;
  if (!invoiceId) return { planId: null, clerkId: null, subscriptionId: null };
  let invoice: Stripe.Invoice;
  try {
    invoice = await stripe.invoices.retrieve(invoiceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`[stripe] charge ${charge.id}: invoice retrieve failed: ${message}`);
  }
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return { planId: null, clerkId: null, subscriptionId: null };
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    throw new Error(`[stripe] charge ${charge.id}: subscription retrieve failed: ${message}`);
  }
  return {
    planId: sub.metadata?.plan_id ?? null,
    clerkId: sub.metadata?.clerk_id ?? null,
    subscriptionId,
  };
}

async function recordBillingAlert(
  sb: AdminClient,
  event: Stripe.Event,
  stripeObjectId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("billing_alerts").insert({
    stripe_event_id: event.id,
    alert_type: event.type,
    stripe_object_id: stripeObjectId,
    detail,
  });
  if (error && !isUniqueViolation(error)) {
    throw new Error(`[stripe] billing alert ${event.id} failed: ${error.message}`);
  }
  console.error(`[stripe][alert] ${event.type} ${event.id} ${stripeObjectId}`);
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

  const stripe = new Stripe(key, {
    apiVersion: "2025-08-27.basil",
    timeout: 20_000,
    maxNetworkRetries: 2,
  });

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
  let claimToken: string | null = null;

  try {
    selfClaim = await eventClaimsItself(sb, event);
    if (sb && !selfClaim) {
      const claim = await claimStripeEvent(sb, event.id, event.type);
      if (claim.status === "duplicate") {
        return NextResponse.json({ received: true, replayed: true });
      }
      if (claim.status === "in_progress") {
        return NextResponse.json(
          { error: "Webhook event is already in progress" },
          { status: 500 },
        );
      }
      claimToken = claim.token;
      ownedClaim = true;
    } else if (sb && (await isEventProcessed(sb, event.id))) {
      return NextResponse.json({ received: true, replayed: true });
    }

    const eventResult = "processed";
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
        if (planId && clerkId && PLANS[planId]?.billingType === "one_time" && !sb) {
          throw new Error(
            `[stripe] checkout.session.completed ${event.id}: admin supabase is not configured`,
          );
        }
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
        const expiredSession = event.data.object as Stripe.Checkout.Session;
        const expiredMeta = expiredSession.metadata || {};
        const expiredOrderId = expiredMeta.marketplace_order_id;
        const expiresAgentOrder = Boolean(expiredOrderId && expiredMeta.product_type === "agent");
        if (!sb) {
          if (expiresAgentOrder || expiredMeta.product_type === "plan") {
            throw new Error(
              `[stripe] checkout.session.expired ${event.id}: admin supabase is not configured`,
            );
          }
          break;
        }
        if (expiresAgentOrder) {
          const { error: rpcError } = await sb.rpc("expire_pending_order", {
            p_order_id: expiredOrderId,
          });
          if (rpcError) {
            throw new Error(`expire_pending_order failed: ${rpcError.message}`);
          }
        }
        const { error: releaseError } = await sb.rpc("release_checkout_reservation", {
          p_session_id: expiredSession.id,
        });
        if (releaseError) {
          throw new Error(
            `release_checkout_reservation failed: ${releaseError.message}`,
          );
        }
        break;
      }

      case "payment_intent.payment_failed": {
        // Mark the matching pending order as failed.
        // Look up by payment_intent_id first (primary), then by metadata.
        if (!sb) {
          throw new Error(
            `[stripe] payment_intent.payment_failed ${event.id}: admin supabase is not configured`,
          );
        }
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
        if (!sb) {
          throw new Error(
            `[stripe] ${event.type} ${event.id}: admin supabase is not configured`,
          );
        }
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
        // Identity, ordering, and the plan write run in one locked transaction.
        // This event does not grant credits. A conflict throws so this delivery is 500.
        let applied = sub;
        let authoritative = false;
        let settled = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          const appliedMeta = applied.metadata || {};
          const planId = resolveSubscriptionPlan(
            (appliedMeta.plan_id as PlanId) || subPlanId,
            priceIdFromSubscription(applied),
            `${event.type} ${sub.id}`,
          );
          const periodEndUnix = applied.items?.data?.[0]?.current_period_end;
          const periodStartUnix = applied.items?.data?.[0]?.current_period_start;
          const decision = await applySubscriptionEvent(sb, {
            userId: subUserId,
            incomingSubscriptionId: sub.id,
            event,
            authoritative,
            ordering: "skip_if_older",
            requireExisting: false,
            plan: planId,
            status: applied.status,
            updatePlan: true,
            statusPolicy: "write",
            liveStatus: null,
            stripeCustomerId:
              typeof applied.customer === "string"
                ? applied.customer
                : applied.customer?.id ?? null,
            periodStart: unixSecondsToIso(periodStartUnix),
            periodEnd: unixSecondsToIso(periodEndUnix),
            cancelAtPeriodEnd: applied.cancel_at_period_end === true,
            incomingPlan: planId,
            grantMode: "none",
            grantAmount: null,
            grantIdempotencyKey: null,
            grantDescription: null,
            grantReferenceId: null,
            grantExpiresAt: null,
            skipGrantIdempotencyKey: null,
          });
          if (decision.outcome === "applied") {
            settled = true;
            break;
          }
          if (decision.outcome === "stale") {
            const live = await readLiveSubscription(stripe, event, sub.id);
            if (!live.status) {
              throw new Error(
                `[stripe] ${event.type} ${event.id}: live subscription has no status`,
              );
            }
            await applyReconciledStatus(sb, event, subUserId, sub.id, live.status);
            settled = true;
            break;
          }
          if (decision.outcome === "recheck") {
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
            authoritative = true;
            continue;
          }
        }
        if (!settled) {
          throw new Error(
            `[stripe] ${event.type} ${event.id}: subscription event was not applied`,
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        if (!sb) {
          throw new Error(
            `[stripe] customer.subscription.deleted ${event.id}: admin supabase is not configured`,
          );
        }
        const delSub = event.data.object as Stripe.Subscription;
        const { data: delMatch, error: delLookupError } = await sb
          .from("subscriptions")
          .select("user_id")
          .eq("stripe_subscription_id", delSub.id)
          .single();
        if (delLookupError && !isMissingRow(delLookupError)) {
          throw new Error(
            `[stripe] customer.subscription.deleted ${delSub.id}: ${delLookupError.message}`,
          );
        }
        if (!delMatch) {
          throw new Error(
            `[stripe] customer.subscription.deleted ${delSub.id}: no subscription row`,
          );
        }
        const deleted = await applySubscriptionEvent(sb, {
          userId: delMatch.user_id,
          incomingSubscriptionId: delSub.id,
          event,
          authoritative: true,
          ordering: "skip_if_older",
          requireExisting: true,
          plan: null,
          status: "canceled",
          updatePlan: false,
          statusPolicy: "write",
          liveStatus: null,
          stripeCustomerId: null,
          periodStart: null,
          periodEnd: null,
          cancelAtPeriodEnd: false,
          incomingPlan: null,
          grantMode: "none",
          grantAmount: null,
          grantIdempotencyKey: null,
          grantDescription: null,
          grantReferenceId: null,
          grantExpiresAt: null,
          skipGrantIdempotencyKey: null,
        });
        if (deleted.outcome === "stale") {
          const live = await readLiveSubscription(stripe, event, delSub.id);
          if (!live.status) {
            throw new Error(
              `[stripe] customer.subscription.deleted ${event.id}: live subscription has no status`,
            );
          }
          await applyReconciledStatus(sb, event, delMatch.user_id, delSub.id, live.status);
        } else if (deleted.outcome !== "applied") {
          throw new Error(
            `[stripe] customer.subscription.deleted ${event.id}: cancellation was not applied`,
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
        const invoiceClerk = clerkIdFromInvoice(inv);
        if (invoiceClerk) {
          await acknowledgeIfSupersededInvoice(sb, event, invoiceClerk, invSubId);
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
        // Self-healing fallback: if subscription.created was lost, resolve
        // the user from Stripe. The write and the grant share one transaction
        // below, so a failed grant does not leave a reconstructed row behind.
        let reconstruct: {
          planId: string;
          status: string;
          customerId: string | null;
          periodStart: string | null;
          periodEnd: string | null;
          cancelAtPeriodEnd: boolean;
        } | null = null;
        if (!invMatch) {
          console.warn(
            `[stripe] invoice.paid ${event.id}: subscription row missing after retries, resolving via Stripe API`,
          );
          try {
            const fullSub = await stripe.subscriptions.retrieve(invSubId, undefined, {
              timeout: 8000,
            });
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
                reconstruct = {
                  planId,
                  status: fullSub.status,
                  customerId:
                    typeof inv.customer === "string"
                      ? inv.customer
                      : inv.customer?.id ?? null,
                  periodStart: unixSecondsToIso(fullSub.items?.data?.[0]?.current_period_start),
                  periodEnd: unixSecondsToIso(fullSub.items?.data?.[0]?.current_period_end),
                  cancelAtPeriodEnd: fullSub.cancel_at_period_end === true,
                };
                invMatch = {
                  user_id: u.id,
                  plan: planId,
                  status: fullSub.status,
                  last_stripe_event_created: null,
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
        // row. The locked function compares event.created with the stored
        // Stripe second. A failed re-read is 500: guessing "active" is the bug.
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
        // The credit is a function of this invoice alone. A base or renewal
        // invoice grants that price's allowance. An upgrade invoice grants
        // the delta only when Stripe settled the proration. A plan change
        // that has not been paid grants nothing, and the stored plan cannot
        // change the amount.
        const settled = settledInvoiceCredit(inv, `invoice.paid ${event.id}`);
        let grantMode: "none" | "invoice_full" = "none";
        let grantAmount: number | null = null;
        let grantKey: string | null = null;
        let grantDescription: string | null = null;
        let grantReferenceId: string | null = null;
        let grantExpiresAt: string | null = null;
        const planForCall = settled?.plan ?? invMatch.plan;
        if (settled) {
          const periodEnd = inv.lines?.data?.[0]?.period?.end;
          grantMode = "invoice_full";
          grantAmount = settled.amount;
          grantKey = `invoice_grant_${inv.id}`;
          grantDescription =
            settled.kind === "upgrade"
              ? `Plan upgrade to ${PLANS[settled.plan].name} — ${settled.amount} LiTTBits`
              : `${PLANS[settled.plan].name} monthly grant — ${settled.amount} LiTTBits`;
          grantReferenceId = `invoice_${inv.id}`;
          grantExpiresAt = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;
        }
        await applySubscriptionEvent(sb, {
          userId: invMatch.user_id,
          incomingSubscriptionId: invSubId,
          event,
          authoritative: true,
          ordering: "apply",
          requireExisting: reconstruct === null,
          plan: planForCall,
          status: reconstruct?.status ?? null,
          updatePlan: reconstruct !== null,
          statusPolicy: "activate_unless_terminal",
          liveStatus,
          stripeCustomerId: reconstruct?.customerId ?? null,
          periodStart: reconstruct?.periodStart ?? null,
          periodEnd: reconstruct?.periodEnd ?? null,
          cancelAtPeriodEnd: reconstruct?.cancelAtPeriodEnd ?? null,
          incomingPlan: planForCall,
          grantMode,
          grantAmount,
          grantIdempotencyKey: grantKey,
          grantDescription,
          grantReferenceId,
          grantExpiresAt,
          skipGrantIdempotencyKey: null,
        });
        break;
      }

      case "invoice.payment_failed": {
        if (!sb) {
          throw new Error(
            `[stripe] invoice.payment_failed ${event.id}: admin supabase is not configured`,
          );
        }
        const failInv = event.data.object as Stripe.Invoice;
        const failSubId = failInv.parent?.subscription_details?.subscription;
        if (!failSubId || typeof failSubId !== "string") {
          throw new Error(
            `[stripe] invoice.payment_failed ${event.id}: missing subscription id`,
          );
        }
        const failedClerk = clerkIdFromInvoice(failInv);
        if (failedClerk) {
          await acknowledgeIfSupersededInvoice(sb, event, failedClerk, failSubId);
        }
        const { data: failMatch, error: failLookupError } = await sb
          .from("subscriptions")
          .select("user_id, status, last_stripe_event_created")
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
        const failed = await applySubscriptionEvent(sb, {
          userId: failMatch.user_id,
          incomingSubscriptionId: failSubId,
          event,
          authoritative: true,
          ordering: "skip_if_older",
          requireExisting: true,
          plan: null,
          status: "past_due",
          updatePlan: false,
          statusPolicy: "write",
          liveStatus: null,
          stripeCustomerId: null,
          periodStart: null,
          periodEnd: null,
          cancelAtPeriodEnd: null,
          incomingPlan: null,
          grantMode: "none",
          grantAmount: null,
          grantIdempotencyKey: null,
          grantDescription: null,
          grantReferenceId: null,
          grantExpiresAt: null,
          skipGrantIdempotencyKey: null,
        });
        if (failed.outcome === "stale") {
          // subscription.created can be one second newer and leave the row
          // incomplete. That clock must not drop this status. A live
          // active, trialing, or ended subscription still wins over past_due.
          const live = await readLiveSubscription(stripe, event, failSubId);
          const liveStatus = live.status ?? "";
          const superseding = new Set([
            "active",
            "trialing",
            "canceled",
            "incomplete_expired",
            "unpaid",
            "paused",
          ]);
          const status = superseding.has(liveStatus) ? liveStatus : "past_due";
          if (!status) {
            throw new Error(
              `[stripe] invoice.payment_failed ${event.id}: live subscription has no status`,
            );
          }
          await applyReconciledStatus(
            sb,
            event,
            failMatch.user_id,
            failSubId,
            status,
          );
        } else if (failed.outcome !== "applied") {
          throw new Error(
            `[stripe] invoice.payment_failed ${event.id}: past_due was not applied`,
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
        // Subscription invoice charges often have no plan metadata. Read the
        // invoice, then the subscription, before deciding this is not a plan.
        // Do NOT debit LiTTBits for Founder refunds — Founder has 0 LiTTBits.
        let refundPlanId = refundMeta.plan_id as PlanId | undefined;
        let planClerkId = refundClerkId;
        if (refundProductType !== "credit_pack" && (!refundPlanId || !planClerkId)) {
          const meta = await subscriptionMetaForCharge(stripe, charge);
          if (!refundPlanId && meta.planId && meta.planId in PLANS) {
            refundPlanId = meta.planId as PlanId;
          }
          if (!planClerkId && meta.clerkId) planClerkId = meta.clerkId;
          if (meta.subscriptionId && (!refundPlanId || !planClerkId)) {
            throw new Error(
              `[stripe] charge.refunded ${charge.id}: subscription ${meta.subscriptionId} has no plan metadata`,
            );
          }
        }
        if (refundPlanId && planClerkId) {
          const plan = PLANS[refundPlanId];
          if (plan) {
            const { data: refundUser } = await sb
              .from("users")
              .select("id")
              .eq("clerk_id", planClerkId)
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

      case "charge.dispute.created":
      case "charge.dispute.updated":
      case "charge.dispute.closed":
      case "charge.dispute.funds_withdrawn":
      case "charge.dispute.funds_reinstated": {
        if (!sb) {
          throw new Error(
            `[stripe] ${event.type} ${event.id}: admin supabase is not configured`,
          );
        }
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId =
          typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        if (!chargeId) {
          throw new Error(`[stripe] ${event.type} ${event.id}: dispute has no charge`);
        }
        let charge: Stripe.Charge;
        try {
          charge = await stripe.charges.retrieve(chargeId);
        } catch (err) {
          const message = err instanceof Error ? err.message : "unknown error";
          throw new Error(`[stripe] ${event.type} ${event.id}: charge retrieve failed: ${message}`);
        }
        const meta = await subscriptionMetaForCharge(stripe, charge);
        const clerkId = charge.metadata?.clerk_id || meta.clerkId;
        await recordBillingAlert(sb, event, dispute.id, {
          charge_id: chargeId,
          dispute_status: dispute.status,
          reason: dispute.reason,
          subscription_id: meta.subscriptionId,
          amount: dispute.amount,
        });
        const locksAccess =
          event.type === "charge.dispute.created" ||
          event.type === "charge.dispute.funds_withdrawn";
        const restoresAccess =
          event.type === "charge.dispute.funds_reinstated" ||
          (event.type === "charge.dispute.closed" &&
            (dispute.status === "won" || dispute.status === "warning_closed"));
        if (clerkId && meta.subscriptionId && (locksAccess || restoresAccess)) {
          const { data: disputeUser, error: userError } = await sb
            .from("users")
            .select("id")
            .eq("clerk_id", clerkId)
            .maybeSingle();
          if (userError) {
            throw new Error(`[stripe] ${event.type} ${event.id}: user lookup failed: ${userError.message}`);
          }
          if (disputeUser) {
            const nextStatus = locksAccess ? "disputed" : "active";
            let update = sb
              .from("subscriptions")
              .update({ status: nextStatus, updated_at: new Date().toISOString() })
              .eq("user_id", disputeUser.id)
              .eq("stripe_subscription_id", meta.subscriptionId);
            if (!locksAccess) update = update.eq("status", "disputed");
            const { error: statusError } = await update;
            if (statusError) {
              throw new Error(
                `[stripe] ${event.type} ${event.id}: subscription status update failed: ${statusError.message}`,
              );
            }
          }
        }
        break;
      }
    }

    if (sb && ownedClaim && claimToken) {
      await finalizeStripeEvent(sb, event.id, claimToken, eventResult);
    } else if (sb && selfClaim) {
      await markEventProcessed(sb, event.id, event.type, "processed");
    }
  } catch (err) {
    if (err instanceof SupersededSubscriptionError) {
      console.error("[stripe] superseded subscription acknowledged", event.id, err);
      if (sb && ownedClaim && claimToken) {
        try {
          await finalizeStripeEvent(sb, event.id, claimToken, "superseded_subscription");
          return NextResponse.json({ received: true, result: "superseded_subscription" });
        } catch (finalizeErr) {
          console.error("[stripe] failed to record superseded subscription", event.id, finalizeErr);
          try {
            await releaseStripeEvent(sb, event.id, claimToken);
          } catch (releaseErr) {
            console.error("[stripe] failed to release event claim", event.id, releaseErr);
          }
        }
      }
      return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
    }
    console.error("[stripe] webhook processing failed", event.id, err);
    if (sb && ownedClaim && claimToken) {
      try {
        await releaseStripeEvent(sb, event.id, claimToken);
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
