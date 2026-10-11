// Hard spend / runaway guards — server-only.
//
// These guards are INDEPENDENT of the monthly LiTTBits plan allowances.
// They exist to catch runaway usage (a stuck loop, a retry storm, a
// misbehaving failover chain) BEFORE it burns through a user's monthly
// allowance — and to bound the owner's own spend even though the owner is
// billing-exempt.
//
// ── Pricing-model note ────────────────────────────────────────────────
// The $1/1K-bit conversion behind LiTTBits is a PRICING MODEL, not
// validated fact (label `modeled` everywhere). The ceilings below are
// denominated in actual PROVIDER COST (USD micros), not bits, because
// provider cost is what LiTT actually pays. Reference point: a Pro
// Builder Beta plan (18,000 LiTTBits/mo) is worth ~$18 of modeled
// provider value — the $50/day guard trips first on a runaway,
// regardless of plan.
//
// ── Design ───────────────────────────────────────────────────────────
// - checkRunawayGuards() is a pre-call check: it looks at ALREADY
//   RECORDED provider cost (usage_events + cost_events, the canonical
//   metering tables) and blocks the next call when a ceiling is hit.
// - estimatedCostMicros (optional) adds the upcoming call's expected
//   cost to the running totals, so a single expensive call can be
//   blocked before it lands.
// - Fail-OPEN on DB errors: guards must never take down the product.
//   A failed guard query logs loudly (a metering gap) and allows the
//   call.
// - BYOK usage bypasses every guard: the user pays their provider
//   directly, so LiTT has nothing to protect.

import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveMeteringUserUuid } from "@/lib/metering";
import { isOwnerClerkId } from "@/lib/owner-identity";

// ─── Constants ────────────────────────────────────────────────────────
// All ceilings are in USD micros (1_000_000 micros = $1).
// Independent of plan allowances: a Pro user's 18,000-bit monthly
// allowance (≈ $18 MODELED — not validated fact) does not raise these
// ceilings; the daily/hourly guards trip first on runaway.

/** Micros per USD. */
export const USD_MICROS_PER_DOLLAR = 1_000_000;

/** Per-run ceiling: a single original_request_id (failover/retry chain)
 *  may not exceed $5.00 provider cost. Blocks further attempts. */
export const RUN_SPEND_CEILING_MICROS = 5 * USD_MICROS_PER_DOLLAR;

/** Per-user ceiling: $20 provider cost in any rolling 60 minutes. */
export const USER_HOURLY_CEILING_MICROS = 20 * USD_MICROS_PER_DOLLAR;

/** Per-user ceiling: $50 provider cost in any rolling 24 hours.
 *  Trips first on runaway even for Pro users (their ~$18 modeled monthly
 *  allowance is worth less than this ceiling). */
export const USER_DAILY_CEILING_MICROS = 50 * USD_MICROS_PER_DOLLAR;

// ─── Owner ceilings ───────────────────────────────────────────────────
// The owner is billing-exempt (wallet never debited) but is NOT
// unguarded. Higher ceilings — still bounded, no infinite spend.

/** Owner per-run ceiling: $20. */
export const OWNER_RUN_CEILING_MICROS = 20 * USD_MICROS_PER_DOLLAR;

/** Owner per-user hourly ceiling: $50. */
export const OWNER_HOURLY_CEILING_MICROS = 50 * USD_MICROS_PER_DOLLAR;

/** Owner per-user daily ceiling: $200. */
export const OWNER_DAILY_CEILING_MICROS = 200 * USD_MICROS_PER_DOLLAR;

// ─── Types ────────────────────────────────────────────────────────────

export interface GuardCheckInput {
  /** Internal users.id uuid. Preferred for usage_events.user_id. */
  userId?: string;
  /** Clerk id — resolved to the internal uuid when userId is absent. */
  clerkId?: string;
  /** Feature label (e.g. "studio-chat") — used in log lines and details. */
  feature: string;
  /**
   * Expected provider cost of the upcoming call, in USD micros.
   * Added to the running totals so one expensive call can be blocked
   * before it lands. Omit when unknown.
   */
  estimatedCostMicros?: number;
  /**
   * The failover/retry chain this call belongs to
   * (usage_events.original_request_id). Required for the per-run
   * ceiling; when omitted that check is skipped.
   */
  originalRequestId?: string;
  /** BYOK usage bypasses all guards — the user pays their provider directly. */
  isByok?: boolean;
}

