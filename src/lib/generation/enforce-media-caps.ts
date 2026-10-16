import "server-only";
import { NextResponse } from "next/server";
import { PLANS, type PlanId } from "@/config/plans";
import { getProviderCostCents } from "@/lib/generation/cost-engine";
import { PLAN_MEDIA_MONTHLY_CAPS } from "@/lib/generation/media-caps";
import type { GenerationModality } from "@/lib/generation/types";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Free catalog rows charge the provider nothing, so the monthly image count
 * and the half-of-revenue spend cap do not bound them. Each plan gets a
 * daily ceiling so a script cannot farm those endpoints.
 *
 * The ceiling applies to every 0-cent generation, not only the three image
 * models below. Starter is the free plan. Creator and Pro are higher because
 * they already pay. Founder is a one-time tier. Owner stays finite.
 */
export const FREE_IMAGE_DAILY_CAP: Record<PlanId, number> = {
  starter: 8,
  creator_beta: 25,
  pro_builder_beta: 50,
  founder: 12,
  owner: 40,
};

const FREE_IMAGE_MODELS = new Set([
  "cloudflare:flux-1-schnell",
  "together:flux-1-schnell-free",
  "pollinations:flux",
]);

const COUNTED_STATUSES = new Set([
  "queued",
  "generating",
  "processing",
  "persisting",
  "completed",
]);

const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

export type PlanLimitReason =
  | "monthly_image_cap"
  | "monthly_video_cap"
  | "provider_spend_cap"
  | "free_model_daily_cap"
  | "usage_unavailable";

export interface PlanLimitDenial {
  status: 402 | 429;
  code: "plan_limit";
  reason: PlanLimitReason;
  error: string;
}

export class PlanLimitError extends Error {
  readonly status: 402 | 429;
  readonly reason: PlanLimitReason;
  readonly code = "plan_limit" as const;

  constructor(denial: PlanLimitDenial) {
    super(denial.error);
    this.name = "PlanLimitError";
    this.status = denial.status;
    this.reason = denial.reason;
  }
}

export interface MediaUsageSnapshot {
  imagesThisMonth: number;
  videosThisMonth: number;
  providerSpendCentsThisMonth: number;
  /** Free image rows today. Kept so older callers can still read it. */
  freeImagesToday: number;
  /** Every 0-cent generation today, any modality. */
  freeModelsToday: number;
}

export interface GenerationUsageRow {
  modality: string;
  provider: string;
  model: string;
  status: string;
  refund_status?: string | null;
  actual_provider_cost_cents?: number | null;
  created_at: string;
  request_id?: string | null;
  metadata?: Record<string, unknown> | null;
  units?: number | null;
}

export function isFreeImageModel(provider: string, model: string): boolean {
  return FREE_IMAGE_MODELS.has(`${provider}:${model}`);
}

/** Zero-cent calls and the known free image models. Paid counts do not include these. */
export function isFreeGeneration(
  modality: GenerationModality,
  provider: string,
  model: string,
  providerCostCents: number,
): boolean {
  if (providerCostCents <= 0) return true;
  return modality === "image" && isFreeImageModel(provider, model);
}

export function emptyMediaUsage(): MediaUsageSnapshot {
  return {
    imagesThisMonth: 0,
    videosThisMonth: 0,
    providerSpendCentsThisMonth: 0,
    freeImagesToday: 0,
    freeModelsToday: 0,
  };
}

function rowUnits(row: GenerationUsageRow): number {
  return typeof row.units === "number" && row.units > 0 ? row.units : 1;
}

function rowProviderCents(row: GenerationUsageRow): number {
  if (isFreeImageModel(row.provider, row.model)) return 0;
  if (row.actual_provider_cost_cents === 0) return 0;
  if (
    typeof row.actual_provider_cost_cents === "number" &&
    row.actual_provider_cost_cents > 0
  ) {
    return row.actual_provider_cost_cents;
  }
  const meta = row.metadata ?? {};
  const duration =
    typeof meta.duration === "number"
      ? meta.duration
      : typeof meta.durationSeconds === "number"
        ? meta.durationSeconds
        : undefined;
  const resolution = typeof meta.resolution === "string" ? meta.resolution : undefined;
  if (
    row.modality !== "image" &&
    row.modality !== "video" &&
    row.modality !== "music" &&
    row.modality !== "speech"
  ) {
    return 0;
  }
  return getProviderCostCents({
    modality: row.modality,
    provider: row.provider,
    model: row.model,
    durationSeconds: duration,
    resolution,
  });
}

function isFreeUsageRow(row: GenerationUsageRow): boolean {
  if (row.modality === "image" && isFreeImageModel(row.provider, row.model)) return true;
  if (row.actual_provider_cost_cents === 0) return true;
  return rowProviderCents(row) <= 0;
}

