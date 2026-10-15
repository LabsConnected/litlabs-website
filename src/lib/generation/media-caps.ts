import "server-only";
import { PLANS, type PlanId } from "@/config/plans";
import {
  calculateRetailBits,
  catalogTableCents,
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
  /** Monthly credits the plan can spend. Zero when the plan has no subscription grant. */
  creditCap: number;
  /**
   * Provider-spend ceiling for a month, in cents. Half the plan price.
   * Sits beside the image and video count caps. Modelled, not proven.
   */
  maxProviderSpendCents: number;
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
    creditCap: monthly,
    maxProviderSpendCents: monthly > 0 && price > 0 ? Math.floor(price * 0.5) : 0,
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

export interface ModelledPlanSpend {
  count: number;
  providerCents: number;
  providerUsd: number;
}

export interface ModelledCatalogRow {
  label: string;
  modality: GenerationModality;
  provider: string;
  model: string;
  durationSeconds: number | null;
  resolution: string | null;
  /** PROVIDER_COST_CENTS for this provider:model, before duration rules. */
  tableCents: number;
  /** Cents getProviderCostCents charges for this input. */
  providerCostCents: number;
  retailCredits: number;
  /** Which rule in cost-engine.ts produced providerCostCents. */
  pricingRule: string;
  creator: ModelledPlanSpend;
  pro: ModelledPlanSpend;
}

export interface ModelledCatalogEconomics {
  /** This table is computed from the repo cost catalog. It is not an invoice. */
  label: "modelled, not proven";
  creator: {
    priceCents: number;
    credits: number;
    halfPriceCents: number;
    caps: PlanMediaCap;
  };
  pro: {
    priceCents: number;
    credits: number;
    halfPriceCents: number;
    caps: PlanMediaCap;
  };
  rows: ModelledCatalogRow[];
}

function pricingRule(input: CostInput): string {
  if (input.modality === "video" && input.provider === "veo") {
    return "veo per-second: 10 cents/s at 720p, 12 cents/s at 1080p; the table stores the 4s base";
  }
  if (input.modality === "video") {
    return "ceil(tableCents * durationSeconds / 4)";
  }
  if (input.modality === "music" && input.provider === "elevenlabs") {
    return "ceil(durationSeconds * 0.15); the table stores the 8 cent base row";
  }
  return "PROVIDER_COST_CENTS";
}

function planSpend(
  credits: number,
  providerCostCents: number,
  retailCredits: number,
): ModelledPlanSpend {
  if (providerCostCents <= 0 || retailCredits <= 0 || credits <= 0) {
    return { count: 0, providerCents: 0, providerUsd: 0 };
  }
  const count = Math.floor(credits / retailCredits);
  const providerCents = count * providerCostCents;
  return { count, providerCents, providerUsd: providerCents / 100 };
}

/**
 * Every input pricedGenerationInputs() emits, with the catalog cents, the
 * credits charged, and the provider bill of spending a full Creator or Pro
 * balance on that one input. Modelled from this repo. Not proven against
 * a provider invoice.
 */
export function modelledCatalogEconomics(): ModelledCatalogEconomics {
  const creatorCredits = PLANS.creator_beta.monthlyCredits;
  const proCredits = PLANS.pro_builder_beta.monthlyCredits;
  const creatorPrice = PLANS.creator_beta.monthlyPriceCents ?? 0;
  const proPrice = PLANS.pro_builder_beta.monthlyPriceCents ?? 0;
  const rows: ModelledCatalogRow[] = pricedGenerationInputs().map((input) => {
    const tableCents = catalogTableCents(input.provider, input.model);
    if (tableCents === undefined) {
      throw new Error(`missing catalog row for ${input.provider}:${input.model}`);
    }
    const priced = calculateRetailBits(input);
    return {
      label: labelFor(input),
      modality: input.modality,
      provider: input.provider,
      model: input.model,
      durationSeconds: input.durationSeconds ?? null,
      resolution: input.resolution ?? null,
      tableCents,
      providerCostCents: priced.providerCostCents,
      retailCredits: priced.retailLiTTBits,
      pricingRule: pricingRule(input),
      creator: planSpend(creatorCredits, priced.providerCostCents, priced.retailLiTTBits),
      pro: planSpend(proCredits, priced.providerCostCents, priced.retailLiTTBits),
    };
  });
  return {
    label: "modelled, not proven",
    creator: {
      priceCents: creatorPrice,
      credits: creatorCredits,
      halfPriceCents: Math.floor(creatorPrice * 0.5),
      caps: PLAN_MEDIA_MONTHLY_CAPS.creator_beta,
    },
    pro: {
      priceCents: proPrice,
      credits: proCredits,
      halfPriceCents: Math.floor(proPrice * 0.5),
      caps: PLAN_MEDIA_MONTHLY_CAPS.pro_builder_beta,
    },
    rows,
  };
}
