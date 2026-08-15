/**
 * Canonical monetary unit system for LiTT billing.
 *
 * ONE conversion: USD micros ↔ BITS.
 * No separate LLM and generation exchange rates.
 *
 * All provider costs are stored as integer micro-USD (1 USD = 1,000,000 micros).
 * All customer charges are stored as integer BITS.
 *
 * The exchange rate is versioned and immutable per version. Historical charges
 * must always be reproducible from (usage + pricingVersion + exchangeRateVersion).
 *
 * CRITICAL: The existing codebase has TWO different exchange rates:
 *   - llm-cost-engine.ts:       $1.00 ≈ 1000 BITS  (1 BIT = $0.001)
 *   - generation/cost-engine.ts: $1.00 = 100 BITS   (1 BIT = $0.01)
 *
 * B1 does NOT pick one and rewrite balances. B1 defines the canonical contract
 * and leaves the existing rates classified as legacy until a reconciliation
 * audit determines which rate each historical charge used.
 */

// ── Primitive integer monetary types ───────────────────────────────────

/**
 * Integer micro-USD. 1 USD = 1,000,000 micros.
 * Never use floating-point for money.
 */
export type UsdMicros = number;

/**
 * Integer BITS (LiTT product credits).
 * Always non-negative for balances; can be negative for adjustments.
 */
export type Bits = number;

/**
 * Integer basis points. 100 bps = 1%. 5000 bps = 50%.
 * Used for margin targets and discounts.
 */
export type BasisPoints = number;

// ── Exchange rate ──────────────────────────────────────────────────────

/**
 * Immutable exchange rate between USD micros and BITS.
 *
 * `bitsPerUsdMicros` is a rational number expressed as
 * (numerator / denominator) to avoid floating-point.
 *
 * For example:
 *   - "1000 BITS per dollar" → bitsPerUsdMicros = { num: 1000, den: 1_000_000 }
 *   - "100 BITS per dollar"  → bitsPerUsdMicros = { num: 100,  den: 1_000_000 }
 *
 * The rate is versioned. Once a version is created, it never changes.
 * Every settled charge references the exchange rate version it used.
 */
export interface ExchangeRateVersion {
  /** Unique immutable identifier, e.g. "exch-2026-08-13-v1" */
  id: string;
  /** Human-readable label, e.g. "1000 BITS per USD" */
  label: string;
  /** Rational BITS per 1 USD micro. */
  bitsPerUsdMicro: { num: number; den: number };
  /** When this rate became effective. */
  effectiveFrom: string; // ISO 8601
  /** When this rate was superseded (null = still active). */
  effectiveUntil: string | null;
  /** Who approved this rate. */
  approvedBy: string;
  /** Creation timestamp. */
  createdAt: string;
}

// ── Conversion functions ───────────────────────────────────────────────

/**
 * Convert USD micros to BITS using a specific exchange rate version.
 *
 * Uses integer math: bits = floor(usdMicros * num / den)
 * Rounding is always downward (conservative for customer charges).
 */
export function usdMicrosToBits(
  usdMicros: UsdMicros,
  rate: Pick<ExchangeRateVersion, "bitsPerUsdMicro">,
): Bits {
  if (usdMicros < 0) throw new Error("usdMicros must be non-negative");
  const { num, den } = rate.bitsPerUsdMicro;
  if (den <= 0) throw new Error("Exchange rate denominator must be positive");
  return Math.floor((usdMicros * num) / den);
}

/**
 * Convert BITS to USD micros using a specific exchange rate version.
 *
 * Uses integer math: micros = floor(bits * den / num)
 * Rounding is always downward (conservative for provider cost estimation).
 */
export function bitsToUsdMicros(
  bits: Bits,
  rate: Pick<ExchangeRateVersion, "bitsPerUsdMicro">,
): UsdMicros {
  if (bits < 0) throw new Error("bits must be non-negative");
  const { num, den } = rate.bitsPerUsdMicro;
  if (num <= 0) throw new Error("Exchange rate numerator must be positive");
  return Math.floor((bits * den) / num);
}

// ── Legacy rate classification ─────────────────────────────────────────

/**
 * Classification of the two existing exchange rates in the codebase.
 *
 * B1 does NOT pick one. B1 documents both and leaves the choice to a
 * reconciliation audit (B1.10) that determines which rate each historical
 * charge used.
 */
