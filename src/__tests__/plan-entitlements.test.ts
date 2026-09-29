/**
 * Entitlement-truth consistency tests.
 *
 * Locked pricing (rev 2, 2026-09-29):
 * - Starter: free, 1,500 LiTTBits ONE-TIME grant
 * - Creator: $15/mo, 7,500 LiTTBits/month
 * - Pro Builder: $39/mo, 18,000 LiTTBits/month
 *
 * Every consumer must derive from PLAN_ENTITLEMENTS
 * (src/config/plan-entitlements.ts). These tests fail if any consumer
 * hardcodes a divergent number.
 */
import { describe, it, expect } from "vitest";
import {
  PLAN_ENTITLEMENTS,
  getPlanCreditAllowance,
  STARTER_GRANT_KEY_PREFIX,
  BITS_PER_USD_MODELED,
} from "@/config/plan-entitlements";
import { PLANS } from "@/config/plans";
import { getEntitlementsForPlan } from "@/lib/entitlements";

describe("PLAN_ENTITLEMENTS — locked rev-2 numbers", () => {
  it("Starter is a 1,500 one-time grant (not monthly)", () => {
    expect(PLAN_ENTITLEMENTS.starter.oneTimeGrantBits).toBe(1500);
    expect(PLAN_ENTITLEMENTS.starter.monthlyBits).toBe(0);
    expect(PLAN_ENTITLEMENTS.starter.monthlyPriceCents).toBe(0);
  });

  it("Creator is $15/mo with 7,500 bits/month", () => {
    expect(PLAN_ENTITLEMENTS.creator_beta.monthlyBits).toBe(7500);
    expect(PLAN_ENTITLEMENTS.creator_beta.oneTimeGrantBits).toBe(0);
    expect(PLAN_ENTITLEMENTS.creator_beta.monthlyPriceCents).toBe(1500);
  });

  it("Pro Builder is $39/mo with 18,000 bits/month (40K is dead)", () => {
    expect(PLAN_ENTITLEMENTS.pro_builder_beta.monthlyBits).toBe(18000);
    expect(PLAN_ENTITLEMENTS.pro_builder_beta.oneTimeGrantBits).toBe(0);
    expect(PLAN_ENTITLEMENTS.pro_builder_beta.monthlyPriceCents).toBe(3900);
    expect(PLAN_ENTITLEMENTS.pro_builder_beta.monthlyBits).not.toBe(40000);
  });

  it("capacity windows are 1/3/8 with 15/45/120 min runtime caps", () => {
    expect(PLAN_ENTITLEMENTS.starter.agentStartsPer5h).toBe(1);
    expect(PLAN_ENTITLEMENTS.creator_beta.agentStartsPer5h).toBe(3);
    expect(PLAN_ENTITLEMENTS.pro_builder_beta.agentStartsPer5h).toBe(8);
    expect(PLAN_ENTITLEMENTS.starter.maxRuntimeMinutes).toBe(15);
    expect(PLAN_ENTITLEMENTS.creator_beta.maxRuntimeMinutes).toBe(45);
    expect(PLAN_ENTITLEMENTS.pro_builder_beta.maxRuntimeMinutes).toBe(120);
  });

  it("starter grant uses the v1 idempotency namespace", () => {
    expect(STARTER_GRANT_KEY_PREFIX).toBe("starter:v1:");
  });

  it("$1/1K-bit conversion is explicitly labeled modeled", () => {
    expect(BITS_PER_USD_MODELED).toBe(1000);
  });
});

describe("consumers derive from PLAN_ENTITLEMENTS (no divergent hardcodes)", () => {
  it("PLANS.*.monthlyCredits matches the canonical allowances", () => {
    expect(PLANS.starter.monthlyCredits).toBe(
      getPlanCreditAllowance("starter"),
    );
    expect(PLANS.creator_beta.monthlyCredits).toBe(
      getPlanCreditAllowance("creator_beta"),
    );
    expect(PLANS.pro_builder_beta.monthlyCredits).toBe(
      getPlanCreditAllowance("pro_builder_beta"),
    );
    expect(PLANS.starter.monthlyCredits).toBe(1500);
    expect(PLANS.creator_beta.monthlyCredits).toBe(7500);
    expect(PLANS.pro_builder_beta.monthlyCredits).toBe(18000);
  });

  it("entitlements.ts monthlyCredits matches the canonical allowances", () => {
    expect(getEntitlementsForPlan("starter").monthlyCredits).toBe(1500);
    expect(getEntitlementsForPlan("creator_beta").monthlyCredits).toBe(7500);
    expect(getEntitlementsForPlan("pro_builder_beta").monthlyCredits).toBe(
      18000,
    );
  });

  it("entitlements.ts feature gates match PLAN_ENTITLEMENTS", () => {
    for (const planId of [
      "starter",
      "creator_beta",
      "pro_builder_beta",
    ] as const) {
      const ent = getEntitlementsForPlan(planId);
      const canon = PLAN_ENTITLEMENTS[planId];
      expect(ent.privateProjects).toBe(canon.features.privateProjects);
      expect(ent.github).toBe(canon.features.github);
      expect(ent.terminal).toBe(canon.features.terminal);
      expect(ent.voice).toBe(canon.features.voice);
      expect(ent.premiumModels).toBe(canon.features.premiumModels);
      expect(ent.deployment).toBe(canon.features.deployment);
      expect(ent.activeProjectLimit).toBe(canon.activeProjectLimit);
    }
  });

  it("PLANS.*.monthlyPriceCents matches the canonical prices", () => {
    expect(PLANS.starter.monthlyPriceCents).toBe(
      PLAN_ENTITLEMENTS.starter.monthlyPriceCents,
    );
    expect(PLANS.creator_beta.monthlyPriceCents).toBe(
      PLAN_ENTITLEMENTS.creator_beta.monthlyPriceCents,
    );
    expect(PLANS.pro_builder_beta.monthlyPriceCents).toBe(
      PLAN_ENTITLEMENTS.pro_builder_beta.monthlyPriceCents,
    );
  });
});
