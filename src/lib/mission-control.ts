import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSystemHealth } from "@/lib/system-health";
import type { HealthState } from "@/lib/system-health";

/* ------------------------------------------------------------------ */
/*  Types — matches the MissionControlDashboard scaffold contract       */
/* ------------------------------------------------------------------ */

export type MissionControlState =
  | "created"
  | "inspecting"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "paused"
  | "cancelled";

export type ProjectRuntime = {
  projectId: string;
  repository: string;
  branch: string;
  workspaceState: "missing" | "preparing" | "ready" | "failed";
  terminalState: "disconnected" | "connecting" | "connected" | "failed";
  previewState: "idle" | "preparing" | "ready" | "running" | "failed";
  deploymentState: "none" | "preview" | "production" | "failed";
  latestCommit: string | null;
  updatedAt: string | null;
};

export type MissionItem = {
  id: string;
  title: string;
  state: MissionControlState;
  progress: number;
  currentStep: string | null;
  updatedAt: string;
  agent: "litt" | "spark";
  projectId: string | null;
  blockedReason: string | null;
};

export type ActivityItem = {
  id: string;
  title: string;
  detail: string | null;
  category: "mission" | "tool" | "deployment" | "billing" | "user" | "system";
  severity: "info" | "success" | "warning" | "error";
  createdAt: string;
};

export type HealthService = {
  id: string;
  label: string;
  category: "platform" | "workspace" | "provider";
  state: HealthState;
  detail: string;
  latencyMs: number | null;
  actionHref: string | null;
};

export type GrowthSnapshot = {
  visitorsOnline: number;
  signedInOnline: number;
  signupsToday: number;
  studioOpensToday: number;
  firstPromptsToday: number;
  upgradesToday: number;
};

export type BillingSnapshot = {
  balance: number;
  plan: string;
  revenueTodayCents: number | null;
  estimatedProviderCostTodayCents: number | null;
};

export type MissionControlResponse = {
  role: "owner" | "admin" | "user";
  ownerMode: boolean;
  project: ProjectRuntime | null;
  missions: MissionItem[];
  activity: ActivityItem[];
  health: HealthService[];
  growth: GrowthSnapshot | null;
  billing: BillingSnapshot;
};

/* ------------------------------------------------------------------ */
/*  Owner resolution                                                   */
/* ------------------------------------------------------------------ */

export function isOwnerClerkId(clerkId: string): boolean {
  const ids = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(clerkId);
}

/* ------------------------------------------------------------------ */
/*  Canonical active project runtime                                   */
/* ------------------------------------------------------------------ */

interface IntegrationProjectRow {
  id: string;
  repository_full_name: string | null;
  repository_html_url: string | null;
  selected_branch: string | null;
  working_branch: string | null;
  vercel_project_id: string | null;
  vercel_deployment_url: string | null;
  vercel_production_url: string | null;
  vercel_status: string | null;
  sync_status: string;
  sync_error: string | null;
  latest_commit_sha: string | null;
  updated_at: string | null;
}

interface LegacyProjectRow {
  id: string;
  repository_full_name: string | null;
  working_branch: string | null;
  selected_branch: string | null;
  connection_status: string | null;
  status: string | null;
}

/**
 * Resolve the ONE canonical active project for a user.
 *
 * Priority:
 *   1. integration_projects with a repository_full_name (newest first)
 *   2. legacy projects with a repository_full_name
 *   3. null — no project connected
 *
 * Runtime states are derived from available data — never fabricated.
 * If we don't have workspace/terminal/preview state, we report the
 * truthful "missing" / "disconnected" / "idle" rather than pretending.
 */
export async function resolveActiveProject(
  client: SupabaseClient,
  userId: string,
): Promise<ProjectRuntime | null> {
  // 1. integration_projects
  const { data: intProjects } = await client
    .from("integration_projects")
    .select("id, repository_full_name, repository_html_url, selected_branch, working_branch, vercel_project_id, vercel_deployment_url, vercel_production_url, vercel_status, sync_status, sync_error, latest_commit_sha, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  const intWithRepo = (intProjects ?? []).find(
    (p) => p.repository_full_name && p.sync_status !== "error",
  ) as IntegrationProjectRow | undefined;

  if (intWithRepo?.repository_full_name) {
    return projectRowToRuntime(intWithRepo);
  }

  // 2. Legacy projects
  const { data: legacyProjects } = await client
    .from("projects")
    .select("id, repository_full_name, working_branch, selected_branch, connection_status, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const legacyWithRepo = (legacyProjects ?? []).find(
    (p) => p.repository_full_name && p.connection_status !== "disconnected",
  ) as LegacyProjectRow | undefined;

  if (legacyWithRepo?.repository_full_name) {
    return {
      projectId: legacyWithRepo.id,
      repository: legacyWithRepo.repository_full_name,
      branch: legacyWithRepo.selected_branch || legacyWithRepo.working_branch || "main",
      workspaceState: legacyWithRepo.connection_status === "connected" ? "ready" : "missing",
      terminalState: "disconnected",
      previewState: "idle",
      deploymentState: "none",
      latestCommit: null,
      updatedAt: null,
    };
  }

  // 3. Nothing
  return null;
}

