import "server-only";
import { PLANS, type PlanId } from "@/config/plans";
import {
  calculateRetailBits,
  getProviderCostCents,
  pricedGenerationInputs,
} from "@/lib/generation/cost-engine";
import type { CostInput, GenerationModality } from "@/lib/generation/types";

export interface WorstCaseSpend {
  /** Provider cents for spending the whole credit balance on one catalog item. */
  providerCents: number;
  providerUsd: number;
  count: number;
  bitsPerCall: number;
  label: string;
}

export interface PlanMediaCap {
  planId: PlanId;
  maxImages: number;
  maxVideos: number;
  /** Catalog item the image cap was derived from. */
  imageLabel: string;
  /** Catalog item the video cap was derived from. */
  videoLabel: string;
}

function labelFor(input: CostInput): string {
  const duration = input.durationSeconds ? ` ${input.durationSeconds}s` : "";
  const resolution = input.resolution ? ` ${input.resolution}` : "";
  return `${input.modality} ${input.provider}:${input.model}${duration}${resolution}`;
}

/**
 * Highest provider bill from spending `credits` entirely on one priced
 * catalog input. Free rows (provider cost 0) are skipped.
 */
export function worstCaseProviderSpend(credits: number): WorstCaseSpend {
  let best: WorstCaseSpend | null = null;
  for (const input of pricedGenerationInputs()) {
    const priced = calculateRetailBits(input);
    if (priced.providerCostCents <= 0 || priced.retailLiTTBits <= 0) continue;
    const count = Math.floor(credits / priced.retailLiTTBits);
    const providerCents = count * priced.providerCostCents;
    if (!best || providerCents > best.providerCents) {
      best = {
        providerCents,
        providerUsd: providerCents / 100,
        count,
        bitsPerCall: priced.retailLiTTBits,
        label: labelFor(input),
      };
    }
  }
  if (!best) {
    throw new Error("generation catalog has no paid inputs");
  }
  return best;
}

function mostExpensive(modality: GenerationModality): CostInput {
  let best: CostInput | null = null;
  let bestCents = -1;
  for (const input of pricedGenerationInputs()) {
    if (input.modality !== modality) continue;
    const cents = getProviderCostCents(input);
    if (cents > bestCents) {
      best = input;
      bestCents = cents;
    }
  }
  if (!best) throw new Error(`no ${modality} inputs in the generation catalog`);
  return best;
}

/**
 * How many of the most expensive catalog item fit in the credit balance
 * without the provider bill exceeding half the plan price.
 */
function countCap(credits: number, monthlyPriceCents: number, input: CostInput): number {
  if (credits <= 0 || monthlyPriceCents <= 0) return 0;
  const priced = calculateRetailBits(input);
  if (priced.providerCostCents <= 0 || priced.retailLiTTBits <= 0) return 0;
  const byCredits = Math.floor(credits / priced.retailLiTTBits);
  const byPrice = Math.floor((monthlyPriceCents * 0.5) / priced.providerCostCents);
  return Math.min(byCredits, byPrice);
}

function capFor(planId: PlanId): PlanMediaCap {
  const plan = PLANS[planId];
  const image = mostExpensive("image");
  const video = mostExpensive("video");
  const price = plan.monthlyPriceCents ?? 0;
  const monthly = plan.billingType === "subscription" ? plan.monthlyCredits : 0;
  return {
    planId,
    maxImages: countCap(monthly, price, image),
    maxVideos: countCap(monthly, price, video),
    imageLabel: labelFor(image),
    videoLabel: labelFor(video),
  };
}

/** Derived from the cost table. Not a hand-entered quota. */
export const PLAN_MEDIA_MONTHLY_CAPS: Record<PlanId, PlanMediaCap> = {
  starter: capFor("starter"),
  creator_beta: capFor("creator_beta"),
  pro_builder_beta: capFor("pro_builder_beta"),
  founder: capFor("founder"),
  owner: capFor("owner"),
};
