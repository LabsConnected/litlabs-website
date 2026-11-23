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

import { supabaseAdmin, getSupabaseAdmin } from "@/lib/supabase";
import {
  DEFAULT_AGENT_MODE,
  isValidAgentMode,
  type AgentMode,
} from "@/lib/litt-intelligence/agent-identity";
import { isBillingExempt, type SimulatedPlan } from "@/lib/owner";
import { emitUsageEvent } from "@/lib/metering";
import { calculateLlmCost } from "@/lib/llm-cost-engine";

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
   * The run's agent_mode, written to the agent_runs row. Must be one of
   * the DB check-constraint values ('standard' | 'builder' | 'research' |
   * 'spark') — never a model name. Defaults to DEFAULT_AGENT_MODE.
   * (ACC-01 F7: the inserts previously wrote `ctx.model ?? "default"`,
   * which always violated agent_runs_agent_mode_check once built-in
   * Studio runs started reserving for real.)
   */
  agentMode?: AgentMode;
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
  /** The ledger outcome, independent of whether the run metadata update succeeded. */
  billingStatus: "confirmed" | "failed" | "pending_reconciliation";
  runId: string;
  reservationId: string | null;
  creditsCharged: number;
  creditsRefunded: number;
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
 * PostgREST returns RETURNS TABLE RPC results as an array of rows, not a
 * single object. reserve_bits/settle_bits/release_bits all return tables,
 * so `.rpc()` `data` is `Row[]`. Reading `.success`/`.reservation_id`
 * directly off the array yields undefined — which this module previously
 * treated as "unknown reason" failures, aborting every paid run with 503
 * or mis-reporting every settle as rejected. Row 0 is the row; anything
 * else is treated as absent so callers fail closed rather than assume a
 * debit or release happened.
 */
function unwrapRpcRow<T extends Record<string, unknown>>(data: unknown): T | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  return candidate as T;
}

type BillingStatus = SettleResult["billingStatus"];

type ReservationRow = {
  id: string;
  status: string;
  reserved_amount: number;
  settled_amount: number;
  idempotency_key?: string;
};

/** A lost RPC response is not proof of failure: the transaction may have committed. */
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function confirmedAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function readReservation(reservationId: string): Promise<{ row: ReservationRow | null; uncertain: boolean }> {
  try {
    const { data, error } = await supabaseAdmin!
      .from("credit_reservations")
      .select("id,status,reserved_amount,settled_amount,idempotency_key")
      .eq("id", reservationId)
      .maybeSingle();
    return { row: error ? null : data as ReservationRow | null, uncertain: Boolean(error) };
  } catch {
    return { row: null, uncertain: true };
  }
}

