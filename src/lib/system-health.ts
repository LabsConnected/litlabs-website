
/**
 * System Health — canonical connection-state resolver for the Dashboard.
 *
 * GitHub state is resolved from every supported connection source so the
 * dashboard reports the repository LiTT can actually build from.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

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

export interface WorkspaceConnection {
  id: string;
  label: string;
  category: "Workspace";
  state: HealthState;
  detail: string;
  subState?: string;
  lastChecked: string;
  action?: { label: string; href: string };
}

export interface AiProviderHealth {
  id: string;
  label: string;
  category: "AI";
  state: HealthState;
  detail: string;
  model: string;
  latencyMs: number | null;
  lastChecked: string;
  action?: { label: string; href: string };
}

export interface PlatformService {
  id: string;
  label: string;
  category: "Platform";
  state: HealthState;
  detail: string;
  lastChecked: string;
}

export interface SystemHealthSummary {
  headline: string;
  optionalPending: number;
  platformDegraded: boolean;
}

export interface SystemHealthResponse {
  workspace: WorkspaceConnection[];
  ai: AiProviderHealth[];
  platform: PlatformService[];
  summary: SystemHealthSummary;
  isOwner: boolean;
  generatedAt: string;
}

interface RawDashboardData {
  accounts: Array<{
    provider: string;
    provider_account_id: string | null;
    provider_account_name: string | null;
    status: string;
    last_connected_at: string | null;
    last_error: string | null;
  }>;
  projects: Array<{
    repository_full_name: string | null;
    repository_html_url: string | null;
    vercel_project_id: string | null;
    vercel_deployment_url: string | null;
    vercel_production_url: string | null;
    vercel_status: string | null;
    sync_status: string;
    sync_error: string | null;
  }>;
  legacyProjects: Array<{
    repository_full_name?: string | null;
    connection_status?: string;
  }>;
  installations: Array<{ installation_id: number; created_at: string }>;
}

const SETTINGS_CONNECTIONS = "/settings?section=connections&returnTo=/dashboard";
const STUDIO_GITHUB = "/studio/github";

export function resolveGitHub(data: RawDashboardData): WorkspaceConnection {
  const now = new Date().toISOString();
  const account = data.accounts.find((item) => item.provider === "github");
  const activeProject = data.projects.find(
    (project) => project.repository_full_name && project.sync_status !== "error",
  );

  if (activeProject?.repository_full_name) {
    return {
      id: "github",
      label: "GitHub Repository",
      category: "Workspace",
      state: "connected",
      detail: activeProject.repository_full_name,
      lastChecked: now,
      action: { label: "Manage", href: STUDIO_GITHUB },
    };
  }

  const legacyProject = data.legacyProjects.find(
    (project) => project.repository_full_name && project.connection_status !== "disconnected",
  );
  if (legacyProject?.repository_full_name) {
    return {
      id: "github",
      label: "GitHub Repository",
      category: "Workspace",
      state: "connected",
      detail: legacyProject.repository_full_name,
      lastChecked: now,
      action: { label: "Manage", href: STUDIO_GITHUB },
    };
  }

  if (data.installations.length > 0) {
    return {
      id: "github",
      label: "GitHub Repository",
      category: "Workspace",
      state: "authorized",
      detail: "Authorized — no repository selected",
      lastChecked: now,
      action: { label: "Select repository", href: STUDIO_GITHUB },
    };
  }

  if (account && (account.last_error || account.status === "error" || account.status === "expired")) {
    return {
      id: "github",
      label: "GitHub Repository",
      category: "Workspace",
      state: "reconnect_required",
      detail: account.last_error || "Token expired or revoked",
      lastChecked: now,
      action: { label: "Reconnect", href: STUDIO_GITHUB },
    };
  }

  if (account) {
    return {
      id: "github",
      label: "GitHub Repository",
      category: "Workspace",
      state: "authorized",
      detail: account.provider_account_name || "Authorized",
      lastChecked: now,
      action: { label: "Select repository", href: STUDIO_GITHUB },
    };
  }

  return {
    id: "github",
    label: "GitHub Repository",
    category: "Workspace",
    state: "not_connected",
    detail: "Not connected",
    lastChecked: now,
    action: { label: "Connect GitHub", href: STUDIO_GITHUB },
  };
}


/**
 * Resolve Supabase — labeled as "Project Integration" to avoid confusing
 * it with the LiTTree platform database.
 */
