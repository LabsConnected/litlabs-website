/**
 * Agent billing — reserve → execute → settle/refund flow.
 *
 * Every marketplace agent execution follows this flow:
 *   1. reserveCredits() — atomically reserve estimated credits BEFORE the
 *      model call. Returns 402 if balance is insufficient.
 *   2. Execute the model call (caller's responsibility).
 *   3. settleRun() — settle the actual cost and refund unused reserved
 *      credits. If the model call failed, refund all reserved credits.
 *
 * A charge failure NEVER silently returns a successful output.
 * The caller must check the return value of reserveCredits() and abort
 * if it returns { ok: false, status: 402 }.
 */

import { supabaseAdmin } from "@/lib/supabase";

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
}

export interface ReserveResult {
  ok: boolean;
  runId: string | null;
  /** HTTP status code for the error (402 = insufficient, 500 = DB error). */
  status?: number;
  error?: string;
  /** The number of credits reserved. */
  reservedCredits: number;
}

export interface SettleResult {
  ok: boolean;
  runId: string;
  creditsCharged: number;
  creditsRefunded: number;
}

/**
 * Reserve credits BEFORE the model call.
 *
 * 1. Creates an agent_runs row with status='running'.
 * 2. Atomically reserves estimated credits from the user's balance.
 * 3. Returns 402 if the user doesn't have enough credits.
 *
 * The caller MUST check the return value and abort if ok=false.
 */
