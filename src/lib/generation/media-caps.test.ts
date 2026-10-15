// @vitest-environment node
/**
 * Image and video credits use the same 1000-credits-per-retail-dollar rate
 * as the LLM engine. A plan's full balance, spent on the catalog item that
 * maximizes provider cost, must stay within about half the plan price.
 */
import { describe, expect, it } from "vitest";
import { PLANS } from "@/config/plans";
import { calculateRetailBits, pricedGenerationInputs } from "@/lib/generation/cost-engine";
import {
  modelledCatalogEconomics,
  PLAN_MEDIA_MONTHLY_CAPS,
  worstCaseProviderSpend,
} from "@/lib/generation/media-caps";

describe("generation retail rate and plan provider ceiling", () => {
  it("charges 1000 credits per retail dollar (10x the old 1-credit-per-cent rate)", () => {
    const image = calculateRetailBits({
      modality: "image",
      provider: "gemini",
      model: "gemini-3-pro-image",
    });
    // Catalog provider cost is 8 cents. Plus 1 cent infra, 50% markup:
    // ceil(9 * 1.5) = 14 retail cents = 140 credits.
    expect(image.providerCostCents).toBe(8);
    expect(image.retailLiTTBits).toBe(140);
  });

  it("Creator and Pro worst-case provider cost stays within half the plan price", () => {
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
    expect(creator.providerCents).toBeLessThanOrEqual(Math.floor(creatorPrice * 0.5));
    expect(pro.providerCents).toBeLessThanOrEqual(Math.floor(proPrice * 0.5));
    expect(creator.providerCents).toBeGreaterThan(0);
    expect(pro.providerCents).toBeGreaterThan(0);

    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxImages).toBeGreaterThan(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxVideos).toBeGreaterThan(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta.maxImages).toBeGreaterThan(
      PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxImages,
    );
    expect(PLAN_MEDIA_MONTHLY_CAPS.starter.maxImages).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.starter.maxVideos).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.founder.maxImages).toBe(0);
    expect(PLAN_MEDIA_MONTHLY_CAPS.owner.maxVideos).toBe(0);

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
      expect(row.creator.providerCents).toBeLessThanOrEqual(report.creator.halfPriceCents);
      expect(row.pro.providerCents).toBeLessThanOrEqual(report.pro.halfPriceCents);
    }
    for (const input of inputs) {
      expect(seen.has(`${input.provider}:${input.model}`)).toBe(true);
    }

    console.info(JSON.stringify(report));
  });
});