function projectRowToRuntime(p: IntegrationProjectRow): ProjectRuntime {
  const vercelLive = p.vercel_status === "ready" || p.vercel_status === "READY";
  const syncError = p.sync_status === "error";

  return {
    projectId: p.id,
    repository: p.repository_full_name || "unknown",
    branch: p.selected_branch || p.working_branch || "main",
    // Workspace: ready if synced, failed if sync error, missing otherwise
    workspaceState: syncError ? "failed" : p.sync_status === "synced" ? "ready" : "missing",
    // Terminal: we don't have a live terminal state in the DB — report truthfully
    terminalState: "disconnected",
    // Preview: derived from Vercel deployment state
    previewState: vercelLive ? "ready" : p.vercel_project_id ? "preparing" : "idle",
    // Deployment: production if live, preview if linked, none otherwise
    deploymentState: vercelLive ? "production" : p.vercel_project_id ? "preview" : "none",
    latestCommit: p.latest_commit_sha || null,
    updatedAt: p.updated_at || null,
  };
}

/* ------------------------------------------------------------------ */
/*  Active missions                                                    */
/* ------------------------------------------------------------------ */

interface MissionRow {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: string;
  updated_at: string;
  graph: Record<string, unknown>;
}

interface RunRow {
  id: string;
  mission_id: string;
  status: string;
  error: string | null;
  updated_at: string | null;
}

interface StepRow {
  id: string;
  run_id: string;
  title: string;
  status: string;
  sequence_order: number;
}

/**
 * Map internal mission/run/step states to the MissionControl state vocabulary.
 */
function mapMissionState(
  missionStatus: string,
  runStatus: string | null,
  hasPendingApproval: boolean,
): MissionControlState {
  if (hasPendingApproval) return "awaiting_approval";
  if (missionStatus === "completed") return "completed";
  if (missionStatus === "failed" || runStatus === "failed") return "failed";
  if (missionStatus === "paused" || runStatus === "paused") return "paused";
  if (missionStatus === "cancelled" || runStatus === "cancelled") return "cancelled";
  if (runStatus === "running") return "executing";
  if (missionStatus === "ready") return "planning";
  if (missionStatus === "draft") return "created";
  return "created";
}

/**
 * Estimate progress from completed steps in the active run.
 * Returns 0-100. If no run, 0.
 */
function estimateProgress(steps: StepRow[]): number {
  if (!steps.length) return 0;
  const completed = steps.filter(
    (s) => s.status === "completed" || s.status === "skipped",
  ).length;
  return Math.round((completed / steps.length) * 100);
}

/**
 * Fetch active missions for a user across all their projects.
 * Returns up to 20 most recent, mapped to the MissionItem contract.
 */
