// Canonical LiTTBits pricing contract — the single versioned authority for
// how every billable capability is rated and evidenced.
//
// ── Version model ──────────────────────────────────────────────────────────
//
//   CANONICAL_PRICING_VERSION_ID   — immutable version stamped on every
//                                    credit_ledger charge. Historical charges
//                                    are reproducible from (usage, provider,
//                                    model, pricing_version, exchange_rate).
//                                    NEVER re-rate historical charges with a
//                                    newer version.
//
//   CANONICAL_EXCHANGE_RATE_VERSION_ID — the bits↔USD exchange-rate version
//                                    the charge was rated under.
//
// ── v1: legacy-parity version ──────────────────────────────────────────────
//
// v1 deliberately preserves the two legacy effective exchange rates that
// existed before unification, as distinct pricing lanes inside ONE versioned
// contract:
//
//   - Generation lane (image/video/music/speech): ~100 LiTTBits per USD
//     (1 bit ≈ $0.01, CENTS_PER_BIT = 1 in generation/cost-engine.ts)
//   - LLM lane: ~1,000 LiTTBits per USD-equivalent before margin
//     (providerCostUsd * 1000 in llm-cost-engine.ts)
//
// Unifying these lanes into a single bits/$ rate changes customer economics
// (roughly 10× in one direction). That is an explicit economics decision
// requiring sign-off — it must NOT ship silently. To support that decision,
// every rated charge also emits a shadow rating under SHADOW_PRICING_VERSION_ID
// showing what the charge WOULD be at the unified lane rate, so finance can
// compare real revenue vs. unified-rate revenue from rating_events.
//
// ── What every charge must carry ───────────────────────────────────────────
//
//   providerCostMicros   — what LiTT paid the provider (USD micros), stored
//                          separately from the customer price.
//   bitsCharged          — the customer LiTTBits price actually debited.
//   pricingVersionId     — immutable version reference (→ credit_ledger).
//   exchangeRateVersionId— exchange-rate version reference (→ credit_ledger).
//   billingClass         — standard | premium | code | reasoning | byok | free | flat.
//   margin               — derivable: bitsCharged (via lane rate) minus
//                          providerCost; both sides are recorded.
//
// Evidence is persisted in two places:
//   1. credit_ledger.pricing_version / exchange_rate_version /
//      provider_cost_micros — stamped by idempotency_key (idempotent).
//   2. usage_events → cost_events → rating_events — the canonical evidence
//      chain (usage_events.idempotency_key is unique → replay-safe).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const CANONICAL_PRICING_VERSION_ID = "littbits-pricing-v1";
export const CANONICAL_EXCHANGE_RATE_VERSION_ID = "littbits-exchange-v1";
export const SHADOW_PRICING_VERSION_ID = "littbits-pricing-v2-shadow-unified";

/** LiTTBits per USD for the generation lane (1 bit = $0.01). */
export const GENERATION_LANE_BITS_PER_USD = 100;
/** LiTTBits per USD-equivalent for the LLM lane (legacy ~1000 bits/$). */
export const LLM_LANE_BITS_PER_USD = 1000;
/** The candidate unified lane rate for v2 shadow comparison: 100 bits/$. */
export const UNIFIED_SHADOW_BITS_PER_USD = 100;

export type PricingLane = "generation" | "llm" | "flat";

export interface ChargeRating {
  /** Billable capability: "llm" | "image" | "video" | "music" | "speech" | "agent_run" | … */
  capability: string;
  provider: string;
  model: string;
  /** What LiTT paid the provider, in USD micros. */
  providerCostMicros: number;
  /** Customer LiTTBits actually debited. */
  bitsCharged: number;
  /** Platform gross margin in LiTTBits (bitsCharged − provider-cost bits-equivalent). */
  marginBits: number;
  billingClass: string;
  lane: PricingLane;
  pricingVersionId: string;
  exchangeRateVersionId: string;
}

