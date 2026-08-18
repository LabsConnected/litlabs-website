/**
 * Billing display resolver — pure presentation logic.
 *
 * Reads from the canonical PLANS config (server authority) and the
 * subscription data returned by /api/billing/subscription. Does NOT
 * duplicate billing business logic — it only maps server data to
 * display-ready values for the settings/billing UI.
 */
import { PLANS, type PlanId, type BillingType, type PlanDefinition } from "@/config/plans";

export interface SubscriptionData {
  plan?: string;
  status: string;
  stripe_customer_id: string | null;
  current_period_end: string | null;
}

export interface PlanData {
  id: string;
  name: string;
  billingType?: BillingType;
  monthlyPriceCents: number | null;
  default_price?: number | null;
  monthlyCredits: number;
  beta: boolean;
}

export interface BillingDisplay {
  planName: string;
  billingType: BillingType;
  planPriceCents: number;
  isPaid: boolean;
  isSubscription: boolean;
  isOneTime: boolean;
  isFree: boolean;
  priceLabel: string;
  /** The resolved PlanDefinition from the canonical catalog, if found. */
  plan: PlanDefinition | null;
  /** Whether the "Manage billing" portal button should be shown. */
  showPortal: boolean;
  /** Whether the subscription status indicates active access. */
  isActive: boolean;
  /** Whether the subscription was canceled but period hasn't ended. */
  isCanceledWithAccess: boolean;
  /** Whether payment is past due. */
  isPastDue: boolean;
  /** Formatted renewal or access-end date, if applicable. */
  periodEndDate: Date | null;
}

/**
 * Resolve the plan to display. The subscription row carries the real
 * purchased plan id (e.g. "creator_beta") even when the API falls back
 * to Starter for non-active statuses — so a canceled-but-still-within-period
 * subscriber sees their real plan, not a misleading "Starter / Free".
 */
export function resolveBillingDisplay(
  apiPlan: PlanData | null,
  subscription: SubscriptionData | null,
): BillingDisplay {
  const subPlanId = subscription?.plan as PlanId | undefined;
  const subPlan = subPlanId && PLANS[subPlanId] ? PLANS[subPlanId] : null;
  const displayPlan = subPlan ?? apiPlan ?? null;

  const planName = displayPlan?.name ?? "Starter";
  const billingType: BillingType = displayPlan?.billingType ?? "free";
  const planPriceCents =
    billingType === "one_time"
      ? (displayPlan?.default_price ?? displayPlan?.monthlyPriceCents ?? 0)
      : (displayPlan?.monthlyPriceCents ?? 0);
  const isSubscription = billingType === "subscription";
  const isOneTime = billingType === "one_time";
  const isFree = billingType === "free";
  const isPaid = planPriceCents !== null && planPriceCents > 0;

  const priceLabel = !isPaid
    ? "Free"
    : isOneTime
      ? `$${(planPriceCents / 100).toFixed(0)} one-time`
      : `$${(planPriceCents / 100).toFixed(0)}/month`;

  const subStatus = subscription?.status ?? "none";
  const periodEnd = subscription?.current_period_end ?? null;
  const periodEndDate = periodEnd ? new Date(periodEnd) : null;
  const periodInFuture = periodEndDate ? periodEndDate.getTime() > Date.now() : false;

  const isActive = isSubscription && subStatus === "active";
  const isCanceledWithAccess = isSubscription && subStatus === "canceled" && periodInFuture;
  const isPastDue = isSubscription && subStatus === "past_due";

  // Portal manages a recurring subscription. One-time purchases (Founder)
  // have no subscription to manage, so the portal button is hidden for them.
  // Also requires a Stripe customer id — without one there is nothing to
  // manage in the portal.
  const showPortal =
    isSubscription &&
    isPaid &&
    Boolean(subscription?.stripe_customer_id);

  return {
    planName,
    billingType,
    planPriceCents,
    isPaid,
    isSubscription,
    isOneTime,
    isFree,
    priceLabel,
    plan: displayPlan as PlanDefinition | null,
    showPortal,
    isActive,
    isCanceledWithAccess,
    isPastDue,
    periodEndDate,
  };
}
