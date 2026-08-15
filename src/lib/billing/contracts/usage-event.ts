/**
 * Canonical unified UsageEvent contract.
 *
 * Raw usage must be immutable. UsageEvent must contain sufficient fields
 * to reconstruct billing. Never store only the final BITS debit.
 *
 * This is the unified contract that supersedes the fragmented tracking in:
 *   - llm_usage_records (LLM-specific)
 *   - generation_jobs (media-specific)
 *   - agent_runs (agent-specific)
 *   - terminal_usage (terminal-specific)
 *
 * B1 defines the contract. Migration of existing tables is a later phase.
 */

import type { UsdMicros, Bits } from "./monetary";
import type { BillabilityDecision } from "./billability";

// ── Capability / modality ──────────────────────────────────────────────

/**
 * The type of capability that produced this usage.
 */
export type Capability =
  | "llm_chat"
  | "llm_code"
  | "llm_reasoning"
  | "image_generation"
  | "video_generation"
  | "music_generation"
  | "speech_stt"
  | "speech_tts"
  | "terminal"
  | "browser"
  | "cloud_execution"
  | "tool_call"
  | "storage"
  | "network"
  | "deployment"
  | "api_request"
  | "automation"
  | "campaign_os";

// ── UsageEvent ─────────────────────────────────────────────────────────

/**
 * Immutable raw usage event.
 *
 * This is the evidence of what physically happened. It is never mutated
 * after creation. All billing calculations derive from this + pricing version.
 */
export interface UsageEvent {
  /** Immutable unique event ID. */
  usageEventId: string;
  /** Tenant ID (null until tenant concept is implemented). */
  tenantId: string | null;
  /** User/account ID (internal Supabase UUID). */
  userId: string;
  /** Run ID this event belongs to. */
  runId: string | null;
  /** Project ID (optional). */
  projectId: string | null;

  // ── Provider / model ──
  /** Provider that handled the request. */
  provider: string;
  /** Model name. */
  model: string;
  /** Capability/modality. */
  capability: Capability;

  // ── Token usage (LLM) ──
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;

  // ── Compute / runtime ──
  /** Compute time in milliseconds. */
  computeMs: number;
  /** Wall-clock runtime in seconds. */
  runtimeSeconds: number;

  // ── Media-specific ──
  imageCount: number;
  videoSeconds: number;
  audioSeconds: number;

  // ── Resource usage ──
  storageBytes: number;
  networkBytes: number;
  /** Number of tool calls in this event. */
  toolCalls: number;

  // ── Provider correlation ──
  /** Provider's request ID (for cross-referencing with provider invoices). */
  providerRequestId: string | null;

  // ── Timing ──
  startedAt: string; // ISO 8601
  finishedAt: string; // ISO 8601

  // ── Idempotency ──
  idempotencyKey: string;

  // ── Billability ──
  billability: BillabilityDecision;

  // ── BYOK ──
  /** True if the user supplied their own API key. */
  isByok: boolean;
}

// ── Cost event ─────────────────────────────────────────────────────────

/**
 * What LiTT actually paid for a usage event.
 * All values in integer micro-USD.
 */
export interface CostEvent {
  /** Usage event this cost applies to. */
  usageEventId: string;
  /** Provider cost in micro-USD. */
  providerCostMicros: UsdMicros;
  /** Compute cost in micro-USD. */
  computeCostMicros: UsdMicros;
  /** Storage cost in micro-USD. */
  storageCostMicros: UsdMicros;
  /** Network cost in micro-USD. */
  networkCostMicros: UsdMicros;
  /** Third-party tool cost in micro-USD. */
  toolCostMicros: UsdMicros;
  /** Total cost in micro-USD. */
  totalCostMicros: UsdMicros;
  /** Rate card version used for this calculation. */
  rateCardVersion: string;
}

// ── Rating event ───────────────────────────────────────────────────────

/**
 * What that usage should cost the customer.
 * This is the stored result of the rating engine.
 */
