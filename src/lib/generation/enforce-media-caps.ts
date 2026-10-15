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
 * Starter is the free plan. Creator and Pro are higher because they already
 * pay. Founder is a one-time tier. Owner stays finite.
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

export interface MediaUsageSnapshot {
  imagesThisMonth: number;
  videosThisMonth: number;
  providerSpendCentsThisMonth: number;
  freeImagesToday: number;
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
}

export function isFreeImageModel(provider: string, model: string): boolean {
  return FREE_IMAGE_MODELS.has(`${provider}:${model}`);
}

export function emptyMediaUsage(): MediaUsageSnapshot {
  return {
    imagesThisMonth: 0,
    videosThisMonth: 0,
    providerSpendCentsThisMonth: 0,
    freeImagesToday: 0,
  };
}

function rowProviderCents(row: GenerationUsageRow): number {
  if (isFreeImageModel(row.provider, row.model)) return 0;
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
    const free = row.modality === "image" && isFreeImageModel(row.provider, row.model);
    if (row.modality === "image" && !free) usage.imagesThisMonth += 1;
    if (row.modality === "video") usage.videosThisMonth += 1;
    usage.providerSpendCentsThisMonth += rowProviderCents(row);
    if (free && created >= dayStart) usage.freeImagesToday += 1;
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

/**
 * Decide whether this call fits the plan. Billing-exempt callers skip the
 * monthly count and spend ceilings (those are the paid-plan revenue caps)
 * and still hit the free-model daily cap.
 */
export function evaluateMediaCap(input: {
  planId: PlanId;
  modality: GenerationModality;
  provider: string;
  model: string;
  providerCostCents: number;
  usage: MediaUsageSnapshot;
  billingExempt?: boolean;
}): PlanLimitDenial | null {
  const caps = PLAN_MEDIA_MONTHLY_CAPS[input.planId];
  const exempt = input.billingExempt === true;
  const freeImage =
    input.modality === "image" &&
    (input.providerCostCents <= 0 || isFreeImageModel(input.provider, input.model));

  if (freeImage) {
    const daily = FREE_IMAGE_DAILY_CAP[input.planId];
    if (input.usage.freeImagesToday + 1 > daily) {
      return denial(
        429,
        "free_model_daily_cap",
        `${PLANS[input.planId].name} allows ${daily} free image generations per day. Today's limit is reached.`,
      );
    }
  }

  if (!exempt && input.modality === "image" && !freeImage) {
    if (input.usage.imagesThisMonth + 1 > caps.maxImages) {
      return denial(
        429,
        "monthly_image_cap",
        `${PLANS[input.planId].name} allows ${caps.maxImages} paid images this month.`,
      );
    }
  }

  if (!exempt && input.modality === "video" && input.providerCostCents > 0) {
    if (input.usage.videosThisMonth + 1 > caps.maxVideos) {
      return denial(
        429,
        "monthly_video_cap",
        `${PLANS[input.planId].name} allows ${caps.maxVideos} videos this month.`,
      );
    }
  }

  if (!exempt && input.providerCostCents > 0) {
    const next = input.usage.providerSpendCentsThisMonth + input.providerCostCents;
    if (next > caps.maxProviderSpendCents) {
      return denial(
        402,
        "provider_spend_cap",
        `${PLANS[input.planId].name} provider spend cap is ${caps.maxProviderSpendCents} cents this month. This request would reach ${next} cents.`,
      );
    }
  }

  return null;
}

export function planLimitResponse(denial: PlanLimitDenial): NextResponse {
  return NextResponse.json(
    { error: denial.error, code: denial.code, reason: denial.reason },
    { status: denial.status },
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

async function loadMonthRows(
  admin: AdminClient,
  userId: string,
  monthStartIso: string,
): Promise<{ rows: GenerationUsageRow[] } | { error: string }> {
  const { data, error, count } = await admin
    .from("generation_jobs")
    .select(
      "modality, provider, model, status, refund_status, actual_provider_cost_cents, created_at, request_id, metadata",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .gte("created_at", monthStartIso)
    .limit(1000);
  if (error) return { error: error.message };
  const rows = (data ?? []) as GenerationUsageRow[];
  if (typeof count === "number" && count > rows.length) {
    return { error: "monthly usage exceeded the read window" };
  }
  return { rows };
}

export async function assertGenerationWithinPlanCaps(input: {
  clerkId: string;
  requestId?: string;
  modality: GenerationModality;
  provider: string;
  model: string;
  providerCostCents: number;
  billingExempt?: boolean;
  now?: Date;
}): Promise<PlanLimitDenial | null> {
  const unavailable = denial(
    402,
    "usage_unavailable",
    "Plan usage could not be read. Nothing was generated.",
  );
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable;

  const plan = await resolvePlan(admin, input.clerkId);
  if ("error" in plan) return unavailable;

  const now = input.now ?? new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  let usage = emptyMediaUsage();
  if (plan.internalUserId) {
    const loaded = await loadMonthRows(admin, plan.internalUserId, monthStart);
    if ("error" in loaded) return unavailable;
    usage = summarizeMediaUsage(loaded.rows, now, input.requestId);
  }

  return evaluateMediaCap({
    planId: plan.planId,
    modality: input.modality,
    provider: input.provider,
    model: input.model,
    providerCostCents: input.providerCostCents,
    usage,
    billingExempt: input.billingExempt,
  });
}
