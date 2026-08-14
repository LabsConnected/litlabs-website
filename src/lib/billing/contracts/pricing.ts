/**
 * Canonical pricing versioning contracts.
 *
 * Provider price catalogs must have immutable/versioned identities.
 * Every settled charge must be reproducible later from:
 *
 *   usage + provider/model + pricingVersion + exchangeRateVersion + billing policy
 *
 * Never calculate historical invoices using today's pricing table.
 */

import type { UsdMicros, BasisPoints, Bits } from "./monetary";
import type { ExchangeRateVersion } from "./monetary";

// ── Pricing version ────────────────────────────────────────────────────

/**
 * An immutable pricing version.
 *
 * A pricing version is a snapshot of all rates at a point in time.
 * Once created, it never changes. All charges reference the version
 * they were calculated under.
 */
export interface PricingVersion {
  /** Unique immutable identifier, e.g. "price-2026-08-13-v1" */
  id: string;
  /** Human-readable label. */
  label: string;
  /** When this version became effective. */
  effectiveFrom: string; // ISO 8601
  /** When this version was superseded (null = still active). */
  effectiveUntil: string | null;
  /** Exchange rate version used by this pricing version. */
  exchangeRateVersionId: string;
  /** Default margin target in basis points. */
  defaultMarginBps: BasisPoints;
  /** Default infrastructure allowance in micro-USD. */
  defaultInfraAllowanceMicros: UsdMicros;
  /** Default risk reserve in basis points (applied to provider cost). */
  defaultRiskReserveBps: BasisPoints;
  /** Default payment allocation in basis points. */
  defaultPaymentAllocationBps: BasisPoints;
  /** Who approved this version. */
  approvedBy: string;
  /** Creation timestamp. */
  createdAt: string;
}

// ── Rate card entry ────────────────────────────────────────────────────

/**
 * Unit of measurement for pricing.
 */
export type PricingUnit =
  | "per_1m_prompt_tokens"
  | "per_1m_completion_tokens"
  | "per_1k_tokens"
  | "per_image"
  | "per_video_second"
  | "per_audio_second"
  | "per_music_clip"
  | "per_request"
  | "per_compute_ms"
  | "per_storage_gb_hour"
  | "per_network_gb"
  | "per_tool_call"
  | "per_terminal_minute"
  | "per_deployment";

/**
 * A single entry in a pricing catalog.
 *
 * This is the versioned replacement for the hardcoded COST_CATALOG
 * in llm-cost-engine.ts and PROVIDER_COST_CENTS in generation/cost-engine.ts.
 */
export interface PricingCatalogEntry {
  /** Unique ID. */
  id: string;
  /** Pricing version this entry belongs to. */
  pricingVersionId: string;
  /** Provider identifier. */
  provider: string;
  /** Model name. */
  model: string;
  /** Capability/modality. */
  capability: string;
  /** Unit of measurement. */
  unit: PricingUnit;
  /** Provider rate in USD micros per unit. */
  providerRateMicros: UsdMicros;
  /** Customer rate in USD micros per unit (after margin). */
  customerRateMicros: UsdMicros;
  /** Billing class. */
  billingClass: string;
  /** Minimum charge in BITS (floor per request). */
  minimumBits: Bits;
  /** Effective from (within the pricing version's range). */
  effectiveFrom: string;
  /** Effective until (null = until version expires). */
  effectiveUntil: string | null;
}

// ── Rating result ──────────────────────────────────────────────────────

/**
 * The result of rating a usage event — converting raw usage into
 * provider cost, customer price, and BITS charge.
 */
export interface RatingResult {
  /** Usage event ID this rating applies to. */
  usageEventId: string;
  /** Pricing version used. */
  pricingVersionId: string;
  /** Exchange rate version used. */
  exchangeRateVersionId: string;
  /** Raw provider cost in micro-USD. */
  rawCostMicros: UsdMicros;
  /** Fully-loaded cost (provider + infra + reserve + payment allocation). */
  loadedCostMicros: UsdMicros;
  /** Target margin in basis points. */
  targetMarginBps: BasisPoints;
  /** Rated customer price in micro-USD. */
  ratedPriceMicros: UsdMicros;
  /** BITS charged to customer. */
  bitsCharged: Bits;
  /** Realized margin in basis points. */
  realizedMarginBps: BasisPoints;
  /** Discount applied (null if none). */
  discountId: string | null;
  /** Plan ID used for pricing (if plan-specific). */
  planId: string | null;
  /** Billing class. */
  billingClass: string;
  /** Whether this was a BYOK charge (platform fee only). */
  isByok: boolean;
}

// ── Legacy catalog classification ──────────────────────────────────────

/**
 * Classification of existing hardcoded cost catalogs.
 *
 * B1 does NOT replace these. B1 defines the versioned contract.
 * The existing catalogs continue to work until a migration moves
 * them into the pricing_catalog table.
 */
export const LEGACY_CATALOGS = {
  LLM_COST_ENGINE: {
    file: "src/lib/llm-cost-engine.ts",
    lines: "76-180",
    unit: "per_1m_tokens (prompt/completion separately)",
    exchangeRate: "legacy-llm-1000-per-usd",
    marginTarget: 0.50, // 50%
    note: "Hardcoded COST_CATALOG array. Not versioned. Not reproducible.",
  },
  GENERATION_COST_ENGINE: {
    file: "src/lib/generation/cost-engine.ts",
    lines: "41-69",
    unit: "per_generation (cents)",
    exchangeRate: "legacy-generation-100-per-usd",
    marginTarget: 0.50, // 50%
    note: "Hardcoded PROVIDER_COST_CENTS record. Not versioned. Not reproducible.",
  },
  USAGE_COSTS: {
    file: "src/config/usage-costs.ts",
    lines: "21-88",
    unit: "flat BITS per category",
    exchangeRate: "none (flat BITS, no provider cost)",
    marginTarget: null,
    note: "Hardcoded flat BITS. No provider cost tracking. No margin. Not used by actual billing path.",
  },
  VIDEO_TIERS: {
    file: "src/config/video-tiers.ts",
    lines: "33-94",
    unit: "flat BITS per tier",
    exchangeRate: "none (flat BITS)",
    marginTarget: null,
    note: "Hardcoded flat BITS per video tier. Not versioned.",
  },
  STUDIO_MODELS: {
    file: "src/lib/studio-models.ts",
    lines: "179-266",
    unit: "flat BITS per model",
    exchangeRate: "none (flat BITS)",
    marginTarget: null,
    note: "Hardcoded cost per video/music model. Duplicates generation cost engine.",
  },
} as const;
