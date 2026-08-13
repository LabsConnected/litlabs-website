import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { GenerationJob, GenerationModality, GenerationStatus, RefundStatus } from "./types";

/**
 * Generation jobs persistence layer.
 *
 * Stores one row per generation attempt in the `generation_jobs` table.
 * This replaces the in-memory video job store and provides durable,
 * queryable job history for all modalities.
 */

export interface CreateGenerationJobInput {
  id: string;
  userId: string;
  modality: GenerationModality;
  provider: string;
  model: string;
  prompt: string;
  requestId: string;
  littBitsCharged: number;
  metadata?: Record<string, unknown>;
}

/**
 * Create a generation job row.
 * Uses ON CONFLICT DO NOTHING on (user_id, request_id) for idempotency.
 */
export async function createGenerationJob(
  input: CreateGenerationJobInput,
): Promise<GenerationJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("generation_jobs")
    .insert({
      id: input.id,
      user_id: input.userId,
      modality: input.modality,
      provider: input.provider,
      model: input.model,
      status: "queued",
      prompt: input.prompt.slice(0, 2000),
      request_id: input.requestId,
      provider_job_id: null,
      actual_provider_cost_cents: null,
      littbits_charged: input.littBitsCharged,
      refund_status: "none",
      asset_id: null,
      error: null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .maybeSingle();

  if (error) {
    // If it's a unique constraint violation, the job already exists (replay)
    if (error.code === "23505") {
      const existing = await getGenerationJobByRequestId(input.userId, input.requestId);
      return existing;
    }
    console.error("[generation-jobs] create failed:", error.message);
    return null;
  }

  return rowToJob(data);
}

/**
 * Get a generation job by ID.
 */
export async function getGenerationJob(jobId: string): Promise<GenerationJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("generation_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToJob(data);
}

/**
 * Get a generation job by (userId, requestId) — the idempotency key.
 */
export async function getGenerationJobByRequestId(
  userId: string,
  requestId: string,
): Promise<GenerationJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToJob(data);
}

/**
 * Get a generation job by provider job ID.
 * Used by video status routes to find the generation_jobs row
 * associated with a provider operation/task.
 */
export async function getGenerationJobByProviderJobId(
  userId: string,
  providerJobId: string,
): Promise<GenerationJob | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("provider_job_id", providerJobId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToJob(data);
}

/**
 * Update a generation job's status.
 */
export async function updateGenerationJobStatus(
  jobId: string,
  status: GenerationStatus,
  updates?: {
    providerJobId?: string | null;
    actualProviderCostCents?: number;
    assetId?: string | null;
    error?: string;
    refundStatus?: RefundStatus;
  },
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const patch: Record<string, unknown> = {
    status,
    ...(updates?.providerJobId !== undefined && { provider_job_id: updates.providerJobId }),
    ...(updates?.actualProviderCostCents !== undefined && {
      actual_provider_cost_cents: updates.actualProviderCostCents,
    }),
    ...(updates?.assetId !== undefined && { asset_id: updates.assetId }),
    ...(updates?.error !== undefined && { error: updates.error }),
    ...(updates?.refundStatus !== undefined && { refund_status: updates.refundStatus }),
    ...(status === "completed" && { completed_at: new Date().toISOString() }),
  };

  await admin.from("generation_jobs").update(patch).eq("id", jobId);
}

/**
 * Mark a generation job as failed and record the error.
 */
export async function failGenerationJob(
  jobId: string,
  error: string,
  refundStatus: RefundStatus = "none",
): Promise<void> {
  await updateGenerationJobStatus(jobId, "failed", {
    error: error.slice(0, 1000),
    refundStatus,
  });
}

/**
 * Mark a generation job as completed with an asset ID.
 */
export async function completeGenerationJob(
  jobId: string,
  assetId: string | null,
  actualProviderCostCents?: number,
): Promise<void> {
  await updateGenerationJobStatus(jobId, "completed", {
    assetId,
    actualProviderCostCents,
    refundStatus: "none",
  });
}

/**
 * Update a generation job's metadata by merging new keys into the
 * existing JSONB metadata field. This is used by video status routes
 * to add the durable URL after the video is persisted to R2.
 */
export async function updateGenerationJobMetadata(
  jobId: string,
  metadataUpdates: Record<string, unknown>,
): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  // Fetch existing metadata first.
  const { data } = await admin
    .from("generation_jobs")
    .select("metadata")
    .eq("id", jobId)
    .maybeSingle();

  const existingMetadata = (data?.metadata as Record<string, unknown>) ?? {};
  const merged = { ...existingMetadata, ...metadataUpdates };

  await admin
    .from("generation_jobs")
    .update({ metadata: merged })
    .eq("id", jobId);
}

// ─── Helpers ────────────────────────────────────────────────────

function rowToJob(row: Record<string, unknown>): GenerationJob {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    modality: row.modality as GenerationModality,
    provider: row.provider as string,
    model: row.model as string,
    status: row.status as GenerationStatus,
    prompt: row.prompt as string,
    requestId: row.request_id as string,
    providerJobId: (row.provider_job_id as string) ?? null,
    actualProviderCostCents: (row.actual_provider_cost_cents as number) ?? null,
    littBitsCharged: (row.littbits_charged as number) ?? 0,
    refundStatus: (row.refund_status as RefundStatus) ?? "none",
    assetId: (row.asset_id as string) ?? null,
    error: (row.error as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string) ?? null,
  };
}
