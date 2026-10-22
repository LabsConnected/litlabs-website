/**
 * #684 — Studio LiTTBits billing policy.
 *
 * Rules (LiTree B, 2026-10-22). The 100 LiTTBits = $1 rate in rule 5 is
 * UNAPPROVED pending owner economics review:
 *  1. Cancelled builds charge only verifiably completed billable work; the
 *     unused part of the reservation is released.
 *  2. Approval waits keep the reservation, bounded by a defined TTL; an
 *     unresolved wait expires automatically (reserve_bits expires_at — held
 *     bits stop counting against the balance once expires_at passes).
 *  3. Plain Studio chat is FREE, behind an abuse guard.
 *  4. A minimum of 1 LiTTBit applies only to successful billable operations.
 *  5. Pricing candidate: 100 LiTTBits = $1 (see LLM_LANE_BITS_PER_USD).
 *     UNAPPROVED — pending owner economics review. Not a customer-price change.
 *
 * Reservation mechanics reuse PR #714's agent-billing (row-shape unwrap,
 * bare-run-id settle key, explicit TTL) — nothing here re-implements RPC
 * handling.
 */

import {
  consumeFreeChat,
  type FreeChatLimitStore,
  FREE_CHAT_PER_DAY,
  FREE_CHAT_PER_MINUTE,
} from "@/lib/billing/free-chat-limit";

export { FREE_CHAT_PER_MINUTE, FREE_CHAT_PER_DAY };

/** Agent-loop hard runtime cap (agent-loop-v2 DEFAULT_LOOP_CONFIG.maxRuntimeMs). */
export const STUDIO_LOOP_MAX_RUNTIME_SECONDS = 30 * 60;

/**
 * Reservation TTL for a Studio build: initial loop segment + one approval
 * wait + resumed loop segment. A wait that outlives this releases
 * automatically via the reservation's expires_at.
 */
/** Mirrors paused-run-store APPROVAL_TTL_MS (30 min); a test pins the two together. */
export const STUDIO_APPROVAL_TTL_SECONDS = 30 * 60;

export const STUDIO_BUILD_RESERVATION_TTL_SECONDS =
  STUDIO_LOOP_MAX_RUNTIME_SECONDS * 2 + STUDIO_APPROVAL_TTL_SECONDS;

/**
 * Hold placed before a builtin Studio build runs. At 100 bits/$ this caps
 * one build (including approval resume) at $2.00 of LiTTBits. Settle is
 * capped at the hold; overflow is logged for reconciliation, never charged
 * beyond what was reserved.
 *
 * ECONOMICS REVIEW (#684 rule 5): plan allowances are left at ~5x face
 * value (Creator 7,500 / Pro 18,000 bits). With the UNAPPROVED 100 bits/$
 * candidate, a Creator allowance covers 37 max-cost (200-bit) builds.
 * Allowances are not changed here. The 100/$ rate is not approved.
 */
export const STUDIO_BUILD_RESERVE_BITS = 200;

/** Synthetic agent identity for builtin LiTT Studio builds (no marketplace instance). */
export const STUDIO_BUILTIN_AGENT_REF = "studio-builtin:litt";

export type StudioRunOutcome = "completed" | "cancelled" | "failed" | "awaiting_approval";

/**
 * Bits to settle for a Studio build outcome.
 * - completed: accrued bits, floor 1 (rule 4), capped at the hold.
 * - cancelled / failed: only verifiably completed billable work (accrued
 *   bits from successful steps), no 1-bit floor; 0 → full release.
 * - awaiting_approval: nothing settles yet (rule 2: keep the hold).
 */
export function studioSettleBits(
  outcome: StudioRunOutcome,
  accruedBits: number,
  reservedBits: number,
): number {
  if (outcome === "awaiting_approval") return 0;
  const accrued = Number.isFinite(accruedBits) ? Math.max(0, Math.round(accruedBits)) : 0;
  const floored = outcome === "completed" ? Math.max(1, accrued) : accrued;
  if (reservedBits > 0) return Math.min(floored, reservedBits);
  return floored;
}

/** Map a Studio outcome to the agent-billing settle status. */
export function studioSettleStatus(outcome: Exclude<StudioRunOutcome, "awaiting_approval">, bits: number): "completed" | "cancelled" | "failed" {
  // Partial completed work on cancel/fail is settled (charged) as
  // "completed" for exactly the accrued bits; settle_bits releases the
  // remainder. With no completed work it is a pure release.
  if (outcome === "completed") return "completed";
  return bits > 0 ? "completed" : outcome;
}

// ─── Free-chat abuse guard (rule 3) ─────────────────────────────────
// Shared atomic limiter on rate_limit_store (consume_free_chat_limit).
// Fails closed when the store is missing or errors. The per-process map
// is gone: two instances must not each grant their own 20/minute.

