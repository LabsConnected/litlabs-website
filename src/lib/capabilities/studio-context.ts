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
    const availableTools: string[] = [];
    if (repositoryConnected) availableTools.push("repository");

    const connectionSummary = repositoryConnected
      ? `Connected: repository (${repositoryName})`
      : hasInstallation
        ? "GitHub installed — no repository selected."
        : "No services connected.";

    return {
      ...base,
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
