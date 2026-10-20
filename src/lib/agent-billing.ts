/**
 * Agent billing — canonical reserve → execute → settle/release flow.
 *
 * B2 migration: replaces the broken reserve_credits/refund_credits RPCs
 * (which never existed in production) with the canonical:
 *
 *   reserve_bits  → hold BITS against available balance
 *   execute       → caller runs the model/agent
 *   settle_bits   → debit actual cost, release remainder
 *   release_bits  → cancel reservation (execution failed)
 *
 * The RPCs are BITS-denominated and exchange-rate-agnostic.
 * The conversion from provider cost to BITS happens in the
 * application layer (agent-registry cost policies), before calling
 * reserve_bits.
 *
 * A charge failure NEVER silently returns a successful output.
 * The caller MUST check the return value of reserveCredits() and abort
 * if it returns { ok: false, status: 402 }.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { isBillingExempt, type SimulatedPlan } from "@/lib/owner";
import { emitUsageEvent } from "@/lib/metering";
import { calculateLlmCost } from "@/lib/llm-cost-engine";
import {
  DEFAULT_AGENT_MODE,
  isValidAgentMode,
  type AgentMode,
} from "@/lib/litt-intelligence/agent-identity";

export interface AgentRunContext {
  clerkId: string;
  agentInstanceId: string;
  agentId: string | null;
  agentVersionId: string | null;
  conversationId?: string;
  messageId?: string;
  idempotencyKey: string;
  model?: string;
  provider?: string;
  /**
   * The run's LiTT mode, when the caller carries one. Validated by
   * resolveAgentRunMode before the agent_runs insert: absent →
   * 'standard'; an explicitly invalid value fails the run closed
   * rather than being silently rewritten. Never the model id — the
   * model lives in `model` (and lands in input.model on the row).
   */
  agentMode?: string;
  /** Optional owner simulation override for billing-exempt checks. */
  simulation?: SimulatedPlan | null;
}

export interface ReserveResult {
  ok: boolean;
  runId: string | null;
  /** The reservation ID from reserve_bits RPC. */
  reservationId: string | null;
  /** HTTP status code for the error (402 = insufficient, 500 = DB error). */
  status?: number;
  error?: string;
  /** The number of BITS reserved. */
  reservedCredits: number;
}

export interface SettleResult {
  ok: boolean;
  runId: string;
  reservationId: string | null;
  creditsCharged: number;
  creditsRefunded: number;
}

/**
 * One row from reserve_bits / settle_bits / release_bits.
 * Those RPCs are RETURNS TABLE, so PostgREST sends an array. A bare
 * object is accepted for older callers. `success` is only set when the
 * payload actually carried a boolean.
 */
interface BitsRpcRow {
  success: boolean;
  reason: string | null;
  reservationId: string | null;
  settledAmount: number | null;
  releasedAmount: number | null;
}

type BitsRpcParse =
  | { ok: true; row: BitsRpcRow }
  | { ok: false; reservationId: string | null };

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reservationIdOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Normalize a PostgREST payload for a RETURNS TABLE bits RPC.
 *
 * An array uses row 0. A single object is accepted unchanged. An empty
 * array, null, a non-object, or a row with no boolean `success` fails
 * closed: the caller must not assume a charge or a release. A
 * reservation id found on a rejected payload is kept so a hold the
 * caller will not use can still be released.
 */
function unwrapBitsRpcRow(data: unknown): BitsRpcParse {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, reservationId: null };
  }
  const record = candidate as Record<string, unknown>;
  const reservationId = reservationIdOf(record.reservation_id);
  if (typeof record.success !== "boolean") {
    return { ok: false, reservationId };
  }
  return {
    ok: true,
    row: {
      success: record.success,
      reason: typeof record.reason === "string" ? record.reason : null,
      reservationId,
      settledAmount: finiteNumber(record.settled_amount),
      releasedAmount: finiteNumber(record.released_amount),
    },
  };
}

/**
 * Reservation lifetime passed to reserve_bits as p_expires_seconds.
 *
 * Must exceed the longest reachable billable segment: the agent loop's
 * hard runtime cap is 30 minutes (maxRuntimeMs = 1_800_000 in
 * agent-loop-v2), so 3,600s gives 2x headroom over that cap. With the
 * reserve_bits default of 600s, any segment running longer than
 * 10 minutes outlived its reservation and settle_bits rejected the
 * settlement as reservation_expired — the completed work was delivered
 * with zero debit. Do not lower this below the loop cap without also
 * lowering the cap.
 */
