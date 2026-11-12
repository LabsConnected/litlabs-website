/**
 * Durable run checkpoints — store/claim/heartbeat for resumable agent runs.
 *
 * Mirrors the agent_paused_runs lifecycle (execution_token fencing, 90s
 * lease + heartbeat, read-path reaper) but for runs that die WITHOUT an
 * approval gate: the serialized loop state lands here once per step
 * boundary so a recovery path can claim the row and continue the loop.
 *
 * Failure posture: every write is best-effort. The table may not exist in
 * an environment where the migration has not been applied — checkpointing
 * must never block or break a run, so all store functions return null/
 * false on error rather than throwing (except claim, where throwing is
 * the caller's signal to abort this resume attempt).
 */

import { supabaseAdmin } from "@/lib/supabase";
import type { LLMMessage } from "./llm-tool-calling";

export interface RunCheckpointState {
  actionRunId: string;
  userId: string;
  conversationId: string;
  projectId?: string | null;
  workspaceId?: string | null;
  assistantMessageId?: string | null;
  clientRequestId?: string | null;
  agentRunId?: string | null;
  reservationId?: string | null;
  meteringRunId?: string | null;
  messages: LLMMessage[];
  stepsUsed: number;
  hadInterveningMutation: boolean;
  deferredToolCalls?: unknown[] | null;
  baselineCheckpointId?: string | null;
  checkpointId?: string | null;
  qualityLoopState?: unknown;
  systemPrompt?: string | null;
  executionMode?: string | null;
  model?: string | null;
  phase?: string;
}

export const RUN_CHECKPOINT_LEASE_SECONDS = 90;

function isMissingTableError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return err.code === "42P01" || /relation .* does not exist/i.test(msg);
}

/**
 * Insert or overwrite the checkpoint row for an action run. Returns the
 * checkpoint id or null when persistence is unavailable — callers treat
 * null as "no durable checkpoint this step" and continue.
 */
export async function writeRunCheckpoint(state: RunCheckpointState): Promise<string | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from("agent_run_checkpoints")
      .upsert(
        {
          action_run_id: state.actionRunId,
          user_id: state.userId,
          conversation_id: state.conversationId,
          project_id: state.projectId ?? null,
          workspace_id: state.workspaceId ?? null,
          assistant_message_id: state.assistantMessageId ?? null,
          client_request_id: state.clientRequestId ?? null,
          agent_run_id: state.agentRunId ?? null,
          reservation_id: state.reservationId ?? null,
          metering_run_id: state.meteringRunId ?? null,
          messages: state.messages,
          steps_used: state.stepsUsed,
          had_intervening_mutation: state.hadInterveningMutation,
          deferred_tool_calls: state.deferredToolCalls ?? null,
          baseline_checkpoint_id: state.baselineCheckpointId ?? null,
          checkpoint_id: state.checkpointId ?? null,
          quality_loop_state: state.qualityLoopState ?? null,
          system_prompt: state.systemPrompt ?? null,
          execution_mode: state.executionMode ?? null,
          model: state.model ?? null,
          phase: state.phase ?? "loop",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "action_run_id" },
      )
      .select("id")
      .maybeSingle();
    if (error) {
      if (!isMissingTableError(error)) {
        console.warn(`[run-checkpoint] write failed for run ${state.actionRunId}: ${error.message}`);
      }
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Atomic claim of a checkpoint for resume — the cross-instance fence.
 * Returns the claimed row or null when already claimed/terminal/missing.
 */
export async function claimRunCheckpoint(checkpointId: string): Promise<Record<string, unknown> | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.rpc("claim_run_checkpoint", {
    p_checkpoint_id: checkpointId,
    p_lease_seconds: RUN_CHECKPOINT_LEASE_SECONDS,
  });
  if (error) {
    if (!isMissingTableError(error)) {
      console.error(`[run-checkpoint] claim failed for ${checkpointId}: ${error.message}`);
    }
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as Record<string, unknown>) ?? null;
}

/**
 * Token-fenced heartbeat. false = fenced → the executor must abort
 * (another instance owns this run now). Exceptions are transient and the
 * caller may keep working until the next heartbeat check.
 */
export async function renewRunCheckpointLease(checkpointId: string, executionToken: string): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin.rpc("renew_run_checkpoint_lease", {
    p_checkpoint_id: checkpointId,
    p_execution_token: executionToken,
    p_lease_seconds: RUN_CHECKPOINT_LEASE_SECONDS,
  });
  if (error) {
    if (!isMissingTableError(error)) {
      console.warn(`[run-checkpoint] lease renew failed for ${checkpointId}: ${error.message}`);
    }
    return true; // transient — let the next heartbeat decide
  }
  return data === true;
}

/** Checkpoints whose executor is presumed dead (lease expired). */
export async function listStaleRunCheckpoints(maxAttempts = 2): Promise<Record<string, unknown>[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin.rpc("stale_run_checkpoints", {
    p_max_attempts: maxAttempts,
  });
  if (error) {
    if (!isMissingTableError(error)) {
      console.error(`[run-checkpoint] stale scan failed: ${error.message}`);
    }
    return [];
  }
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

/** Fetch the checkpoint for an action run, if one exists. */
export async function getRunCheckpoint(actionRunId: string): Promise<Record<string, unknown> | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("agent_run_checkpoints")
    .select("*")
    .eq("action_run_id", actionRunId)
    .maybeSingle();
  if (error) {
    if (!isMissingTableError(error)) {
      console.warn(`[run-checkpoint] read failed for ${actionRunId}: ${error.message}`);
    }
    return null;
  }
  return (data as Record<string, unknown>) ?? null;
}

/** Terminal settle — marks the checkpoint done/failed so it stops recovering. */
export async function settleRunCheckpoint(
  checkpointId: string,
  outcome: "completed" | "failed",
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin
      .from("agent_run_checkpoints")
      .update({ run_status: outcome, updated_at: new Date().toISOString() })
      .eq("id", checkpointId);
  } catch {
    // best-effort; the run's own ledger row is authoritative
  }
}
