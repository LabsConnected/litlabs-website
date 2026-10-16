import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHECKOUT_BLOCKING_SUBSCRIPTION_STATUSES,
  checkoutBlocksAnotherSubscription,
  subscriptionGrantsPaidPlan,
} from "@/lib/billing/subscription-entitlement";

describe("subscription entitlement policy", () => {
  it("entitles active and trialing and withholds past_due", () => {
    expect(subscriptionGrantsPaidPlan("active")).toBe(true);
    expect(subscriptionGrantsPaidPlan("trialing")).toBe(true);
    expect(subscriptionGrantsPaidPlan("past_due")).toBe(false);
    for (const status of ["unpaid", "paused", "incomplete", "incomplete_expired", "canceled", "refunded", "disputed"]) {
      expect(subscriptionGrantsPaidPlan(status)).toBe(false);
    }
  });

  it("blocks a second checkout for unpaid, paused, incomplete, and refunded", () => {
    for (const status of ["unpaid", "paused", "incomplete", "refunded", "past_due", "disputed"]) {
      expect(checkoutBlocksAnotherSubscription(status)).toBe(true);
    }
    expect(checkoutBlocksAnotherSubscription("canceled")).toBe(false);
    expect(checkoutBlocksAnotherSubscription("incomplete_expired")).toBe(false);
  });

  it("is the status list media caps, wallet, and paid features import", () => {
    const media = readFileSync("src/lib/generation/enforce-media-caps.ts", "utf8");
    const wallet = readFileSync("src/lib/wallet-ledger.ts", "utf8");
    const paid = readFileSync("src/lib/entitlements.ts", "utf8");
    const agents = readFileSync("src/lib/agent-entitlements.ts", "utf8");
    const metering = readFileSync("src/app/api/admin/metering-reconciliation/route.ts", "utf8");
    for (const source of [media, wallet, paid, agents, metering]) {
      expect(source).toContain("subscription-entitlement");
    }
    expect(media).not.toContain('new Set(["active", "trialing", "past_due"])');
    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    expect(webhook).toContain("claim_stripe_event");
    expect(webhook).toContain("p_claim_token");
    expect(webhook).not.toContain('.delete()\n      .eq("stripe_event_id"');
    const checkoutSql = readFileSync(
      "supabase/migrations/20261015230000_checkout_block_protected_subscription.sql",
      "utf8",
    );
    for (const status of ["unpaid", "paused", "incomplete", "refunded"]) {
      expect(checkoutSql).toContain(`'${status}'`);
    }
    expect(CHECKOUT_BLOCKING_SUBSCRIPTION_STATUSES).toEqual([
      "active",
      "trialing",
      "past_due",
      "unpaid",
      "paused",
      "incomplete",
      "refunded",
      "disputed",
    ]);
  });
});
