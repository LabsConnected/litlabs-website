/**
 * Subscription entitlement policy for the paid beta.
 *
 * One predicate decides whether a subscription row unlocks the paid plan.
 * Wallet "has a plan" checks, paid features (`getUserPlan` /
 * `premiumModels`), media caps, and managed provider spend all call
 * `subscriptionGrantsPaidPlan`. Do not keep a second status list.
 *
 * trialing — entitled. A Stripe trial is a live subscription. The plan on
 * the row is the plan these surfaces use.
 *
 * past_due — not entitled. The latest invoice failed. The row stays, and
 * checkout will not open a second subscription, but paid features, plan
 * media caps, and managed provider spend fall back to Starter until a
 * later invoice.paid returns the status to active. Balances already in
 * the wallet are not zeroed and are not rescaled.
 *
 * active — entitled.
 * unpaid, paused, incomplete, incomplete_expired, canceled, refunded,
 * disputed — not entitled.
 *
 * Checkout blocking is a different list. Any status the subscription
 * apply function will not replace (everything except canceled and
 * incomplete_expired) must refuse a new Checkout session. That includes
 * past_due, which is not entitled, and unpaid, paused, incomplete, and
 * refunded, which a second Checkout would turn into a subscription the
 * webhook then records as superseded.
 */

export const ENTITLED_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;

export type EntitledSubscriptionStatus = (typeof ENTITLED_SUBSCRIPTION_STATUSES)[number];

export const CHECKOUT_BLOCKING_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
  "refunded",
  "disputed",
] as const;

export function subscriptionGrantsPaidPlan(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}

export function checkoutBlocksAnotherSubscription(status: string | null | undefined): boolean {
  return (CHECKOUT_BLOCKING_SUBSCRIPTION_STATUSES as readonly string[]).includes(status ?? "");
}