export interface RatingEvent {
  /** Usage event this rating applies to. */
  usageEventId: string;
  /** Pricing version used. */
  pricingVersionId: string;
  /** Exchange rate version used. */
  exchangeRateVersionId: string;
  /** Raw provider cost in micro-USD. */
  rawCostMicros: UsdMicros;
  /** Fully-loaded cost in micro-USD. */
  loadedCostMicros: UsdMicros;
  /** Target margin in basis points. */
  targetMarginBps: number;
  /** Rated customer price in micro-USD. */
  ratedPriceMicros: UsdMicros;
  /** BITS charged to customer. */
  bitsCharged: Bits;
  /** Realized margin in basis points. */
  realizedMarginBps: number;
  /** Discount applied (null if none). */
  discountId: string | null;
  /** Plan ID used for pricing (if plan-specific). */
  planId: string | null;
}

// ── Correlation chain ──────────────────────────────────────────────────

/**
 * Full correlation chain for a single billable execution.
 *
 *   tenantId → userId → runId → usageEventId → ratingEventId
 *            → reservationId → journalEntryId → StripeEventId
 *            → StripeCustomerId → providerRequestId → pricingVersion
 */
export interface BillingCorrelation {
  tenantId: string | null;
  userId: string;
  runId: string | null;
  usageEventId: string;
  costEventId: string | null;
  ratingEventId: string | null;
  reservationId: string | null;
  settleEntryId: string | null;
  stripeEventId: string | null;
  stripeCustomerId: string | null;
  providerRequestId: string | null;
  pricingVersionId: string | null;
  exchangeRateVersionId: string | null;
}

// ── Existing table mapping ─────────────────────────────────────────────

/**
 * How existing tables map to the unified UsageEvent contract.
 *
 * B1 does NOT migrate these tables. B1 defines the target contract.
 * Migration is a later phase.
 */
export const EXISTING_TABLE_MAPPING = {
  llm_usage_records: {
    mapsTo: "UsageEvent (LLM subset)",
    fieldsCovered: [
      "clerk_id → userId (via lookup)",
      "provider",
      "model",
      "prompt_tokens → inputTokens",
      "completion_tokens → outputTokens",
      "is_byok",
      "billing_class",
      "provider_cost_micros",
      "retail_littbits → bitsCharged",
      "call_id → providerRequestId",
    ],
    fieldsMissing: [
      "tenantId", "runId", "projectId", "capability",
      "cachedInputTokens", "computeMs", "runtimeSeconds",
      "imageCount", "videoSeconds", "audioSeconds",
      "storageBytes", "networkBytes", "toolCalls",
      "billability", "idempotencyKey",
    ],
  },
  generation_jobs: {
    mapsTo: "UsageEvent (media subset)",
    fieldsCovered: [
      "user_id → userId",
      "modality → capability",
      "provider",
      "model",
      "request_id → providerRequestId",
      "actual_provider_cost_cents → CostEvent",
      "littbits_charged → bitsCharged",
    ],
    fieldsMissing: [
      "tenantId", "runId", "projectId",
      "inputTokens", "outputTokens", "cachedInputTokens",
      "computeMs", "runtimeSeconds",
      "storageBytes", "networkBytes", "toolCalls",
      "billability", "idempotencyKey",
    ],
  },
  agent_runs: {
    mapsTo: "UsageEvent (agent run metadata)",
    fieldsCovered: [
      "user_id → userId",
      "id → runId",
      "model",
      "provider",
      "input_tokens", "output_tokens",
      "credits_charged → bitsCharged (reserved, not settled)",
      "idempotency_key",
    ],
    fieldsMissing: [
      "tenantId", "projectId", "capability",
      "cachedInputTokens", "computeMs", "runtimeSeconds",
      "imageCount", "videoSeconds", "audioSeconds",
      "storageBytes", "networkBytes", "toolCalls",
      "billability", "providerRequestId",
      "actual bits charged (credits_charged is reserved amount)",
    ],
  },
  terminal_usage: {
    mapsTo: "UsageEvent (terminal aggregate)",
    fieldsCovered: [
      "user_id → userId",
      "sandbox_hours → runtimeSeconds (aggregate)",
      "storage_gb_hours → storageBytes (aggregate)",
    ],
    fieldsMissing: [
      "All per-event fields (this is an aggregate table)",
      "Not correlated to credit_ledger debits",
    ],
  },
} as const;
