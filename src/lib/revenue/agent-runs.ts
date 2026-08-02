import "server-only";

import { supabaseAdmin } from "@/lib/supabase";
import { getAgentAuthorization } from "@/lib/agent-entitlements";

/**
 * Canonical revenue agent run service.
 *
 * This is the single entry point for creating and managing paid agent
 * runs. The browser never creates runs directly — it calls the API
 * route which delegates to this service.
 *
 * Security guarantees:
 *   1. User is authenticated (Clerk ID resolved to internal user)
 *   2. Project ownership verified (studio_projects.user_id = caller)
 *   3. Agent entitlement verified (active entitlement or free agent)
 *   4. Agent version resolved server-side (latest published)
 *   5. Allowed tools resolved from agent capability manifest
 *   6. Idempotency enforced (client_request_id unique per user)
 *   7. Rate limits enforced (max concurrent + daily runs)
 *   8. State transitions validated (no skipping approval gates)
 */

// ─── Types ───────────────────────────────────────────────────────────────

export type RunStatus =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "previewing"
  | "awaiting_deploy_approval"
  | "deploying"
  | "completed"
  | "failed"
  | "cancelled";

export type ApprovalType = "plan" | "deploy";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface CreateRunInput {
  clerkId: string;
  agentId: string;
  projectId: string;
  prompt: string;
  clientRequestId: string;
}

export interface CreateRunResult {
  ok: boolean;
  runId?: string;
  status?: RunStatus;
  error?: string;
  statusCode?: number;
}

