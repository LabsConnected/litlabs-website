import { describe, expect, it } from "vitest";
import {
  buildChargeRating,
  shadowUnifiedBits,
  CANONICAL_PRICING_VERSION_ID,
  CANONICAL_EXCHANGE_RATE_VERSION_ID,
} from "./canonical-pricing";

describe("canonical-pricing", () => {
  it("stamps the canonical version ids on every rating", () => {
    const r = buildChargeRating({
      capability: "image",
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      providerCostMicros: 40_000,
      bitsCharged: 8,
      lane: "generation",
    });
    expect(r.pricingVersionId).toBe(CANONICAL_PRICING_VERSION_ID);
    expect(r.exchangeRateVersionId).toBe(CANONICAL_EXCHANGE_RATE_VERSION_ID);
    expect(r.providerCostMicros).toBe(40_000);
    expect(r.bitsCharged).toBe(8);
  });

  it("computes margin in bits against the lane rate", () => {
    // 4¢ provider cost at 100 bits/$ lane → 4 cost-bits; 8 charged → 4 margin.
    const gen = buildChargeRating({
      capability: "image",
      provider: "gemini",
      model: "gemini-3.1-flash-image",
      providerCostMicros: 40_000,
      bitsCharged: 8,
      lane: "generation",
    });
    expect(gen.marginBits).toBe(4);

    // LLM lane: $0.10 cost → 100 cost-bits at 1000 bits/$; 160 charged → 60 margin.
    const llm = buildChargeRating({
      capability: "llm",
      provider: "gemini",
      model: "gemini-2.5-flash",
      providerCostMicros: 100_000,
      bitsCharged: 160,
      lane: "llm",
    });
    expect(llm.marginBits).toBe(60);
  });

  it("never reports negative margin", () => {
    const r = buildChargeRating({
      capability: "speech",
      provider: "elevenlabs",
      model: "tts",
      providerCostMicros: 30_000,
      bitsCharged: 2,
      lane: "flat",
    });
    expect(r.marginBits).toBe(0);
  });

  it("emits a shadow unified price only when it differs", () => {
    // LLM lane charge: $0.10 → enforced 160 bits; shadow 100 bits/$ → 15 bits.
    const llm = buildChargeRating({
      capability: "llm",
      provider: "gemini",
      model: "gemini-2.5-flash",
      providerCostMicros: 100_000,
      bitsCharged: 160,
      lane: "llm",
    });
    expect(shadowUnifiedBits(llm)).toBe(15);

    // Free provider (no cost basis) → no shadow comparison possible.
    const free = buildChargeRating({
      capability: "image",
      provider: "pollinations",
      model: "flux",
      providerCostMicros: 0,
      bitsCharged: 0,
      lane: "generation",
    });
    expect(shadowUnifiedBits(free)).toBeNull();
  });
});
