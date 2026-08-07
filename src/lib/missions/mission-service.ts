/**
 * Mission Service — persistence, resume, step approvals, verification gates.
 *
 * Uses the existing mission schema (missions, mission_runs, mission_steps,
 * mission_approvals, mission_validation_results). Server-only.
 */

import { supabaseAdmin } from "@/lib/supabase";

// ─── Types ──────────────────────────────────────────────────────────

export interface Mission {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  description: string | null;
  graph: Record<string, unknown>;
  status: "draft" | "ready" | "running" | "paused" | "completed" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface MissionRun {
  id: string;
  mission_id: string;
  project_id: string;
  user_id: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
}

export interface MissionStep {
  id: string;
  run_id: string;
  mission_id: string;
  node_id: string;
  node_type: string;
  title: string;
  status: "pending" | "running" | "waiting_approval" | "completed" | "failed" | "skipped";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  sequence_order: number;
  created_at: string;
}

export interface MissionApproval {
  id: string;
  run_id: string;
  step_id: string;
  mission_id: string;
  project_id: string;
  user_id: string;
  action_type: string;
  action_payload: Record<string, unknown>;
  affected_files: unknown[];
  diff: string | null;
  patch: string | null;
  risk_level: "low" | "medium" | "high";
  status: "pending" | "approved" | "denied" | "expired";
  expires_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

export interface ValidationResult {
  id: string;
  run_id: string;
  project_id: string;
  user_id: string;
  command: string;
  exit_code: number | null;
  status: "pending" | "running" | "passed" | "failed" | "skipped" | "not_configured" | "timed_out";
  stdout: string | null;
  stderr: string | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface MissionResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

function ok<T>(data: T, status = 200): MissionResult<T> {
  return { ok: true, data, status };
}

function fail(status: number, error: string): MissionResult<never> {
  return { ok: false, error, status };
}

// ─── Missions ───────────────────────────────────────────────────────

export async function createMission(args: {
  ownerId: string;
  projectId: string;
  name: string;
  description?: string;
  graph?: Record<string, unknown>;
}): Promise<MissionResult<Mission>> {
  if (!args.name?.trim()) return fail(400, "name is required");
  const { data, error } = await supabaseAdmin
    .from("missions")
    .insert({
      project_id: args.projectId,
      user_id: args.ownerId,
      name: args.name,
      description: args.description ?? null,
      graph: args.graph ?? {},
      status: "draft",
    })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return ok(data as Mission);
}

export async function getMission(ownerId: string, missionId: string): Promise<MissionResult<Mission>> {
  const { data, error } = await supabaseAdmin
    .from("missions")
    .select("*")
    .eq("id", missionId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Mission not found");
  return ok(data as Mission);
}

export async function listMissions(ownerId: string, projectId?: string): Promise<MissionResult<Mission[]>> {
  let query = supabaseAdmin.from("missions").select("*").eq("user_id", ownerId);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return fail(500, error.message);
  return ok((data || []) as Mission[]);
}

export async function updateMissionStatus(
  ownerId: string,
  missionId: string,
  status: Mission["status"],
): Promise<MissionResult<Mission>> {
  const { data, error } = await supabaseAdmin
    .from("missions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", missionId)
    .eq("user_id", ownerId)
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Mission not found");
  return ok(data as Mission);
}

// ─── Runs ───────────────────────────────────────────────────────────

export async function createRun(args: {
  ownerId: string;
  missionId: string;
  projectId: string;
}): Promise<MissionResult<MissionRun>> {
  const { data, error } = await supabaseAdmin
    .from("mission_runs")
    .insert({
      mission_id: args.missionId,
      project_id: args.projectId,
      user_id: args.ownerId,
      status: "pending",
    })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return ok(data as MissionRun);
}

export async function getRun(ownerId: string, runId: string): Promise<MissionResult<MissionRun>> {
  const { data, error } = await supabaseAdmin
    .from("mission_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Run not found");
  return ok(data as MissionRun);
}

export async function listRuns(ownerId: string, missionId?: string): Promise<MissionResult<MissionRun[]>> {
  let query = supabaseAdmin.from("mission_runs").select("*").eq("user_id", ownerId);
  if (missionId) query = query.eq("mission_id", missionId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return fail(500, error.message);
  return ok((data || []) as MissionRun[]);
}

/**
 * Resume a paused or failed run. Sets status back to 'running' and
 * updates the started_at timestamp. The caller is responsible for
 * re-executing the pending steps.
 */
export async function resumeRun(ownerId: string, runId: string): Promise<MissionResult<MissionRun>> {
  const { data, error } = await supabaseAdmin
    .from("mission_runs")
    .update({
      status: "running",
      error: null,
    })
    .eq("id", runId)
    .eq("user_id", ownerId)
    .in("status", ["paused", "failed"])
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Run not found or not in a resumable state");
  return ok(data as MissionRun);
}

// ─── Steps ──────────────────────────────────────────────────────────

export async function listSteps(ownerId: string, runId: string): Promise<MissionResult<MissionStep[]>> {
  const { data, error } = await supabaseAdmin
    .from("mission_steps")
    .select("*")
    .eq("run_id", runId)
    .order("sequence_order", { ascending: true });
  if (error) return fail(500, error.message);
  // Verify ownership via the run
  const runResult = await getRun(ownerId, runId);
  if (!runResult.ok) return fail(runResult.status, runResult.error!);
  return ok((data || []) as MissionStep[]);
}

export async function updateStepStatus(
  ownerId: string,
  stepId: string,
  status: MissionStep["status"],
  patch?: { output?: Record<string, unknown>; error?: string },
): Promise<MissionResult<MissionStep>> {
  const updates: Record<string, unknown> = {
    status,
    ...(patch?.output !== undefined && { output: patch.output }),
    ...(patch?.error !== undefined && { error: patch.error }),
  };
  if (status === "running") updates.started_at = new Date().toISOString();
  if (status === "completed" || status === "failed" || status === "skipped") {
    updates.completed_at = new Date().toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from("mission_steps")
    .update(updates)
    .eq("id", stepId)
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(404, "Step not found");
  // Verify ownership via the run
  const step = data as MissionStep;
  const runResult = await getRun(ownerId, step.run_id);
  if (!runResult.ok) return fail(runResult.status, runResult.error!);
  return ok(step);
}

// ─── Approvals ──────────────────────────────────────────────────────

/**
 * Create an approval request for a step. The step's status is set to
 * 'waiting_approval' and cannot proceed until the approval is resolved.
 */
export async function createApproval(args: {
  ownerId: string;
  runId: string;
  stepId: string;
  missionId: string;
  projectId: string;
  actionType: string;
  actionPayload?: Record<string, unknown>;
  affectedFiles?: unknown[];
  diff?: string;
  patch?: string;
  riskLevel?: "low" | "medium" | "high";
  expiresAt?: string;
}): Promise<MissionResult<MissionApproval>> {
  // Set the step to waiting_approval
  const stepResult = await updateStepStatus(args.ownerId, args.stepId, "waiting_approval");
  if (!stepResult.ok) return fail(stepResult.status, stepResult.error!);

  const { data, error } = await supabaseAdmin
    .from("mission_approvals")
    .insert({
      run_id: args.runId,
      step_id: args.stepId,
      mission_id: args.missionId,
      project_id: args.projectId,
      user_id: args.ownerId,
      action_type: args.actionType,
      action_payload: args.actionPayload ?? {},
      affected_files: args.affectedFiles ?? [],
      diff: args.diff ?? null,
      patch: args.patch ?? null,
      risk_level: args.riskLevel ?? "low",
      status: "pending",
      expires_at: args.expiresAt ?? null,
    })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return ok(data as MissionApproval);
}

/**
 * Resolve an approval (approve or deny). Only the owner can resolve.
 * If approved, the step status is set back to 'pending' so the runtime
 * can continue execution. If denied, the step is marked 'skipped'.
 */
export async function resolveApproval(
  ownerId: string,
  approvalId: string,
  decision: "approved" | "denied",
): Promise<MissionResult<MissionApproval>> {
  // Fetch the approval first
  const { data: approval, error: fetchError } = await supabaseAdmin
    .from("mission_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("user_id", ownerId)
    .eq("status", "pending")
    .maybeSingle();
  if (fetchError) return fail(500, fetchError.message);
  if (!approval) return fail(404, "Approval not found or already resolved");

  // Update the approval
  const { data, error } = await supabaseAdmin
    .from("mission_approvals")
    .update({
      status: decision,
      resolved_at: new Date().toISOString(),
      resolved_by: ownerId,
    })
    .eq("id", approvalId)
    .select()
    .single();
  if (error) return fail(500, error.message);

  // Update the step status
  const newStepStatus = decision === "approved" ? "pending" : "skipped";
  await updateStepStatus(ownerId, (approval as MissionApproval).step_id, newStepStatus);

  return ok(data as MissionApproval);
}

export async function listPendingApprovals(ownerId: string): Promise<MissionResult<MissionApproval[]>> {
  const { data, error } = await supabaseAdmin
    .from("mission_approvals")
    .select("*")
    .eq("user_id", ownerId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) return fail(500, error.message);
  return ok((data || []) as MissionApproval[]);
}

// ─── Verification Gates ─────────────────────────────────────────────

/**
 * Record a validation result (typecheck, lint, test, build) for a run.
 * Verification gates prevent a mission from proceeding until all
 * required validations pass.
 */
export async function recordValidationResult(args: {
  ownerId: string;
  runId: string;
  projectId: string;
  command: string;
  exitCode?: number;
  status: ValidationResult["status"];
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}): Promise<MissionResult<ValidationResult>> {
  const { data, error } = await supabaseAdmin
    .from("mission_validation_results")
    .insert({
      run_id: args.runId,
      project_id: args.projectId,
      user_id: args.ownerId,
      command: args.command,
      exit_code: args.exitCode ?? null,
      status: args.status,
      stdout: args.stdout ?? null,
      stderr: args.stderr ?? null,
      duration_ms: args.durationMs ?? null,
      started_at: new Date().toISOString(),
      completed_at: args.status === "passed" || args.status === "failed" ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error) return fail(500, error.message);
  return ok(data as ValidationResult);
}

/**
 * Check if all validation gates for a run have passed.
 * Returns true if there are no failed or pending validations.
 */
export async function checkVerificationGates(
  ownerId: string,
  runId: string,
): Promise<MissionResult<{ passed: boolean; failedCount: number; pendingCount: number }>> {
  const { data, error } = await supabaseAdmin
    .from("mission_validation_results")
    .select("status")
    .eq("run_id", runId)
    .eq("user_id", ownerId);
  if (error) return fail(500, error.message);

  const results = (data || []) as { status: string }[];
  const failedCount = results.filter((r) => r.status === "failed").length;
  const pendingCount = results.filter((r) => r.status === "pending" || r.status === "running").length;
  const passed = failedCount === 0 && pendingCount === 0;

  return ok({ passed, failedCount, pendingCount });
}
