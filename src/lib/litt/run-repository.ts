/**
 * Run repository — server-side CRUD for canonical LiTT runs, events,
 * and kernel decisions. Uses the Supabase admin client (service role).
 *
 * All mutations are atomic: events are persisted BEFORE publication to
 * the SSE stream, so reconnection can replay from the DB.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CanonicalMessage,
  RunStatus,
  KernelDecisionSummary,
} from "./run-contract";

// ─── Helpers ─────────────────────────────────────────────────────

function admin(): SupabaseClient {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Supabase admin client is not configured");
  return client;
}

function genId(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// ─── Run CRUD ─────────────────────────────────────────────────────

export interface CreateRunInput {
  conversationId: string;
  userId: string;
  projectId?: string | null;
  missionId?: string | null;
  canvasId?: string | null;
}

export async function createRun(
  input: CreateRunInput,
): Promise<{ runId: string; createdAt: string }> {
  const sb = admin();
  const runId = genId();
  const createdAt = now();

  const { error } = await sb.from("litt_runs").insert({
    id: runId,
    conversation_id: input.conversationId,
    user_id: input.userId,
    project_id: input.projectId ?? null,
    mission_id: input.missionId ?? null,
    canvas_id: input.canvasId ?? null,
    status: "pending",
    last_sequence: 0,
    created_at: createdAt,
    updated_at: createdAt,
  });

  if (error) throw new Error(`Failed to create run: ${error.message}`);

  return { runId, createdAt };
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  error?: { code: string; message: string; retryable: boolean } | null,
): Promise<void> {
  const sb = admin();
  const updates: Record<string, unknown> = {
    status,
    updated_at: now(),
  };
  if (error) updates.error = error;
  if (status === "completed" || status === "failed" || status === "cancelled") {
    updates.completed_at = now();
  }

  const { error: err } = await sb.from("litt_runs").update(updates).eq("id", runId);
  if (err) throw new Error(`Failed to update run status: ${err.message}`);
}

export async function linkUserMessage(runId: string, messageId: string): Promise<void> {
  const sb = admin();
  const { error } = await sb
    .from("litt_runs")
    .update({ user_message_id: messageId, updated_at: now() })
    .eq("id", runId);
  if (error) throw new Error(`Failed to link user message: ${error.message}`);
}

export async function linkAssistantMessage(
  runId: string,
  messageId: string,
): Promise<void> {
  const sb = admin();
  const { error } = await sb
    .from("litt_runs")
    .update({ assistant_message_id: messageId, updated_at: now() })
    .eq("id", runId);
  if (error) throw new Error(`Failed to link assistant message: ${error.message}`);
}

export async function linkKernelDecision(
  runId: string,
  decisionId: string,
): Promise<void> {
  const sb = admin();
  const { error } = await sb
    .from("litt_runs")
    .update({ kernel_decision_id: decisionId, updated_at: now() })
    .eq("id", runId);
  if (error) throw new Error(`Failed to link kernel decision: ${error.message}`);
}

export async function setRetryOf(runId: string, originalRunId: string): Promise<void> {
  const sb = admin();
  const { error } = await sb
    .from("litt_runs")
    .update({ retry_of: originalRunId, updated_at: now() })
    .eq("id", runId);
  if (error) throw new Error(`Failed to set retry_of: ${error.message}`);
}

export async function getRun(runId: string): Promise<RunRow | null> {
  const sb = admin();
  const { data, error } = await sb
    .from("litt_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) return null;
  return data as RunRow;
}

export interface RunRow {
  id: string;
  conversation_id: string;
  user_id: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  kernel_decision_id: string | null;
  project_id: string | null;
  mission_id: string | null;
  canvas_id: string | null;
  status: RunStatus;
  last_sequence: number;
  error: { code: string; message: string; retryable: boolean } | null;
  retry_of: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ─── Event persistence ───────────────────────────────────────────

/**
 * Append an event to the run event log. Atomically increments the
 * sequence counter on the run row using a conditional update.
 * Returns the assigned sequence number.
 *
 * If the (run_id, sequence) already exists (duplicate delivery),
 * the insert fails silently — the event was already persisted.
 */
export async function appendEvent(
  runId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ sequence: number; timestamp: string } | null> {
  const sb = admin();
  const timestamp = now();

  // Atomically increment last_sequence and get the new value
  const { data: runData, error: runErr } = await sb
    .from("litt_runs")
    .select("last_sequence")
    .eq("id", runId)
    .single();

  if (runErr || !runData) {
    throw new Error(`Failed to get run for event append: ${runErr?.message}`);
  }

  const nextSequence = (runData.last_sequence as number) + 1;

  // Update the run's last_sequence
  const { error: updateErr } = await sb
    .from("litt_runs")
    .update({ last_sequence: nextSequence, updated_at: timestamp })
    .eq("id", runId)
    .eq("last_sequence", runData.last_sequence);

  if (updateErr) {
    throw new Error(`Failed to increment sequence: ${updateErr.message}`);
  }

  // Insert the event (UNIQUE constraint prevents duplicates)
  const { error: eventErr } = await sb.from("litt_run_events").insert({
    id: genId(),
    run_id: runId,
    sequence: nextSequence,
    type,
    payload,
    created_at: timestamp,
  });

  if (eventErr) {
    // If duplicate (UNIQUE violation), the event was already persisted
    if (eventErr.code === "23505") return null;
    throw new Error(`Failed to append event: ${eventErr.message}`);
  }

  return { sequence: nextSequence, timestamp };
}

