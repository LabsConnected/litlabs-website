/**
 * #684 — Studio LiTTBits billing policy.
 *
 * Approved rules (LiTree B, 2026-10-22):
 *  1. Cancelled builds charge only verifiably completed billable work; the
 *     unused part of the reservation is released.
 *  2. Approval waits keep the reservation, bounded by a defined TTL; an
 *     unresolved wait expires automatically (reserve_bits expires_at — held
 *     bits stop counting against the balance once expires_at passes).
 *  3. Plain Studio chat is FREE, behind an abuse guard.
 *  4. A minimum of 1 LiTTBit applies only to successful billable operations.
 *  5. Pricing: 100 LiTTBits = $1 (see LLM_LANE_BITS_PER_USD).
 *
 * Reservation mechanics reuse PR #714's agent-billing (row-shape unwrap,
 * bare-run-id settle key, explicit TTL) — nothing here re-implements RPC
 * handling.
 */

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
 * value (Creator 7,500 / Pro 18,000 bits). With LLM pricing moved to
 * 100 bits/$ a Creator allowance covers ~37 max-cost builds. Flagged for
 * product/economics review — not changed here.
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

export const FREE_CHAT_PER_MINUTE = 20;
export const FREE_CHAT_PER_DAY = 500;

const chatWindows = new Map<string, number[]>();

/**
 * Per-user sliding-window guard for free (unbilled) Studio chat. In-process:
 * on multi-instance deploys each instance enforces its own window (the
 * route-level withRateLimit store-backed limit still applies globally).
 */
export function checkFreeChatGuard(userKey: string, now: number = Date.now()): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const dayMs = 24 * 60 * 60 * 1000;
  const hits = (chatWindows.get(userKey) ?? []).filter((t) => now - t < dayMs);
  const lastMinute = hits.filter((t) => now - t < 60_000);
  if (lastMinute.length >= FREE_CHAT_PER_MINUTE) {
    chatWindows.set(userKey, hits);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (now - lastMinute[0])) / 1000)) };
  }
  if (hits.length >= FREE_CHAT_PER_DAY) {
    chatWindows.set(userKey, hits);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((dayMs - (now - hits[0])) / 1000)) };
  }
  hits.push(now);
  chatWindows.set(userKey, hits);
  return { ok: true };
}

export function _resetFreeChatGuard(): void {
  chatWindows.clear();
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
