/**
 * Stripe catalog normalization contract gate.
 *
 * This test enforces that the application's advertised plan prices
 * match the expected Stripe live catalog prices. It is the single
 * source of truth for "app price = Stripe price" alignment.
 *
 * If this test fails, either:
 * - The application code was changed to advertise a different price
 * - The Stripe price IDs in Railway were changed to point to different prices
 * - Someone needs to update the expected values after an intentional price change
 *
 * Production validation command (run manually with Stripe API access):
 *   stripe prices retrieve price_1U36qFJ53kgx4fp5avhUOuBH  # Creator $15
 *   stripe prices retrieve price_1U36qFJ53kgx4fp52s6oy53l  # Pro $39
 *   stripe prices retrieve price_1U066EJ53kgx4fp5ZLKsk6wp  # Founder $149
 */

import { describe, it, expect } from "vitest";
import { PLANS } from "@/config/plans";
import { PLAN_CONTRACTS, VERIFIED_STRIPE_PLANS } from "@/config/product-truth";

/**
 * The canonical expected Stripe catalog.
 * These values are verified against the live Stripe API.
 * Update this ONLY after intentionally changing Stripe prices
 * AND updating the Railway environment variables.
 */
export const EXPECTED_STRIPE_CATALOG = {
  creator_beta: {
    priceCents: 1500,
    priceMode: "recurring" as const,
    envVar: "STRIPE_PRICE_CREATOR_BETA",
    label: "Creator $15/month",
  },
  pro_builder_beta: {
    priceCents: 3900,
    priceMode: "recurring" as const,
    envVar: "STRIPE_PRICE_PRO_BUILDER_BETA",
    label: "Pro Builder $39/month",
  },
  founder: {
    priceCents: 14900,
    priceMode: "one_time" as const,
    envVar: "STRIPE_PRICE_FOUNDER",
    label: "Founder $149 one-time",
  },
} as const;

describe("Stripe catalog normalization — single source of truth", () => {
  describe("Creator Beta $15/month", () => {
    it("PLANS.monthlyPriceCents matches expected Stripe price", () => {
      expect(PLANS.creator_beta.monthlyPriceCents).toBe(
        EXPECTED_STRIPE_CATALOG.creator_beta.priceCents,
      );
    });

    it("PLAN_CONTRACTS.priceCents matches expected Stripe price", () => {
      expect(PLAN_CONTRACTS.creator_beta.priceCents).toBe(
        EXPECTED_STRIPE_CATALOG.creator_beta.priceCents,
      );
    });

    it("VERIFIED_STRIPE_PLANS.priceCents matches expected Stripe price", () => {
      expect(VERIFIED_STRIPE_PLANS.creator_beta.priceCents).toBe(
        EXPECTED_STRIPE_CATALOG.creator_beta.priceCents,
      );
    });

    it("billing type is subscription/recurring", () => {
      expect(PLANS.creator_beta.billingType).toBe("subscription");
      expect(VERIFIED_STRIPE_PLANS.creator_beta.priceMode).toBe("recurring");
    });

    it("env var name is correct", () => {
      expect(PLANS.creator_beta.stripePriceIdEnv).toBe(
        EXPECTED_STRIPE_CATALOG.creator_beta.envVar,
      );
    });
  });

  describe("Pro Builder Beta $39/month", () => {
    it("PLANS.monthlyPriceCents matches expected Stripe price", () => {
      expect(PLANS.pro_builder_beta.monthlyPriceCents).toBe(
        EXPECTED_STRIPE_CATALOG.pro_builder_beta.priceCents,
      );
    });

    it("PLAN_CONTRACTS.priceCents matches expected Stripe price", () => {
      expect(PLAN_CONTRACTS.pro_builder_beta.priceCents).toBe(
        EXPECTED_STRIPE_CATALOG.pro_builder_beta.priceCents,
      );
    });

    it("VERIFIED_STRIPE_PLANS.priceCents matches expected Stripe price", () => {
      expect(VERIFIED_STRIPE_PLANS.pro_builder_beta.priceCents).toBe(
        EXPECTED_STRIPE_CATALOG.pro_builder_beta.priceCents,
      );
    });

    it("billing type is subscription/recurring", () => {
      expect(PLANS.pro_builder_beta.billingType).toBe("subscription");
      expect(VERIFIED_STRIPE_PLANS.pro_builder_beta.priceMode).toBe("recurring");
    });

    it("env var name is correct", () => {
      expect(PLANS.pro_builder_beta.stripePriceIdEnv).toBe(
        EXPECTED_STRIPE_CATALOG.pro_builder_beta.envVar,
      );
    });
  });

  describe("Founder $149 one-time", () => {
    it("PLANS.monthlyPriceCents matches expected Stripe price", () => {
      expect(PLANS.founder.monthlyPriceCents).toBe(
        EXPECTED_STRIPE_CATALOG.founder.priceCents,
      );
    });

    it("PLAN_CONTRACTS.priceCents matches expected Stripe price", () => {
      expect(PLAN_CONTRACTS.founder.priceCents).toBe(
        EXPECTED_STRIPE_CATALOG.founder.priceCents,
      );
    });

    it("VERIFIED_STRIPE_PLANS.priceCents matches expected Stripe price", () => {
      expect(VERIFIED_STRIPE_PLANS.founder.priceCents).toBe(
        EXPECTED_STRIPE_CATALOG.founder.priceCents,
      );
    });

    it("billing type is one_time", () => {
      expect(PLANS.founder.billingType).toBe("one_time");
      expect(VERIFIED_STRIPE_PLANS.founder.priceMode).toBe("one_time");
    });

    it("env var name is correct", () => {
      expect(PLANS.founder.stripePriceIdEnv).toBe(
        EXPECTED_STRIPE_CATALOG.founder.envVar,
      );
    });
  });

  describe("Cross-source consistency", () => {
    it("PLANS = PLAN_CONTRACTS = VERIFIED_STRIPE_PLANS for all plans", () => {
      for (const planId of ["creator_beta", "pro_builder_beta", "founder"] as const) {
        expect(PLANS[planId].monthlyPriceCents).toBe(PLAN_CONTRACTS[planId].priceCents);
        expect(PLANS[planId].monthlyPriceCents).toBe(VERIFIED_STRIPE_PLANS[planId].priceCents);
      }
    });

    it("no standardPriceCents (no tiered pricing)", () => {
      expect(PLANS.creator_beta.standardPriceCents).toBeNull();
      expect(PLANS.pro_builder_beta.standardPriceCents).toBeNull();
      expect(PLAN_CONTRACTS.creator_beta.standardPriceCents).toBeNull();
      expect(PLAN_CONTRACTS.pro_builder_beta.standardPriceCents).toBeNull();
    });
  });

  describe("Production report", () => {
    it("reports the expected catalog", () => {
      // This test serves as a living documentation of the production catalog
      const report = {
        creator: `$${EXPECTED_STRIPE_CATALOG.creator_beta.priceCents / 100} monthly`,
        pro: `$${EXPECTED_STRIPE_CATALOG.pro_builder_beta.priceCents / 100} monthly`,
        founder: `$${EXPECTED_STRIPE_CATALOG.founder.priceCents / 100} one-time`,
      };
      expect(report.creator).toBe("$15 monthly");
      expect(report.pro).toBe("$39 monthly");
      expect(report.founder).toBe("$149 one-time");
    });
  });
});
