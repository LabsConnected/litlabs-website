// LLM Cost Engine — server-authoritative model usage billing.
//
// This is the single source of truth for how much LiTTBits a given LLM call
// costs. Never trust client-supplied cost. The engine takes actual returned
// token usage and computes:
//   - providerCostMicros: what the underlying provider charges LiTTree (in USD micros)
//   - retailLiTTBits: what the user is charged in LiTTBits
//   - platformMargin: LiTTree's gross margin (retail value minus provider cost)
//   - billingClass: how the charge is categorized
//
// Platform-funded inference targets ~50% gross margin, configurable via
// LLM_COST_MARGIN_TARGET env var (0.0–1.0).
//
// BYOK (bring-your-own-key) calls are NOT charged for model inference —
// the provider bills the user directly. LiTTree only charges for non-model
// resources (browser, video, storage, etc.) separately.
//
// Shadow mode: when LLM_COST_SHADOW_MODE=true, the engine calculates and
// records expected charges but does NOT debit the user's wallet. This
// allows verifying margin calculations against real provider invoices
// before enabling enforcement.

import "server-only";

// ── Types ──────────────────────────────────────────────────────────────

export type BillingClass = "standard" | "premium" | "code" | "reasoning" | "byok" | "free";

export interface ModelCostEntry {
  /** Provider identifier matching LLMProvider in llm.ts */
  provider: string;
  /** Model name as returned by the provider */
  model: string;
  /** Cost per 1M prompt tokens in USD */
  promptCostPer1M: number;
  /** Cost per 1M completion tokens in USD */
  completionCostPer1M: number;
  /** Billing class for this model */
  billingClass: BillingClass;
  /** LiTTBits per 1K tokens (retail, before margin adjustment) */
  baseBitsPer1K: number;
}

export interface CostCalculation {
  /** What the provider charges LiTTree in USD micros (1/1,000,000 USD) */
  providerCostMicros: number;
  /** What the user is charged in LiTTBits */
  retailLiTTBits: number;
  /** LiTTree's gross margin in LiTTBits-equivalent */
  platformMargin: number;
  /** Billing classification */
  billingClass: BillingClass;
  /** Whether this call should be debited (false for BYOK, shadow mode) */
  shouldDebit: boolean;
  /** Whether this was calculated in shadow mode (no actual debit) */
  shadowMode: boolean;
}

export interface CostEngineInput {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** True if the user supplied their own API key (BYOK) */
  isByok: boolean;
  /** LiTT alias ID if the call was routed through a branded alias */
  littAliasId?: string;
}

// ── Cost Catalog ───────────────────────────────────────────────────────
//
// Server-owned, never exposed to the client. These are the actual costs
// LiTTree pays to the underlying providers per 1M tokens.
// Source: provider pricing pages as of 2026-08.