/** Prior usage for the UTC month, excluding the request about to run. */
export function summarizeMediaUsage(
  rows: GenerationUsageRow[],
  now: Date,
  excludeRequestId?: string,
): MediaUsageSnapshot {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const usage = emptyMediaUsage();
  for (const row of rows) {
    if (excludeRequestId && row.request_id === excludeRequestId) continue;
    if (!COUNTED_STATUSES.has(row.status)) continue;
    if (row.refund_status === "refunded") continue;
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(created) || created < monthStart) continue;
    const units = rowUnits(row);
    const free = isFreeUsageRow(row);
    if (row.modality === "image" && !free) usage.imagesThisMonth += units;
    if (row.modality === "video" && !free) usage.videosThisMonth += units;
    if (!free) usage.providerSpendCentsThisMonth += rowProviderCents(row) * units;
    if (free && created >= dayStart) {
      usage.freeModelsToday += units;
      if (row.modality === "image") usage.freeImagesToday += units;
    }
  }
  return usage;
}

function denial(
  status: 402 | 429,
  reason: PlanLimitReason,
  error: string,
): PlanLimitDenial {
  return { status, code: "plan_limit", reason, error };
}

function freeTodayCount(usage: MediaUsageSnapshot): number {
  return usage.freeModelsToday ?? usage.freeImagesToday;
}

/**
 * Decide whether this call fits the plan.
 *
 * Every catalog model hits one of these ceilings:
 * - 0-cent models (any modality): the per-plan daily cap
 * - paid images: the monthly image count, then the provider-spend cap
 * - paid videos: the monthly video count, then the provider-spend cap
 * - paid music and speech: the provider-spend cap
 *
 * Billing-exempt callers skip the monthly count and spend ceilings and
 * still hit the free-model daily cap.
 */
export function evaluateMediaCap(input: {
  planId: PlanId;
  modality: GenerationModality;
  provider: string;
  model: string;
  providerCostCents: number;
  usage: MediaUsageSnapshot;
  billingExempt?: boolean;
  units?: number;
}): PlanLimitDenial | null {
  const caps = PLAN_MEDIA_MONTHLY_CAPS[input.planId];
  const exempt = input.billingExempt === true;
  const units = input.units && input.units > 0 ? input.units : 1;
  const free = isFreeGeneration(
    input.modality,
    input.provider,
    input.model,
    input.providerCostCents,
  );
  const planName = PLANS[input.planId].name;

  if (free) {
    const daily = FREE_IMAGE_DAILY_CAP[input.planId];
    if (freeTodayCount(input.usage) + units > daily) {
      return denial(
        429,
        "free_model_daily_cap",
        `${planName} allows ${daily} free generations per day. Today's limit is reached.`,
      );
    }
    return null;
  }

  if (exempt) return null;

  if (input.modality === "image") {
    if (input.usage.imagesThisMonth + units > caps.maxImages) {
      return denial(
        429,
        "monthly_image_cap",
        `${planName} allows ${caps.maxImages} paid images this month.`,
      );
    }
  }

  if (input.modality === "video" && input.providerCostCents > 0) {
    if (input.usage.videosThisMonth + units > caps.maxVideos) {
      return denial(
        429,
        "monthly_video_cap",
        `${planName} allows ${caps.maxVideos} videos this month.`,
      );
    }
  }

  if (input.providerCostCents > 0) {
    const next = input.usage.providerSpendCentsThisMonth + input.providerCostCents * units;
    if (next > caps.maxProviderSpendCents) {
      return denial(
        402,
        "provider_spend_cap",
        `${planName} provider spend cap is ${caps.maxProviderSpendCents} cents this month. This request would reach ${next} cents.`,
      );
    }
  }

  return null;
}

export function planLimitResponse(denialResult: PlanLimitDenial): NextResponse {
  return NextResponse.json(
    { error: denialResult.error, code: denialResult.code, reason: denialResult.reason },
    { status: denialResult.status },
  );
}

function isPlanId(value: string): value is PlanId {
  return value in PLANS;
}

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

async function resolvePlan(
  admin: AdminClient,
  clerkId: string,
): Promise<{ planId: PlanId; internalUserId: string | null } | { error: string }> {
  const { data: user, error: userError } = await admin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  if (userError) return { error: userError.message };
  if (!user?.id) return { planId: "starter", internalUserId: null };

  const { data: sub, error: subError } = await admin
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (subError) return { error: subError.message };
  const plan =
    sub &&
    typeof sub.plan === "string" &&
    isPlanId(sub.plan) &&
    ENTITLED_STATUSES.has(sub.status)
      ? sub.plan
      : "starter";
  return { planId: plan, internalUserId: user.id };
}

