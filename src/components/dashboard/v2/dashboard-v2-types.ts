export type IntegrationProject = {
  id: string;
  provider: string;
  repository_id: number | null;
  repository_full_name: string | null;
  repository_html_url: string | null;
  repository_private: boolean;
  default_branch: string | null;
  working_branch: string | null;
  latest_commit_sha: string | null;
  latest_commit_message: string | null;
  latest_commit_author: string | null;
  latest_commit_date: string | null;
  open_prs_count: number;
  open_issues_count: number;
  github_actions_status: Record<string, unknown>;
  vercel_project_id: string | null;
  vercel_deployment_url: string | null;
  vercel_production_url: string | null;
  vercel_status: string | null;
  last_synced_at: string | null;
  sync_status: string;
  sync_error: string | null;
};

export type LegacyProject = {
  id: string;
  name: string;
  status: string;
  owner?: string;
  repository?: string;
  working_branch?: string;
  connection_status: string;
  repository_full_name?: string;
  repository_html_url?: string;
  repository_private?: boolean;
  selected_branch?: string;
  connected_at?: string;
  last_synced_at?: string;
};

export type IntegrationEvent = {
  id: string;
  provider: string;
  event_type: string;
  title: string;
  description: string | null;
  severity: string;
  actor: string | null;
  url: string | null;
  read_at: string | null;
  created_at: string;
};

export type IntegrationAccount = {
  id: string;
  provider: string;
  provider_account_id: string | null;
  provider_account_name: string | null;
  status: string;
  last_connected_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
};

export type DashboardData = {
  accounts: IntegrationAccount[];
  projects: IntegrationProject[];
  legacyProjects: LegacyProject[];
  events: IntegrationEvent[];
  unreadCount: number;
  deployments: Array<Record<string, unknown>>;
  installations: Array<{
    installation_id: number;
    user_id: string;
    created_at: string;
  }>;
};

export type LlmHealth = {
  gemini?: { available: boolean; model: string };
  openrouter?: { available: boolean; model: string };
};

export type SocialPost = {
  id: string;
  content: string;
  likes_count: number;
  comments_count: number;
  created_at: string;
  author?: { name: string; username: string; avatar_url: string | null } | null;
};

export type InboxItem = {
  id: string;
  severity: string;
  message: string;
  time: string | null;
  area: string;
};

export type HealthCheck = {
  label: string;
  status: string;
  detail: string;
};

/* ── System Health (3-section model) ─────────────────────────────── */

export type HealthState =
  | "connected"
  | "authorized"
  | "linked"
  | "live"
  | "configured"
  | "checking"
  | "healthy"
  | "degraded"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "reconnect_required"
  | "not_connected"
  | "missing"
  | "operational"
  | "disconnected";

export type HealthAction = { label: string; href: string };

export type WorkspaceConnection = {
  id: string;
  label: string;
  category: "Workspace";
  state: HealthState;
  detail: string;
  subState?: string;
  lastChecked: string;
  action?: HealthAction;
};

export type AiProviderHealth = {
  id: string;
  label: string;
  category: "AI";
  state: HealthState;
  detail: string;
  model: string;
  latencyMs: number | null;
  lastChecked: string;
  action?: HealthAction;
};

export type PlatformService = {
  id: string;
  label: string;
  category: "Platform";
  state: HealthState;
  detail: string;
  lastChecked: string;
};

export type SystemHealthSummary = {
  headline: string;
  optionalPending: number;
  platformDegraded: boolean;
};

export type SystemHealthResponse = {
  workspace: WorkspaceConnection[];
  ai: AiProviderHealth[];
  platform: PlatformService[];
  summary: SystemHealthSummary;
  isOwner: boolean;
  generatedAt: string;
};