/** Usage quantities for the usage_events evidence row (all optional). */
export interface ChargeUsage {
  promptTokens?: number;
  completionTokens?: number;
  imageCount?: number;
  videoSeconds?: number;
  audioSeconds?: number;
  computeMs?: number;
  isByok?: boolean;
  projectId?: string;
  runId?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

function laneBitsPerUsd(lane: PricingLane): number {
  return lane === "llm" ? LLM_LANE_BITS_PER_USD : GENERATION_LANE_BITS_PER_USD;
}

/**
 * Build a canonical ChargeRating for a charge. The caller supplies the
 * amounts its engine already computed — this module does NOT re-rate; it
 * normalizes and versions the result so every capability reports through
 * the same contract.
 */
export function buildChargeRating(input: {
  capability: string;
  provider: string;
  model: string;
  providerCostMicros: number;
  bitsCharged: number;
  billingClass?: string;
  lane: PricingLane;
}): ChargeRating {
  const costBits = (input.providerCostMicros / 1_000_000) * laneBitsPerUsd(input.lane);
  return {
    capability: input.capability,
    provider: input.provider,
    model: input.model,
    providerCostMicros: input.providerCostMicros,
    bitsCharged: input.bitsCharged,
    marginBits: Math.max(0, Math.round(input.bitsCharged - costBits)),
    billingClass: input.billingClass ?? "standard",
    lane: input.lane,
    pricingVersionId: CANONICAL_PRICING_VERSION_ID,
    exchangeRateVersionId: CANONICAL_EXCHANGE_RATE_VERSION_ID,
  };
}

/**
 * What this charge WOULD cost under the candidate unified lane rate
 * (100 bits/$ customer price, i.e. provider cost + ~50% margin floor of 1 bit).
 * Returns null when the shadow price equals the enforced price (nothing to
 * compare) or the provider cost is unknown.
 */
export function shadowUnifiedBits(rating: ChargeRating): number | null {
  if (rating.providerCostMicros <= 0) return null;
  const shadow = Math.max(
    1,
    Math.ceil((rating.providerCostMicros / 1_000_000) * UNIFIED_SHADOW_BITS_PER_USD * 1.5),
  );
  return shadow === rating.bitsCharged ? null : shadow;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v: string | undefined): string | null =>
  v && UUID_RE.test(v) ? v : null;

/**
 * Persist canonical pricing evidence for a charge. Best-effort: failures are
 * logged but never block or fail the billing flow — the ledger debit is the
 * authoritative record; this stamps reproducibility metadata on it.
 *
 * 1. Inserts usage_events (unique idempotency_key → replay-safe), then
 *    cost_events + rating_events.
 * 2. Stamps credit_ledger.pricing_version / exchange_rate_version /
 *    provider_cost_micros / usage_event_id keyed by idempotency_key
 *    (idempotent update).
 * 3. When the unified-rate shadow price differs, inserts a second
 *    rating_events row under SHADOW_PRICING_VERSION_ID for comparison.
 */
export async function recordChargeEvidence(
  admin: SupabaseClient,
  input: {
    userId: string;
    idempotencyKey: string;
    rating: ChargeRating;
    usage?: ChargeUsage;
  },
): Promise<void> {
  const { rating } = input;
  let usageEventId: string | null = null;
  try {
    // 1. Evidence chain — replay-safe via usage_events.idempotency_key unique.
    const now = new Date();
    const { data: usageRow, error: usageErr } = await admin
      .from("usage_events")
      .upsert(
        {
          user_id: input.userId,
          project_id: asUuid(input.usage?.projectId),
          run_id: asUuid(input.usage?.runId),
          provider: rating.provider,
          model: rating.model,
          capability: rating.capability,
          input_tokens: input.usage?.promptTokens ?? 0,
          output_tokens: input.usage?.completionTokens ?? 0,
          compute_ms: input.usage?.computeMs ?? 0,
          image_count: input.usage?.imageCount ?? 0,
          video_seconds: input.usage?.videoSeconds ?? 0,
          audio_seconds: input.usage?.audioSeconds ?? 0,
          idempotency_key: input.idempotencyKey,
          is_byok: input.usage?.isByok ?? false,
          started_at: (input.usage?.startedAt ?? now).toISOString(),
          finished_at: (input.usage?.finishedAt ?? now).toISOString(),
        },
        { onConflict: "idempotency_key" },
      )
      .select("usage_event_id")
      .single();

    if (usageErr || !usageRow) {
      if (usageErr) {
        console.error(`[pricing] usage_event insert failed for ${input.idempotencyKey}:`, usageErr.message);
      }
    } else {
      usageEventId = usageRow.usage_event_id;
    }
  } catch (err) {
    console.error("[pricing] usage_event insert threw:", err instanceof Error ? err.message : err);
  }

  try {
    // 2. Stamp the ledger row — idempotent (same key ⇒ same values).
    const { error: stampErr } = await admin
      .from("credit_ledger")
      .update({
        pricing_version: rating.pricingVersionId,
        exchange_rate_version: rating.exchangeRateVersionId,
        provider_cost_micros: rating.providerCostMicros,
        usage_event_id: usageEventId,
      })
      .eq("idempotency_key", input.idempotencyKey);
    if (stampErr) {
      console.error(`[pricing] ledger stamp failed for ${input.idempotencyKey}:`, stampErr.message);
    }
  } catch (err) {
    console.error("[pricing] ledger stamp threw:", err instanceof Error ? err.message : err);
  }

  if (!usageEventId) return;

  try {

    await admin.from("cost_events").insert({
      usage_event_id: usageEventId,
      provider_cost_micros: rating.providerCostMicros,
      total_cost_micros: rating.providerCostMicros,
      rate_card_version: rating.pricingVersionId,
    });

    const ratedMicros = Math.round(
      (rating.bitsCharged / laneBitsPerUsd(rating.lane)) * 1_000_000,
    );
    const realizedMarginBps =
      ratedMicros > 0
        ? Math.round(((ratedMicros - rating.providerCostMicros) / ratedMicros) * 10_000)
        : 0;

    await admin.from("rating_events").insert({
      usage_event_id: usageEventId,
      pricing_version_id: rating.pricingVersionId,
      exchange_rate_version_id: rating.exchangeRateVersionId,
      raw_cost_micros: rating.providerCostMicros,
      loaded_cost_micros: rating.providerCostMicros,
      target_margin_bps: 5000,
      rated_price_micros: ratedMicros,
      bits_charged: rating.bitsCharged,
      realized_margin_bps: Math.max(0, realizedMarginBps),
    });

    // 3. Shadow comparison row for the v2 unified-rate decision.
    const shadowBits = shadowUnifiedBits(rating);
    if (shadowBits !== null) {
      await admin.from("rating_events").insert({
        usage_event_id: usageEventId,
        pricing_version_id: SHADOW_PRICING_VERSION_ID,
        exchange_rate_version_id: CANONICAL_EXCHANGE_RATE_VERSION_ID,
        raw_cost_micros: rating.providerCostMicros,
        loaded_cost_micros: rating.providerCostMicros,
        target_margin_bps: 5000,
        rated_price_micros: Math.round(
          (shadowBits / UNIFIED_SHADOW_BITS_PER_USD) * 1_000_000,
        ),
        bits_charged: shadowBits,
        realized_margin_bps: 5000,
      });
    }
  } catch (err) {
    console.error("[pricing] evidence chain threw:", err instanceof Error ? err.message : err);
  }
}