export const RESERVATION_TTL_SECONDS = 3600;

/**
 * Thrown when a caller supplies an agent mode outside the set the
 * agent_runs.agent_mode check constraint allows ('standard' |
 * 'builder' | 'research' | 'spark' — migration
 * 20260805000000_litt_agent_identity.sql). An explicitly invalid mode
 * is a routing defect: it must fail loudly, never be silently
 * rewritten to 'standard', which would conceal the defect.
 */
export class InvalidAgentModeError extends Error {
  readonly agentMode: unknown;
  constructor(agentMode: unknown) {
    super(
      `Invalid agent mode ${JSON.stringify(agentMode) ?? String(agentMode)}: ` +
        "agent_runs.agent_mode must be one of 'standard', 'builder', 'research', 'spark'",
    );
    this.name = "InvalidAgentModeError";
    this.agentMode = agentMode;
  }
}

/**
 * Resolve the agent_mode written to the agent_runs row.
 *
 * The column carries the run's MODE — never the model id (the model
 * id is stored in input.model). A mode that is absent (undefined or
 * null — no current caller supplies one) resolves to the column
 * default 'standard'. An explicitly present but unrecognized value
 * throws InvalidAgentModeError so the run fails closed before any
 * insert instead of being silently converted.
 */
export function resolveAgentRunMode(candidate: unknown): AgentMode {
  if (candidate === undefined || candidate === null) {
    return DEFAULT_AGENT_MODE;
  }
  if (isValidAgentMode(candidate)) {
    return candidate;
  }
  throw new InvalidAgentModeError(candidate);
}

/**
 * Reserve BITS BEFORE the model call.
 *
 * Flow:
 *   1. Resolve internal user ID from Clerk ID.
 *   2. Call reserve_bits RPC to atomically hold BITS against available balance.
 *   3. Create an agent_runs row with status='running' and the reservation ID.
 *   4. Return the reservation ID for later settlement/release.
 *
 * If the run-row insert fails after reservation, release the reservation.
 * The caller MUST check the return value and abort if ok=false.
 */