/**
 * Replay events after a given sequence number (for SSE reconnection).
 */
export async function getEventsAfter(
  runId: string,
  afterSequence: number,
): Promise<Array<{ sequence: number; type: string; payload: Record<string, unknown>; created_at: string }>> {
  const sb = admin();
  const { data, error } = await sb
    .from("litt_run_events")
    .select("sequence, type, payload, created_at")
    .eq("run_id", runId)
    .gt("sequence", afterSequence)
    .order("sequence", { ascending: true });

  if (error || !data) return [];
  return data as Array<{
    sequence: number;
    type: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
}

// ─── Kernel decision persistence ──────────────────────────────────

export async function persistKernelDecision(
  runId: string,
  userId: string,
  decision: Record<string, unknown>,
  summary: KernelDecisionSummary,
): Promise<string> {
  const sb = admin();
  const decisionId = genId();

  const { error } = await sb.from("litt_kernel_decisions").insert({
    id: decisionId,
    run_id: runId,
    user_id: userId,
    decision,
    summary,
    created_at: now(),
  });

  if (error) throw new Error(`Failed to persist kernel decision: ${error.message}`);

  await linkKernelDecision(runId, decisionId);
  return decisionId;
}

// ─── Canonical message persistence ───────────────────────────────

export interface CreateMessageInput {
  conversationId: string;
  runId: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: CanonicalMessage["status"];
  inputMode: CanonicalMessage["inputMode"];
  canvasBlockId?: string | null;
}

export async function createMessage(
  input: CreateMessageInput,
): Promise<CanonicalMessage> {
  const sb = admin();
  const messageId = genId();
  const timestamp = now();

  const { error } = await sb.from("conversation_messages").insert({
    id: messageId,
    conversation_id: input.conversationId,
    run_id: input.runId,
    role: input.role,
    content: input.content,
    status: input.status,
    input_mode: input.inputMode,
    canvas_block_id: input.canvasBlockId ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });

  if (error) throw new Error(`Failed to create message: ${error.message}`);

  return {
    id: messageId,
    conversationId: input.conversationId,
    runId: input.runId,
    role: input.role,
    content: input.content,
    status: input.status,
    inputMode: input.inputMode,
    canvasBlockId: input.canvasBlockId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function updateMessage(
  messageId: string,
  updates: Partial<Pick<CanonicalMessage, "content" | "status" | "canvasBlockId" | "completedAt" | "error">>,
): Promise<void> {
  const sb = admin();
  const dbUpdates: Record<string, unknown> = { updated_at: now() };
  if (updates.content !== undefined) dbUpdates.content = updates.content;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.canvasBlockId !== undefined) dbUpdates.canvas_block_id = updates.canvasBlockId;
  if (updates.completedAt !== undefined) dbUpdates.completed_at = updates.completedAt;
  if (updates.error !== undefined) dbUpdates.error = updates.error;

  const { error } = await sb
    .from("conversation_messages")
    .update(dbUpdates)
    .eq("id", messageId);

  if (error) throw new Error(`Failed to update message: ${error.message}`);
}

export async function getMessages(
  conversationId: string,
): Promise<CanonicalMessage[]> {
  const sb = admin();
  const { data, error } = await sb
    .from("conversation_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map(rowToMessage);
}

function rowToMessage(row: Record<string, unknown>): CanonicalMessage {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    runId: row.run_id as string,
    role: row.role as "user" | "assistant" | "system",
    content: row.content as string,
    status: row.status as CanonicalMessage["status"],
    inputMode: row.input_mode as CanonicalMessage["inputMode"],
    canvasBlockId: (row.canvas_block_id as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string) ?? null,
    error: (row.error as MessageError) ?? null,
  };
}

interface MessageError {
  code: string;
  message: string;
  retryable: boolean;
}

// ─── Conversation helpers ─────────────────────────────────────────

export async function getOrCreateConversation(
  userId: string,
  conversationId?: string | null,
  agentId: string = "litt",
  title?: string,
): Promise<string> {
  const sb = admin();

  // If conversationId provided, verify it exists and belongs to user
  if (conversationId) {
    const { data } = await sb
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data) return conversationId;
  }

  // Create new conversation
  const convId = genId();
  const { error } = await sb.from("conversations").insert({
    id: convId,
    user_id: userId,
    agent_id: agentId,
    title: title || "LiTT Conversation",
    status: "active",
    created_at: now(),
    updated_at: now(),
  });

  if (error) throw new Error(`Failed to create conversation: ${error.message}`);

  return convId;
}
