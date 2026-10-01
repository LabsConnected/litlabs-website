/**
 * Service Cost Tracking
 *
 * For provider-spend paths that have no billable user (service-to-service
 * API calls, anonymous demo, etc.), we still need cost visibility.
 * This helper routes service/anonymous spend through the canonical
 * metering emitter so cost_events are created for every provider attempt.
 *
 * Design:
 * - Uses a designated system user ID (SERVICE_METERING_USER_ID env var)
 *   for FK compliance. This should be the owner's user ID or a dedicated
 *   system user. The cost is marked billable=false and liitt_absorbed=true
 *   (LiTT absorbs the cost — the "user" is never charged).
 * - The `feature` field carries the service identifier (e.g.,
 *   "agent-chat-service", "demo-chat-service") for reporting.
 * - Routes through canonical `emitLlmMetering` — no duplicated logic.
 *
 * If SERVICE_METERING_USER_ID is not set, emission is skipped with a
 * warning (fail-open for tracking, never fail-closed for the request).
 */

import { emitLlmMetering } from "@/lib/metering";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the system user ID for service cost tracking.
 * Returns null if not configured (caller should skip emission).
 */
export function getServiceMeteringUserId(): string | null {
  const id = process.env.SERVICE_METERING_USER_ID?.trim();
  if (id && UUID_RE.test(id)) return id;
  return null;
}

export interface ServiceCostEventInput {
  /** Service identifier, e.g. "agent-chat-service". Goes in `feature`. */
  feature: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Idempotency key — one event per provider attempt. */
  idempotencyKey: string;
  status?: "success" | "failed";
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

/**
 * Emit a cost-tracking event for service/anonymous provider spend.
 * Never bills anyone — purely for cost visibility (liitt_absorbed=true).
 * Best-effort: never throws.
 */
export async function emitServiceCostEvent(
  input: ServiceCostEventInput,
): Promise<{ usageEventId: string | null; skipped?: string }> {
  const systemUserId = getServiceMeteringUserId();
  if (!systemUserId) {
    console.warn(
      `[service-metering] SERVICE_METERING_USER_ID not set — skipping cost event for feature=${input.feature}`,
    );
    return { usageEventId: null, skipped: "no-service-user-configured" };
  }

  try {
    return await emitLlmMetering({
      userId: systemUserId,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      status: input.status ?? "success",
      // Never billable — LiTT absorbs service/anonymous spend.
      billable: false,
      chargedBits: 0,
      idempotencyKey: input.idempotencyKey,
      error: input.error,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    });
  } catch (err) {
    console.error(
      `[service-metering] emit failed for feature=${input.feature}:`,
      err instanceof Error ? err.message : err,
    );
    return { usageEventId: null, skipped: "exception" };
  }
}
