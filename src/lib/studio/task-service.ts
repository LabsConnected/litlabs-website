import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase";
import { getProject } from "@/lib/projects/project-repository";
import { createConversation, getConversation } from "./conversation-service";
import type {
  CreateStudioTaskInput,
  StudioTask,
  StudioTaskStatus,
  StudioTaskType,
  UpdateStudioTaskInput,
} from "./task-types";

interface TaskRow {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  task_type: StudioTaskType;
  status: StudioTaskStatus;
  conversation_id: string | null;
  active_action_run_id: string | null;
  latest_action_run_id: string | null;
  browser_session_id: string | null;
  preview_workspace_id: string | null;
  preview_url: string | null;
  selected_artifact: Record<string, unknown> | null;
  verification_state: Record<string, unknown>;
  metadata: Record<string, unknown>;
  last_opened_surface: string | null;
  last_opened_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ActionRunStatusRow {
  id: string;
  status: string;
}

function admin() {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Task persistence is not configured");
  return client;
}

export function deriveStudioTaskStatus(
  storedStatus: StudioTaskStatus,
  verificationState: Record<string, unknown>,
  actionStatus?: string,
): StudioTaskStatus {
  if (!actionStatus) return storedStatus;
  if (["queued", "starting", "working"].includes(actionStatus)) return "working";
  if (["paused", "waiting_for_user", "user_controlling"].includes(actionStatus)) return "waiting_approval";
  if (actionStatus === "failed" || actionStatus === "cancelled") return storedStatus === "needs_verification" ? "needs_verification" : "failed";
  if (actionStatus === "completed") return verificationState.verified === true ? "complete" : "needs_verification";
  return storedStatus;
}

function mapTask(row: TaskRow, actionStatus?: string): StudioTask {
  const status = row.archived_at ? "closed" : deriveStudioTaskStatus(row.status, row.verification_state, actionStatus);
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    taskType: row.task_type,
    status,
    conversationId: row.conversation_id,
    activeActionRunId: row.active_action_run_id,
    latestActionRunId: row.latest_action_run_id,
    browserSessionId: row.browser_session_id,
    previewWorkspaceId: row.preview_workspace_id,
    previewUrl: row.preview_url,
    selectedArtifact: row.selected_artifact,
    verificationState: row.verification_state ?? {},
    metadata: row.metadata ?? {},
    lastOpenedSurface: row.last_opened_surface,
    lastOpenedAt: row.last_opened_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function projectOwned(userId: string, projectId: string): Promise<boolean> {
  return Boolean(await getProject(projectId, userId));
}

async function projectRunStatuses(userId: string, rows: TaskRow[]): Promise<Map<string, string>> {
  const runIds = rows.flatMap((row) => [row.active_action_run_id, row.latest_action_run_id]).filter(Boolean) as string[];
  if (runIds.length === 0) return new Map();
  const { data, error } = await admin()
    .from("action_runs")
    .select("id,status")
    .eq("user_id", userId)
    .in("id", [...new Set(runIds)]);
  if (error || !data) return new Map();
  return new Map((data as ActionRunStatusRow[]).map((row) => [row.id, row.status]));
}

export async function listStudioTasks(userId: string, projectId: string, includeClosed = false): Promise<StudioTask[]> {
  if (!(await projectOwned(userId, projectId))) return [];
  let query = admin()
    .from("studio_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("last_opened_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (!includeClosed) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as TaskRow[];
  const statuses = await projectRunStatuses(userId, rows);
  return rows.map((row) => mapTask(row, statuses.get(row.active_action_run_id ?? row.latest_action_run_id ?? "")));
}

export async function getStudioTask(userId: string, taskId: string): Promise<StudioTask | null> {
  const { data, error } = await admin()
    .from("studio_tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as TaskRow;
  const statuses = await projectRunStatuses(userId, [row]);
  return mapTask(row, statuses.get(row.active_action_run_id ?? row.latest_action_run_id ?? ""));
}

export async function createStudioTask(userId: string, input: CreateStudioTaskInput): Promise<StudioTask | null> {
  if (!(await projectOwned(userId, input.projectId))) return null;
  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const conversation = await getConversation(conversationId, userId);
    if (!conversation || conversation.projectId !== input.projectId) return null;
  } else {
    const conversation = await createConversation(userId, input.projectId, input.title ?? null, "litt");
    if (!conversation) return null;
    conversationId = conversation.id;
  }

  const { data, error } = await admin()
    .from("studio_tasks")
    .insert({
      user_id: userId,
      project_id: input.projectId,
      title: (input.title ?? "New task").trim().slice(0, 160) || "New task",
      task_type: input.taskType ?? "general",
      conversation_id: conversationId,
      last_opened_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) return null;
  return mapTask(data as TaskRow);
}

export async function attachActionRunToConversationTask(
  userId: string,
  conversationId: string,
  actionRunId: string,
): Promise<void> {
  await admin()
    .from("studio_tasks")
    .update({ active_action_run_id: actionRunId, latest_action_run_id: actionRunId, status: "working", last_opened_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .is("archived_at", null);
}

export async function attachBrowserSessionToConversationTask(
  userId: string,
  conversationId: string,
  browserSessionId: string,
): Promise<void> {
  await admin()
    .from("studio_tasks")
    .update({ browser_session_id: browserSessionId })
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .is("archived_at", null);
}

export async function settleConversationTask(
  userId: string,
  conversationId: string,
  actionStatus: "completed" | "failed" | "cancelled" | "waiting_approval",
  verified: boolean,
): Promise<void> {
  const status = actionStatus === "completed" ? (verified ? "complete" : "needs_verification") : actionStatus === "waiting_approval" ? "waiting_approval" : actionStatus === "cancelled" ? "failed" : "failed";
  await admin()
    .from("studio_tasks")
    .update({ active_action_run_id: null, status })
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .is("archived_at", null);
}

export async function updateStudioTask(
  userId: string,
  taskId: string,
  input: UpdateStudioTaskInput,
): Promise<StudioTask | null> {
  const current = await getStudioTask(userId, taskId);
  if (!current) return null;
  if (input.conversationId) {
    const conversation = await getConversation(input.conversationId, userId);
    if (!conversation || conversation.projectId !== current.projectId) return null;
  }
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim().slice(0, 160) || current.title;
  if (input.conversationId !== undefined) patch.conversation_id = input.conversationId;
  if (input.activeActionRunId !== undefined) patch.active_action_run_id = input.activeActionRunId;
  if (input.latestActionRunId !== undefined) patch.latest_action_run_id = input.latestActionRunId;
  if (input.browserSessionId !== undefined) patch.browser_session_id = input.browserSessionId;
  if (input.previewWorkspaceId !== undefined) patch.preview_workspace_id = input.previewWorkspaceId;
  if (input.previewUrl !== undefined) patch.preview_url = input.previewUrl;
  if (input.selectedArtifact !== undefined) patch.selected_artifact = input.selectedArtifact;
  if (input.verificationState !== undefined) patch.verification_state = input.verificationState;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (input.lastOpenedSurface !== undefined) patch.last_opened_surface = input.lastOpenedSurface;
  if (input.lastOpenedSurface !== undefined || input.lastOpenedAt !== undefined) patch.last_opened_at = input.lastOpenedAt ?? new Date().toISOString();
  if (input.status !== undefined) patch.status = input.status;
  if (input.close) patch.archived_at = new Date().toISOString();
  if (input.reopen) {
    patch.archived_at = null;
    patch.status = current.status === "closed" ? "ready" : current.status;
  }
  const { data, error } = await admin()
    .from("studio_tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error || !data) return null;
  return mapTask(data as TaskRow);
}
