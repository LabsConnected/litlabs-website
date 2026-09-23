import "server-only";

import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { assertActionRunTransition } from "./state-machine";
import { sanitizeActionPayload, type ActionEventInput } from "./events";
import {
  ActionRuntimeError,
  type ActionActivity,
  type ActionEvent,
  type ActionRun,
  type ActionRunPatch,
  type ActionRunStatus,
  type CreateActionRunInput,
} from "./types";

interface ActionRunRow {
  id: string;
  user_id: string;
  project_id: string | null;
  conversation_id: string | null;
  kind: ActionRun["kind"];
  status: ActionRunStatus;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  completed_at: string | null;
  current_activity: string | null;
  browser_session_id: string | null;
  cancellation_requested_at: string | null;
  approval_reference: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

interface ActionEventRow {
  id: string;
  sequence: number;
  run_id: string;
  user_id: string;
  type: ActionEvent["type"];
  created_at: string;
  payload: ActionEvent["payload"];
}

function adminOrThrow() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new ActionRuntimeError(
      "Action Runtime persistence is not configured",
      "PERSISTENCE_UNAVAILABLE",
    );
  }
  return admin;
}

function mapDatabaseError(error: unknown, fallback: ActionRuntimeError["code"]): ActionRuntimeError {
  const message = typeof error === "object" && error && "message" in error
    ? String((error as { message?: unknown }).message)
    : "";
  if (message.includes("ACTION_RUN_NOT_FOUND")) return new ActionRuntimeError("Action run not found", "ACTION_RUN_NOT_FOUND");
  if (message.includes("ACTION_RUN_INVALID_TRANSITION")) return new ActionRuntimeError("Invalid action run transition", "INVALID_TRANSITION");
  if (message.includes("ACTION_RUN_TERMINAL")) return new ActionRuntimeError("Action run is terminal", "ACTION_RUN_TERMINAL");
  if (message.includes("ACTION_BROWSER_SESSION_MISMATCH")) return new ActionRuntimeError("Action run is not attached to this browser session", "ACTION_BROWSER_SESSION_MISMATCH");
  return new ActionRuntimeError("Action Runtime persistence failed", fallback);
}

function mapRun(row: ActionRunRow): ActionRun {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    currentActivity: row.current_activity,
    browserSessionId: row.browser_session_id,
    cancellationRequestedAt: row.cancellation_requested_at,
    approvalReference: row.approval_reference,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
  };
}

function mapEvent(row: ActionEventRow): ActionEvent {
  return {
    id: row.id,
    sequence: Number(row.sequence),
    runId: row.run_id,
    userId: row.user_id,
    type: row.type,
    createdAt: row.created_at,
    payload: row.payload ?? {},
  };
}

async function getOwnedRunRow(runId: string, userId: string): Promise<ActionRunRow | null> {
  const { data, error } = await adminOrThrow()
    .from("action_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return (data as ActionRunRow | null) ?? null;
}

export async function createActionRun(input: CreateActionRunInput): Promise<ActionRun> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_create_run", {
    p_id: randomUUID(),
    p_user_id: input.userId,
    p_project_id: input.projectId ?? null,
    p_conversation_id: input.conversationId ?? null,
    p_kind: input.kind,
    p_current_activity: input.currentActivity ?? null,
    p_browser_session_id: input.browserSessionId ?? null,
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return mapRun(data as ActionRunRow);
}

export async function findOrCreateBrowserActionRun(input: {
  userId: string;
  projectId?: string | null;
  conversationId?: string | null;
}): Promise<ActionRun> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_find_or_create_browser_run", {
    p_id: randomUUID(),
    p_user_id: input.userId,
    p_project_id: input.projectId ?? null,
    p_conversation_id: input.conversationId ?? null,
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return mapRun(data as ActionRunRow);
}

export async function getActionRun(runId: string, userId: string): Promise<ActionRun | null> {
  const row = await getOwnedRunRow(runId, userId);
  return row ? mapRun(row) : null;
}

export async function listActionRuns(
  userId: string,
  options: { conversationId?: string; projectId?: string; limit?: number } = {},
): Promise<ActionRun[]> {
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100));
  let query = adminOrThrow()
    .from("action_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (options.conversationId) query = query.eq("conversation_id", options.conversationId);
  if (options.projectId) query = query.eq("project_id", options.projectId);
  const { data, error } = await query;
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return (data as ActionRunRow[]).map(mapRun);
}

