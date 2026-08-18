/**
 * Billing UX Display — Presentation Logic Tests
 *
 * Proves the customer-facing billing display resolver correctly:
 *  1. Identifies the current plan from server authority
 *  2. Identifies LiTTBits balance (via balances object — tested at the
 *     integration level; here we test plan/price resolution)
 *  3. Shows subscription management for paid subscribers
 *  4. Founder is NOT shown as monthly
 *  5. Founder is NOT promised recurring LiTTBits
 *  6. Canceled/past_due does not appear fully active
 *  7. Checkout success gives a useful next step (via priceLabel/planName)
 *  8. Checkout cancel/failure does not strand user (tested at page level)
 *  9. No obsolete "coins" terminology (verified by product-truth tests)
 * 10. UI reflects server authority rather than duplicating billing logic
 */
import { describe, it, expect } from "vitest";
import { resolveBillingDisplay } from "@/lib/billing/display";
import { PLANS } from "@/config/plans";

describe("Billing UX Display — resolveBillingDisplay", () => {
  // ── 1. User can identify current plan ──────────────────────────────

  describe("Plan identification", () => {
    it("shows Starter when no subscription and no API plan", () => {
      const d = resolveBillingDisplay(null, null);
      expect(d.planName).toBe("Starter");
      expect(d.isFree).toBe(true);
      expect(d.priceLabel).toBe("Free");
    });

    it("shows Creator Beta when subscription is active", () => {
      const d = resolveBillingDisplay(PLANS.starter, {
        plan: "creator_beta",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(d.planName).toBe("Creator Beta");
      expect(d.isSubscription).toBe(true);
      expect(d.isActive).toBe(true);
    });

    it("shows Pro Builder Beta when subscription is active", () => {
      const d = resolveBillingDisplay(PLANS.starter, {
        plan: "pro_builder_beta",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(d.planName).toBe("Pro Builder Beta");
      expect(d.priceLabel).toBe("$39/month");
    });

    it("prefers subscription plan over API plan (server authority)", () => {
      // API may fall back to Starter for non-active statuses, but the
      // subscription row carries the real purchased plan id.
      const d = resolveBillingDisplay(PLANS.starter, {
        plan: "creator_beta",
        status: "canceled",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(d.planName).toBe("Creator Beta");
      expect(d.planName).not.toBe("Starter");
    });
  });

  // ── 3. Paid subscriber can find subscription management ────────────

  describe("Portal button visibility", () => {
    it("shows portal for active subscription", () => {
      const d = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(d.showPortal).toBe(true);
    });

    it("shows portal for canceled subscription (still has Stripe customer)", () => {
      const d = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "canceled",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(d.showPortal).toBe(true);
    });

    it("does NOT show portal for free plan", () => {
      const d = resolveBillingDisplay(PLANS.starter, null);
      expect(d.showPortal).toBe(false);
    });

    it("does NOT show portal for Founder (one-time purchase)", () => {
      const d = resolveBillingDisplay(PLANS.founder, {
        plan: "founder",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: null,
      });
      expect(d.showPortal).toBe(false);
      expect(d.isOneTime).toBe(true);
    });

    it("does NOT show portal when Stripe customer is missing", () => {
      const d = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "active",
        stripe_customer_id: null,
        current_period_end: "2026-12-01T00:00:00Z",
      });

      expect(d.showPortal).toBe(false);
    });
  });

  // ── 4. Founder is not shown as monthly ─────────────────────────────

  describe("Founder presentation", () => {
    it("shows $149 one-time, not $149/month", () => {
      const d = resolveBillingDisplay(PLANS.founder, {
        plan: "founder",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: null,
      });
      expect(d.priceLabel).toBe("$149 one-time");
      expect(d.priceLabel).not.toContain("/month");
      expect(d.isOneTime).toBe(true);
      expect(d.isSubscription).toBe(false);
    });

    it("is not marked as subscription", () => {
      const d = resolveBillingDisplay(PLANS.founder, {
        plan: "founder",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: null,
      });
      expect(d.isSubscription).toBe(false);
      expect(d.billingType).toBe("one_time");
    });

    // ── 5. Founder is not promised recurring LiTTBits ────────────────

    it("Founder plan has zero monthlyCredits in canonical config", () => {
      // This is a config-level check, but it proves the display resolver
      // reads from server authority (PLANS) rather than inventing values.
      expect(PLANS.founder.monthlyCredits).toBe(0);
      const d = resolveBillingDisplay(PLANS.founder, {
        plan: "founder",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: null,
      });
      // The display plan comes from PLANS, so monthlyCredits is 0
      expect(d.plan?.monthlyCredits).toBe(0);
    });

    it("Founder does not show a renewal date", () => {
      const d = resolveBillingDisplay(PLANS.founder, {
        plan: "founder",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: null,
      });
      expect(d.isActive).toBe(false); // isActive is only for subscriptions
      expect(d.periodEndDate).toBe(null);
    });
  });

  // ── 6. Canceled/past_due does not appear fully active ──────────────

  describe("Subscription status display", () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const pastDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    it("active subscription shows as active", () => {
      const d = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: futureDate,
      });
      expect(d.isActive).toBe(true);
      expect(d.isCanceledWithAccess).toBe(false);
      expect(d.isPastDue).toBe(false);
    });

    it("canceled with future period end shows canceled-with-access, not active", () => {
      const d = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "canceled",
        stripe_customer_id: "cus_123",
        current_period_end: futureDate,
      });
      expect(d.isActive).toBe(false);
      expect(d.isCanceledWithAccess).toBe(true);
      expect(d.isPastDue).toBe(false);
    });

    it("canceled with past period end shows canceled, not active and not with-access", () => {
      const d = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "canceled",
        stripe_customer_id: "cus_123",
        current_period_end: pastDate,
      });
      expect(d.isActive).toBe(false);
      expect(d.isCanceledWithAccess).toBe(false);
    });

    it("past_due shows as past due, not active", () => {
      const d = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "past_due",
        stripe_customer_id: "cus_123",
        current_period_end: futureDate,
      });
      expect(d.isActive).toBe(false);
      expect(d.isPastDue).toBe(true);
    });

    it("none/missing subscription is not active", () => {
      const d = resolveBillingDisplay(PLANS.starter, null);
      expect(d.isActive).toBe(false);
      expect(d.isCanceledWithAccess).toBe(false);
      expect(d.isPastDue).toBe(false);
    });
  });

  // ── 10. UI reflects server authority ───────────────────────────────

  describe("Server authority", () => {
    it("display plan comes from PLANS config, not invented", () => {
      const d = resolveBillingDisplay(null, {
        plan: "creator_beta",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(d.plan).toBe(PLANS.creator_beta);
      expect(d.planName).toBe(PLANS.creator_beta.name);
      expect(d.priceLabel).toBe("$15/month");
    });

    it("price label matches canonical pricing", () => {
      const creator = resolveBillingDisplay(PLANS.creator_beta, {
        plan: "creator_beta",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(creator.priceLabel).toBe("$15/month");

      const pro = resolveBillingDisplay(PLANS.pro_builder_beta, {
        plan: "pro_builder_beta",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(pro.priceLabel).toBe("$39/month");

      const founder = resolveBillingDisplay(PLANS.founder, {
        plan: "founder",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: null,
      });
      expect(founder.priceLabel).toBe("$149 one-time");

      const starter = resolveBillingDisplay(PLANS.starter, null);
      expect(starter.priceLabel).toBe("Free");
    });

    it("falls back to API plan when subscription has no plan field", () => {
      const d = resolveBillingDisplay(PLANS.pro_builder_beta, {
        plan: undefined,
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      expect(d.planName).toBe("Pro Builder Beta");
    });

    it("falls back to Starter when subscription plan is unknown", () => {
      const d = resolveBillingDisplay(PLANS.starter, {
        plan: "nonexistent_plan",
        status: "active",
        stripe_customer_id: "cus_123",
        current_period_end: "2026-12-01T00:00:00Z",
      });
      // Unknown plan in subscription falls back to apiPlan (Starter)
      expect(d.planName).toBe("Starter");
    });
  });
});
