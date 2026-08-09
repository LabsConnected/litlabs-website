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
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

const APPROVAL_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TABLE = "agent_paused_runs";

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
  pausedMessages: Array<{ role: "user" | "assistant"; content: string }>;
  executionMode: "plan" | "act" | "auto";
  systemPrompt: string;
  checkpointId: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
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
  paused_messages: Array<{ role: "user" | "assistant"; content: string }>;
  execution_mode: string;
  system_prompt: string;
  checkpoint_id: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
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
  pausedMessages: Array<{ role: "user" | "assistant"; content: string }>;
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