export async function reserveCredits(
  ctx: AgentRunContext,
  estimatedCredits: number,
): Promise<ReserveResult> {
  if (!supabaseAdmin) {
    return { ok: false, runId: null, reservationId: null, status: 503, error: "DB unavailable", reservedCredits: 0 };
  }

  // Owner billing exemption: skip reservation entirely.
  // Usage is still recorded by chargeLlmUsage (which also checks exemption).
  if (isBillingExempt(ctx.clerkId, ctx.simulation)) {
    // Resolve the run mode before any write: an explicitly invalid
    // mode fails closed here. No reservation exists on this path, so
    // there is no hold to release.
    let exemptAgentMode: AgentMode;
    try {
      exemptAgentMode = resolveAgentRunMode(ctx.agentMode);
    } catch (err) {
      return {
        ok: false,
        runId: null,
        reservationId: null,
        status: 422,
        error: err instanceof Error ? err.message : "Invalid agent mode",
        reservedCredits: 0,
      };
    }
    // Still create the agent_runs row for audit, but no reservation.
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("clerk_id", ctx.clerkId)
      .maybeSingle();
    if (!user) {
      return { ok: false, runId: null, reservationId: null, status: 404, error: "User not found", reservedCredits: 0 };
    }
    const { data: runRow } = await supabaseAdmin
      .from("agent_runs")
      .insert({
        user_id: user.id,
        agent_name: ctx.agentInstanceId,
        task: ctx.idempotencyKey,
        status: "running",
        agent_mode: exemptAgentMode,
        input: {
          agent_id: ctx.agentId,
          agent_version_id: ctx.agentVersionId,
          conversation_id: ctx.conversationId ?? null,
          message_id: ctx.messageId ?? null,
          model: ctx.model ?? null,
          provider: ctx.provider ?? null,
          idempotency_key: ctx.idempotencyKey,
          reservation_id: null,
          estimated_credits: 0,
          billing_exempt: true,
        },
      })
      .select("id")
      .single();
    if (!runRow) {
      return { ok: false, runId: null, reservationId: null, status: 500, error: "Failed to create run row", reservedCredits: 0 };
    }
    return { ok: true, runId: runRow.id, reservationId: null, reservedCredits: 0 };
  }

  // Resolve internal user ID
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", ctx.clerkId)
    .maybeSingle();

  if (!user) {
    return { ok: false, runId: null, reservationId: null, status: 404, error: "User not found", reservedCredits: 0 };
  }

  // Reserve BITS via the canonical RPC
  let reservationId: string | null = null;
  if (estimatedCredits > 0) {
    const { data: reserveData, error: reserveError } = await supabaseAdmin.rpc("reserve_bits", {
      p_user_id: user.id,
      p_amount: estimatedCredits,
      p_idempotency_key: ctx.idempotencyKey,
      p_run_id: ctx.idempotencyKey,
      p_usage_type: "agent_run",
      p_reference_type: "agent_instance",
      p_reference_id: ctx.agentInstanceId,
      p_description: `Agent run: ${ctx.agentInstanceId}`,
      p_expires_seconds: RESERVATION_TTL_SECONDS,
    });

    if (reserveError) {
      console.error(`[agent-billing] reserve_bits FAILED — aborting run. Error: ${reserveError.message}`);
      return {
        ok: false,
        runId: null,
        reservationId: null,
        status: 503,
        error: `Credit reservation failed: ${reserveError.message}`,
        reservedCredits: 0,
      };
    }

    const parsed = unwrapBitsRpcRow(reserveData);
    if (parsed.ok && parsed.row.success && parsed.row.reservationId) {
      reservationId = parsed.row.reservationId;
    } else if (
      parsed.ok &&
      parsed.row.reason === "already_reserved" &&
      parsed.row.reservationId
    ) {
      // Idempotent retry — the original reservation already exists.
      reservationId = parsed.row.reservationId;
    } else {
      // Fail closed. If the rejected payload still names a hold, release
      // it so a reservation we will not use cannot stay stuck.
      const leakedId = parsed.ok ? parsed.row.reservationId : parsed.reservationId;
      if (leakedId) {
        await confirmRelease(
          leakedId,
          ctx.idempotencyKey + ":release-on-reserve-fail",
          estimatedCredits,
          "release_after_reserve_failure",
          ctx,
        );
      }
      // A malformed payload (empty array, null, non-object, or a row
      // with no boolean success) is a shape failure, not a DB verdict —
      // name it explicitly instead of the misleading "unknown".
      const reason = parsed.ok ? (parsed.row.reason ?? "unknown") : "invalid_reserve_response";
      if (reason === "insufficient_balance") {
        return {
          ok: false,
          runId: null,
          reservationId: null,
          status: 402,
          error: "Insufficient LiTTBits balance",
          reservedCredits: 0,
        };
      }
      return {
        ok: false,
        runId: null,
        reservationId: null,
        status: 503,
        error: `Credit reservation failed: ${reason}`,
        reservedCredits: 0,
      };
    }
  }

  // Resolve the run mode before inserting the run row. An explicitly
  // invalid mode fails closed: release the hold just taken so it
  // cannot leak, and never write the row.
  let agentMode: AgentMode;
  try {
    agentMode = resolveAgentRunMode(ctx.agentMode);
  } catch (err) {
    if (reservationId && estimatedCredits > 0) {
      await confirmRelease(
        reservationId,
        ctx.idempotencyKey + ":release-on-invalid-mode",
        estimatedCredits,
        "release_after_invalid_mode",
        ctx,
      );
    }
    return {
      ok: false,
      runId: null,
      reservationId: null,
      status: 422,
      error: err instanceof Error ? err.message : "Invalid agent mode",
      reservedCredits: 0,
    };
  }

  // Create the agent_runs row (using production schema columns)
  const { data: runRow, error: runError } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      user_id: user.id,
      agent_name: ctx.agentInstanceId,
      task: ctx.idempotencyKey,
      status: "running",
      agent_mode: agentMode,
      input: {
        agent_id: ctx.agentId,
        agent_version_id: ctx.agentVersionId,
        conversation_id: ctx.conversationId ?? null,
        message_id: ctx.messageId ?? null,
        model: ctx.model ?? null,
        provider: ctx.provider ?? null,
        idempotency_key: ctx.idempotencyKey,
        reservation_id: reservationId,
        estimated_credits: estimatedCredits,
      },
    })
    .select("id")
    .single();

  if (runError) {
    // Run-row insert failed — release the reservation if it was made.
    if (reservationId && estimatedCredits > 0) {
      await confirmRelease(
        reservationId,
        ctx.idempotencyKey + ":release-on-insert-fail",
        estimatedCredits,
        "release_after_insert_failure",
        ctx,
      );
    }
    return { ok: false, runId: null, reservationId: null, status: 500, error: runError.message, reservedCredits: 0 };
  }

  return { ok: true, runId: runRow.id, reservationId, reservedCredits: estimatedCredits };
}