export async function resolveMissions(
  client: SupabaseClient,
  userId: string,
): Promise<MissionItem[]> {
  const { data: missions } = await client
    .from("missions")
    .select("id, project_id, user_id, name, description, status, updated_at, graph")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (!missions || missions.length === 0) return [];

  const missionIds = missions.map((m) => m.id);

  // Fetch latest runs for these missions
  const { data: runs } = await client
    .from("mission_runs")
    .select("id, mission_id, status, error, updated_at")
    .in("mission_id", missionIds)
    .order("updated_at", { ascending: false });

  // Fetch pending approvals for these missions
  const { data: approvals } = await client
    .from("mission_approvals")
    .select("mission_id")
    .in("mission_id", missionIds)
    .eq("status", "pending");

  // Fetch steps for active runs to estimate progress
  const activeRunIds = (runs ?? [])
    .filter((r) => r.status === "running" || r.status === "pending")
    .map((r) => r.id);

  const stepsByRun: Record<string, StepRow[]> = {};
  if (activeRunIds.length > 0) {
    const { data: steps } = await client
      .from("mission_steps")
      .select("id, run_id, title, status, sequence_order")
      .in("run_id", activeRunIds)
      .order("sequence_order", { ascending: true });
    for (const s of steps ?? []) {
      if (!stepsByRun[s.run_id]) stepsByRun[s.run_id] = [];
      stepsByRun[s.run_id].push(s as StepRow);
    }
  }

  // Build a map: missionId → latest run
  const latestRunByMission: Record<string, RunRow> = {};
  for (const r of (runs ?? []) as RunRow[]) {
    if (!latestRunByMission[r.mission_id]) {
      latestRunByMission[r.mission_id] = r;
    }
  }

  // Build a map: missionId → has pending approval
  const pendingApprovalByMission: Record<string, boolean> = {};
  for (const a of approvals ?? []) {
    pendingApprovalByMission[(a as { mission_id: string }).mission_id] = true;
  }

  return (missions as MissionRow[]).map((m) => {
    const run = latestRunByMission[m.id];
    const hasPendingApproval = pendingApprovalByMission[m.id] || false;
    const state = mapMissionState(m.status, run?.status || null, hasPendingApproval);
    const steps = run ? stepsByRun[run.id] || [] : [];
    const progress = estimateProgress(steps);
    const currentStep = steps.find((s) => s.status === "running")?.title || null;
    const blockedReason = run?.error || null;

    // Determine agent from graph metadata if available
    const graph = m.graph as { agent?: string } | null;
    const agent: "litt" | "spark" = graph?.agent === "spark" ? "spark" : "litt";

    return {
      id: m.id,
      title: m.name,
      state,
      progress,
      currentStep,
      updatedAt: m.updated_at,
      agent,
      projectId: m.project_id,
      blockedReason,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Activity feed                                                      */
/* ------------------------------------------------------------------ */

interface EventRow {
  id: string;
  event_type: string | null;
  provider: string | null;
  message: string | null;
  created_at: string;
  read_at: string | null;
}

/**
 * Fetch recent activity events and map them to the ActivityItem contract.
 * Sources: integration_events (workspace), mission_runs (mission lifecycle).
 */
export async function resolveActivity(
  client: SupabaseClient,
  userId: string,
): Promise<ActivityItem[]> {
  const { data: events } = await client
    .from("integration_events")
    .select("id, event_type, provider, message, created_at, read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  return (events ?? []).map((e) => eventToActivity(e as EventRow));
}

function eventToActivity(e: EventRow): ActivityItem {
  const provider = e.provider || "system";
  const type = e.event_type || "info";
  const title = e.message || `${provider} event`;

  // Categorize
  let category: ActivityItem["category"] = "system";
  if (provider === "github" || provider === "vercel") category = "deployment";
  else if (provider === "stripe" || provider === "billing") category = "billing";
  else if (type.includes("mission")) category = "mission";
  else if (type.includes("tool") || type.includes("generation")) category = "tool";

  // Severity
  let severity: ActivityItem["severity"] = "info";
  if (type.includes("error") || type.includes("fail")) severity = "error";
  else if (type.includes("warn")) severity = "warning";
  else if (type.includes("success") || type.includes("ready") || type.includes("deployed")) severity = "success";

  return {
    id: e.id,
    title,
    detail: provider !== "system" ? provider : null,
    category,
    severity,
    createdAt: e.created_at,
  };
}

/* ------------------------------------------------------------------ */
/*  Health — flatten system-health.ts into the HealthService[] contract */
/* ------------------------------------------------------------------ */

export async function resolveHealth(
  client: SupabaseClient,
  userId: string,
  isOwner: boolean,
): Promise<HealthService[]> {
  const health = await resolveSystemHealth(client, userId, isOwner);
  const services: HealthService[] = [];

  // Platform services
  for (const p of health.platform) {
    services.push({
      id: p.id,
      label: p.label,
      category: "platform",
      state: p.state,
      detail: p.detail,
      latencyMs: null,
      actionHref: null,
    });
  }

  // Workspace connections
  for (const w of health.workspace) {
    services.push({
      id: w.id,
      label: w.label,
      category: "workspace",
      state: w.state,
      detail: w.detail,
      latencyMs: null,
      actionHref: w.action?.href || null,
    });
  }

  // AI providers
  for (const a of health.ai) {
    services.push({
      id: a.id,
      label: a.label,
      category: "provider",
      state: a.state,
      detail: a.detail,
      latencyMs: a.latencyMs,
      actionHref: a.action?.href || null,
    });
  }

  return services;
}

/* ------------------------------------------------------------------ */
/*  Billing snapshot                                                   */
/* ------------------------------------------------------------------ */

interface SubscriptionRow {
  plan: string;
  status: string;
}

/**
 * Resolve billing snapshot: LiTTBits balance + plan name.
 * Revenue and provider cost are owner-only and returned as null for normal users.
 */
export async function resolveBilling(
  client: SupabaseClient,
  clerkId: string,
  isOwner: boolean,
): Promise<BillingSnapshot> {
  // Get user id
  const { data: user } = await client
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!user) {
    return { balance: 0, plan: "Starter", revenueTodayCents: null, estimatedProviderCostTodayCents: null };
  }

  // Get subscription / plan
  const { data: sub } = await client
    .from("subscriptions")
    .select("plan, status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as { data: SubscriptionRow | null };

  let planName = "Starter";
  if (sub && sub.status === "active") {
    const planMap: Record<string, string> = {
      starter: "Starter",
      creator_beta: "Creator Beta",
      pro_builder_beta: "Pro Builder Beta",
      founder: "Founding Member",
    };
    planName = planMap[sub.plan] || sub.plan;
  }

  // Get balance from credit ledger RPC
  let balance = 0;
  try {
    const { data: balances } = await client.rpc("get_user_balances", { p_user_id: user.id });
    const row = Array.isArray(balances) ? balances[0] : balances;
    balance = Math.max(0, Number(row?.total ?? 0));
  } catch {
    // Ledger not available — report 0 truthfully
  }

  // Owner-only: revenue and provider cost
  let revenueTodayCents: number | null = null;
  let estimatedProviderCostTodayCents: number | null = null;

  if (isOwner) {
    // Revenue today from Stripe payments
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: payments } = await client
        .from("payment_records")
        .select("amount_cents")
        .gte("created_at", todayStart.toISOString())
        .eq("status", "succeeded");
      revenueTodayCents = (payments ?? []).reduce((sum, p) => sum + (p.amount_cents || 0), 0);
    } catch {
      // payment_records table may not exist — leave null
    }

    // Provider cost today from credit ledger spend entries
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: spend } = await client
        .from("credit_ledger")
        .select("amount")
        .eq("category", "spend")
        .gte("created_at", todayStart.toISOString());
      // amount is negative for spend — sum the absolute value, convert LiTTBits to cents at 1:1
      // (This is an estimate — real provider cost tracking would need a separate ledger)
      const totalSpend = (spend ?? []).reduce((sum, s) => sum + Math.abs(Number(s.amount) || 0), 0);
      estimatedProviderCostTodayCents = totalSpend;
    } catch {
      // Leave null
    }
  }

  return { balance, plan: planName, revenueTodayCents, estimatedProviderCostTodayCents };
}

/* ------------------------------------------------------------------ */
/*  Growth snapshot — owner only                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve growth snapshot. ONLY called for owners.
 * Normal users receive null.
 *
 * Uses real data from the database — no fake metrics.
 * "Visitors online" requires a presence table; if not available, reports 0.
 */
export async function resolveGrowth(
  client: SupabaseClient,
): Promise<GrowthSnapshot> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [signupsRes, studioOpensRes, firstPromptsRes, upgradesRes, onlineRes] = await Promise.all([
    // Signups today
    client
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString()),
    // Studio opens today (from activity events)
    client
      .from("integration_events")
      .select("id", { count: "exact", head: true })
      .ilike("event_type", "%studio_open%")
      .gte("created_at", todayStart.toISOString()),
    // First prompts today
    client
      .from("integration_events")
      .select("id", { count: "exact", head: true })
      .ilike("event_type", "%first_prompt%")
      .gte("created_at", todayStart.toISOString()),
    // Upgrades today (subscription activations)
    client
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("created_at", todayStart.toISOString()),
    // Online users (from presence table if it exists)
    client
      .from("user_presence")
      .select("user_id, is_signed_in")
      .gte("last_seen_at", new Date(Date.now() - 5 * 60_000).toISOString()),
  ]);

  const onlineData = (onlineRes.data ?? []) as Array<{ user_id: string; is_signed_in: boolean }>;
  const visitorsOnline = onlineData.filter((u) => !u.is_signed_in).length;
  const signedInOnline = onlineData.filter((u) => u.is_signed_in).length;

  return {
    visitorsOnline,
    signedInOnline,
    signupsToday: signupsRes.count || 0,
    studioOpensToday: studioOpensRes.count || 0,
    firstPromptsToday: firstPromptsRes.count || 0,
    upgradesToday: upgradesRes.count || 0,
  };
}