export function resolveSupabaseProject(data: RawDashboardData): WorkspaceConnection {
  const now = new Date().toISOString();
  const supaAccount = data.accounts.find((a) => a.provider === "supabase");

  if (supaAccount) {
    return {
      id: "supabase_project",
      label: "Supabase Project Integration",
      category: "Workspace",
      state: "connected",
      detail: supaAccount.provider_account_name || "Connected",
      lastChecked: now,
      action: { label: "Manage", href: SETTINGS_CONNECTIONS },
    };
  }

  return {
    id: "supabase_project",
    label: "Supabase Project Integration",
    category: "Workspace",
    state: "not_connected",
    detail: "Optional · Not linked",
    lastChecked: now,
    action: { label: "Connect", href: SETTINGS_CONNECTIONS },
  };
}

export function resolveWorkspaceConnections(data: RawDashboardData): WorkspaceConnection[] {
  return [resolveGitHub(data), resolveSupabaseProject(data)];
}

/* ------------------------------------------------------------------ */
/*  AI provider health — real probes with caching                      */
/* ------------------------------------------------------------------ */

const AI_CACHE_MS = 45_000;

interface CachedProbe {
  result: Omit<AiProviderHealth, "label" | "category" | "action">;
  expiresAt: number;
}

let _geminiCache: CachedProbe | null = null;
let _openrouterCache: CachedProbe | null = null;

const GEMINI_MODEL = process.env.GEMINI_PRIMARY_MODEL || "gemini-2.5-flash";

/**
 * Probe Gemini with a tiny 1-token generation request.
 * Returns state + latency. Never exposes the API key.
 */
export async function probeGemini(): Promise<Omit<AiProviderHealth, "label" | "category" | "action">> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const now = new Date().toISOString();

  if (!key) {
    return { id: "gemini", state: "missing", detail: "API key required", model: GEMINI_MODEL, latencyMs: null, lastChecked: now };
  }

  if (_geminiCache && Date.now() < _geminiCache.expiresAt) return _geminiCache.result;

  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 1, temperature: 0 },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    const latencyMs = Date.now() - t0;

    if (res.ok) {
      const result: AiProviderHealth = {
        id: "gemini",
        label: "Gemini",
        category: "AI",
        state: "healthy",
        detail: `${GEMINI_MODEL} · ${latencyMs} ms`,
        model: GEMINI_MODEL,
        latencyMs,
        lastChecked: now,
      };
      const cached = { id: "gemini", state: "healthy" as const, detail: result.detail, model: GEMINI_MODEL, latencyMs, lastChecked: now };
      _geminiCache = { result: cached, expiresAt: Date.now() + AI_CACHE_MS };
      return cached;
    }

    // Error states
    if (res.status === 401 || res.status === 403) {
      return { id: "gemini", state: "unauthorized", detail: "Key rejected by provider", model: GEMINI_MODEL, latencyMs, lastChecked: now };
    }
    if (res.status === 429) {
      return { id: "gemini", state: "rate_limited", detail: "Rate limited — retry later", model: GEMINI_MODEL, latencyMs, lastChecked: now };
    }
    if (res.status >= 500) {
      return { id: "gemini", state: "unavailable", detail: `Provider returned ${res.status}`, model: GEMINI_MODEL, latencyMs, lastChecked: now };
    }
    return { id: "gemini", state: "degraded", detail: `Unexpected response ${res.status}`, model: GEMINI_MODEL, latencyMs, lastChecked: now };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : "Network error";
    return { id: "gemini", state: "unavailable", detail: msg, model: GEMINI_MODEL, latencyMs, lastChecked: now };
  }
}

/**
 * Probe OpenRouter with a tiny 1-token chat completion to a free model.
 */
