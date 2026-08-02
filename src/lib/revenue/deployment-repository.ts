import "server-only";

import { supabaseAdmin } from "@/lib/supabase";

/**
 * Canonical deployment repository for revenue agent runs.
 *
 * This is the single source of truth for deployment records.
 * It stores real provider deployment IDs, statuses, and URLs.
 *
 * The legacy `deployments` table (GitLab-focused) and
 * `project_deployments` table (integration platform) are not
 * modified — this table is canonical for revenue agent deployments.
 */

export type DeploymentProvider = "vercel" | "railway" | "manual" | "system";
export type DeploymentEnvironment = "production" | "preview" | "development";
export type DeploymentStatus =
  | "pending"
  | "queued"
  | "building"
  | "deploying"
  | "ready"
  | "live"
  | "failed"
  | "canceled";

export interface RevenueDeployment {
  id: string;
  user_id: string;
  project_id: string;
  agent_run_id: string | null;
  provider: DeploymentProvider;
  provider_deployment_id: string | null;
  environment: DeploymentEnvironment;
  status: DeploymentStatus;
  preview_url: string | null;
  production_url: string | null;
  source_revision: string | null;
  checkpoint_id: string | null;
  error_code: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CreateDeploymentInput {
  user_id: string;
  project_id: string;
  agent_run_id?: string | null;
  provider: DeploymentProvider;
  provider_deployment_id?: string | null;
  environment?: DeploymentEnvironment;
  status?: DeploymentStatus;
  preview_url?: string | null;
  production_url?: string | null;
  source_revision?: string | null;
  checkpoint_id?: string | null;
  metadata?: Record<string, unknown>;
}

// ─── Valid status transitions ────────────────────────────────────────────

const VALID_DEPLOYMENT_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  pending: ["queued", "building", "failed", "canceled"],
  queued: ["building", "failed", "canceled"],
  building: ["deploying", "ready", "live", "failed", "canceled"],
  deploying: ["ready", "live", "failed", "canceled"],
  ready: ["live", "failed"],
  live: ["failed"],
  failed: [],
  canceled: [],
};

export function isValidDeploymentTransition(
  from: DeploymentStatus,
  to: DeploymentStatus,
): boolean {
  return VALID_DEPLOYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── CRUD operations ─────────────────────────────────────────────────────

export async function createDeployment(
  input: CreateDeploymentInput,
): Promise<RevenueDeployment | null> {
  const { data, error } = await supabaseAdmin
    .from("revenue_deployments")
    .insert({
      user_id: input.user_id,
      project_id: input.project_id,
      agent_run_id: input.agent_run_id ?? null,
      provider: input.provider,
      provider_deployment_id: input.provider_deployment_id ?? null,
      environment: input.environment ?? "production",
      status: input.status ?? "pending",
      preview_url: input.preview_url ?? null,
      production_url: input.production_url ?? null,
      source_revision: input.source_revision ?? null,
      checkpoint_id: input.checkpoint_id ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    return null;
  }
  return data as RevenueDeployment;
}

export async function getDeployment(
  deploymentId: string,
  userId: string,
): Promise<RevenueDeployment | null> {
  const { data } = await supabaseAdmin
    .from("revenue_deployments")
    .select("*")
    .eq("id", deploymentId)
    .eq("user_id", userId)
    .maybeSingle();
  return data as RevenueDeployment | null;
}

export async function getDeploymentByProviderId(
  provider: DeploymentProvider,
  providerDeploymentId: string,
): Promise<RevenueDeployment | null> {
  const { data } = await supabaseAdmin
    .from("revenue_deployments")
    .select("*")
    .eq("provider", provider)
    .eq("provider_deployment_id", providerDeploymentId)
    .maybeSingle();
  return data as RevenueDeployment | null;
}

export async function updateDeploymentStatus(
  deploymentId: string,
  userId: string,
  newStatus: DeploymentStatus,
  updates?: Partial<Pick<RevenueDeployment,
    "provider_deployment_id" | "preview_url" | "production_url" |
    "source_revision" | "error_code" | "error_message" | "completed_at"
  >>,
): Promise<{ ok: boolean; error?: string }> {
  const deployment = await getDeployment(deploymentId, userId);
  if (!deployment) {
    return { ok: false, error: "Deployment not found" };
  }

  if (!isValidDeploymentTransition(deployment.status, newStatus)) {
    return { ok: false, error: `Invalid transition: ${deployment.status} → ${newStatus}` };
  }

  const updateData: Record<string, unknown> = {
    status: newStatus,
    ...updates,
  };

  if (newStatus === "ready" || newStatus === "live" || newStatus === "failed" || newStatus === "canceled") {
    updateData.completed_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin
    .from("revenue_deployments")
    .update(updateData)
    .eq("id", deploymentId)
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function listDeployments(
  userId: string,
  options?: { projectId?: string; limit?: number },
): Promise<RevenueDeployment[]> {
  let query = supabaseAdmin
    .from("revenue_deployments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options?.projectId) {
    query = query.eq("project_id", options.projectId);
  }

  const limit = options?.limit ?? 20;
  const { data } = await query.limit(limit);
  return (data ?? []) as RevenueDeployment[];
}

export async function listDeploymentsForRun(
  runId: string,
  userId: string,
): Promise<RevenueDeployment[]> {
  const { data } = await supabaseAdmin
    .from("revenue_deployments")
    .select("*")
    .eq("agent_run_id", runId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as RevenueDeployment[];
}
