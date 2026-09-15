/**
 * Paused Run Store — server-side persistence for V2 agent loop runs that
 * paused for ACT-mode approval.
 *
 * Security properties:
 * - Never trusts client-supplied paused state. All state is server-verified.
 * - Approvals are single-use: once resolved, they cannot be replayed.
 * - Approvals expire after APPROVAL_TTL_MS.
 * - Tool arguments are frozen at pause time. The approve endpoint cannot
 *   replace them.
 * - On resume, user ownership and workspace state are re-verified.
 *
 * Async execution:
 * - After approval, the resumed agent loop runs detached from the HTTP
 *   request. Its state is persisted in run_status / run_result / run_error
 *   so the client can poll the GET endpoint for completion.
 * - Stale runs (processing > RUN_STALE_TIMEOUT_MS) are marked failed on
 *   read to recover from process restarts.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import type { LLMMessage } from "./llm-tool-calling";

const APPROVAL_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TABLE = "agent_paused_runs";

/** A run that has been "processing" longer than this is considered stale
 *  (the process likely restarted). The GET endpoint marks it as failed. */
export const RUN_STALE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export type RunStatus = "processing" | "completed" | "failed" | null;

export interface RunResult {
  finalText: string;
  stepsUsed: number;
  toolCalls: Array<{ toolId: string; success: boolean; summary: string; mutating: boolean }>;
  cancelled: boolean;
  cancelReason?: string;
  pendingApproval?: {
    toolId: string;
    pausedRunId?: string;
    reason: string;
  };
}

export interface PausedRunRecord {
  id: string;
  userId: string;
  conversationId: string;
  projectId: string;
  workspaceId: string;
  toolId: string;
  toolCallId: string;
  inputs: Record<string, unknown>;
  reason: string;
  pausedMessages: LLMMessage[];
  executionMode: "plan" | "act" | "auto";
  systemPrompt: string;
  checkpointId: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  // Async execution tracking (null when not yet started)
  runStatus: RunStatus;
  runResult: RunResult | null;
  runError: string | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
}

interface PausedRunRow {
  id: string;
  user_id: string;
  conversation_id: string;
  project_id: string;
  workspace_id: string;
  tool_id: string;
  tool_call_id: string;
  inputs: Record<string, unknown>;
  reason: string;
  paused_messages: LLMMessage[];
  execution_mode: string;
  system_prompt: string;
  checkpoint_id: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
  run_status: string | null;
  run_result: RunResult | null;
  run_error: string | null;
  run_started_at: string | null;
  run_completed_at: string | null;
}

function rowToRecord(row: PausedRunRow): PausedRunRecord {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    toolId: row.tool_id,
    toolCallId: row.tool_call_id,
    inputs: row.inputs,
    reason: row.reason,
    pausedMessages: row.paused_messages,
    executionMode: row.execution_mode as "plan" | "act" | "auto",
    systemPrompt: row.system_prompt,
    checkpointId: row.checkpoint_id,
    status: row.status as PausedRunRecord["status"],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    runStatus: (row.run_status as RunStatus) ?? null,
    runResult: row.run_result ?? null,
    runError: row.run_error ?? null,
    runStartedAt: row.run_started_at ?? null,
    runCompletedAt: row.run_completed_at ?? null,
  };
}