const COST_CATALOG: ModelCostEntry[] = [
  // ── Gemini ──────────────────────────────────────────────────────
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    promptCostPer1M: 0.075,
    completionCostPer1M: 0.30,
    billingClass: "standard",
    baseBitsPer1K: 1,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    promptCostPer1M: 0.0375,
    completionCostPer1M: 0.15,
    billingClass: "free",
    baseBitsPer1K: 0.5,
  },

  // ── Groq ────────────────────────────────────────────────────────
  {
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    promptCostPer1M: 0.59,
    completionCostPer1M: 0.79,
    billingClass: "standard",
    baseBitsPer1K: 2,
  },

  // ── OpenRouter (free models — provider cost is $0) ──────────────
  {
    provider: "openrouter-free",
    model: "openrouter/free",
    promptCostPer1M: 0,
    completionCostPer1M: 0,
    billingClass: "free",
    baseBitsPer1K: 0.5,
  },
  {
    provider: "openrouter-qwen",
    model: "qwen/qwen-2.5-coder-32b-instruct:free",
    promptCostPer1M: 0,
    completionCostPer1M: 0,
    billingClass: "code",
    baseBitsPer1K: 1,
  },
  {
    provider: "openrouter-deepseek",
    model: "deepseek/deepseek-chat:free",
    promptCostPer1M: 0,
    completionCostPer1M: 0,
    billingClass: "reasoning",
    baseBitsPer1K: 2,
  },
  {
    provider: "openrouter-llama",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    promptCostPer1M: 0,
    completionCostPer1M: 0,
    billingClass: "standard",
    baseBitsPer1K: 1,
  },
  {
    provider: "openrouter-mistral",
    model: "mistralai/mistral-small-3.2-24b-instruct:free",
    promptCostPer1M: 0,
    completionCostPer1M: 0,
    billingClass: "standard",
    baseBitsPer1K: 1,
  },
  {
    provider: "openrouter-trinity",
    model: "microsoft/trinity-large-preview:free",
    promptCostPer1M: 0,
    completionCostPer1M: 0,
    billingClass: "reasoning",
    baseBitsPer1K: 2,
  },
  {
    provider: "openrouter-vision",
    model: "google/gemini-2.5-flash:free",
    promptCostPer1M: 0,
    completionCostPer1M: 0,
    billingClass: "standard",
    baseBitsPer1K: 1,
  },

  // ── BYOK providers (user pays directly) ─────────────────────────
  {
    provider: "openai",
    model: "gpt-4o",
    promptCostPer1M: 2.50,
    completionCostPer1M: 10.00,
    billingClass: "byok",
    baseBitsPer1K: 0, // BYOK = no LiTTBits charge
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    promptCostPer1M: 3.00,
    completionCostPer1M: 15.00,
    billingClass: "byok",
    baseBitsPer1K: 0,
  },
];

// ── LiTT Alias → billing class mapping ─────────────────────────────────

const LITT_ALIAS_BILLING: Record<string, BillingClass> = {
  "litt-auto": "standard",
  "litt-fast": "standard",
  "litt-balanced": "standard",
  "litt-reasoning": "reasoning",
  "litt-code": "code",
  "litt-research": "standard",
};

// ── Configuration ──────────────────────────────────────────────────────

const SHADOW_MODE = process.env.LLM_COST_SHADOW_MODE === "true";
const MARGIN_TARGET = parseFloat(process.env.LLM_COST_MARGIN_TARGET || "0.50");

// ── Cost calculation ───────────────────────────────────────────────────

/**
 * Look up a model in the cost catalog by provider + model name.
 * Falls back to a provider-level default, then a generic default.
 */
function lookupCostEntry(provider: string, model: string): ModelCostEntry {
  // Exact match
  const exact = COST_CATALOG.find(
    (e) => e.provider === provider && e.model === model,
  );
  if (exact) return exact;

  // Provider-level fallback (first entry for that provider)
  const providerFallback = COST_CATALOG.find((e) => e.provider === provider);
  if (providerFallback) return providerFallback;

  // Generic fallback — conservative standard pricing
  return {
    provider,
    model,
    promptCostPer1M: 0.50,
    completionCostPer1M: 1.50,
    billingClass: "standard",
    baseBitsPer1K: 2,
  };
}

/**
 * Calculate the cost of an LLM call.
 *
 * For platform-funded inference:
 *   retailLiTTBits = baseBitsPer1K * totalTokens / 1000 * (1 + marginTarget)
 *   providerCostMicros = (promptCost * promptTokens + completionCost * completionTokens) / 1_000_000 * 1_000_000
 *
 * For BYOK:
 *   retailLiTTBits = 0 (provider bills user directly)
 *   shouldDebit = false
 *
 * For free models (provider cost = $0):
 *   retailLiTTBits = baseBitsPer1K * totalTokens / 1000 (nominal charge)
 *   providerCostMicros = 0
 */