/** The old SQL RPC returns success for any already-settled reservation, even with a different key. */
async function verifyPriorSettlement(runId: string, reservationId: string, actualCredits: number, reservedCredits: number): Promise<BillingStatus> {
  const reservation = await readReservation(reservationId);
  if (reservation.uncertain || !reservation.row) return "pending_reconciliation";
  if (reservation.row.status !== "settled" || reservation.row.settled_amount !== actualCredits || reservation.row.reserved_amount !== reservedCredits) return "failed";
  try {
    // Settlement debits are bucket-allocated: one ledger row per bucket with
    // keys '<runId>:settle:<bucket>' / '<runId>:overage:<bucket>' (legacy rows
    // used '<runId>:settle' / '<runId>:overage'). Verify the full set of debit
    // rows for this reservation sums to the settled amount and every key
    // belongs to this run.
    const { data, error } = await supabaseAdmin!
      .from("credit_ledger")
      .select("idempotency_key,reference_id,direction,amount")
      .eq("reference_id", reservationId)
      .eq("direction", "debit");
    if (error || !data || data.length === 0) return "pending_reconciliation";
    const rows = data as Array<{ idempotency_key: string; reference_id: string; direction: string; amount: number }>;
    const keyOk = (key: string) =>
      key === `${runId}:settle` || key.startsWith(`${runId}:settle:`) ||
      key === `${runId}:overage` || key.startsWith(`${runId}:overage:`);
    const totalDebited = rows.reduce((sum, row) => sum + row.amount, 0);
    const allMatch = rows.every(
      (row) => row.reference_id === reservationId && row.direction === "debit" && keyOk(row.idempotency_key),
    );
    return allMatch && totalDebited === actualCredits ? "confirmed" : "failed";
  } catch {
    return "pending_reconciliation";
  }
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
        idempotency_key: ctx.idempotencyKey,
        status: "running",
        agent_mode: ctx.agentMode ?? DEFAULT_AGENT_MODE,
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
  let reservationWasExisting = false;
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

    const reserveRow = unwrapRpcRow<{
      success?: boolean;
      reason?: string;
      reservation_id?: string;
    }>(reserveData);

    if (!reserveRow?.success) {
      const reason = reserveRow?.reason ?? "unknown";
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
      // Idempotent retry — reservation already exists
      if (reason === "already_reserved" && reserveRow?.reservation_id) {
        reservationId = reserveRow.reservation_id;
        reservationWasExisting = true;
        // Fall through to create/find the run row
      } else {
        return {
          ok: false,
          runId: null,
          reservationId: null,
          status: 503,
          error: `Credit reservation failed: ${reason}`,
          reservedCredits: 0,
        };
      }
    } else {
      reservationId = reserveRow.reservation_id ?? null;
      reservationWasExisting = reserveRow.reason === "already_reserved";
    }
    if (reservationWasExisting && reservationId) {
      const prior = await readReservation(reservationId);
      if (prior.uncertain || !prior.row) {
        await createReconciliationRecord(ctx, estimatedCredits, "reservation_retry_unverified", "Existing reservation could not be read", reservationId);
        return { ok: false, runId: null, reservationId, status: 503, error: "Existing reservation could not be verified", reservedCredits: 0 };
      }
      if (prior.row.status !== "reserved" || prior.row.reserved_amount !== estimatedCredits || prior.row.idempotency_key !== ctx.idempotencyKey) {
        return { ok: false, runId: null, reservationId, status: 409, error: "Existing reservation does not match this request", reservedCredits: 0 };
      }
    }
  }

  // Create the agent_runs row (using production schema columns)
  const { data: runRow, error: runError } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      user_id: user.id,
      agent_name: ctx.agentInstanceId,
      task: ctx.idempotencyKey,
      idempotency_key: ctx.idempotencyKey,
      status: "running",
      agent_mode: ctx.agentMode ?? DEFAULT_AGENT_MODE,
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
    if (runError.code === "23505" && reservationWasExisting) {
      return { ok: false, runId: null, reservationId, status: 409, error: "Agent run already exists for this request", reservedCredits: 0 };
    }
    // Run-row insert failed — release the reservation if it was made
    if (reservationId && estimatedCredits > 0 && !reservationWasExisting) {
      let releaseProblem: string | null = null;
      try {
        const { data, error } = await supabaseAdmin.rpc("release_bits", {
          p_reservation_id: reservationId,
          p_idempotency_key: ctx.idempotencyKey + ":release-on-insert-fail",
        });
        const row = unwrapRpcRow<{ success?: boolean; reason?: string; released_amount?: number }>(data);
        if (error) releaseProblem = error.message;
        else if (row?.success !== true) releaseProblem = row?.reason ?? "missing_release_result";
        else if (row.reason === "already_released") {
          const prior = await readReservation(reservationId);
          if (prior.uncertain || prior.row?.status !== "released" || prior.row.reserved_amount !== estimatedCredits) {
            releaseProblem = "prior_release_unverified";
          }
        } else if (row.reason !== "released" || row.released_amount !== estimatedCredits) {
          releaseProblem = "release_inconsistent_result";
        }
      } catch (error) {
        releaseProblem = failureMessage(error);
      }
      if (releaseProblem) {
        console.error(`[agent-billing] CRITICAL: run insert failed and reservation release is unconfirmed for ${reservationId}: ${releaseProblem}`);
        await createReconciliationRecord(ctx, estimatedCredits, "release_after_insert_failure", releaseProblem, reservationId);
      }
    } else if (reservationWasExisting) {
      await createReconciliationRecord(ctx, estimatedCredits, "run_insert_existing_reservation", runError.message, reservationId);
    }
    return { ok: false, runId: null, reservationId: null, status: runError.code === "23505" ? 409 : 500, error: runError.message, reservedCredits: 0 };
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
    return { ok: false, billingStatus: "pending_reconciliation", runId, reservationId, creditsCharged: 0, creditsRefunded: 0 };
  }

  let creditsCharged = 0;
  let creditsRefunded = 0;
  let billingStatus: BillingStatus = "confirmed";
  let billingReason = "";
  let billingDetail = "";

  if (!confirmedAmount(result.actualCredits) || !confirmedAmount(reservedCredits)) {
    billingStatus = "failed";
    billingReason = "invalid_billing_amount";
  } else if (!reservationId && reservedCredits > 0) {
    billingStatus = "failed";
    billingReason = "missing_reservation";
  } else if (result.status === "completed" && result.actualCredits > 0 && reservationId) {
    // The RPC commits the debit and reservation transition in one transaction.
    // A success row is confirmation; a transport failure has an unknown outcome.
    try {
      const { data, error } = await supabaseAdmin.rpc("settle_bits", {
        p_reservation_id: reservationId,
        p_actual_amount: result.actualCredits,
        p_idempotency_key: runId,
        p_overage_policy: "reject",
        p_description: `Agent run settled: ${runId}`,
      });
      if (error) {
        billingStatus = "pending_reconciliation";
        billingReason = "settle_rpc_error";
        billingDetail = error.message;
      } else {
        const row = unwrapRpcRow<{ success?: boolean; reason?: string; settled_amount?: number; released_amount?: number }>(data);
        if (row?.success === false) {
          billingStatus = "failed";
          billingReason = "settle_rejected";
          billingDetail = row.reason ?? "unknown";
        } else if (row?.success !== true) {
          billingStatus = "pending_reconciliation";
          billingReason = "settle_missing_result";
        } else if (row.reason === "already_settled") {
          billingStatus = await verifyPriorSettlement(runId, reservationId, result.actualCredits, reservedCredits);
          if (billingStatus === "confirmed") {
            creditsCharged = result.actualCredits;
            creditsRefunded = reservedCredits - result.actualCredits;
          } else {
            billingReason = "prior_settlement_unverified";
            billingDetail = "Existing settlement does not match this run or could not be read";
          }
        } else if (row.reason === "settled" && confirmedAmount(row.settled_amount) && confirmedAmount(row.released_amount)
          && row.settled_amount === result.actualCredits && row.settled_amount + row.released_amount === reservedCredits) {
          creditsCharged = row.settled_amount;
          creditsRefunded = row.released_amount;
        } else {
          billingStatus = "pending_reconciliation";
          billingReason = "settle_inconsistent_result";
          billingDetail = row.reason ?? "unknown";
        }
      }
    } catch (error) {
      billingStatus = "pending_reconciliation";
      billingReason = "settle_rpc_exception";
      billingDetail = failureMessage(error);
    }
  } else if (reservationId) {
    // Failed/cancelled and zero-cost runs release the hold. A repeated release
    // changes no balance, but the reservation row can confirm the original amount.
    try {
      const { data, error } = await supabaseAdmin.rpc("release_bits", {
        p_reservation_id: reservationId,
        p_idempotency_key: `${runId}:${result.status === "completed" ? "release-free" : "release"}`,
      });
      if (error) {
        billingStatus = "pending_reconciliation";
        billingReason = "release_rpc_error";
        billingDetail = error.message;
      } else {
        const row = unwrapRpcRow<{ success?: boolean; reason?: string; released_amount?: number }>(data);
        if (row?.success === false) {
          billingStatus = "failed";
          billingReason = "release_rejected";
          billingDetail = row.reason ?? "unknown";
        } else if (row?.success !== true) {
          billingStatus = "pending_reconciliation";
          billingReason = "release_missing_result";
        } else if (row.reason === "already_released") {
          const prior = await readReservation(reservationId);
          if (prior.uncertain || !prior.row) {
            billingStatus = "pending_reconciliation";
            billingReason = "prior_release_unverified";
          } else if (prior.row.status !== "released" || prior.row.reserved_amount !== reservedCredits) {
            billingStatus = "failed";
            billingReason = "prior_release_mismatch";
          } else {
            const { data: runRow, error: runError } = await supabaseAdmin.from("agent_runs").select("input").eq("id", runId).maybeSingle();
            if (runError) {
              billingStatus = "pending_reconciliation";
              billingReason = "prior_release_owner_unverified";
              billingDetail = runError.message;
            } else {
              const input = runRow?.input as { reservation_id?: unknown; idempotency_key?: unknown } | null;
              if (input?.reservation_id !== reservationId || !prior.row.idempotency_key || input.idempotency_key !== prior.row.idempotency_key) {
                billingStatus = "failed";
                billingReason = "prior_release_owner_mismatch";
              } else {
                creditsRefunded = prior.row.reserved_amount;
              }
            }
          }
        } else if (row.reason === "released" && confirmedAmount(row.released_amount) && row.released_amount === reservedCredits) {
          creditsRefunded = row.released_amount;
        } else {
          billingStatus = "pending_reconciliation";
          billingReason = "release_inconsistent_result";
          billingDetail = row.reason ?? "unknown";
        }
      }
    } catch (error) {
      billingStatus = "pending_reconciliation";
      billingReason = "release_rpc_exception";
      billingDetail = failureMessage(error);
    }
  } else if (result.status === "completed" && result.actualCredits > 0) {
    // Owner-exempt runs have no reservation. Confirm that persisted decision;
    // an unexpectedly missing reservation on a paid run is a billing failure.
    try {
      const { data, error } = await supabaseAdmin.from("agent_runs").select("input").eq("id", runId).maybeSingle();
      if (error) {
        billingStatus = "pending_reconciliation";
        billingReason = "exemption_lookup_failed";
        billingDetail = error.message;
      } else if ((data?.input as { billing_exempt?: unknown } | null)?.billing_exempt !== true) {
        billingStatus = "failed";
        billingReason = "missing_reservation";
      }
    } catch (error) {
      billingStatus = "pending_reconciliation";
      billingReason = "exemption_lookup_exception";
      billingDetail = failureMessage(error);
    }
  }

  if (billingStatus !== "confirmed") {
    console.error(`[agent-billing] ${billingReason} for run ${runId}: ${billingDetail}`);
    await createReconciliationRecord(
      { clerkId: "", agentInstanceId: "", agentId: null, agentVersionId: null, idempotencyKey: runId },
      result.status === "completed" ? result.actualCredits : reservedCredits,
      billingReason,
      billingDetail,
      reservationId,
    );
  }

  // Update the agent_runs row (using production schema columns)
  let updateError: { message: string } | null = null;
  try {
    const updated = await supabaseAdmin
      .from("agent_runs")
      .update({
        status: billingStatus === "confirmed" ? result.status : "reconciliation_required",
        output: {
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          credits_charged: creditsCharged,
          credits_refunded: creditsRefunded,
          reservation_id: reservationId,
          billing_status: billingStatus,
          billing_reason: billingReason || null,
          error: result.error ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    updateError = updated.error;
  } catch (error) {
    updateError = { message: failureMessage(error) };
  }

  if (updateError) {
    console.error(`[agent-billing] CRITICAL: agent_runs update failed for run ${runId}. Error: ${updateError.message}`);
    await createReconciliationRecord(
      { clerkId: "", agentInstanceId: "", agentId: null, agentVersionId: null, idempotencyKey: runId },
      creditsCharged,
      "settlement_update_failed",
      updateError.message,
      reservationId,
    );
    return { ok: false, billingStatus, runId, reservationId, creditsCharged, creditsRefunded };
  }

  // Canonical metering (P0): token-level provider-cost evidence for the
  // settle. Best-effort — never breaks settlement.
  if (billingStatus === "confirmed") await emitSettleMetering(runId, result, creditsCharged).catch(() => {});

  return { ok: billingStatus === "confirmed", billingStatus, runId, reservationId, creditsCharged, creditsRefunded };
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
      // Settlement debits are bucket-allocated: '<runId>:settle' plus one
      // '<runId>:settle:<bucket>' row per funded bucket. Stamp them all.
      await supabaseAdmin
        .from("credit_ledger")
        .update({ usage_event_id: existing.usage_event_id as string })
        .or(`idempotency_key.eq.${settleKey},idempotency_key.like.${settleKey}:*`);
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

// ── Approval-resume billing (ACC-01 F6) ─────────────────────────────
//
// A run that pauses for approval settles its original reservation as
// released at pause time (the messages route maps awaiting_approval to a
// non-completed settle). The approvals route then resumes the work in a
// NEW request — historically with no billing operation at all, so the
// post-approval segment (in ACC-01: the approved edit and the approved
// deploy) completed verified work and charged nothing. These helpers let
// the resume re-reserve under the SAME billing identity the original run
// used and settle at the resumed run's true terminal state.
//
// Engagement rule: resume billing engages only when the conversation
// already has an agent-billing run — proof the original turn billed.
// Conversations whose original turn never billed (pre-fix history) keep
// the legacy no-op behavior instead of inventing a charge identity.

export interface ResumeBillingHandle {
  runId: string;
  reservationId: string | null;
  reservedCredits: number;
  inputTokens: number;
}

export type ReserveResumeResult =
  | { engaged: false }
  | { engaged: true; ok: true; handle: ResumeBillingHandle }
  | { engaged: true; ok: false; status: number; error: string };

export async function reserveResumeCredits(params: {
  clerkId: string;
  conversationId: string;
  pausedRunId: string;
  /** Estimated input tokens for the resumed segment (system prompt + paused history). */
  estimatedInputTokens: number;
}): Promise<ReserveResumeResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { engaged: false };

  try {
    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("clerk_id", params.clerkId)
      .maybeSingle();
    if (!user) return { engaged: false };

    // The original run's billing identity: agent_name carries the instance
    // id (`builtin:<slug>` for built-in Studio agents, the marketplace
    // instance id otherwise); input carries agent/model/provider.
    const { data: priorRuns } = await admin
      .from("agent_runs")
      .select("agent_name, agent_mode, input")
      .eq("user_id", user.id)
      .filter("input->>conversation_id", "eq", params.conversationId)
      .order("started_at", { ascending: false })
      .limit(1);
    const prior = (priorRuns ?? [])[0] as
      | {
          agent_name?: unknown;
          agent_mode?: unknown;
          input?: Record<string, unknown> | null;
        }
      | undefined;
    if (!prior || typeof prior.agent_name !== "string" || !prior.agent_name) {
      return { engaged: false };
    }
    const priorInput = (prior.input ?? {}) as Record<string, unknown>;

    const estimatedTokens = Math.max(0, Math.floor(params.estimatedInputTokens)) + 2048;
    const estimatedCost = estimateCredits(estimatedTokens, 0, 1, 1);
    const reserveResult = await reserveCredits(
      {
        clerkId: params.clerkId,
        agentInstanceId: prior.agent_name,
        agentId: typeof priorInput.agent_id === "string" ? priorInput.agent_id : null,
        agentVersionId:
          typeof priorInput.agent_version_id === "string" ? priorInput.agent_version_id : null,
        conversationId: params.conversationId,
        idempotencyKey: `approval-resume:${params.pausedRunId}`,
        model: typeof priorInput.model === "string" ? priorInput.model : undefined,
        provider: typeof priorInput.provider === "string" ? priorInput.provider : undefined,
        // Carry the original run's mode into the resume's run row. Rows
        // written before the F7 fix can hold a model name or "default"
        // in agent_mode — anything that is not a valid mode falls back
        // to reserveCredits' standard default.
        agentMode: isValidAgentMode(prior.agent_mode) ? prior.agent_mode : undefined,
      },
      estimatedCost,
    );
    if (!reserveResult.ok) {
      return {
        engaged: true,
        ok: false,
        status: reserveResult.status ?? 402,
        error: reserveResult.error ?? "Insufficient LiTTBits balance",
      };
    }
    return {
      engaged: true,
      ok: true,
      handle: {
        runId: reserveResult.runId as string,
        reservationId: reserveResult.reservationId,
        reservedCredits: reserveResult.reservedCredits,
        inputTokens: Math.max(0, Math.floor(params.estimatedInputTokens)),
      },
    };
  } catch {
    // Billing identity lookup must never break an approval resume on its
    // own — degrade to the legacy uncharged resume rather than strand a
    // user-approved run. (A reserve FAILURE after a successful lookup is
    // NOT degraded: it returns ok:false above and the route fails the
    // resume honestly, because charging was demonstrably engaged.)
    return { engaged: false };
  }
}

/**
 * Settle a resume reservation at the resumed run's terminal state.
 * Completed work charges the same size-based estimate the messages route
 * uses; failed/cancelled segments release the hold in full. Best-effort
 * by design: settleRun records a reconciliation row on any unconfirmed
 * outcome, and a billing hiccup must not corrupt the resume's canonical
 * outcome write.
 */
export async function settleResumeCredits(
  handle: ResumeBillingHandle,
  result: {
    outputTokens: number;
    status: "completed" | "failed" | "cancelled";
    error?: string;
  },
): Promise<void> {
  const outputTokens = Math.max(0, Math.floor(result.outputTokens));
  const actualCredits =
    result.status === "completed"
      ? estimateCredits(handle.inputTokens, outputTokens, 1, 1)
      : 0;
  await settleRun(
    handle.runId,
    {
      inputTokens: handle.inputTokens,
      outputTokens,
      actualCredits,
      status: result.status,
      error: result.error,
    },
    handle.reservedCredits,
    handle.reservationId,
  ).catch(() => undefined);
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
    const { error } = await supabaseAdmin.from("billing_reconciliations").insert({
      idempotency_key: ctx.idempotencyKey,
      agent_instance_id: ctx.agentInstanceId,
      credits_expected: credits,
      reason,
      error_message: reservationId ? `reservation=${reservationId}; ${errorMessage}` : errorMessage,
      status: "pending",
      created_at: new Date().toISOString(),
    });
    if (error) console.error(`[agent-billing] FATAL: Could not create reconciliation record for ${ctx.idempotencyKey}: ${error.message}`);
  } catch (err) {
    console.error(`[agent-billing] FATAL: Could not create reconciliation record: ${err}`);
  }
}
