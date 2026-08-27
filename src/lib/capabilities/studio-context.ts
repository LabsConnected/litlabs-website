import { supabaseAdmin } from "@/lib/supabase";
import { getProject } from "@/lib/projects/project-repository";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
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
 * Build the studio capability context for a given Clerk user.
 *
 * Project resolution (P0-A fix):
 *   1. If projectId is provided, resolve via getProject() — checks
 *      studio_projects first, then legacy projects. This is the canonical
 *      path that matches resolveProject() and /api/project-runtime.
 *   2. If no projectId, fall back to resolveCurrentProject() — checks
 *      user_active_project table, then most recent studio_projects/projects.
 *   3. If neither resolves, check github_installations for a legacy fallback.
 *
 * Previously this function ONLY queried the legacy `projects` table, which
 * missed projects that exist solely in `studio_projects`. That caused
 * buildCanonicalRuntimeContext to report "repository not connected" for
 * projects the Studio UI showed as connected — the core identity divergence.
 */
export async function getStudioContext(
  userId?: string,
  projectId?: string | null,
): Promise<StudioContext> {
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

    // ── Canonical project resolution ──────────────────────────────
    // Use getProject (checks studio_projects + legacy) when we have an
    // explicit projectId. Fall back to resolveCurrentProject (checks
    // user_active_project + most recent) when we don't. This ensures
    // getStudioContext agrees with /api/project-runtime and the Studio UI.
    let repositoryName: string | null = null;
    let hasInstallation = false;

    if (projectId) {
      const project = await getProject(projectId, userId);
      if (project?.githubFullName) {
        repositoryName = project.githubFullName;
      }
    }

    if (!repositoryName) {
      // No explicit project or it has no repo — try the active project
      const current = await resolveCurrentProject({ userId });
      if (current?.repositoryFullName) {
        repositoryName = current.repositoryFullName;
      }
    }

    if (!repositoryName) {
      // Final fallback: check github_installations + legacy projects table
      const { data: installations } = await supabaseAdmin
        .from("github_installations")
        .select("installation_id")
        .eq("user_id", userId);
      hasInstallation = !!(installations && installations.length > 0);

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
