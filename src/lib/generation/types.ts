import "server-only";

/**
 * Canonical Generation Job Contract.
 *
 * All media generation (image, video, music, speech) uses this contract.
 * This is the single source of truth for what a generation looks like
 * across providers, billing, storage, and the Studio UI.
 */

export type GenerationModality = "image" | "video" | "music" | "speech";

export type GenerationStatus =
  | "queued"
  | "generating"
  | "processing"
  | "persisting"
  | "completed"
  | "failed"
  | "cancelled";

export type RefundStatus = "none" | "pending" | "refunded" | "failed";

/**
 * Canonical generation job — one row per generation attempt.
 * Stored in the `generation_jobs` table (see migration).
 */
export interface GenerationJob {
  id: string;
  userId: string;
  modality: GenerationModality;
  provider: string;
  model: string;
  status: GenerationStatus;
  prompt: string;
  requestId: string;
  providerJobId: string | null;
  actualProviderCostCents: number | null;
  littBitsCharged: number;
  refundStatus: RefundStatus;
  assetId: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  completedAt: string | null;
}

/**
 * LiTT product tiers — user-facing quality levels.
 * The user chooses a tier; LiTT selects the underlying provider.
 */
export type ProductTier = "fast" | "balanced" | "pro";

/**
 * LiTT product aliases — what users see in the UI.
 * Provider names are hidden behind these aliases.
 */
export interface LittProduct {
  id: string;
  label: string;
  modality: GenerationModality;
  tier: ProductTier;
  provider: string;
  model: string;
  description: string;
}

/**
 * Cost calculation input.
 */
export interface CostInput {
  modality: GenerationModality;
  provider: string;
  model: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
}

/**
 * Cost calculation result.
 */
export interface CostResult {
  providerCostCents: number;
  infrastructureAllowanceCents: number;
  marginPercent: number;
  retailLiTTBits: number;
}

/**
 * Provider health status.
 */
export type ProviderHealthState =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "quota_exhausted"
  | "not_configured"
  | "failed";

export interface ProviderHealth {
  id: string;
  state: ProviderHealthState;
  detail: string;
  latencyMs: number | null;
  lastChecked: string;
}
