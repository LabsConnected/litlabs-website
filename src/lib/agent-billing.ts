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
        status: "running",
        agent_mode: ctx.model ?? "default",
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

    if (!reserveData?.success) {
      const reason = reserveData?.reason ?? "unknown";
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
      if (reason === "already_reserved") {
        reservationId = reserveData.reservation_id;
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
      reservationId = reserveData.reservation_id;
    }
  }

  // Create the agent_runs row (using production schema columns)
  const { data: runRow, error: runError } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      user_id: user.id,
      agent_name: ctx.agentInstanceId,
      task: ctx.idempotencyKey,
      status: "running",
      agent_mode: ctx.model ?? "default",
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
    // Run-row insert failed — release the reservation if it was made
    if (reservationId && estimatedCredits > 0) {
      const { error: releaseErr } = await supabaseAdmin.rpc("release_bits", {
        p_reservation_id: reservationId,
        p_idempotency_key: ctx.idempotencyKey + ":release-on-insert-fail",
      });
      if (releaseErr) {
        console.error(
          `[agent-billing] CRITICAL: run insert failed AND release failed. ` +
          `User ${ctx.clerkId} may have ${estimatedCredits} BITS stuck in reservation ${reservationId}. ` +
          `Error: ${releaseErr.message}`,
        );
        await createReconciliationRecord(ctx, estimatedCredits, "release_after_insert_failure", releaseErr.message, reservationId);
      }
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

  if (result.status === "completed" && reservationId && result.actualCredits > 0) {
    // Settle: debit actual cost, release remainder
    const { data: settleData, error: settleError } = await supabaseAdmin.rpc("settle_bits", {
      p_reservation_id: reservationId,
      p_actual_amount: result.actualCredits,
      p_idempotency_key: runId + ":settle",
      p_overage_policy: "reject",
      p_description: `Agent run settled: ${runId}`,
    });

    if (settleError) {
      console.error(`[agent-billing] CRITICAL: settle_bits failed for run ${runId}. Error: ${settleError.message}`);
      await createReconciliationRecord(
        { clerkId: "", agentInstanceId: "", agentId: null, agentVersionId: null, idempotencyKey: runId },
        result.actualCredits,
        "settle_failed",
        settleError.message,
        reservationId,
      );
    } else if (settleData?.success) {
      creditsCharged = settleData.settled_amount;
      creditsRefunded = settleData.released_amount;
    } else {
      console.error(`[agent-billing] settle_bits returned failure for run ${runId}: ${settleData?.reason}`);
      await createReconciliationRecord(
        { clerkId: "", agentInstanceId: "", agentId: null, agentVersionId: null, idempotencyKey: runId },
        result.actualCredits,
        "settle_rejected",
        settleData?.reason ?? "unknown",
        reservationId,
      );
    }
  } else if (result.status !== "completed" && reservationId && reservedCredits > 0) {
    // Release: execution failed, return all reserved BITS
    const { error: releaseError } = await supabaseAdmin.rpc("release_bits", {
      p_reservation_id: reservationId,
      p_idempotency_key: runId + ":release",
    });

    if (releaseError) {
      console.error(`[agent-billing] CRITICAL: release_bits failed for run ${runId}. Error: ${releaseError.message}`);
      await createReconciliationRecord(
        { clerkId: "", agentInstanceId: "", agentId: null, agentVersionId: null, idempotencyKey: runId },
        reservedCredits,
        "release_failed",
        releaseError.message,
        reservationId,
      );
    } else {
      creditsRefunded = reservedCredits;
    }
  } else if (result.status === "completed" && result.actualCredits === 0) {
    // Free run — nothing to settle, but release the reservation if one was made
    if (reservationId && reservedCredits > 0) {
      const { error: releaseError } = await supabaseAdmin.rpc("release_bits", {
        p_reservation_id: reservationId,
        p_idempotency_key: runId + ":release-free",
      });
      if (releaseError) {
        console.error(`[agent-billing] release_bits failed for free run ${runId}. Error: ${releaseError.message}`);
      } else {
        creditsRefunded = reservedCredits;
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

  return { ok: true, runId, reservationId, creditsCharged, creditsRefunded };
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