async function sharedFreeChatStore(): Promise<FreeChatLimitStore> {
  const { getSupabaseAdmin } = await import("@/lib/supabase");
  const db = getSupabaseAdmin();
  return {
    async consume(userKey: string, nowMs: number) {
      if (!db || typeof db.rpc !== "function") throw new Error("free-chat store unavailable");
      const { data, error } = await db.rpc("consume_free_chat_limit", {
        p_user_key: userKey,
        p_per_minute: FREE_CHAT_PER_MINUTE,
        p_per_day: FREE_CHAT_PER_DAY,
        p_now: new Date(nowMs).toISOString(),
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; retry_after_seconds?: number } | null;
      if (!row?.allowed) {
        return { ok: false, retryAfterSeconds: Math.max(1, Number(row?.retry_after_seconds) || 60) };
      }
      return { ok: true, retryAfterSeconds: 0 };
    },
  };
}

/**
 * Free (unbilled) Studio chat. `store` is the shared limiter. Omit it to
 * use consume_free_chat_limit. Denial is fail-closed.
 */
export async function checkFreeChatGuard(
  userKey: string,
  now: number = Date.now(),
  store?: FreeChatLimitStore | null,
): Promise<{ ok: true; retryAfterSeconds: number } | { ok: false; retryAfterSeconds: number }> {
  const limiter = store === undefined ? await sharedFreeChatStore() : store;
  const decision = await consumeFreeChat(limiter, userKey, now);
  return decision.ok
    ? { ok: true, retryAfterSeconds: 0 }
    : { ok: false, retryAfterSeconds: decision.retryAfterSeconds };
}

/** Test hook kept so older suites can call it. The shared store is not process-local. */
export function _resetFreeChatGuard(): void {
  /* no process-local window */
}

// ─── Approval-wait persistence (rule 2) ─────────────────────────────
//
// The reservation stays open across an approval wait. The run's billing
// state (bits accrued before the pause, reservation id, hold size) is
// stored on the agent_runs row's `output` so the approvals route can
// settle or release the SAME reservation when the user decides. If the
// user never decides, the reservation expires on its own (expires_at,
// STUDIO_BUILD_RESERVATION_TTL_SECONDS) and the held bits are released.

export interface StudioAwaitingBilling {
  runId: string;
  reservationId: string | null;
  reservedCredits: number;
  accruedBits: number;
  billableSteps: number;
  pausedRunId: string;
}

type SupabaseLike = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

type RpcResult = { data: unknown; error: { message: string } | null };
type RpcFn = (fn: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;

function rpcOf(db: SupabaseLike): RpcFn | null {
  const candidate = (db as { rpc?: unknown }).rpc;
  return typeof candidate === "function" ? (candidate as RpcFn) : null;
}

export async function recordStudioAwaitingApproval(
  db: SupabaseLike | null | undefined,
  state: StudioAwaitingBilling,
): Promise<boolean> {
  if (!db) return false;
  const { error } = await db
    .from("agent_runs")
    .update({
      output: {
        studio_billing: {
          phase: "awaiting_approval",
          paused_run_id: state.pausedRunId,
          reservation_id: state.reservationId,
          reserved_credits: state.reservedCredits,
          accrued_bits: state.accruedBits,
          billable_steps: state.billableSteps,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", state.runId);
  return !error;
}

export async function loadStudioAwaitingApproval(
  db: SupabaseLike | null | undefined,
  pausedRunId: string,
): Promise<StudioAwaitingBilling | null> {
  if (!db) return null;
  const { data, error } = await db
    .from("agent_runs")
    .select("id, output")
    .eq("output->studio_billing->>paused_run_id", pausedRunId)
    .maybeSingle();
  if (error || !data) return null;
  const sb = (data.output as { studio_billing?: Record<string, unknown> } | null)?.studio_billing;
  if (!sb || sb.phase !== "awaiting_approval") return null;
  return {
    runId: String(data.id),
    pausedRunId,
    reservationId: typeof sb.reservation_id === "string" ? sb.reservation_id : null,
    reservedCredits: Number(sb.reserved_credits) || 0,
    accruedBits: Number(sb.accrued_bits) || 0,
    billableSteps: Number(sb.billable_steps) || 0,
  };
}

function studioBillingOutput(state: StudioAwaitingBilling, phase: string) {
  return {
    studio_billing: {
      phase,
      paused_run_id: state.pausedRunId,
      reservation_id: state.reservationId,
      reserved_credits: state.reservedCredits,
      accrued_bits: state.accruedBits,
      billable_steps: state.billableSteps,
    },
  };
}

async function compareAndSetStudioPhase(
  db: SupabaseLike,
  state: StudioAwaitingBilling,
  fromPhase: string,
  toPhase: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("agent_runs")
    .update(studioBillingOutput(state, toPhase))
    .eq("id", state.runId)
    .eq("output->studio_billing->>phase", fromPhase)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

/**
 * Settle completed pre-pause work exactly once when an approval wait is
 * abandoned or a late decision loses the race. The phase compare-and-set
 * is the claim. settle_bits / release_bits are the debit (status guard:
 * a reservation already settled or released is not charged again).
 *
 * Does not pass p_allow_past_expiry. That flag exists only on the unrun
 * sweep migration. If the reservation has already expired, the phase is
 * put back to awaiting_approval so the sweep can settle it after the
 * migration is applied.
 */
export async function settleAbandonedStudioHold(
  db: SupabaseLike | null | undefined,
  pausedRunId: string,
): Promise<{ action: "settled" | "released" | "lost" | "unavailable"; bits: number }> {
  const rpc = db ? rpcOf(db) : null;
  if (!db || !rpc) return { action: "unavailable", bits: 0 };
  const hold = await loadStudioAwaitingApproval(db, pausedRunId);
  if (!hold) return { action: "lost", bits: 0 };
  const claimed = await compareAndSetStudioPhase(db, hold, "awaiting_approval", "settlement_claimed");
  if (!claimed) return { action: "lost", bits: 0 };

  const bits = studioSettleBits("cancelled", hold.accruedBits, hold.reservedCredits);
  try {
    if (!hold.reservationId || bits <= 0) {
      if (hold.reservationId) {
        const { error } = await rpc("release_bits", {
          p_reservation_id: hold.reservationId,
          p_idempotency_key: `${hold.runId}:abandon-release`,
        });
        if (error) throw error;
      }
      await compareAndSetStudioPhase(db, hold, "settlement_claimed", "expired_released");
      return { action: "released", bits: 0 };
    }

    const { data, error } = await rpc("settle_bits", {
      p_reservation_id: hold.reservationId,
      p_actual_amount: bits,
      p_idempotency_key: hold.runId,
      p_overage_policy: "reject",
      p_description: `Abandoned Studio approval: settle completed work ${hold.runId}`,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as {
      success?: boolean;
      reason?: string;
      settled_amount?: number;
    } | null;
    if (!row?.success && row?.reason === "reservation_expired") {
      await compareAndSetStudioPhase(db, hold, "settlement_claimed", "awaiting_approval");
      return { action: "unavailable", bits: 0 };
    }
    if (!row?.success && row?.reason !== "already_settled") {
      await compareAndSetStudioPhase(db, hold, "settlement_claimed", "awaiting_approval");
      return { action: "unavailable", bits: 0 };
    }
    await compareAndSetStudioPhase(db, hold, "settlement_claimed", "expired_settled");
    const charged = row?.reason === "already_settled" ? 0 : (row?.settled_amount ?? bits);
    return { action: "settled", bits: charged };
  } catch {
    await compareAndSetStudioPhase(db, hold, "settlement_claimed", "awaiting_approval");
    return { action: "unavailable", bits: 0 };
  }
}

/**
 * Settle (or carry forward) a Studio build reservation after an approval
 * decision / resumed segment. `totalAccruedBits` is pre-pause + resumed.
 * - completed: charge accrued (min 1, capped at hold), release the rest.
 * - cancelled / failed / rejected: charge only accrued completed work.
 * - awaiting_approval (nested gate): keep the hold, re-key to the new gate.
 */
export async function finalizeStudioBuildBilling(
  deps: {
    db: SupabaseLike | null | undefined;
    settleRun: (
      runId: string,
      result: { inputTokens: number; outputTokens: number; actualCredits: number; status: "completed" | "failed" | "cancelled"; error?: string },
      reserved: number,
      reservationId: string | null,
    ) => Promise<unknown>;
  },
  state: StudioAwaitingBilling,
  outcome: StudioRunOutcome,
  totalAccruedBits: number,
  totalBillableSteps: number,
  nestedPausedRunId?: string | null,
): Promise<{ action: "carried" | "settled"; bits: number }> {
  if (outcome === "awaiting_approval" && nestedPausedRunId) {
    await recordStudioAwaitingApproval(deps.db, {
      ...state,
      pausedRunId: nestedPausedRunId,
      accruedBits: totalAccruedBits,
      billableSteps: totalBillableSteps,
    });
    return { action: "carried", bits: 0 };
  }
  const terminal: Exclude<StudioRunOutcome, "awaiting_approval"> =
    outcome === "awaiting_approval" ? "failed" : outcome;
  const bits = studioSettleBits(terminal, totalAccruedBits, state.reservedCredits);
  await deps.settleRun(
    state.runId,
    { inputTokens: 0, outputTokens: 0, actualCredits: bits, status: studioSettleStatus(terminal, bits) },
    state.reservedCredits,
    state.reservationId ?? null,
  );
  return { action: "settled", bits };
}