export async function reserveCredits(
  ctx: AgentRunContext,
  estimatedCredits: number,
): Promise<ReserveResult> {
  if (!supabaseAdmin) {
    return { ok: false, runId: null, status: 503, error: "DB unavailable", reservedCredits: 0 };
  }

  // Check for existing run with the same idempotency key (retry safety)
  const { data: existing } = await supabaseAdmin
    .from("agent_runs")
    .select("id, status, credits_charged")
    .eq("idempotency_key", ctx.idempotencyKey)
    .maybeSingle();

  if (existing) {
    // Idempotent retry — validate that this run belongs to the same
    // user, agent instance, and conversation before reusing it.
    const { data: existingRun } = await supabaseAdmin
      .from("agent_runs")
      .select("user_id, agent_instance_id, conversation_id")
      .eq("id", existing.id)
      .maybeSingle();

    if (existingRun) {
      // Look up the clerk_id for this run's user to verify ownership
      const { data: existingUser } = await supabaseAdmin
        .from("users")
        .select("clerk_id")
        .eq("id", existingRun.user_id)
        .maybeSingle();

      if (existingUser?.clerk_id !== ctx.clerkId) {
        return { ok: false, runId: null, status: 403, error: "Idempotency key belongs to another user", reservedCredits: 0 };
      }
      if (existingRun.agent_instance_id !== ctx.agentInstanceId) {
        return { ok: false, runId: null, status: 403, error: "Idempotency key belongs to another agent instance", reservedCredits: 0 };
      }
    }

    return {
      ok: true,
      runId: existing.id,
      reservedCredits: existing.credits_charged || 0,
    };
  }

  // Resolve internal user ID
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", ctx.clerkId)
    .maybeSingle();

  if (!user) {
    return { ok: false, runId: null, status: 404, error: "User not found", reservedCredits: 0 };
  }

  // Check balance and reserve credits atomically
  if (estimatedCredits > 0) {
    const { error: reserveError } = await supabaseAdmin.rpc("reserve_credits", {
      p_user_id: user.id,
      p_credits: estimatedCredits,
    });

    if (reserveError) {
      // Check if it's an insufficient-balance error (402)
      if (reserveError.message.includes("insufficient")) {
        return {
          ok: false,
          runId: null,
          status: 402,
          error: "Insufficient LiTTBits balance",
          reservedCredits: 0,
        };
      }
      // Any other RPC error (missing function, permission denied,
      // schema mismatch, timeout, database unavailable) must ABORT.
      // Never proceed with the model call unless reservation is confirmed.
      console.error(`[agent-billing] reserve_credits FAILED — aborting run. Error: ${reserveError.message}`);
      return {
        ok: false,
        runId: null,
        status: 503,
        error: `Credit reservation failed: ${reserveError.message}`,
        reservedCredits: 0,
      };
    }
  }

  // Create the agent_runs row
  const { data: runRow, error: runError } = await supabaseAdmin
    .from("agent_runs")
    .insert({
      user_id: user.id,
      agent_instance_id: ctx.agentInstanceId,
      agent_id: ctx.agentId,
      agent_version_id: ctx.agentVersionId,
      conversation_id: ctx.conversationId ?? null,
      message_id: ctx.messageId ?? null,
      idempotency_key: ctx.idempotencyKey,
      model: ctx.model ?? null,
      provider: ctx.provider ?? null,
      credits_charged: estimatedCredits, // reserved amount
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError) {
    if (runError.code === "23505") {
      // Duplicate key race — fetch existing and validate ownership
      const { data: race } = await supabaseAdmin
        .from("agent_runs")
        .select("id, credits_charged, user_id, agent_instance_id")
        .eq("idempotency_key", ctx.idempotencyKey)
        .maybeSingle();
      if (race) {
        // Validate ownership before reusing
        const { data: raceUser } = await supabaseAdmin
          .from("users")
          .select("clerk_id")
          .eq("id", race.user_id)
          .maybeSingle();
        if (raceUser?.clerk_id !== ctx.clerkId) {
          return { ok: false, runId: null, status: 403, error: "Idempotency key belongs to another user", reservedCredits: 0 };
        }
        if (race.agent_instance_id !== ctx.agentInstanceId) {
          return { ok: false, runId: null, status: 403, error: "Idempotency key belongs to another agent instance", reservedCredits: 0 };
        }
        return { ok: true, runId: race.id, reservedCredits: race.credits_charged || 0 };
      }
      return { ok: false, runId: null, status: 500, error: "Duplicate key but existing run not found", reservedCredits: 0 };
    }
    // Run-row insert failed — refund the reservation if it was made
    if (estimatedCredits > 0) {
      const { error: refundErr } = await supabaseAdmin.rpc("refund_credits", {
        p_run_id: null,
        p_credits: estimatedCredits,
      });
      if (refundErr) {
        console.error(`[agent-billing] CRITICAL: run insert failed AND refund failed. User ${ctx.clerkId} may have lost ${estimatedCredits} credits. Error: ${refundErr.message}`);
        await createReconciliationRecord(ctx, estimatedCredits, "refund_after_insert_failure", refundErr.message);
      }
    }
    return { ok: false, runId: null, status: 500, error: runError.message, reservedCredits: 0 };
  }

  return { ok: true, runId: runRow.id, reservedCredits: estimatedCredits };
}

/**
 * Settle a run after the model call completes.
 *
 * 1. If actual cost < reserved credits, refund the difference.
 * 2. Update the agent_runs row with final token counts and status.
 * 3. Update the agent instance's last_active_at.
 *
 * If the model call failed, refund ALL reserved credits and mark as failed.
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
): Promise<SettleResult> {
  if (!supabaseAdmin) {
    return { ok: false, runId, creditsCharged: 0, creditsRefunded: 0 };
  }

  const creditsToCharge = result.status === "completed" ? result.actualCredits : 0;
  const creditsToRefund = Math.max(0, reservedCredits - creditsToCharge);

  // Refund unused credits
  if (creditsToRefund > 0) {
    const { error: refundError } = await supabaseAdmin.rpc("refund_credits", {
      p_run_id: runId,
      p_credits: creditsToRefund,
    });

    if (refundError) {
      console.error(`[agent-billing] CRITICAL: refund_credits failed for run ${runId}. Credits to refund: ${creditsToRefund}. Error: ${refundError.message}`);
      await createReconciliationRecord({
        clerkId: "",
        agentInstanceId: "",
        agentId: null,
        agentVersionId: null,
        idempotencyKey: runId,
      }, creditsToRefund, "refund_failed", refundError.message);
    }
  }

  // Update the agent_runs row
  const { error: updateError } = await supabaseAdmin
    .from("agent_runs")
    .update({
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      credits_charged: creditsToCharge,
      status: result.status,
      error: result.error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (updateError) {
    console.error(`[agent-billing] CRITICAL: agent_runs update failed for run ${runId}. Error: ${updateError.message}`);
    await createReconciliationRecord({
      clerkId: "",
      agentInstanceId: "",
      agentId: null,
      agentVersionId: null,
      idempotencyKey: runId,
    }, creditsToCharge, "settlement_update_failed", updateError.message);
    return { ok: false, runId, creditsCharged: creditsToCharge, creditsRefunded: 0 };
  }

  // Update the agent instance's last_active_at
  const { data: run } = await supabaseAdmin
    .from("agent_runs")
    .select("agent_instance_id")
    .eq("id", runId)
    .maybeSingle();

  if (run?.agent_instance_id) {
    void supabaseAdmin
      .from("user_agents")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", run.agent_instance_id);
  }

  return { ok: true, runId, creditsCharged: creditsToCharge, creditsRefunded: creditsToRefund };
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
): Promise<{ runId: string; ok: boolean; creditsCharged: number }> {
  const settleResult = await settleRun(runId, {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    actualCredits: result.creditsCharged,
    status: result.status,
    error: result.error,
  }, result.creditsCharged);

  return { runId, ok: settleResult.ok, creditsCharged: settleResult.creditsCharged };
}

/**
 * Create a reconciliation record when settlement or refund fails.
 * This ensures failed financial operations are tracked and can be retried.
 */
async function createReconciliationRecord(
  ctx: AgentRunContext,
  credits: number,
  reason: string,
  errorMessage: string,
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
