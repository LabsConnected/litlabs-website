import { describe, it, expect } from "vitest";
import { PLANS, PLAN_LIST, PLAN_RANK, getPlanById, hasPlanAccess, formatPrice, formatPriceMonthly } from "@/config/plans";

describe("Pricing contract — single source of truth", () => {
  describe("Plan catalog integrity", () => {
    it("has exactly 4 plans: starter, creator_beta, pro_builder_beta, founder", () => {
      expect(Object.keys(PLANS).sort()).toEqual(
        ["starter", "creator_beta", "pro_builder_beta", "founder"].sort(),
      );
    });

    it("PLAN_LIST matches PLANS values", () => {
      expect(PLAN_LIST.length).toBe(4);
      expect(PLAN_LIST.every((p) => PLANS[p.id] === p)).toBe(true);
    });

    it("every plan has a unique id", () => {
      const ids = PLAN_LIST.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("every plan has required fields", () => {
      for (const plan of PLAN_LIST) {
        expect(plan.id).toBeTruthy();
        expect(plan.name).toBeTruthy();
        expect(plan.description).toBeTruthy();
        expect(plan.billingType).toBeTruthy();
        expect(plan.monthlyCredits).toBeGreaterThanOrEqual(0);
        expect(plan.activeProjectLimit).toBeGreaterThanOrEqual(0);
        expect(plan.features).toBeInstanceOf(Array);
        expect(plan.features.length).toBeGreaterThan(0);
        expect(typeof plan.beta).toBe("boolean");
        expect(typeof plan.enabled).toBe("boolean");
      }
    });
  });

  describe("Pricing values", () => {
    it("Starter is free", () => {
      expect(PLANS.starter.billingType).toBe("free");
      expect(PLANS.starter.monthlyPriceCents).toBe(0);
      expect(PLANS.starter.monthlyCredits).toBe(500);
    });

    it("Creator Beta is $7/month", () => {
      expect(PLANS.creator_beta.billingType).toBe("subscription");
      expect(PLANS.creator_beta.monthlyPriceCents).toBe(700);
      expect(PLANS.creator_beta.monthlyCredits).toBe(6000);
    });

    it("Pro Builder Beta is $19/month", () => {
      expect(PLANS.pro_builder_beta.billingType).toBe("subscription");
      expect(PLANS.pro_builder_beta.monthlyPriceCents).toBe(1900);
      expect(PLANS.pro_builder_beta.monthlyCredits).toBe(20000);
    });

    it("Founder is disabled for v1 launch", () => {
      expect(PLANS.founder.enabled).toBe(false);
      expect(PLANS.founder.billingType).toBe("one_time");
    });
  });

  describe("Plan ranking", () => {
    it("starter < creator_beta = founder < pro_builder_beta", () => {
      expect(PLAN_RANK.starter).toBe(0);
      expect(PLAN_RANK.creator_beta).toBe(1);
      expect(PLAN_RANK.founder).toBe(1);
      expect(PLAN_RANK.pro_builder_beta).toBe(2);
    });

    it("hasPlanAccess respects ranking", () => {
      expect(hasPlanAccess("starter", "starter")).toBe(true);
      expect(hasPlanAccess("starter", "creator_beta")).toBe(false);
      expect(hasPlanAccess("creator_beta", "creator_beta")).toBe(true);
      expect(hasPlanAccess("creator_beta", "pro_builder_beta")).toBe(false);
      expect(hasPlanAccess("pro_builder_beta", "creator_beta")).toBe(true);
      expect(hasPlanAccess("pro_builder_beta", "pro_builder_beta")).toBe(true);
      expect(hasPlanAccess("founder", "creator_beta")).toBe(true);
      expect(hasPlanAccess("founder", "pro_builder_beta")).toBe(false);
    });
  });

  describe("Price formatting", () => {
    it("formatPrice renders free for 0", () => {
      expect(formatPrice(0)).toBe("Free");
      expect(formatPrice(null)).toBe("Free");
    });

    it("formatPrice renders dollar amounts", () => {
      expect(formatPrice(700)).toBe("$7");
      expect(formatPrice(1900)).toBe("$19");
      expect(formatPrice(4900)).toBe("$49");
    });

    it("formatPriceMonthly renders per-month", () => {
      expect(formatPriceMonthly(0)).toBe("Free");
      expect(formatPriceMonthly(700)).toBe("$7/month");
      expect(formatPriceMonthly(1900)).toBe("$19/month");
    });
  });

  describe("getPlanById", () => {
    it("returns plan by valid id", () => {
      expect(getPlanById("starter")?.id).toBe("starter");
      expect(getPlanById("creator_beta")?.id).toBe("creator_beta");
      expect(getPlanById("pro_builder_beta")?.id).toBe("pro_builder_beta");
      expect(getPlanById("founder")?.id).toBe("founder");
    });

    it("returns null for invalid id", () => {
      expect(getPlanById("invalid")).toBeNull();
      expect(getPlanById("")).toBeNull();
    });
  });

  describe("Checkout safety — disabled plans cannot be purchased", () => {
    it("Founder is disabled and cannot be purchased", () => {
      const founder = PLANS.founder;
      expect(founder.enabled).toBe(false);
      // The billing checkout route checks plan.enabled and returns 400
      // This test verifies the contract is enforced at the catalog level
    });

    it("Only enabled plans can be purchased", () => {
      const enabledPlans = PLAN_LIST.filter((p) => p.enabled && p.billingType !== "free");
      // Only creator_beta and pro_builder_beta should be purchasable
      expect(enabledPlans.map((p) => p.id).sort()).toEqual(["creator_beta", "pro_builder_beta"]);
    });
  });
});
