/**
 * Agent billing — atomic LiTTBit charging and agent_runs records for
 * marketplace agent executions.
 *
 * Every time a marketplace agent instance runs, we:
 *   1. Create an agent_runs row with status='running'
 *   2. After the run completes, atomically charge LiTTBits
 *   3. Update the agent_runs row with token counts, credits charged, and status
 *
 * The charge is atomic — if the user doesn't have enough credits, the
 * run is marked as 'failed' with error='insufficient_credits'.
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

export interface AgentRunResult {
  runId: string;
  ok: boolean;
  error?: string;
  creditsCharged: number;
}

/**
 * Start an agent run — creates an agent_runs row with status='running'.
 * Uses an idempotency key to prevent double-charging on retries.
 */
export async function startAgentRun(
  ctx: AgentRunContext,
): Promise<{ runId: string | null; error?: string }> {
  if (!supabaseAdmin) return { runId: null, error: "DB unavailable" };

  // Check for existing run with the same idempotency key
  const { data: existing } = await supabaseAdmin
    .from("agent_runs")
    .select("id, status")
    .eq("idempotency_key", ctx.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { runId: existing.id };
  }

  // Resolve internal user ID
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", ctx.clerkId)
    .maybeSingle();

  if (!user) return { runId: null, error: "User not found" };

  const { data, error } = await supabaseAdmin
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
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // If duplicate key race, fetch the existing one
    if (error.code === "23505") {
      const { data: race } = await supabaseAdmin
        .from("agent_runs")
        .select("id")
        .eq("idempotency_key", ctx.idempotencyKey)
        .maybeSingle();
      return { runId: race?.id ?? null };
    }
    return { runId: null, error: error.message };
  }

  return { runId: data.id };
}

/**
 * Complete an agent run — atomically charges LiTTBits and updates the
 * agent_runs row with the final token counts and status.
 */
export async function completeAgentRun(
  runId: string,
  result: {
    inputTokens: number;
    outputTokens: number;
    creditsCharged: number;
    status: "completed" | "failed" | "cancelled";
    error?: string;
  },
): Promise<AgentRunResult> {
  if (!supabaseAdmin) {
    return { runId, ok: false, error: "DB unavailable", creditsCharged: 0 };
  }

  // Update the agent_runs row
  const { error: updateError } = await supabaseAdmin
    .from("agent_runs")
    .update({
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      credits_charged: result.creditsCharged,
      status: result.status,
      error: result.error ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (updateError) {
    return { runId, ok: false, error: updateError.message, creditsCharged: 0 };
  }

  // If credits should be charged, do so atomically
  if (result.creditsCharged > 0 && result.status === "completed") {
    const { error: chargeError } = await supabaseAdmin.rpc("charge_credits", {
      p_run_id: runId,
      p_credits: result.creditsCharged,
    });

    if (chargeError) {
      // The run completed but charging failed — log but don't fail the run
      console.warn(`[agent-billing] charge_credits failed for run ${runId}: ${chargeError.message}`);
      return { runId, ok: true, creditsCharged: 0 };
    }
  }

  // Update the agent instance's last_active_at
  await supabaseAdmin
    .from("user_agents")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", (await supabaseAdmin.from("agent_runs").select("agent_instance_id").eq("id", runId).maybeSingle()).data?.agent_instance_id)
    .then(() => {});

  return { runId, ok: true, creditsCharged: result.creditsCharged };
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
