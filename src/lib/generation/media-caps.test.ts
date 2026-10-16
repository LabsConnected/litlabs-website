// @vitest-environment node
/**
 * Generation credits stay on main's rate: 1 LiTTBit per retail cent.
 * Spending a whole plan balance at that rate can exceed half the plan
 * price. The monthly image, video, and provider-spend caps are what keep
 * a month inside that ceiling. Do not rescale the credit unit to make the
 * uncapped balance fit.
 */
import { describe, expect, it } from "vitest";
import { PLANS } from "@/config/plans";
import { calculateRetailBits, pricedGenerationInputs } from "@/lib/generation/cost-engine";
import {
  modelledCatalogEconomics,
  PLAN_MEDIA_MONTHLY_CAPS,
  worstCaseProviderSpend,
} from "@/lib/generation/media-caps";

/** Generations the monthly cap would allow, times provider cents. */
function cappedProviderCents(
  credits: number,
  halfPriceCents: number,
  providerCostCents: number,
  retailCredits: number,
): number {
  if (providerCostCents <= 0 || retailCredits <= 0 || credits <= 0 || halfPriceCents <= 0) {
    return 0;
  }
  const count = Math.min(
    Math.floor(credits / retailCredits),
    Math.floor(halfPriceCents / providerCostCents),
  );
  return count * providerCostCents;
}

describe("generation retail rate and plan provider ceiling", () => {
  it("charges 1 LiTTBit per retail cent, the same rate as main", () => {
    const image = calculateRetailBits({
      modality: "image",
      provider: "gemini",
      model: "gemini-3-pro-image",
    });
    // Catalog provider cost is 8 cents. Plus 1 cent infra, 50% markup:
    // ceil(9 * 1.5) = 14 retail cents = 14 LiTTBits. Not 140.
    expect(image.providerCostCents).toBe(8);
    expect(image.retailLiTTBits).toBe(14);
  });

  it("plan caps keep a month inside half the plan price without rescaling credits", () => {
    const creatorCredits = PLANS.creator_beta.monthlyCredits;
    const proCredits = PLANS.pro_builder_beta.monthlyCredits;
    const creatorPrice = PLANS.creator_beta.monthlyPriceCents ?? 0;
    const proPrice = PLANS.pro_builder_beta.monthlyPriceCents ?? 0;
    const creator = worstCaseProviderSpend(creatorCredits);
    const pro = worstCaseProviderSpend(proCredits);

    expect(creatorCredits).toBe(7500);
    expect(proCredits).toBe(18000);
    expect(creatorPrice).toBe(1500);
    expect(proPrice).toBe(3900);
    // Uncapped full-balance spend at the preserved rate is larger than half
    // the plan price. That is why the cap exists. It is not a reason to
    // charge 10x LiTTBits per generation.
    expect(creator.providerCents).toBeGreaterThan(Math.floor(creatorPrice * 0.5));
    expect(pro.providerCents).toBeGreaterThan(Math.floor(proPrice * 0.5));

    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxImages).toBeGreaterThan(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxVideos).toBeGreaterThan(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta.maxImages).toBeGreaterThan(
      PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxImages,
    );
    expect(PLAN_MEDIA_MONTHLY_CAPS.starter.maxImages).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.starter.maxVideos).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.founder.maxImages).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.owner.maxVideos).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.creditCap).toBe(7500);
    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxProviderSpendCents).toBe(750);
    expect(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta.creditCap).toBe(18000);
    expect(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta.maxProviderSpendCents).toBe(1950);
    expect(PLAN_MEDIA_MONTHLY_CAPS.starter.creditCap).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.starter.maxProviderSpendCents).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.founder.creditCap).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.owner.maxProviderSpendCents).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxProviderSpendCents).toBe(
      Math.floor(creatorPrice * 0.5),
    );
    expect(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta.maxProviderSpendCents).toBe(
      Math.floor(proPrice * 0.5),
    );

    // Printed for the PR. Values come from PROVIDER_COST_CENTS / getProviderCostCents.
    // Modelled, not proven.
    console.info(
      JSON.stringify({
        creator: {
          priceUsd: creatorPrice / 100,
          credits: creatorCredits,
          worst: creator,
          caps: PLAN_MEDIA_MONTHLY_CAPS.creator_beta,
        },
        pro: {
          priceUsd: proPrice / 100,
          credits: proCredits,
          worst: pro,
          caps: PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta,
        },
      }),
    );
  });

  it("every priced model stays within half of Creator and Pro revenue (modelled, not proven)", () => {
    const report = modelledCatalogEconomics();
    const inputs = pricedGenerationInputs();
    expect(report.label).toBe("modelled, not proven");
    expect(report.rows).toHaveLength(inputs.length);
    expect(report.creator.priceCents).toBe(1500);
    expect(report.creator.credits).toBe(7500);
    expect(report.pro.priceCents).toBe(3900);
    expect(report.pro.credits).toBe(18000);
    expect(report.creator.halfPriceCents).toBe(750);
    expect(report.pro.halfPriceCents).toBe(1950);
    expect(report.creator.caps).toEqual(PLAN_MEDIA_MONTHLY_CAPS.creator_beta);
    expect(report.pro.caps).toEqual(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta);

    const seen = new Set<string>();
    for (const row of report.rows) {
      seen.add(`${row.provider}:${row.model}`);
      expect(row.providerCostCents).toBeGreaterThanOrEqual(0);
      expect(row.retailCredits).toBeGreaterThanOrEqual(0);
      if (row.providerCostCents === 0) {
        expect(row.retailCredits).toBe(0);
        expect(row.creator.providerCents).toBe(0);
        expect(row.pro.providerCents).toBe(0);
      }
      const creatorCapped = cappedProviderCents(
        report.creator.credits,
        report.creator.halfPriceCents,
        row.providerCostCents,
        row.retailCredits,
      );
      const proCapped = cappedProviderCents(
        report.pro.credits,
        report.pro.halfPriceCents,
        row.providerCostCents,
        row.retailCredits,
      );
      expect(creatorCapped).toBeLessThanOrEqual(report.creator.halfPriceCents);
      expect(proCapped).toBeLessThanOrEqual(report.pro.halfPriceCents);
      expect(creatorCapped).toBeLessThanOrEqual(report.creator.caps.maxProviderSpendCents);
      expect(proCapped).toBeLessThanOrEqual(report.pro.caps.maxProviderSpendCents);
    }
    for (const input of inputs) {
      expect(seen.has(`${input.provider}:${input.model}`)).toBe(true);
    }

    console.info(JSON.stringify(report));
  });
});