export async function createPausedRun(input: {
  userId: string;
  conversationId: string;
  projectId: string;
  workspaceId: string;
  toolId: string;
  toolCallId: string;
  inputs: Record<string, unknown>;
  reason: string;
  pausedMessages: LLMMessage[];
  executionMode: "plan" | "act" | "auto";
  systemPrompt: string;
  checkpointId: string | null;
}): Promise<PausedRunRecord> {
  if (!supabaseAdmin) throw new Error("Database not available");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      user_id: input.userId,
      conversation_id: input.conversationId,
      project_id: input.projectId,
      workspace_id: input.workspaceId,
      tool_id: input.toolId,
      tool_call_id: input.toolCallId,
      inputs: input.inputs,
      reason: input.reason,
      paused_messages: input.pausedMessages,
      execution_mode: input.executionMode,
      system_prompt: input.systemPrompt,
      checkpoint_id: input.checkpointId,
      status: "pending",
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
      resolved_at: null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create paused run: ${error?.message ?? "unknown"}`);
  }

  return rowToRecord(data as PausedRunRow);
}

export async function getPausedRun(
  pausedRunId: string,
  userId: string,
): Promise<PausedRunRecord | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const record = rowToRecord(data as PausedRunRow);

  // Stale-run recovery: if the run has been "processing" for too long,
  // mark it as failed. This handles process restarts where the detached
  // execution was killed mid-flight.
  if (record.runStatus === "processing" && record.runStartedAt) {
    const startedAt = new Date(record.runStartedAt).getTime();
    if (Date.now() - startedAt > RUN_STALE_TIMEOUT_MS) {
      await markRunFailed(pausedRunId, userId, "Execution timed out (process may have restarted)");
      record.runStatus = "failed";
      record.runError = "Execution timed out (process may have restarted)";
      record.runCompletedAt = new Date().toISOString();
    }
  }

  return record;
}

/**
 * Latest still-pending paused run for a conversation — used to rehydrate
 * the approval card after a page reload (the in-memory execution store is
 * gone, but the paused run row survives). Returns null when nothing is
 * resumable.
 */
export async function getPendingPausedRunForConversation(
  conversationId: string,
  userId: string,
): Promise<PausedRunRecord | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return rowToRecord(data as PausedRunRow);
}

export async function resolvePausedRun(
  pausedRunId: string,
  userId: string,
  decision: "approved" | "rejected",
): Promise<PausedRunRecord | null> {
  if (!supabaseAdmin) throw new Error("Database not available");

  // Single-use: only update if still pending
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      status: decision,
      resolved_at: now,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve paused run: ${error.message}`);
  }

  if (!data) {
    // Either not found, wrong user, or already resolved
    return null;
  }

  const record = rowToRecord(data as PausedRunRow);

  // Check expiration
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    // Mark as expired instead
    await supabaseAdmin
      .from(TABLE)
      .update({ status: "expired", resolved_at: now })
      .eq("id", pausedRunId)
      .eq("status", decision);
    return null;
  }

  return record;
}

/**
 * Mark a run as "processing" — the resumed execution has started.
 * Only transitions from null (not yet started) to "processing".
 * This is idempotent: if already processing, it's a no-op.
 */
export async function markRunProcessing(
  pausedRunId: string,
  userId: string,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      run_status: "processing",
      run_started_at: now,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId)
    .is("run_status", null) // Only if not yet started (NULL check requires .is, not .eq)
    .select("id")
    .maybeSingle();

  if (error) return false;
  return !!data;
}

/**
 * Mark a run as "completed" — the resumed execution finished successfully.
 */
export async function markRunCompleted(
  pausedRunId: string,
  userId: string,
  result: RunResult,
): Promise<void> {
  if (!supabaseAdmin) return;

  const now = new Date().toISOString();
  await supabaseAdmin
    .from(TABLE)
    .update({
      run_status: "completed",
      run_result: result,
      run_completed_at: now,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId);
}

/**
 * Mark a run as "failed" — the resumed execution threw or returned an error.
 */
export async function markRunFailed(
  pausedRunId: string,
  userId: string,
  error: string,
): Promise<void> {
  if (!supabaseAdmin) return;

  const now = new Date().toISOString();
  await supabaseAdmin
    .from(TABLE)
    .update({
      run_status: "failed",
      run_error: error,
      run_completed_at: now,
    })
    .eq("id", pausedRunId)
    .eq("user_id", userId);
}

export async function expireStaleRuns(): Promise<number> {
  if (!supabaseAdmin) return 0;

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: "expired", resolved_at: now })
    .eq("status", "pending")
    .lt("expires_at", now)
    .select("id");

  if (error) return 0;
  return data?.length ?? 0;
}

export const APPROVAL_TTL = APPROVAL_TTL_MS;
