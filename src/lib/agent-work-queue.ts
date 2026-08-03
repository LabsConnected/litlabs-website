/**
 * Agent work queue — TypeScript service for production-grade background work.
 *
 * Features:
 *   - claimNextWork() — atomically claims the next pending task
 *   - completeWork() — marks a task as completed/failed
 *   - enqueueWork() — adds a new task to the queue
 *   - retry logic with exponential backoff
 *   - Cost cap enforcement
 *   - Approval mode support
 */

import { supabaseAdmin } from "@/lib/supabase";

export type WorkStatus =
  | "pending"
  | "leased"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export type ApprovalMode = "supervised" | "autonomous" | "ask-first";

export interface WorkItem {
  id: string;
  user_id: string;
  agent_instance_id: string;
  agent_id: string | null;
  agent_version_id: string | null;
  task_type: string;
  task_payload: Record<string, unknown>;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  cost_cap_credits: number;
  credits_spent: number;
  approval_mode: ApprovalMode;
}

export interface EnqueueWorkParams {
  userId: string;
  agentInstanceId: string;
  agentId?: string | null;
  agentVersionId?: string | null;
  taskType: string;
  taskPayload?: Record<string, unknown>;
  idempotencyKey: string;
  scheduledAt?: Date;
  recurringCron?: string;
  maxAttempts?: number;
  costCapCredits?: number;
  approvalMode?: ApprovalMode;
}

/**
 * Enqueue a new work item. Idempotent — if an item with the same
 * idempotency_key already exists, returns the existing item.
 */
export async function enqueueWork(
  params: EnqueueWorkParams,
): Promise<{ workId: string | null; error?: string }> {
  if (!supabaseAdmin) return { workId: null, error: "DB unavailable" };

  // Check for existing work with the same idempotency key
  const { data: existing } = await supabaseAdmin
    .from("agent_work_queue")
    .select("id")
    .eq("idempotency_key", params.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { workId: existing.id };
  }

  const { data, error } = await supabaseAdmin
    .from("agent_work_queue")
    .insert({
      user_id: params.userId,
      agent_instance_id: params.agentInstanceId,
      agent_id: params.agentId ?? null,
      agent_version_id: params.agentVersionId ?? null,
      task_type: params.taskType,
      task_payload: params.taskPayload ?? {},
      idempotency_key: params.idempotencyKey,
      scheduled_at: params.scheduledAt?.toISOString() ?? new Date().toISOString(),
      recurring_cron: params.recurringCron ?? null,
      max_attempts: params.maxAttempts ?? 3,
      cost_cap_credits: params.costCapCredits ?? 100,
      approval_mode: params.approvalMode ?? "ask-first",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      // Duplicate key race — fetch existing
      const { data: race } = await supabaseAdmin
        .from("agent_work_queue")
        .select("id")
        .eq("idempotency_key", params.idempotencyKey)
        .maybeSingle();
      return { workId: race?.id ?? null };
    }
    return { workId: null, error: error.message };
  }

  return { workId: data.id };
}

/**
 * Claim the next pending work item. Uses FOR UPDATE SKIP LOCKED via RPC
 * for safe concurrent claiming.
 */
export async function claimNextWork(
  workerId: string,
  leaseDurationSeconds = 300,
): Promise<WorkItem | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin.rpc("claim_next_work", {
    p_worker_id: workerId,
    p_lease_duration_seconds: leaseDurationSeconds,
  });

  if (error || !data || data.length === 0) return null;

  const row = data[0];
  return {
    id: row.id,
    user_id: row.user_id,
    agent_instance_id: row.agent_instance_id,
    agent_id: row.agent_id,
    agent_version_id: row.agent_version_id,
    task_type: row.task_type,
    task_payload: row.task_payload,
    idempotency_key: row.idempotency_key,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    cost_cap_credits: row.cost_cap_credits,
    credits_spent: row.credits_spent,
    approval_mode: row.approval_mode,
  };
}

/**
 * Complete a work item. Idempotent — only updates if the item is
 * currently 'leased'.
 */
export async function completeWork(
  workId: string,
  status: "completed" | "failed" | "cancelled",
  result?: Record<string, unknown>,
  error?: string,
  creditsSpent?: number,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  const { error: rpcError } = await supabaseAdmin.rpc("complete_work", {
    p_work_id: workId,
    p_status: status,
    p_result: result ?? null,
    p_error: error ?? null,
    p_credits_spent: creditsSpent ?? 0,
  });

  return !rpcError;
}

/**
 * Check if a work item has exceeded its cost cap.
 */
export function isOverBudget(item: WorkItem): boolean {
  return item.credits_spent >= item.cost_cap_credits;
}

/**
 * Calculate exponential backoff delay for retry attempts.
 */
export function getRetryDelay(attempts: number): number {
  // 1s, 2s, 4s, 8s, 16s, capped at 60s
  return Math.min(1000 * Math.pow(2, attempts - 1), 60000);
}

/**
 * Re-queue a failed work item for retry, with exponential backoff.
 * Returns false if max attempts have been exceeded.
 */
export async function retryWorkItem(
  workId: string,
  error: string,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  // Load the work item to check attempts
  const { data: item } = await supabaseAdmin
    .from("agent_work_queue")
    .select("attempts, max_attempts")
    .eq("id", workId)
    .maybeSingle();

  if (!item) return false;

  if (item.attempts >= item.max_attempts) {
    // Mark as permanently failed
    await completeWork(workId, "failed", undefined, error);
    return false;
  }

  // Re-queue with backoff delay
  const delay = getRetryDelay(item.attempts);
  const scheduledAt = new Date(Date.now() + delay);

  const { error: updateError } = await supabaseAdmin
    .from("agent_work_queue")
    .update({
      status: "pending",
      error,
      scheduled_at: scheduledAt.toISOString(),
      leased_at: null,
      lease_expires_at: null,
      leased_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workId);

  return !updateError;
}