/**
 * Settle a run after the model call completes.
 *
 * Flow:
 *   1. If status='completed': call settle_bits with actual cost.
 *      - If actual < reserved: settle_bits releases the difference automatically.
 *      - If actual > reserved: settle_bits with overage_policy='reject' (default).
 *   2. If status='failed' or 'cancelled': call release_bits to return all reserved BITS.
 *   3. Update the agent_runs row with final status and output.
 *
 * The reservationId from reserveCredits() MUST be passed through.
 */
export async function settleRun(
  runId: string,
  result: {
    inputTokens: number;
    outputTokens: number;
    actualCredits: number;
    status: "completed" | "failed" | "cancelled";
    error?: string;
  },
  reservedCredits: number,
  reservationId: string | null,
): Promise<SettleResult> {
  if (!supabaseAdmin) {
    return { ok: false, runId, reservationId, creditsCharged: 0, creditsRefunded: 0 };
  }

  let creditsCharged = 0;
  let creditsRefunded = 0;
  // A bits RPC that does not positively succeed must not be recorded as
  // a charge or a release. The run row is still updated below.
  let billingAccepted = true;
  const billingCtx: AgentRunContext = {
    clerkId: "",
    agentInstanceId: "",
    agentId: null,
    agentVersionId: null,
    idempotencyKey: runId,
  };

  if (result.status === "completed" && reservationId && result.actualCredits > 0) {
    // Settle: debit actual cost, release remainder. The amount is capped
    // at the reservation HERE, at the ledger boundary — not only by
    // caller convention — so no caller (present or future) can settle
    // above the quote the user approved. settle_bits would reject an
    // overage (→ a completed run debiting zero, the D4 defect class);
    // capping makes the debit land at the approved maximum instead.
    const settleAmount =
      reservedCredits > 0 ? Math.min(result.actualCredits, reservedCredits) : result.actualCredits;
    const { data: settleData, error: settleError } = await supabaseAdmin.rpc("settle_bits", {
      p_reservation_id: reservationId,
      p_actual_amount: settleAmount,
      p_idempotency_key: runId + ":settle",
      p_overage_policy: "reject",
      p_description: `Agent run settled: ${runId}`,
    });

    const parsed = unwrapBitsRpcRow(settleData);
    // success:false, an empty/null/malformed payload, a transport error,
    // or a success row with no settled_amount are all "not charged".
    if (settleError || !parsed.ok || !parsed.row.success || parsed.row.settledAmount == null) {
      billingAccepted = false;
      const message = settleError
        ? settleError.message
        : !parsed.ok
          ? "invalid_settlement_response"
          : !parsed.row.success
            ? (parsed.row.reason ?? "unknown")
            : "settled_amount_missing";
      console.error(`[agent-billing] settle_bits did not confirm a debit for run ${runId}: ${message}`);
      await createReconciliationRecord(
        billingCtx,
        result.actualCredits,
        settleError ? "settle_failed" : "settle_rejected",
        message,
        reservationId,
      );
    } else {
      creditsCharged = parsed.row.settledAmount;
      creditsRefunded = parsed.row.releasedAmount ?? 0;
    }
  } else if (result.status !== "completed" && reservationId && reservedCredits > 0) {
    // Release: execution failed, return all reserved BITS. Only a
    // confirmed success row counts as released.
    const released = await confirmRelease(
      reservationId,
      runId + ":release",
      reservedCredits,
      "release_failed",
      billingCtx,
    );
    if (released) {
      creditsRefunded = reservedCredits;
    } else {
      billingAccepted = false;
    }
  } else if (result.status === "completed" && result.actualCredits === 0) {
    // Free run — nothing to settle, but release the reservation if one was made
    if (reservationId && reservedCredits > 0) {
      const released = await confirmRelease(
        reservationId,
        runId + ":release-free",
        reservedCredits,
        "release_failed",
        billingCtx,
      );
      if (released) {
        creditsRefunded = reservedCredits;
      } else {
        billingAccepted = false;
      }
    }
  }

  // Update the agent_runs row (using production schema columns)
  const { error: updateError } = await supabaseAdmin
    .from("agent_runs")
    .update({
      status: result.status,
      output: {
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        credits_charged: creditsCharged,
        credits_refunded: creditsRefunded,
        reservation_id: reservationId,
        error: result.error ?? null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (updateError) {
    console.error(`[agent-billing] CRITICAL: agent_runs update failed for run ${runId}. Error: ${updateError.message}`);
    await createReconciliationRecord(
      { clerkId: "", agentInstanceId: "", agentId: null, agentVersionId: null, idempotencyKey: runId },
      creditsCharged,
      "settlement_update_failed",
      updateError.message,
      reservationId,
    );
    return { ok: false, runId, reservationId, creditsCharged, creditsRefunded: 0 };
  }

  // Canonical metering (P0): token-level provider-cost evidence for the
  // settle. Best-effort — never breaks settlement.
  await emitSettleMetering(runId, result, creditsCharged).catch(() => {});

  if (!billingAccepted) {
    return { ok: false, runId, reservationId, creditsCharged, creditsRefunded };
  }
  return { ok: true, runId, reservationId, creditsCharged, creditsRefunded };
}

// ─── Canonical metering (P0) ─────────────────────────────────────
//
// settleRun debits the ledger via settle_bits with only credit totals.
// This adds the token-level evidence: one usage_events + one cost_events
// row carrying the actual provider/model/tokens.
//
// P0 invariant (Larry): per logical action (here: one agent run) exactly
// ONE billable usage_event. The agent loop already emits billable attempt
// events per step (linked by run_id) — when one exists, the settle must
// NOT create a duplicate: the ledger debit is linked to the existing
// event instead (the existingUsageEventKey pattern from
// recordChargeEvidence). Only when no billable attempt event exists
// (metering skipped, or the run never went through the metered loop) is a
// new event emitted — billable=true ONLY on the successful attempt;
// failed/cancelled runs are recorded billable=false with cost kept.
async function emitSettleMetering(
  runId: string,
  result: {
    inputTokens: number;
    outputTokens: number;
    actualCredits: number;
    status: "completed" | "failed" | "cancelled";
    error?: string;
  },
  creditsCharged: number,
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    const settleKey = `${runId}:settle`;

    // 1. Read the run row: user identity + provider/model. Per the audit,
    //    model/provider live in the reservation-time input JSON; token
    //    totals land in output at settle time.
    const { data: runRow } = await supabaseAdmin
      .from("agent_runs")
      .select("user_id, input")
      .eq("id", runId)
      .maybeSingle();
    const userId = (runRow?.user_id as string | undefined) ?? null;
    const runInput = (runRow?.input ?? {}) as Record<string, unknown>;
    const provider =
      typeof runInput.provider === "string" && runInput.provider ? runInput.provider : "unknown";
    const model =
      typeof runInput.model === "string" && runInput.model ? runInput.model : "unknown";
    if (!userId) return;

    // 2. Already-emitted billable attempt event? Link the ledger debit to
    //    it — never create a second billable event for the same action.
    const { data: existing } = await supabaseAdmin
      .from("usage_events")
      .select("usage_event_id")
      .eq("run_id", runId)
      .eq("billable", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.usage_event_id) {
      await supabaseAdmin
        .from("credit_ledger")
        .update({ usage_event_id: existing.usage_event_id as string })
        .eq("idempotency_key", settleKey);
      return;
    }

    // 3. No billable attempt event — emit the token-level event.
    //    ledgerIdempotencyKey stamps credit_ledger.usage_event_id on the
    //    settle's debit row so charges join to their cost evidence.
    const inputTokens = Math.max(0, Math.floor(result.inputTokens));
    const outputTokens = Math.max(0, Math.floor(result.outputTokens));
    const { providerCostMicros } = calculateLlmCost({
      provider,
      model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      isByok: false,
    });
    const idempotencyKey = `metering:agent-run:${runId}`;
    await emitUsageEvent({
      userId,
      runId,
      capability: "llm",
      feature: "studio-chat",
      provider,
      model,
      inputTokens,
      outputTokens,
      providerCostMicros,
      chargedBits: Math.max(0, Math.floor(creditsCharged)),
      status: result.status === "completed" ? "success" : "failed",
      // billable=true only on the successful attempt.
      billable: result.status === "completed",
      error: result.error,
      idempotencyKey,
      // The logical action IS this run — one event per run keeps
      // per-original_request_id billable counts at <= 1.
      originalRequestId: idempotencyKey,
      ledgerIdempotencyKey: settleKey,
    });
  } catch {
    // Best-effort: metering must never break settlement.
  }
}

/**
 * Estimate the credit cost for a run based on token counts and the
 * agent's cost policy.
 */
export function estimateCredits(
  inputTokens: number,
  outputTokens: number,
  per1kTokens: number,
  perRun: number,
): number {
  const tokenCost = Math.ceil((inputTokens + outputTokens) / 1000) * per1kTokens;
  return perRun + tokenCost;
}

/**
 * The binding quote for resuming a paused (approval-gated) run.
 *
 * SINGLE source of truth, used by both sides of the approval boundary:
 * the messages route computes it from the frozen pausedMessages when the
 * approval card is rendered and discloses it in the approval reason; the
 * approvals route computes it from the same stored pausedMessages when
 * the user approves and reserves exactly that amount. The inputs are
 * frozen server-side at pause time and the formula is deterministic, so
 * the figure the user approved IS the figure reserved — it can never be
 * recomputed into a larger number after the click. (JSON key order can
 * change across a DB round-trip, but reordering does not change the
 * serialized length the estimate is derived from.)
 */
export function computeResumeQuoteBits(
  pausedMessages: readonly unknown[] | null | undefined,
): number {
  return estimateCredits(
    Math.ceil(JSON.stringify(pausedMessages ?? []).length / 4) + 2048,
    0,
    1,
    1,
  );
}

/**
 * The disclosure appended to an approval reason at pause time so the
 * card states the resume cost BEFORE the user approves — the same
 * contract the initial-run estimate disclosure already follows.
 */
export function resumeQuoteDisclosure(
  pausedMessages: readonly unknown[] | null | undefined,
): string {
  return (
    ` Estimated resume cost: ${computeResumeQuoteBits(pausedMessages)} LiTTBits ` +
    `(reserved when you approve and debited on success only — never more than this amount; ` +
    `failed or cancelled work debits zero).`
  );
}

// ── Legacy compatibility ──────────────────────────────────────────
// These functions are kept for backward compatibility with code that
// hasn't been migrated to the reserve → settle flow yet.

export async function startAgentRun(
  ctx: AgentRunContext,
): Promise<{ runId: string | null; error?: string }> {
  const result = await reserveCredits(ctx, 0);
  return { runId: result.runId, error: result.error };
}

export async function completeAgentRun(
  runId: string,
  result: {
    inputTokens: number;
    outputTokens: number;
    creditsCharged: number;
    status: "completed" | "failed" | "cancelled";
    error?: string;
  },
  reservationId?: string | null,
): Promise<{ runId: string; ok: boolean; creditsCharged: number }> {
  const settleResult = await settleRun(
    runId,
    {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      actualCredits: result.creditsCharged,
      status: result.status,
      error: result.error,
    },
    result.creditsCharged,
    reservationId ?? null,
  );

  return { runId, ok: settleResult.ok, creditsCharged: settleResult.creditsCharged };
}

/**
 * Call release_bits and accept it only when the unwrapped row says
 * success. Transport errors, empty/null/malformed payloads, and
 * success:false are not a release — no amount is assumed returned.
 */
async function confirmRelease(
  reservationId: string,
  idempotencyKey: string,
  credits: number,
  reconcileReason: string,
  ctx: AgentRunContext,
): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin.rpc("release_bits", {
    p_reservation_id: reservationId,
    p_idempotency_key: idempotencyKey,
  });
  const parsed = unwrapBitsRpcRow(data);
  if (!error && parsed.ok && parsed.row.success) {
    return true;
  }
  const message = error?.message
    ?? (!parsed.ok ? "invalid_release_response" : (parsed.row.reason ?? "unknown"));
  console.error(
    `[agent-billing] CRITICAL: release_bits did not confirm a release for ${reservationId} ` +
    `(${credits} BITS, key ${idempotencyKey}). Error: ${message}`,
  );
  await createReconciliationRecord(ctx, credits, reconcileReason, message, reservationId);
  return false;
}

/**
 * Create a reconciliation record when settlement or release fails.
 * This ensures failed financial operations are tracked and can be retried.
 */
async function createReconciliationRecord(
  ctx: AgentRunContext,
  credits: number,
  reason: string,
  errorMessage: string,
  reservationId?: string | null,
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from("billing_reconciliations").insert({
      idempotency_key: ctx.idempotencyKey,
      agent_instance_id: ctx.agentInstanceId,
      credits_expected: credits,
      reason,
      error_message: errorMessage,
      status: "pending",
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[agent-billing] FATAL: Could not create reconciliation record: ${err}`);
  }
}