export function calculateLlmCost(input: CostEngineInput): CostCalculation {
  const entry = lookupCostEntry(input.provider, input.model);
  const totalTokens = input.promptTokens + input.completionTokens;

  // BYOK: no model inference charge
  if (input.isByok || entry.billingClass === "byok") {
    return {
      providerCostMicros: 0,
      retailLiTTBits: 0,
      platformMargin: 0,
      billingClass: "byok",
      shouldDebit: false,
      shadowMode: SHADOW_MODE,
    };
  }

  // Provider cost in USD micros
  const promptCostUsd =
    (entry.promptCostPer1M * input.promptTokens) / 1_000_000;
  const completionCostUsd =
    (entry.completionCostPer1M * input.completionTokens) / 1_000_000;
  const providerCostUsd = promptCostUsd + completionCostUsd;
  const providerCostMicros = Math.round(providerCostUsd * 1_000_000);

  // Retail LiTTBits
  // baseBitsPer1K is the base rate. We apply margin target on top.
  // For free models (provider cost = $0), the base rate IS the retail rate
  // (LiTTree's infrastructure cost + margin is embedded in the base rate).
  const baseBits = (entry.baseBitsPer1K * totalTokens) / 1000;

  // For paid models, apply margin target on top of the cost-equivalent bits.
  // For free models, the base rate already includes margin.
  let retailLiTTBits: number;
  if (providerCostMicros === 0) {
    retailLiTTBits = Math.max(1, Math.round(baseBits));
  } else {
    // Convert provider cost to a bits-equivalent, then apply margin
    // $1.00 ≈ 1000 BITS at retail (internal, never exposed publicly)
    const costEquivalentBits = (providerCostUsd * 1000);
    retailLiTTBits = Math.max(1, Math.round(
      costEquivalentBits * (1 + MARGIN_TARGET) + baseBits * 0.1,
    ));
  }

  // Platform margin = retail value minus provider cost (in bits-equivalent)
  const providerCostBits = providerCostUsd * 1000;
  const platformMargin = Math.max(0, retailLiTTBits - providerCostBits);

  // Determine billing class from LiTT alias if provided
  const billingClass = input.littAliasId
    ? (LITT_ALIAS_BILLING[input.littAliasId] ?? entry.billingClass)
    : entry.billingClass;

  return {
    providerCostMicros,
    retailLiTTBits,
    platformMargin,
    billingClass,
    shouldDebit: !SHADOW_MODE,
    shadowMode: SHADOW_MODE,
  };
}

/**
 * Get an estimated LiTTBits range for a model, for display in the UI.
 * Returns a min/max range based on typical usage (500–2000 tokens).
 */
export function getEstimatedBitsRange(
  provider: string,
  model: string,
  isByok: boolean,
): { min: number; max: number; label: string } {
  if (isByok) {
    return { min: 0, max: 0, label: "No LiTTBits" };
  }

  const entry = lookupCostEntry(provider, model);
  if (entry.billingClass === "byok") {
    return { min: 0, max: 0, label: "No LiTTBits" };
  }

  const minTokens = 500;
  const maxTokens = 2000;
  const minCalc = calculateLlmCost({
    provider,
    model,
    promptTokens: minTokens * 0.6,
    completionTokens: minTokens * 0.4,
    isByok: false,
  });
  const maxCalc = calculateLlmCost({
    provider,
    model,
    promptTokens: maxTokens * 0.6,
    completionTokens: maxTokens * 0.4,
    isByok: false,
  });

  const minBits = minCalc.retailLiTTBits;
  const maxBits = maxCalc.retailLiTTBits;

  let label: string;
  if (maxBits <= 1) label = "Included";
  else if (maxBits <= 5) label = "Low BITS";
  else if (maxBits <= 15) label = "Standard BITS";
  else label = "Premium BITS";

  return { min: minBits, max: maxBits, label };
}

/**
 * Whether the cost engine is running in shadow mode (calculate but don't debit).
 */
export function isShadowMode(): boolean {
  return SHADOW_MODE;
}