export interface RevenueAgentRun {
  id: string;
  user_id: string;
  agent_id: string;
  agent_version_id: string;
  project_id: string;
  client_request_id: string;
  status: RunStatus;
  prompt: string;
  allowed_tools: string[];
  plan: unknown;
  files_changed: unknown[];
  validation_result: unknown;
  preview_url: string | null;
  preview_status: string | null;
  deployment_id: string | null;
  deployment_url: string | null;
  deployment_status: string | null;
  deployment_provider: string | null;
  deployment_error: string | null;
  checkpoint_id: string | null;
  error_code: string | null;
  error_message: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

// ─── Tool capability manifest ────────────────────────────────────────────

/**
 * The Launch Agent V1 capability manifest.
 * This defines exactly which tools the agent may use.
 * The browser can never override this — it's resolved server-side.
 */
export const LAUNCH_AGENT_V1_TOOLS = [
  "project.context.read",
  "project.files.list",
  "project.files.read",
  "project.files.write", // after approval
  "project.checkpoint.create",
  "project.build.run",
  "project.test.run",
  "project.preview.start",
  "project.preview.read",
  "deployment.prepare",
  "deployment.trigger", // after explicit approval
  "deployment.status.read",
] as const;

/**
 * Tool restrictions for the Launch Agent.
 * These tools are explicitly FORBIDDEN.
 */
export const LAUNCH_AGENT_FORBIDDEN_TOOLS = [
  "terminal.command", // no arbitrary terminal commands
  "env.read", // no environment variable access
  "secrets.read", // no secret access
  "project.delete",
  "billing.modify",
  "marketplace.purchase",
  "user.impersonate",
  "cross_project.access",
] as const;

/**
 * Resolve the allowed tools for an agent.
 * Currently only the Launch Agent has a defined manifest.
 * Other agents get an empty tool list (no tools allowed).
 */
export function resolveAllowedTools(agentSlug: string): string[] {
  if (agentSlug === "litt-launch-agent" || agentSlug === "launch-agent") {
    return [...LAUNCH_AGENT_V1_TOOLS];
  }
  // Unknown agents get no tools — they must be explicitly registered
  return [];
}

/**
 * Validate that a tool is in the allowed list and not forbidden.
 */
export function isToolAllowed(tool: string, allowedTools: string[]): boolean {
  if (LAUNCH_AGENT_FORBIDDEN_TOOLS.includes(tool as never)) {
    return false;
  }
  return allowedTools.includes(tool);
}

// ─── Rate limits ─────────────────────────────────────────────────────────

const MAX_CONCURRENT_RUNS = 3;
const MAX_DAILY_RUNS = 20;

async function checkRateLimits(userId: string): Promise<{ ok: boolean; error?: string }> {
  // Check concurrent active runs
  const activeStatuses = ["queued", "planning", "awaiting_approval", "executing", "previewing", "awaiting_deploy_approval", "deploying"];
  const { count: concurrentCount } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", activeStatuses);

  if (concurrentCount !== null && concurrentCount >= MAX_CONCURRENT_RUNS) {
    return { ok: false, error: `Maximum ${MAX_CONCURRENT_RUNS} concurrent runs exceeded` };
  }

  // Check daily run limit
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("queued_at", oneDayAgo);

  if (dailyCount !== null && dailyCount >= MAX_DAILY_RUNS) {
    return { ok: false, error: `Maximum ${MAX_DAILY_RUNS} runs per day exceeded` };
  }

  return { ok: true };
}

// ─── State machine ───────────────────────────────────────────────────────

/**
 * Valid state transitions for a revenue agent run.
 * This enforces the approval gates — you cannot skip from
 * 'planning' to 'executing' without going through 'awaiting_approval'.
 */
const VALID_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["planning", "failed", "cancelled"],
  planning: ["awaiting_approval", "failed", "cancelled"],
  awaiting_approval: ["executing", "failed", "cancelled"],
  executing: ["previewing", "failed", "cancelled"],
  previewing: ["awaiting_deploy_approval", "failed", "cancelled"],
  awaiting_deploy_approval: ["deploying", "failed", "cancelled"],
  deploying: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function isValidTransition(from: RunStatus, to: RunStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Run creation ────────────────────────────────────────────────────────

export async function createRun(input: CreateRunInput): Promise<CreateRunResult> {
  const { clerkId, agentId, projectId, prompt, clientRequestId } = input;

  // 1. Resolve internal user
  const internalUserId = await resolveInternalUserId(clerkId);
  if (!internalUserId) {
    return { ok: false, error: "User not found", statusCode: 401 };
  }

  // 2. Verify project ownership
  const projectOk = await verifyProjectOwnership(projectId, internalUserId);
  if (!projectOk) {
    return { ok: false, error: "Project not found or not owned by caller", statusCode: 404 };
  }

  // 3. Verify agent entitlement
  const auth = await getAgentAuthorization(clerkId, agentId);
  if (!auth.canUse && !auth.canInstall) {
    if (auth.isRefunded) {
      return { ok: false, error: "Agent access revoked due to refund", statusCode: 403 };
    }
    if (!auth.hasEntitlement && !auth.isFree) {
      return { ok: false, error: "No active entitlement for this agent", statusCode: 403 };
    }
    return { ok: false, error: "Not authorized to use this agent", statusCode: 403 };
  }

  // 4. Resolve agent version server-side
  const version = await resolveAgentVersion(agentId);
  if (!version) {
    return { ok: false, error: "Agent has no published version", statusCode: 404 };
  }

  // 5. Resolve allowed tools from capability manifest
  const agent = await getAgent(agentId);
  if (!agent) {
    return { ok: false, error: "Agent not found", statusCode: 404 };
  }
  const allowedTools = resolveAllowedTools(agent.slug);

  // 6. Check rate limits
  const rateLimitOk = await checkRateLimits(internalUserId);
  if (!rateLimitOk.ok) {
    return { ok: false, error: rateLimitOk.error, statusCode: 429 };
  }

  // 7. Create run (idempotent via unique constraint on user_id + client_request_id)
  const { data: run, error: insertError } = await supabaseAdmin
    .from("revenue_agent_runs")
    .insert({
      user_id: internalUserId,
      agent_id: agentId,
      agent_version_id: version.id,
      project_id: projectId,
      client_request_id: clientRequestId,
      status: "queued",
      prompt,
      allowed_tools: allowedTools,
    })
    .select("id, status")
    .single();

  if (insertError) {
    // Check for unique constraint violation (duplicate client_request_id)
    if (insertError.code === "23505") {
      // Return the existing run
      const { data: existing } = await supabaseAdmin
        .from("revenue_agent_runs")
        .select("id, status")
        .eq("user_id", internalUserId)
        .eq("client_request_id", clientRequestId)
        .single();
      if (existing) {
        return { ok: true, runId: existing.id, status: existing.status as RunStatus };
      }
    }
    return { ok: false, error: "Failed to create run", statusCode: 500 };
  }

  // 8. Log the creation event
  await logRunEvent(run.id, internalUserId, "run.created", {
    agent_id: agentId,
    project_id: projectId,
    prompt_length: prompt.length,
  });

  return { ok: true, runId: run.id, status: run.status as RunStatus };
}

// ─── Run retrieval ───────────────────────────────────────────────────────

export async function getRun(runId: string, userId: string): Promise<RevenueAgentRun | null> {
  const { data } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as RevenueAgentRun | null;
}

export async function listRuns(userId: string, limit = 20): Promise<RevenueAgentRun[]> {
  const { data } = await supabaseAdmin
    .from("revenue_agent_runs")
    .select("*")
    .eq("user_id", userId)
    .order("queued_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as RevenueAgentRun[];
}

// ─── State transitions ───────────────────────────────────────────────────

export async function transitionRun(
  runId: string,
  userId: string,
  newStatus: RunStatus,
  updates?: Partial<RevenueAgentRun>,
): Promise<{ ok: boolean; error?: string }> {
  const run = await getRun(runId, userId);
  if (!run) {
    return { ok: false, error: "Run not found" };
  }

  if (!isValidTransition(run.status, newStatus)) {
    return { ok: false, error: `Invalid transition: ${run.status} → ${newStatus}` };
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    ...updates,
  };

  if (newStatus === "executing") updateData.started_at = new Date().toISOString();
  if (newStatus === "completed" || newStatus === "failed") {
    updateData.completed_at = new Date().toISOString();
  }
  if (newStatus === "cancelled") updateData.cancelled_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("revenue_agent_runs")
    .update(updateData)
    .eq("id", runId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  await logRunEvent(runId, userId, "run.transition", { from: run.status, to: newStatus });
  return { ok: true };
}

// ─── Approvals ───────────────────────────────────────────────────────────

export async function createApproval(
  runId: string,
  userId: string,
  type: ApprovalType,
  summary: unknown,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("revenue_agent_approvals")
    .insert({
      run_id: runId,
      user_id: userId,
      approval_type: type,
      status: "pending",
      summary,
    })
    .select("id")
    .single();

  if (error) return null;
  await logRunEvent(runId, userId, "approval.created", { type, approval_id: data.id });
  return data.id;
}

export async function resolveApproval(
  approvalId: string,
  userId: string,
  decision: "approved" | "rejected",
  rejectionReason?: string,
): Promise<{ ok: boolean; error?: string; runId?: string; type?: ApprovalType }> {
  const { data: approval, error: fetchError } = await supabaseAdmin
    .from("revenue_agent_approvals")
    .select("id, run_id, approval_type, status")
    .eq("id", approvalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError || !approval) {
    return { ok: false, error: "Approval not found" };
  }

  if (approval.status !== "pending") {
    return { ok: false, error: "Approval already resolved" };
  }

  const { error: updateError } = await supabaseAdmin
    .from("revenue_agent_approvals")
    .update({
      status: decision,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      rejection_reason: rejectionReason ?? null,
    })
    .eq("id", approvalId)
    .eq("user_id", userId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  await logRunEvent(approval.run_id, userId, "approval.resolved", {
    approval_id: approvalId,
    decision,
    type: approval.approval_type,
  });

  return {
    ok: true,
    runId: approval.run_id,
    type: approval.approval_type as ApprovalType,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function resolveInternalUserId(clerkId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  return data?.id ?? null;
}

async function verifyProjectOwnership(projectId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("studio_projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

async function resolveAgentVersion(agentId: string): Promise<{ id: string } | null> {
  const { data } = await supabaseAdmin
    .from("agent_versions")
    .select("id")
    .eq("agent_id", agentId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function getAgent(agentId: string): Promise<{ id: string; slug: string } | null> {
  const { data } = await supabaseAdmin
    .from("agents")
    .select("id, slug")
    .eq("id", agentId)
    .maybeSingle();
  return data;
}

async function logRunEvent(
  runId: string,
  userId: string,
  eventType: string,
  eventData: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin
    .from("revenue_agent_run_events")
    .insert({
      run_id: runId,
      user_id: userId,
      event_type: eventType,
      event_data: eventData,
    });
}
