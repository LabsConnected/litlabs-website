/**
 * Mission Repository — server-side service for mission persistence.
 *
 * All mission operations go through this service. MissionForge
 * (the UI) calls the /api/missions endpoints which use this repository.
 * The browser never coordinates multiple APIs directly.
 */

import { supabaseAdmin } from "@/lib/supabase";

// ─── Types ──────────────────────────────────────────────────────

export interface Mission {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  description: string | null;
  graph: Record<string, unknown>;
  status: MissionStatus;
  createdAt: string;
  updatedAt: string;
}

export type MissionStatus = "draft" | "ready" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface MissionRun {
  id: string;
  missionId: string;
  projectId: string;
  userId: string;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
}

export type RunStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export interface MissionStep {
  id: string;
  runId: string;
  missionId: string;
  nodeId: string;
  nodeType: string;
  title: string;
  status: StepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  sequenceOrder: number;
}

export type StepStatus = "pending" | "running" | "waiting_approval" | "completed" | "failed" | "skipped";

export interface MissionApproval {
  id: string;
  runId: string;
  stepId: string;
  missionId: string;
  projectId: string;
  userId: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  affectedFiles: string[];
  diff: string | null;
  patch: string | null;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "denied" | "expired";
  expiresAt: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

export interface ValidationResult {
  id: string;
  runId: string;
  projectId: string;
  userId: string;
  command: string;
  exitCode: number | null;
  status: "pending" | "running" | "passed" | "failed" | "skipped" | "not_configured" | "timed_out";
  stdout: string | null;
  stderr: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface Checkpoint {
  id: string;
  projectId: string;
  userId: string;
  gitSha: string;
  label: string;
  description: string | null;
  missionRunId: string | null;
  createdAt: string;
}

// ─── Row types ──────────────────────────────────────────────────

interface MissionRow {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  description: string | null;
  graph: Record<string, unknown>;
  status: MissionStatus;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  mission_id: string;
  project_id: string;
  user_id: string;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

interface StepRow {
  id: string;
  run_id: string;
  mission_id: string;
  node_id: string;
  node_type: string;
  title: string;
  status: StepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  sequence_order: number;
}

interface ApprovalRow {
  id: string;
  run_id: string;
  step_id: string;
  mission_id: string;
  project_id: string;
  user_id: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  affected_files: string[];
  diff: string | null;
  patch: string | null;
  risk_level: "low" | "medium" | "high";
  status: "pending" | "approved" | "denied" | "expired";
  expires_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

interface ValidationRow {
  id: string;
  run_id: string;
  project_id: string;
  user_id: string;
  command: string;
  exit_code: number | null;
  status: ValidationResult["status"];
  stdout: string | null;
  stderr: string | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
}

interface CheckpointRow {
  id: string;
  project_id: string;
  user_id: string;
  git_sha: string;
  label: string;
  description: string | null;
  mission_run_id: string | null;
  created_at: string;
}

// ─── Mappers ────────────────────────────────────────────────────

function rowToMission(row: MissionRow): Mission {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    graph: row.graph,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): MissionRun {
  return {
    id: row.id,
    missionId: row.mission_id,
    projectId: row.project_id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    createdAt: row.created_at,
  };
}

function rowToStep(row: StepRow): MissionStep {
  return {
    id: row.id,
    runId: row.run_id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    nodeType: row.node_type,
    title: row.title,
    status: row.status,
    input: row.input,
    output: row.output,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    sequenceOrder: row.sequence_order,
  };
}

function rowToApproval(row: ApprovalRow): MissionApproval {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    missionId: row.mission_id,
    projectId: row.project_id,
    userId: row.user_id,
    actionType: row.action_type,
    actionPayload: row.action_payload,
    affectedFiles: row.affected_files,
    diff: row.diff,
    patch: row.patch,
    riskLevel: row.risk_level,
    status: row.status,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    createdAt: row.created_at,
  };
}

function rowToValidation(row: ValidationRow): ValidationResult {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    userId: row.user_id,
    command: row.command,
    exitCode: row.exit_code,
    status: row.status,
    stdout: row.stdout,
    stderr: row.stderr,
    durationMs: row.duration_ms,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    gitSha: row.git_sha,
    label: row.label,
    description: row.description,
    missionRunId: row.mission_run_id,
    createdAt: row.created_at,
  };
}

// ─── Mission CRUD ───────────────────────────────────────────────

export async function createMission(input: {
  projectId: string;
  userId: string;
  name: string;
  description?: string;
  graph?: Record<string, unknown>;
}): Promise<Mission> {
  const { data, error } = await supabaseAdmin
    .from("missions")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      name: input.name,
      description: input.description ?? null,
      graph: input.graph ?? {},
      status: "draft",
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create mission: ${error?.message}`);
  return rowToMission(data as MissionRow);
}

export async function getMission(missionId: string, userId: string): Promise<Mission | null> {
  const { data } = await supabaseAdmin
    .from("missions")
    .select("*")
    .eq("id", missionId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? rowToMission(data as MissionRow) : null;
}

export async function listMissions(projectId: string, userId: string): Promise<Mission[]> {
  const { data } = await supabaseAdmin
    .from("missions")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => rowToMission(r as MissionRow));
}

export async function updateMissionGraph(
  missionId: string,
  userId: string,
  graph: Record<string, unknown>,
): Promise<Mission | null> {
  const { data } = await supabaseAdmin
    .from("missions")
    .update({ graph, updated_at: new Date().toISOString() })
    .eq("id", missionId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  return data ? rowToMission(data as MissionRow) : null;
}

export async function updateMissionStatus(
  missionId: string,
  userId: string,
  status: MissionStatus,
): Promise<Mission | null> {
  const { data } = await supabaseAdmin
    .from("missions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", missionId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  return data ? rowToMission(data as MissionRow) : null;
}

// ─── Mission runs ───────────────────────────────────────────────

export async function createRun(missionId: string, projectId: string, userId: string): Promise<MissionRun> {
  const { data, error } = await supabaseAdmin
    .from("mission_runs")
    .insert({
      mission_id: missionId,
      project_id: projectId,
      user_id: userId,
      status: "pending",
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create run: ${error?.message}`);
  return rowToRun(data as RunRow);
}

export async function getRun(runId: string, userId: string): Promise<MissionRun | null> {
  const { data } = await supabaseAdmin
    .from("mission_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? rowToRun(data as RunRow) : null;
}

export async function updateRunStatus(
  runId: string,
  userId: string,
  status: RunStatus,
  error?: string | null,
): Promise<MissionRun | null> {
  const update: Record<string, unknown> = { status };
  if (status === "running" && !error) update.started_at = new Date().toISOString();
  if (status === "completed" || status === "failed" || status === "cancelled") {
    update.completed_at = new Date().toISOString();
  }
  if (error !== undefined) update.error = error;

  const { data } = await supabaseAdmin
    .from("mission_runs")
    .update(update)
    .eq("id", runId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  return data ? rowToRun(data as RunRow) : null;
}

// ─── Mission steps ──────────────────────────────────────────────

export async function createStep(input: {
  runId: string;
  missionId: string;
  nodeId: string;
  nodeType: string;
  title: string;
  sequenceOrder: number;
  input?: Record<string, unknown>;
}): Promise<MissionStep> {
  const { data, error } = await supabaseAdmin
    .from("mission_steps")
    .insert({
      run_id: input.runId,
      mission_id: input.missionId,
      node_id: input.nodeId,
      node_type: input.nodeType,
      title: input.title,
      status: "pending",
      input: input.input ?? {},
      sequence_order: input.sequenceOrder,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create step: ${error?.message}`);
  return rowToStep(data as StepRow);
}

export async function updateStepStatus(
  stepId: string,
  status: StepStatus,
  output?: Record<string, unknown>,
  error?: string | null,
): Promise<MissionStep | null> {
  const update: Record<string, unknown> = { status };
  if (status === "running") update.started_at = new Date().toISOString();
  if (status === "completed" || status === "failed" || status === "skipped") {
    update.completed_at = new Date().toISOString();
  }
  if (output !== undefined) update.output = output;
  if (error !== undefined) update.error = error;

  const { data } = await supabaseAdmin
    .from("mission_steps")
    .update(update)
    .eq("id", stepId)
    .select()
    .maybeSingle();
  return data ? rowToStep(data as StepRow) : null;
}

export async function listSteps(runId: string): Promise<MissionStep[]> {
  const { data } = await supabaseAdmin
    .from("mission_steps")
    .select("*")
    .eq("run_id", runId)
    .order("sequence_order", { ascending: true });
  return (data ?? []).map((r) => rowToStep(r as StepRow));
}

// ─── Approvals ──────────────────────────────────────────────────

export async function createApproval(input: {
  runId: string;
  stepId: string;
  missionId: string;
  projectId: string;
  userId: string;
  actionType: string;
  actionPayload?: Record<string, unknown>;
  affectedFiles?: string[];
  diff?: string | null;
  patch?: string | null;
  riskLevel?: "low" | "medium" | "high";
  expiresAt?: string | null;
}): Promise<MissionApproval> {
  const { data, error } = await supabaseAdmin
    .from("mission_approvals")
    .insert({
      run_id: input.runId,
      step_id: input.stepId,
      mission_id: input.missionId,
      project_id: input.projectId,
      user_id: input.userId,
      action_type: input.actionType,
      action_payload: input.actionPayload ?? {},
      affected_files: input.affectedFiles ?? [],
      diff: input.diff ?? null,
      patch: input.patch ?? null,
      risk_level: input.riskLevel ?? "low",
      status: "pending",
      expires_at: input.expiresAt ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create approval: ${error?.message}`);
  return rowToApproval(data as ApprovalRow);
}

export async function getApproval(approvalId: string, userId: string): Promise<MissionApproval | null> {
  const { data } = await supabaseAdmin
    .from("mission_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? rowToApproval(data as ApprovalRow) : null;
}

export async function getPendingApprovalForStep(stepId: string): Promise<MissionApproval | null> {
  const { data } = await supabaseAdmin
    .from("mission_approvals")
    .select("*")
    .eq("step_id", stepId)
    .eq("status", "pending")
    .maybeSingle();
  return data ? rowToApproval(data as ApprovalRow) : null;
}

export async function resolveApproval(
  approvalId: string,
  userId: string,
  decision: "approved" | "denied",
): Promise<MissionApproval | null> {
  const { data } = await supabaseAdmin
    .from("mission_approvals")
    .update({
      status: decision,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq("id", approvalId)
    .eq("user_id", userId)
    .eq("status", "pending") // Can only resolve pending approvals
    .select()
    .maybeSingle();
  return data ? rowToApproval(data as ApprovalRow) : null;
}

export async function listPendingApprovals(projectId: string, userId: string): Promise<MissionApproval[]> {
  const { data } = await supabaseAdmin
    .from("mission_approvals")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => rowToApproval(r as ApprovalRow));
}

// ─── Validation results ─────────────────────────────────────────

export async function createValidationResult(input: {
  runId: string;
  projectId: string;
  userId: string;
  command: string;
}): Promise<ValidationResult> {
  const { data, error } = await supabaseAdmin
    .from("mission_validation_results")
    .insert({
      run_id: input.runId,
      project_id: input.projectId,
      user_id: input.userId,
      command: input.command,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create validation result: ${error?.message}`);
  return rowToValidation(data as ValidationRow);
}

export async function updateValidationResult(
  resultId: string,
  update: {
    status?: ValidationResult["status"];
    exitCode?: number | null;
    stdout?: string | null;
    stderr?: string | null;
    durationMs?: number | null;
  },
): Promise<ValidationResult | null> {
  const updateData: Record<string, unknown> = { ...update };
  if (update.status === "passed" || update.status === "failed" || update.status === "timed_out") {
    updateData.completed_at = new Date().toISOString();
  }

  const { data } = await supabaseAdmin
    .from("mission_validation_results")
    .update(updateData)
    .eq("id", resultId)
    .select()
    .maybeSingle();
  return data ? rowToValidation(data as ValidationRow) : null;
}

export async function listValidationResults(runId: string): Promise<ValidationResult[]> {
  const { data } = await supabaseAdmin
    .from("mission_validation_results")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => rowToValidation(r as ValidationRow));
}

// ─── Checkpoints ────────────────────────────────────────────────

export async function createCheckpoint(input: {
  projectId: string;
  userId: string;
  gitSha: string;
  label: string;
  description?: string;
  missionRunId?: string | null;
}): Promise<Checkpoint> {
  const { data, error } = await supabaseAdmin
    .from("project_checkpoints")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      git_sha: input.gitSha,
      label: input.label,
      description: input.description ?? null,
      mission_run_id: input.missionRunId ?? null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`Failed to create checkpoint: ${error?.message}`);
  return rowToCheckpoint(data as CheckpointRow);
}

export async function listCheckpoints(projectId: string, userId: string): Promise<Checkpoint[]> {
  const { data } = await supabaseAdmin
    .from("project_checkpoints")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => rowToCheckpoint(r as CheckpointRow));
}

export async function getCheckpoint(checkpointId: string, userId: string): Promise<Checkpoint | null> {
  const { data } = await supabaseAdmin
    .from("project_checkpoints")
    .select("*")
    .eq("id", checkpointId)
    .eq("user_id", userId)
    .maybeSingle();
  return data ? rowToCheckpoint(data as CheckpointRow) : null;
}
