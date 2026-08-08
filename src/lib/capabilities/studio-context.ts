import { supabaseAdmin } from "@/lib/supabase";
import { translateCapabilities, type RawCapabilities } from "./translate";

export interface StudioContext {
  terminalConnected: boolean;
  terminalSessionId: string | null;
  repositoryConnected: boolean;
  repositoryName: string | null;
  availableTools: string[];
  connectionSummary: string;
}

/**
 * Check if the terminal server is reachable and healthy.
 * Uses a short timeout so chat never blocks on a slow/unreachable server.
 */
async function checkTerminalServerHealth(): Promise<boolean> {
  const url = process.env.TERMINAL_SERVER_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
    process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL ??
    "";
  if (!url || url.includes("localhost")) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    });
    clearTimeout(timeout);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.status === "ok" && data?.readiness === "ready";
  } catch {
    return false;
  }
}

/**
 * Build the studio capability context for a given Clerk user by inspecting
 * the same `projects` + `github_installations` tables that /api/capabilities
 * and /api/github/connection-state use. Falls back to an empty context on
 * error so chat never breaks when the DB is unavailable.
 */
export async function getStudioContext(userId?: string): Promise<StudioContext> {
  const base: StudioContext = {
    terminalConnected: false,
    terminalSessionId: null,
    repositoryConnected: false,
    repositoryName: null,
    availableTools: [],
    connectionSummary: "No services connected.",
  };

  if (!userId) return base;

  try {
    // Check terminal server health (parallel with DB queries)
    const terminalHealthPromise = checkTerminalServerHealth();

    const { data: installations } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id")
      .eq("user_id", userId);

    const hasInstallation = !!(installations && installations.length > 0);

    let repositoryName: string | null = null;
    if (hasInstallation) {
      const { data: projects } = await supabaseAdmin
        .from("projects")
        .select("id, repository_full_name, connection_status")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (projects && projects.length > 0) {
        repositoryName = projects[0].repository_full_name ?? null;
      }
    }

    const repositoryConnected = !!repositoryName;
    const terminalConnected = await terminalHealthPromise;
    const availableTools: string[] = [];
    if (repositoryConnected) availableTools.push("repository");
    if (terminalConnected) availableTools.push("terminal");

    const connectedParts: string[] = [];
    if (terminalConnected) connectedParts.push("terminal");
    if (repositoryConnected) connectedParts.push(`repository (${repositoryName})`);

    const connectionSummary = connectedParts.length > 0
      ? `Connected: ${connectedParts.join(", ")}`
      : hasInstallation
        ? "GitHub installed — no repository selected."
        : "No services connected.";

    return {
      ...base,
      terminalConnected,
      repositoryConnected,
      repositoryName,
      availableTools,
      connectionSummary,
    };
  } catch {
    return base;
  }
}

export function buildCapabilityContextForChat(ctx: StudioContext): string {
  const raw: RawCapabilities = {
    repository: ctx.repositoryConnected ? "connected" : "none",
    repositoryIndexed: ctx.repositoryConnected,
    terminalExecution: ctx.terminalConnected ? "available" : "unavailable",
    terminalSessionId: ctx.terminalSessionId,
    connectedProviders: ctx.availableTools,
    availableTools: ctx.availableTools,
    connectionSummary: ctx.connectionSummary,
  };
  return translateCapabilities(raw).contextBlock;
}