const UNAVAILABLE = denial(
  402,
  "usage_unavailable",
  "Plan usage could not be read. Nothing was generated.",
);

function parseClaim(data: unknown): PlanLimitDenial | null | "bad" {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return "bad";
  const claim = row as {
    allowed?: boolean;
    status?: number;
    reason?: PlanLimitReason;
    error?: string;
  };
  if (claim.allowed === true) return null;
  if (
    (claim.status === 402 || claim.status === 429) &&
    claim.reason &&
    typeof claim.error === "string"
  ) {
    return {
      status: claim.status,
      code: "plan_limit",
      reason: claim.reason,
      error: claim.error,
    };
  }
  return "bad";
}

/**
 * Reserve this generation against the plan before the provider is called.
 *
 * The reservation is `claim_media_cap_slot`. That function holds a per-user
 * advisory lock, counts this month's holds and completed jobs, and inserts
 * the hold in the same transaction. Two parallel calls cannot both take the
 * last slot. A missing user row or a failed claim fails closed.
 */
export async function assertGenerationWithinPlanCaps(input: {
  clerkId: string;
  requestId?: string;
  modality: GenerationModality;
  provider: string;
  model: string;
  providerCostCents: number;
  billingExempt?: boolean;
  units?: number;
  now?: Date;
}): Promise<PlanLimitDenial | null> {
  const admin = getSupabaseAdmin();
  if (!admin || typeof admin.rpc !== "function") return UNAVAILABLE;

  const plan = await resolvePlan(admin, input.clerkId);
  if ("error" in plan) return UNAVAILABLE;
  if (!plan.internalUserId) return UNAVAILABLE;

  const caps = PLAN_MEDIA_MONTHLY_CAPS[plan.planId];
  const units = input.units && input.units > 0 ? input.units : 1;
  const free = isFreeGeneration(
    input.modality,
    input.provider,
    input.model,
    input.providerCostCents,
  );
  const now = input.now ?? new Date();
  const { data, error } = await admin.rpc("claim_media_cap_slot", {
    p_user_id: plan.internalUserId,
    p_request_id: input.requestId || crypto.randomUUID(),
    p_modality: input.modality,
    p_provider: input.provider,
    p_model: input.model,
    p_provider_cost_cents: Math.max(0, Math.round(input.providerCostCents)),
    p_free_model: free,
    p_billing_exempt: input.billingExempt === true,
    p_max_images: caps.maxImages,
    p_max_videos: caps.maxVideos,
    p_max_spend_cents: caps.maxProviderSpendCents,
    p_free_daily: FREE_IMAGE_DAILY_CAP[plan.planId],
    p_units: units,
    p_now: now.toISOString(),
  });
  if (error) return UNAVAILABLE;
  const parsed = parseClaim(data);
  return parsed === "bad" ? UNAVAILABLE : parsed;
}

/** Drop a reservation after the provider was not used. Idempotent. */
export async function releaseMediaCapHold(input: {
  internalUserId: string;
  requestId: string;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin || typeof admin.rpc !== "function") return;
  const { error } = await admin.rpc("release_media_cap_hold", {
    p_user_id: input.internalUserId,
    p_request_id: input.requestId,
  });
  if (error) {
    console.error("[media-cap] release failed:", error.message);
  }
}

/** Keep a successful generation inside the cap after the provider returns. */
export async function settleMediaCapHold(input: {
  internalUserId: string;
  requestId: string;
  now?: Date;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin || typeof admin.rpc !== "function") return;
  const { error } = await admin.rpc("settle_media_cap_hold", {
    p_user_id: input.internalUserId,
    p_request_id: input.requestId,
    p_now: (input.now ?? new Date()).toISOString(),
  });
  if (error) {
    console.error("[media-cap] settle failed:", error.message);
  }
}

async function withClerkHold(
  clerkId: string,
  requestId: string,
  run: (internalUserId: string) => Promise<void>,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin || typeof admin.rpc !== "function") return;
    const plan = await resolvePlan(admin, clerkId);
    if ("error" in plan || !plan.internalUserId) return;
    await run(plan.internalUserId);
  } catch (err) {
    console.error("[media-cap] hold update failed:", err instanceof Error ? err.message : err);
  }
}

export function releaseMediaCapHoldForClerk(clerkId: string, requestId: string): Promise<void> {
  return withClerkHold(clerkId, requestId, (internalUserId) =>
    releaseMediaCapHold({ internalUserId, requestId }),
  );
}

export function settleMediaCapHoldForClerk(clerkId: string, requestId: string): Promise<void> {
  return withClerkHold(clerkId, requestId, (internalUserId) =>
    settleMediaCapHold({ internalUserId, requestId }),
  );
}