export async function probeOpenRouter(): Promise<Omit<AiProviderHealth, "label" | "category" | "action">> {
  const key = process.env.OPENROUTER_API_KEY || "";
  const now = new Date().toISOString();
  const probeModel = "openai/gpt-oss-20b:free";

  if (!key) {
    return { id: "openrouter", state: "missing", detail: "API key required", model: "openrouter/free", latencyMs: null, lastChecked: now };
  }

  if (_openrouterCache && Date.now() < _openrouterCache.expiresAt) return _openrouterCache.result;

  const t0 = Date.now();
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://litlabs.net",
        "X-Title": "LiTTree Lab Studios",
      },
      body: JSON.stringify({
        model: probeModel,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - t0;

    if (res.ok) {
      const detail = `Fallback routing enabled · ${latencyMs} ms`;
      const cached = { id: "openrouter", state: "healthy" as const, detail, model: "openrouter/free", latencyMs, lastChecked: now };
      _openrouterCache = { result: cached, expiresAt: Date.now() + AI_CACHE_MS };
      return cached;
    }

    if (res.status === 401 || res.status === 403) {
      return { id: "openrouter", state: "unauthorized", detail: "Key rejected by provider", model: "openrouter/free", latencyMs, lastChecked: now };
    }
    if (res.status === 429) {
      return { id: "openrouter", state: "rate_limited", detail: "Rate limited — retry later", model: "openrouter/free", latencyMs, lastChecked: now };
    }
    if (res.status >= 500) {
      return { id: "openrouter", state: "unavailable", detail: `Provider returned ${res.status}`, model: "openrouter/free", latencyMs, lastChecked: now };
    }
    return { id: "openrouter", state: "degraded", detail: `Unexpected response ${res.status}`, model: "openrouter/free", latencyMs, lastChecked: now };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : "Network error";
    return { id: "openrouter", state: "unavailable", detail: msg, model: "openrouter/free", latencyMs, lastChecked: now };
  }
}

/** Clear cached AI probe results (used by tests). */
export function _clearAiHealthCache(): void {
  _geminiCache = null;
  _openrouterCache = null;
}

export async function resolveAiProviders(): Promise<AiProviderHealth[]> {
  const [gemini, openrouter] = await Promise.all([probeGemini(), probeOpenRouter()]);
  return [
    { ...gemini, label: "Gemini", category: "AI", action: { label: "Models", href: "/settings?section=ai-models&returnTo=/dashboard" } },
    { ...openrouter, label: "OpenRouter", category: "AI", action: { label: "Models", href: "/settings?section=ai-models&returnTo=/dashboard" } },
  ];
}

/* ------------------------------------------------------------------ */
/*  Platform services                                                  */
/* ------------------------------------------------------------------ */

/**
 * Resolve platform service health from environment configuration.
 *
 * Normal users receive simplified safe statuses. Owners get fuller detail.
 * Never exposes API keys, internal hostnames, or secret identifiers.
 */
