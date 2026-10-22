import { describe, expect, it } from "vitest";
import {
  buildChargeRating,
  shadowUnifiedBits,
  CANONICAL_PRICING_VERSION_ID,
  CANONICAL_EXCHANGE_RATE_VERSION_ID,
  LLM_LANE_BITS_PER_USD,
  LLM_EXCHANGE_RATE_VERSION_ID,
} from "./canonical-pricing";
import {
  ACTIVE_LLM_POLICY_ID,
  LEGACY_EXCHANGE_POLICY_ID,
  PRICING_POLICIES,
  UNAPPROVED_EXCHANGE_POLICY_ID,
} from "./pricing-policy";

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

    // LLM lane at the approved legacy rate (1,000 bits/$): $0.10 cost →
    // 100 cost-bits; 160 charged → 60 margin, stamped littbits-exchange-v1.
    const llm = buildChargeRating({
      capability: "llm",
      provider: "gemini",
      model: "gemini-2.5-flash",
      providerCostMicros: 100_000,
      bitsCharged: 160,
      lane: "llm",
    });
    expect(llm.marginBits).toBe(60);
    expect(llm.exchangeRateVersionId).toBe("littbits-exchange-v1");
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

  it("active LLM policy is the approved legacy policy — the 100/$ candidate stays inactive (owner decision 2026-10-22)", () => {
    // Regression guard for PR #726 economics-neutrality: if any future
    // change flips ACTIVE_LLM_POLICY_ID to the unapproved candidate,
    // this test fails loudly instead of silently re-pricing the LLM lane.
    expect(ACTIVE_LLM_POLICY_ID).toBe(LEGACY_EXCHANGE_POLICY_ID);
    expect(ACTIVE_LLM_POLICY_ID).not.toBe(UNAPPROVED_EXCHANGE_POLICY_ID);
    expect(PRICING_POLICIES[ACTIVE_LLM_POLICY_ID].approval).toBe("legacy");
    expect(PRICING_POLICIES[UNAPPROVED_EXCHANGE_POLICY_ID].approval).toBe("UNAPPROVED");
    expect(LLM_LANE_BITS_PER_USD).toBe(1000);
    expect(LLM_EXCHANGE_RATE_VERSION_ID).toBe("littbits-exchange-v1");
    expect(LLM_EXCHANGE_RATE_VERSION_ID).toBe(CANONICAL_EXCHANGE_RATE_VERSION_ID);
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