/** Which ceiling tripped. */
export type GuardReason = "per-run-ceiling" | "hourly-ceiling" | "daily-ceiling";

export type GuardResult =
  | { allowed: true }
  | { allowed: false; reason: GuardReason; detail?: string };

// ─── Error ────────────────────────────────────────────────────────────

/**
 * Thrown by withSpendGuard() when a runaway guard blocks the call.
 * Callers should translate this to a 429 with a clear message
 * (the guard is a rate/spend limit, not a crash).
 */
export class SpendGuardError extends Error {
  readonly result: Extract<GuardResult, { allowed: false }>;

  constructor(result: Extract<GuardResult, { allowed: false }>) {
    super(
      `Spend guard blocked the call (${result.reason})${result.detail ? `: ${result.detail}` : ""}`,
    );
    this.name = "SpendGuardError";
    this.result = result;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

const formatUsd = (micros: number): string =>
  `$${(micros / USD_MICROS_PER_DOLLAR).toFixed(2)}`;

/**
 * Sum provider_cost_micros for a set of usage_event_ids.
 * Returns 0 on any failure (fail-open; the caller logs).
 */
async function sumCostEventsForUsageIds(usageEventIds: string[]): Promise<{
  totalMicros: number;
  ok: boolean;
}> {
  if (usageEventIds.length === 0) return { totalMicros: 0, ok: true };
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return { totalMicros: 0, ok: true };
    const { data, error } = await admin
      .from("cost_events")
      .select("provider_cost_micros")
      .in("usage_event_id", usageEventIds);
    if (error) {
      console.error("[spend-guards] cost_events sum query failed:", error.message);
      return { totalMicros: 0, ok: false };
    }
    const totalMicros = (data ?? []).reduce(
      (sum: number, row: { provider_cost_micros?: number }) =>
        sum + (row.provider_cost_micros ?? 0),
      0,
    );
    return { totalMicros, ok: true };
  } catch (err) {
    console.error(
      "[spend-guards] cost_events sum threw:",
      err instanceof Error ? err.message : err,
    );
    return { totalMicros: 0, ok: false };
  }
}

/**
 * Sum provider cost (micros) for every attempt in a failover/retry chain,
 * identified by usage_events.original_request_id.
 */
async function sumRunSpendMicros(
  originalRequestId: string,
): Promise<{ totalMicros: number; ok: boolean }> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return { totalMicros: 0, ok: true };
    const { data, error } = await admin
      .from("usage_events")
      .select("usage_event_id")
      .eq("original_request_id", originalRequestId);
    if (error) {
      console.error("[spend-guards] run spend query failed:", error.message);
      return { totalMicros: 0, ok: false };
    }
    const ids = (data ?? []).map(
      (row: { usage_event_id: string }) => row.usage_event_id,
    );
    return sumCostEventsForUsageIds(ids);
  } catch (err) {
    console.error(
      "[spend-guards] run spend query threw:",
      err instanceof Error ? err.message : err,
    );
    return { totalMicros: 0, ok: false };
  }
}

/**
 * Sum provider cost (micros) for a user's usage_events created since
 * `sinceIso`.
 */
async function sumUserSpendSinceMicros(
  userId: string,
  sinceIso: string,
): Promise<{ totalMicros: number; ok: boolean }> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return { totalMicros: 0, ok: true };
    const { data, error } = await admin
      .from("usage_events")
      .select("usage_event_id")
      .eq("user_id", userId)
      .gte("created_at", sinceIso);
    if (error) {
      console.error("[spend-guards] user spend query failed:", error.message);
      return { totalMicros: 0, ok: false };
    }
    const ids = (data ?? []).map(
      (row: { usage_event_id: string }) => row.usage_event_id,
    );
    return sumCostEventsForUsageIds(ids);
  } catch (err) {
    console.error(
      "[spend-guards] user spend query threw:",
      err instanceof Error ? err.message : err,
    );
    return { totalMicros: 0, ok: false };
  }
}

