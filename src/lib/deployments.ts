// Deployment tracking helpers
import { supabaseAdmin } from "@/lib/supabase";

export type DeployStatus =
  | "queued"
  | "building"
  | "deploying"
  | "live"
  | "failed"
  | "cancelled";

export type DeployEnvironment = "preview" | "staging" | "production";

export type DeploySource = "gitlab" | "manual" | "deploy-agent" | "vercel";

export interface DeployRecord {
  id: string;
  task_id?: string | null;
  branch: string;
  commit_sha?: string | null;
  environment: DeployEnvironment;
  status: DeployStatus;
  pipeline_url?: string | null;
  deploy_url?: string | null;
  source: DeploySource;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateDeploymentInput {
  task_id?: string;
  branch: string;
  commit_sha?: string;
  environment: DeployEnvironment;
  status: DeployStatus;
  pipeline_url?: string;
  deploy_url?: string;
  source: DeploySource;
  metadata?: Record<string, unknown>;
}

const STATUS_ORDER: DeployStatus[] = [
  "queued",
  "building",
  "deploying",
  "live",
  "failed",
  "cancelled",
];

export function isStatusTransitionValid(
  current: DeployStatus,
  next: DeployStatus,
): boolean {
  const terminal: DeployStatus[] = ["live", "failed", "cancelled"];
  if (terminal.includes(current)) return false;
  return STATUS_ORDER.indexOf(next) >= STATUS_ORDER.indexOf(current);
}

export function inferEnvironment(branch: string): DeployEnvironment {
  const normalized = branch.toLowerCase().trim();
  if (normalized === "main" || normalized === "master") return "production";
  if (normalized.startsWith("staging") || normalized.startsWith("release"))
    return "staging";
  return "preview";
}

export function mapGitLabStatus(
  status: string,
  sourceOrStage?: string,
): DeployStatus {
  const s = status.toLowerCase();
  const source = sourceOrStage?.toLowerCase() ?? "";
  if (["running"].includes(s)) {
    return source.includes("deploy") ? "deploying" : "building";
  }
  if (["pending", "waiting_for_resource", "preparing"].includes(s))
    return "queued";
  if (["success"].includes(s)) return "live";
  if (["failed"].includes(s)) return "failed";
  if (["canceled", "skipped"].includes(s)) return "cancelled";
  return "building";
}

export async function createDeployment(
  input: CreateDeploymentInput,
): Promise<DeployRecord> {
  const { data, error } = await supabaseAdmin
    .from("deployments")
    .insert({
      task_id: input.task_id ?? null,
      branch: input.branch,
      commit_sha: input.commit_sha ?? null,
      environment: input.environment,
      status: input.status,
      pipeline_url: input.pipeline_url ?? null,
      deploy_url: input.deploy_url ?? null,
      source: input.source,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create deployment: ${error?.message ?? "unknown error"}`,
    );
  }

  return data as unknown as DeployRecord;
}

export async function updateDeploymentStatus(
  id: string,
  status: DeployStatus,
  updates?: Partial<
    Pick<DeployRecord, "deploy_url" | "pipeline_url" | "metadata">
  >,
): Promise<DeployRecord> {
  const { data: existing } = await supabaseAdmin
    .from("deployments")
    .select("status")
    .eq("id", id)
    .single();

  if (
    existing &&
    !isStatusTransitionValid(existing.status as DeployStatus, status)
  ) {
    throw new Error(
      `Invalid status transition from ${existing.status} to ${status}`,
    );
  }

  const payload: Record<string, unknown> = { status };
  if (updates?.deploy_url !== undefined)
    payload.deploy_url = updates.deploy_url;
  if (updates?.pipeline_url !== undefined)
    payload.pipeline_url = updates.pipeline_url;
  if (updates?.metadata !== undefined) payload.metadata = updates.metadata;

  const { data, error } = await supabaseAdmin
    .from("deployments")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to update deployment: ${error?.message ?? "unknown error"}`,
    );
  }

  return data as unknown as DeployRecord;
}

export async function upsertDeploymentByPipeline(
  externalId: string,
  input: CreateDeploymentInput,
): Promise<DeployRecord> {
  const { data: existing } = await supabaseAdmin
    .from("deployments")
    .select("id, status")
    .eq("source", input.source)
    .eq("metadata->external_id", externalId)
    .maybeSingle();

  if (existing) {
    if (
      !isStatusTransitionValid(existing.status as DeployStatus, input.status)
    ) {
      const { data: current } = await supabaseAdmin
        .from("deployments")
        .select("*")
        .eq("id", existing.id)
        .single();
      return current as unknown as DeployRecord;
    }

    const { data, error } = await supabaseAdmin
      .from("deployments")
      .update({
        status: input.status,
        deploy_url: input.deploy_url ?? null,
        pipeline_url: input.pipeline_url ?? null,
        metadata: {
          ...(input.metadata ?? {}),
          external_id: externalId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to update deployment: ${error?.message ?? "unknown error"}`,
      );
    }
    return data as unknown as DeployRecord;
  }

  return createDeployment({
    ...input,
    metadata: {
      ...(input.metadata ?? {}),
      external_id: externalId,
    },
  });
}

export async function getDeployments(
  options: {
    since?: Date;
    until?: Date;
    status?: DeployStatus;
    environment?: DeployEnvironment;
    limit?: number;
  } = {},
): Promise<DeployRecord[]> {
  let query = supabaseAdmin
    .from("deployments")
    .select("*")
    .order("created_at", { ascending: false });

  if (options.since) {
    query = query.gte("created_at", options.since.toISOString());
  }
  if (options.until) {
    query = query.lte("created_at", options.until.toISOString());
  }
  if (options.status) {
    query = query.eq("status", options.status);
  }
  if (options.environment) {
    query = query.eq("environment", options.environment);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch deployments: ${error.message}`);
  }
  return (data ?? []) as unknown as DeployRecord[];
}

export interface DeployDigest {
  period: { start: string; end: string };
  total: number;
  byStatus: Record<DeployStatus, number>;
  byEnvironment: Record<DeployEnvironment, number>;
  items: DeployRecord[];
  failed: DeployRecord[];
  pending: DeployRecord[];
  attentionNeeded: DeployRecord[];
}

export async function buildDeployDigest(hours = 24): Promise<DeployDigest> {
  const now = new Date();
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  const items = await getDeployments({ since, limit: 1000 });

  const byStatus: Record<DeployStatus, number> = {
    queued: 0,
    building: 0,
    deploying: 0,
    live: 0,
    failed: 0,
    cancelled: 0,
  };
  const byEnvironment: Record<DeployEnvironment, number> = {
    preview: 0,
    staging: 0,
    production: 0,
  };

  items.forEach((d) => {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    byEnvironment[d.environment] = (byEnvironment[d.environment] ?? 0) + 1;
  });

  const failed = items.filter((d) => d.status === "failed");
  const pending = items.filter((d) =>
    ["queued", "building", "deploying"].includes(d.status),
  );
  const attentionNeeded = [...failed, ...pending];

  return {
    period: { start: since.toISOString(), end: now.toISOString() },
    total: items.length,
    byStatus,
    byEnvironment,
    items,
    failed,
    pending,
    attentionNeeded,
  };
}