export async function patchActionRun(
  runId: string,
  userId: string,
  patch: ActionRunPatch,
): Promise<ActionRun> {
  const current = await getOwnedRunRow(runId, userId);
  if (!current) throw new ActionRuntimeError("Action run not found", "NOT_FOUND");
  const { data, error } = await adminOrThrow().rpc("action_runtime_transition", {
    p_run_id: runId,
    p_user_id: userId,
    p_to_status: current.status,
    p_patch: patch,
    p_event_type: "run.status",
    p_event_payload: {},
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return mapRun(data as ActionRunRow);
}

export async function transitionActionRun(
  runId: string,
  userId: string,
  status: ActionRunStatus,
  patch: ActionRunPatch = {},
): Promise<ActionRun> {
  const current = await getOwnedRunRow(runId, userId);
  if (!current) throw new ActionRuntimeError("Action run not found", "NOT_FOUND");
  assertActionRunTransition(current.status, status);
  const eventType = status === "completed"
    ? "run.completed"
    : status === "failed"
      ? "run.failed"
      : status === "cancelled"
        ? "run.cancelled"
        : "run.status";
  const { data, error } = await adminOrThrow().rpc("action_runtime_transition", {
    p_run_id: runId,
    p_user_id: userId,
    p_to_status: status,
    p_patch: patch,
    p_event_type: eventType,
    p_event_payload: { currentActivity: patch.currentActivity ?? current.current_activity },
  });
  if (error || !data) throw mapDatabaseError(error, "CONFLICT");
  return mapRun(data as ActionRunRow);
}

export async function getActionRunByBrowserSession(userId: string, browserSessionId: string): Promise<ActionRun | null> {
  const { data, error } = await adminOrThrow()
    .from("action_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("browser_session_id", browserSessionId)
    .not("status", "in", "(completed,failed,cancelled)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return data ? mapRun(data as ActionRunRow) : null;
}

export async function transitionActionRunEventActivity(input: {
  runId: string;
  userId: string;
  status: ActionRunStatus;
  eventType: ActionEventInput["type"];
  payload?: Record<string, unknown>;
  message: string;
  patch?: ActionRunPatch;
}): Promise<ActionRun> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_transition_event_activity", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_to_status: input.status,
    p_patch: input.patch ?? {},
    p_event_type: input.eventType,
    p_event_payload: sanitizeActionPayload(input.payload),
    p_message: input.message,
  });
  if (error || !data) throw mapDatabaseError(error, "CONFLICT");
  return mapRun(data as ActionRunRow);
}

export async function attachBrowserSessionToRun(
  runId: string,
  userId: string,
  browserSessionId: string,
  providerSessionId: string | null,
): Promise<ActionRun> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_attach_browser_session", {
    p_run_id: runId,
    p_user_id: userId,
    p_browser_session_id: browserSessionId,
    p_provider_session_id: providerSessionId,
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return mapRun(data as ActionRunRow);
}

export async function appendActionEvent(input: ActionEventInput): Promise<ActionEvent> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_append_event", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_type: input.type,
    p_payload: sanitizeActionPayload(input.payload),
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return mapEvent(data as ActionEventRow);
}

export async function recordActionEventActivity(input: {
  runId: string;
  userId: string;
  type: ActionEventInput["type"];
  payload?: Record<string, unknown>;
  message: string;
}): Promise<ActionRun> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_event_activity", {
    p_run_id: input.runId,
    p_user_id: input.userId,
    p_type: input.type,
    p_payload: sanitizeActionPayload(input.payload),
    p_message: input.message,
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return mapRun(data as ActionRunRow);
}

export async function recordActionActivity(
  runId: string,
  userId: string,
  message: string,
): Promise<ActionActivity> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_activity", {
    p_run_id: runId,
    p_user_id: userId,
    p_message: message,
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  const run = mapRun(data as ActionRunRow);
  return {
    id: run.id,
    runId,
    userId,
    message,
    createdAt: run.updatedAt,
    eventId: null,
  };
}

export async function listActionEvents(
  runId: string,
  userId: string,
  options: { afterSequence?: number; limit?: number } = {},
): Promise<ActionEvent[]> {
  const owned = await getOwnedRunRow(runId, userId);
  if (!owned) return [];
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 200), 500));
  let query = adminOrThrow()
    .from("action_events")
    .select("*")
    .eq("run_id", runId)
    .eq("user_id", userId)
    .order("sequence", { ascending: true })
    .limit(limit);
  if (Number.isFinite(options.afterSequence)) query = query.gt("sequence", Math.max(0, Math.trunc(options.afterSequence as number)));
  const { data, error } = await query;
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return (data as ActionEventRow[]).map(mapEvent);
}

export async function requestActionRunCancellation(runId: string, userId: string): Promise<ActionRun> {
  const { data, error } = await adminOrThrow().rpc("action_runtime_request_cancellation", {
    p_run_id: runId,
    p_user_id: userId,
    p_requested_at: new Date().toISOString(),
  });
  if (error || !data) throw mapDatabaseError(error, "PERSISTENCE_UNAVAILABLE");
  return mapRun(data as ActionRunRow);
}