export function resolvePlatformServices(isOwner: boolean): PlatformService[] {
  const now = new Date().toISOString();
  const services: PlatformService[] = [];

  // Website
  services.push({
    id: "website",
    label: "Website",
    category: "Platform",
    state: "operational",
    detail: "Operational",
    lastChecked: now,
  });

  // Clerk authentication
  const clerkKey = process.env.CLERK_SECRET_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  services.push({
    id: "auth",
    label: "Authentication",
    category: "Platform",
    state: clerkKey ? "operational" : "disconnected",
    detail: clerkKey ? "Operational" : "Not configured",
    lastChecked: now,
  });

  // Supabase database (platform DB — NOT the user's project integration)
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const dbConfigured = !!(supaUrl && supaKey);
  services.push({
    id: "database",
    label: "Database",
    category: "Platform",
    state: dbConfigured ? "operational" : "disconnected",
    detail: dbConfigured ? "Operational" : "Not configured",
    lastChecked: now,
  });

  // Deployment platform (Railway or Vercel)
  const deployed = process.env.RAILWAY_ENVIRONMENT || process.env.VERCEL || process.env.VERCEL_URL;
  services.push({
    id: "deployment",
    label: "Deployment",
    category: "Platform",
    state: "operational",
    detail: deployed
      ? `Operational (${process.env.RAILWAY_ENVIRONMENT ? "Railway" : "Vercel"})`
      : "Local / preview",
    lastChecked: now,
  });

  // Terminal / PTY
  const terminalWs = process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "";
  const terminalConfigured = !!terminalWs; // env var set (any value, including localhost for dev)
  services.push({
    id: "terminal",
    label: "Terminal",
    category: "Platform",
    state: "operational",
    detail: terminalConfigured ? (isOwner ? "PTY server configured" : "Operational") : "Operational",
    lastChecked: now,
  });

  // Voice / TTS
  const hasVoice = !!(process.env.ELEVENLABS_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  services.push({
    id: "voice",
    label: "Voice",
    category: "Platform",
    state: hasVoice ? "operational" : "disconnected",
    detail: hasVoice ? "Operational" : "Not configured",
    lastChecked: now,
  });

  // Stripe payments
  const stripeKey = process.env.STRIPE_SECRET_KEY || "";
  services.push({
    id: "stripe",
    label: "Payments",
    category: "Platform",
    state: stripeKey ? "operational" : "disconnected",
    detail: stripeKey ? "Operational" : "Not configured",
    lastChecked: now,
  });

  return services;
}

/* ------------------------------------------------------------------ */
/*  Summary                                                            */
/* ------------------------------------------------------------------ */

export function buildHealthSummary(
  workspace: WorkspaceConnection[],
  ai: AiProviderHealth[],
  platform: PlatformService[],
): SystemHealthSummary {
  const optionalPending = workspace.filter(
    (w) => w.state === "not_connected" || w.state === "missing" || w.state === "reconnect_required",
  ).length;

  const platformDown = platform.filter(
    (p) => p.state === "disconnected" || p.state === "unavailable",
  );
  // Auth + Database are critical; terminal/voice/stripe are optional.
  const criticalDown = platformDown.filter((p) => p.id === "auth" || p.id === "database");
  const platformDegraded = criticalDown.length > 0;

  const aiDown = ai.filter(
    (a) => a.state === "missing" || a.state === "unauthorized" || a.state === "unavailable",
  );

  // Build truthful headline
  if (platformDegraded) {
    const names = criticalDown.map((p) => p.label).join(", ");
    return {
      headline: `Platform degraded — ${names} need attention`,
      optionalPending,
      platformDegraded,
    };
  }

  const parts: string[] = ["Platform operational"];
  if (optionalPending > 0) {
    parts.push(`${optionalPending} optional integration${optionalPending === 1 ? " needs" : "s need"} setup`);
  }
  if (aiDown.length > 0) {
    parts.push(`${aiDown.length} AI provider${aiDown.length === 1 ? "" : "s"} need a key`);
  }
  const terminalDown = platform.find((p) => p.id === "terminal" && p.state === "disconnected");
  if (terminalDown && !platformDegraded) {
    parts.push("Terminal needs attention");
  }

  return {
    headline: parts.join(" · "),
    optionalPending,
    platformDegraded,
  };
}

/* ------------------------------------------------------------------ */
/*  Full resolver — used by the API route                              */
/* ------------------------------------------------------------------ */

/**
 * Fetch raw dashboard data for a user and resolve full system health.
 */
export async function resolveSystemHealth(
  client: SupabaseClient,
  userId: string,
  isOwner: boolean,
): Promise<SystemHealthResponse> {
  const [accounts, projects, legacyProjects, installations] = await Promise.all([
    client.from("integration_accounts").select("*").eq("user_id", userId),
    client.from("integration_projects").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    client.from("projects").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
    client.from("github_installations").select("installation_id, user_id, created_at").eq("user_id", userId),
  ]);

  const rawData: RawDashboardData = {
    accounts: accounts.data ?? [],
    projects: projects.data ?? [],
    legacyProjects: legacyProjects.data ?? [],
    installations: installations.data ?? [],
  };

  const workspace = resolveWorkspaceConnections(rawData);
  const ai = await resolveAiProviders();
  const platform = resolvePlatformServices(isOwner);
  const summary = buildHealthSummary(workspace, ai, platform);

  return {
    workspace,
    ai,
    platform,
    summary,
    isOwner,
    generatedAt: new Date().toISOString(),
  };
}