// ─── The check ────────────────────────────────────────────────────────

/**
 * Enforce the hard spend/runaway guards before a provider-costing call.
 *
 * Order: per-run ceiling → per-user hourly → per-user daily.
 * BYOK usage is always allowed. Any DB failure fails OPEN (allowed) and
 * is logged, because a guard outage must never take down the product.
 */
export async function checkRunawayGuards(
  input: GuardCheckInput,
): Promise<GuardResult> {
  // BYOK: the user pays their provider directly — LiTT has no spend to guard.
  if (input.isByok) return { allowed: true };

  const estimatedMicros = input.estimatedCostMicros ?? 0;
  const owner = isOwnerClerkId(input.clerkId);

  const runCeiling = owner ? OWNER_RUN_CEILING_MICROS : RUN_SPEND_CEILING_MICROS;
  const hourlyCeiling = owner
    ? OWNER_HOURLY_CEILING_MICROS
    : USER_HOURLY_CEILING_MICROS;
  const dailyCeiling = owner
    ? OWNER_DAILY_CEILING_MICROS
    : USER_DAILY_CEILING_MICROS;

  // 1. Per-run ceiling (needs the failover chain id).
  if (input.originalRequestId) {
    const run = await sumRunSpendMicros(input.originalRequestId);
    if (run.ok) {
      const projected = run.totalMicros + estimatedMicros;
      if (projected > runCeiling) {
        return {
          allowed: false,
          reason: "per-run-ceiling",
          detail: `request ${input.originalRequestId} (${input.feature}) already spent ${formatUsd(run.totalMicros)} of the ${formatUsd(runCeiling)} per-run provider-cost ceiling`,
        };
      }
    } else {
      // Fail-open: the metering gap is logged inside sumRunSpendMicros.
    }
  }

  // 2+3. Per-user hourly / daily ceilings (need a resolvable user).
  const userId = input.userId ?? (input.clerkId ? await resolveMeteringUserUuid(input.clerkId) : null);
  if (!userId) {
    // No user to attribute spend to — the per-run check above still
    // applied. Fail-open with a log line.
    console.warn(
      `[spend-guards] no resolvable user for feature=${input.feature}; user ceilings skipped (fail-open)`,
    );
    return { allowed: true };
  }

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const hourly = await sumUserSpendSinceMicros(userId, hourAgo);
  if (hourly.ok) {
    const projected = hourly.totalMicros + estimatedMicros;
    if (projected > hourlyCeiling) {
      return {
        allowed: false,
        reason: "hourly-ceiling",
        detail: `user spent ${formatUsd(hourly.totalMicros)} provider cost in the last 60 minutes; ceiling is ${formatUsd(hourlyCeiling)}`,
      };
    }
  }

  const daily = await sumUserSpendSinceMicros(userId, dayAgo);
  if (daily.ok) {
    const projected = daily.totalMicros + estimatedMicros;
    if (projected > dailyCeiling) {
      return {
        allowed: false,
        reason: "daily-ceiling",
        detail: `user spent ${formatUsd(daily.totalMicros)} provider cost in the last 24 hours; ceiling is ${formatUsd(dailyCeiling)}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Wrap an async fn with the runaway guards: check before running, and
 * throw a named SpendGuardError when blocked so callers can return 429
 * with a clear message.
 *
 * Usage:
 *   const result = await withSpendGuard({ userId, clerkId, feature: "image-gen" }, () =>
 *     generateImage(prompt),
 *   );
 *   // on block: catch (err) { if (err instanceof SpendGuardError) return NextResponse.json({ error: err.message }, { status: 429 }); }
 */
export async function withSpendGuard<T>(
  input: GuardCheckInput,
  fn: () => Promise<T>,
): Promise<T> {
  const verdict = await checkRunawayGuards(input);
  if (!verdict.allowed) {
    throw new SpendGuardError(verdict);
  }
  return fn();
}