export const LEGACY_EXCHANGE_RATES = {
  /**
   * Used by src/lib/llm-cost-engine.ts
   * $1.00 ≈ 1000 BITS → 1 BIT = $0.001 = 1000 micros
   * bitsPerUsdMicro = 1000 / 1_000_000 = 1/1000
   */
  LLM_ENGINE: {
    id: "legacy-llm-1000-per-usd",
    label: "LLM engine: 1000 BITS per USD (legacy)",
    bitsPerUsdMicro: { num: 1, den: 1000 },
    source: "src/lib/llm-cost-engine.ts line 279",
    note: "costEquivalentBits = providerCostUsd * 1000",
  },
  /**
   * Used by src/lib/generation/cost-engine.ts
   * $1.00 = 100 BITS → 1 BIT = $0.01 = 10000 micros
   * bitsPerUsdMicro = 100 / 1_000_000 = 1/10000
   */
  GENERATION_ENGINE: {
    id: "legacy-generation-100-per-usd",
    label: "Generation engine: 100 BITS per USD (legacy)",
    bitsPerUsdMicro: { num: 1, den: 10000 },
    source: "src/lib/generation/cost-engine.ts line 19",
    note: "CENTS_PER_BIT = 1 → 1 BIT = $0.01",
  },
} as const;

/**
 * The 10× discrepancy between the two legacy engines.
 * Same $1 provider cost:
 *   - LLM engine charges 1000 BITS
 *   - Generation engine charges 100 BITS
 *
 * This must be reconciled before unifying, but B1 does not make the choice.
 */
export const EXCHANGE_RATE_DISCREPANCY = {
  llmEngineBitsPerDollar: 1000,
  generationEngineBitsPerDollar: 100,
  ratio: 10, // LLM charges 10× more for the same provider cost
  warning:
    "Same provider cost charges 10× differently depending on engine. " +
    "Must reconcile historical charges before unifying.",
} as const;

// ── Margin ─────────────────────────────────────────────────────────────

/**
 * Fully-loaded cost components, all in USD micros.
 * Every component is an integer. No floating-point.
 */
export interface CostComponents {
  /** What the provider charges LiTT. */
  providerCostMicros: UsdMicros;
  /** Compute/infrastructure cost. */
  computeCostMicros: UsdMicros;
  /** Storage cost. */
  storageCostMicros: UsdMicros;
  /** Network/egress cost. */
  networkCostMicros: UsdMicros;
  /** Third-party tool costs. */
  toolCostMicros: UsdMicros;
  /** Failure/risk reserve allowance. */
  riskReserveMicros: UsdMicros;
  /** Payment/billing allocation. */
  paymentAllocationMicros: UsdMicros;
}

/**
 * Calculate fully-loaded cost from components.
 */
export function fullyLoadedCostMicros(c: CostComponents): UsdMicros {
  return (
    c.providerCostMicros +
    c.computeCostMicros +
    c.storageCostMicros +
    c.networkCostMicros +
    c.toolCostMicros +
    c.riskReserveMicros +
    c.paymentAllocationMicros
  );
}

/**
 * Apply a margin target to a fully-loaded cost.
 *
 * customerPrice = fullyLoadedCost / (1 - marginBps/10000)
 *
 * All integer math. Result is rounded up (ceil) to ensure margin is met.
 */
export function applyMargin(
  fullyLoadedMicros: UsdMicros,
  marginBps: BasisPoints,
): UsdMicros {
  if (marginBps < 0 || marginBps >= 10000) {
    throw new Error("marginBps must be in [0, 10000)");
  }
  // customerPrice = ceil(fullyLoaded * 10000 / (10000 - marginBps))
  const denominator = 10000 - marginBps;
  return Math.ceil((fullyLoadedMicros * 10000) / denominator);
}

/**
 * Calculate the realized margin in basis points given cost and price.
 *
 * marginBps = floor((price - cost) * 10000 / price)
 */
export function realizedMarginBps(
  costMicros: UsdMicros,
  priceMicros: UsdMicros,
): BasisPoints {
  if (priceMicros <= 0) return 0;
  return Math.floor(((priceMicros - costMicros) * 10000) / priceMicros);
}
