/**
 * Purchasing power stays on main's generation rate and plan allowances.
 * 1 LiTTBit = 1 retail cent. Grants, pack flags, and cap credit balances
 * are not multiplied by 10.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLAN_ENTITLEMENTS } from "@/config/plan-entitlements";
import { PLANS } from "@/config/plans";
import { CREDIT_PACKS_ENABLED } from "@/config/product-truth";
import { calculateRetailBits } from "@/lib/generation/cost-engine";
import { PLAN_MEDIA_MONTHLY_CAPS } from "@/lib/generation/media-caps";

/** main's calculateRetailBits: CENTS_PER_BIT = 1, 50% margin, 1 cent infra. */
function mainRetailBits(providerCostCents: number): number {
  if (providerCostCents === 0) return 0;
  const retailCents = Math.ceil((providerCostCents + 1) * 1.5);
  return Math.max(1, Math.ceil(retailCents / 1));
}

describe("LiTTBit purchasing power matches main", () => {
  it("does not apply a 10x generation conversion", () => {
    const source = readFileSync("src/lib/generation/cost-engine.ts", "utf8");
    expect(source).toContain("const CENTS_PER_BIT = 1");
    expect(source).not.toContain("RETAIL_CREDITS_PER_USD");

    const samples = [
      { modality: "image" as const, provider: "gemini", model: "gemini-3-pro-image", providerCents: 8 },
      { modality: "image" as const, provider: "gemini", model: "gemini-3.1-flash-lite-image", providerCents: 3 },
      { modality: "video" as const, provider: "veo", model: "veo-3.1-fast-generate-preview", durationSeconds: 4, resolution: "720p", providerCents: 40 },
      { modality: "music" as const, provider: "google", model: "lyria-3-clip-preview", providerCents: 4 },
      { modality: "speech" as const, provider: "elevenlabs", model: "tts", providerCents: 3 },
      { modality: "image" as const, provider: "cloudflare", model: "flux-1-schnell", providerCents: 0 },
    ];
    for (const sample of samples) {
      const priced = calculateRetailBits(sample);
      expect(priced.providerCostCents).toBe(sample.providerCents);
      expect(priced.retailLiTTBits).toBe(mainRetailBits(sample.providerCents));
      if (sample.providerCents > 0) {
        expect(priced.retailLiTTBits).not.toBe(mainRetailBits(sample.providerCents) * 10);
      }
    }
  });

  it("keeps grant, price, cap, and pack amounts", () => {
    expect(PLAN_ENTITLEMENTS.starter.oneTimeGrantBits).toBe(1500);
    expect(PLAN_ENTITLEMENTS.creator_beta.monthlyBits).toBe(7500);
    expect(PLAN_ENTITLEMENTS.pro_builder_beta.monthlyBits).toBe(18000);
    expect(PLANS.creator_beta.monthlyCredits).toBe(7500);
    expect(PLANS.pro_builder_beta.monthlyCredits).toBe(18000);
    expect(PLANS.creator_beta.monthlyPriceCents).toBe(1500);
    expect(PLANS.pro_builder_beta.monthlyPriceCents).toBe(3900);
    expect(PLANS.founder.monthlyCredits).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.creditCap).toBe(7500);
    expect(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta.creditCap).toBe(18000);
    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxProviderSpendCents).toBe(750);
    expect(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta.maxProviderSpendCents).toBe(1950);
    expect(CREDIT_PACKS_ENABLED).toBe(false);
  });
});
