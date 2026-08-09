import { supabaseAdmin } from "@/lib/supabase";
import type { StudioCapabilities, ResolvedStudioContext, AgentSlug, AgentMode } from "./types";

interface ProjectRecord {
  id: string;
  user_id: string;
  name: string;
  github_full_name: string | null;
  github_owner: string | null;
  github_repo: string | null;
  github_default_branch: string | null;
  github_branch: string | null;
  framework: string | null;
  scan_status: string;
  scan_summary: Record<string, unknown> | null;
}

interface LegacyProjectRecord {
  id: string;
  user_id: string;
  repository_full_name: string | null;
  owner: string | null;
  repository: string | null;
  default_branch: string | null;
  working_branch: string | null;
  status: string;
}

export interface ResolvedProject {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  repositoryProvider: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  repositoryDefaultBranch: string | null;
  activeBranch: string | null;
  framework: string | null;
  scanStatus: string | null;
  scanSummary: Record<string, unknown> | null;
  capabilities: StudioCapabilities;
}

/**
 * Resolve a project server-side from the authenticated user's Clerk ID
 * and a project UUID. Checks studio_projects first, then falls back to
 * the legacy projects table.
 *
 * Never trusts client-supplied repository metadata.
 */
export async function resolveProject(
  clerkUserId: string,
  projectId: string,
): Promise<ResolvedProject | null> {
  // Try studio_projects first (newer, more comprehensive)
  const { data: studioProject } = await supabaseAdmin
    .from("studio_projects")
    .select("id, user_id, name, github_full_name, github_owner, github_repo, github_default_branch, github_branch, framework, scan_status, scan_summary")
    .eq("id", projectId)
    .eq("user_id", clerkUserId)
    .single() as { data: ProjectRecord | null; error: unknown };

  if (studioProject) {
    const repoConnected = !!studioProject.github_full_name;
    return {
      projectId: studioProject.id,
      projectName: studioProject.name,
      projectDescription: null,
      repositoryProvider: repoConnected ? "github" : null,
      repositoryOwner: studioProject.github_owner,
      repositoryName: studioProject.github_repo,
      repositoryDefaultBranch: studioProject.github_default_branch,
      activeBranch: studioProject.github_branch,
      framework: studioProject.framework,
      scanStatus: studioProject.scan_status,
      scanSummary: studioProject.scan_summary,
      capabilities: {
        repositoryConnected: repoConnected,
        repositoryName: studioProject.github_full_name,
        terminalConnected: false,
        availableTools: repoConnected ? ["repository"] : [],
        connectionSummary: repoConnected
          ? `Connected: repository (${studioProject.github_full_name})`
          : "No services connected.",
      },
    };
  }

  // Fallback: legacy projects table
  const { data: legacyProject } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, repository_full_name, owner, repository, default_branch, working_branch, status")
    .eq("id", projectId)
    .eq("user_id", clerkUserId)
    .single() as { data: LegacyProjectRecord | null; error: unknown };

  if (legacyProject) {
    const repoConnected = !!legacyProject.repository_full_name;
    return {
      projectId: legacyProject.id,
      projectName: legacyProject.repository || "Untitled Project",
      projectDescription: null,
      repositoryProvider: repoConnected ? "github" : null,
      repositoryOwner: legacyProject.owner,
      repositoryName: legacyProject.repository,
      repositoryDefaultBranch: legacyProject.default_branch,
      activeBranch: legacyProject.working_branch,
      framework: null,
      scanStatus: legacyProject.status,
      scanSummary: null,
      capabilities: {
        repositoryConnected: repoConnected,
        repositoryName: legacyProject.repository_full_name,
        terminalConnected: false,
        availableTools: repoConnected ? ["repository"] : [],
        connectionSummary: repoConnected
          ? `Connected: repository (${legacyProject.repository_full_name})`
          : "No services connected.",
      },
    };
  }

  return null;
}

/**
 * Build a full ResolvedStudioContext from the authenticated user,
 * conversation, and project.
 */
export async function buildStudioContext(
  clerkUserId: string,
  conversationId: string,
  projectId: string,
  agentSlug: AgentSlug,
  agentMode: AgentMode = "standard",
): Promise<ResolvedStudioContext | null> {
  const project = await resolveProject(clerkUserId, projectId);
  if (!project) return null;

  return {
    userId: clerkUserId,
    projectId: project.projectId,
    conversationId,
    projectName: project.projectName,
    projectDescription: project.projectDescription,
    repositoryProvider: project.repositoryProvider,
    repositoryOwner: project.repositoryOwner,
    repositoryName: project.repositoryName,
    repositoryDefaultBranch: project.repositoryDefaultBranch,
    activeBranch: project.activeBranch,
    framework: project.framework,
    scanStatus: project.scanStatus,
    scanSummary: project.scanSummary,
    activeAgentSlug: agentSlug,
    activeAgentMode: agentMode,
    agentInstanceId: null,
    capabilities: project.capabilities,
  };
}

/**
 * Build a project context block for the LLM system prompt.
 */
export function buildProjectContextBlock(ctx: ResolvedStudioContext): string {
  const lines: string[] = [
    "PROJECT CONTEXT (server-resolved):",
    `  Project: ${ctx.projectName}`,
    `  Project ID: ${ctx.projectId}`,
  ];

  if (ctx.repositoryOwner && ctx.repositoryName) {
    lines.push(`  Repository: ${ctx.repositoryOwner}/${ctx.repositoryName}`);
  }
  if (ctx.repositoryDefaultBranch) {
    lines.push(`  Default Branch: ${ctx.repositoryDefaultBranch}`);
  }
  if (ctx.activeBranch) {
    lines.push(`  Active Branch: ${ctx.activeBranch}`);
  }
  if (ctx.framework) {
    lines.push(`  Framework: ${ctx.framework}`);
  }
  if (ctx.scanStatus) {
    lines.push(`  Scan Status: ${ctx.scanStatus}`);
  }
  if (ctx.scanSummary) {
    lines.push(`  Scan Summary: ${JSON.stringify(ctx.scanSummary).slice(0, 2000)}`);
  }
  if (ctx.projectDescription) {
    lines.push(`  Description: ${ctx.projectDescription}`);
  }

  lines.push(`  Agent: ${ctx.activeAgentSlug}`);
  lines.push(`  Capabilities: ${ctx.capabilities.connectionSummary}`);
  lines.push("");
  lines.push("MOBILE APPLICATION (this repo also contains a mobile app):");
  lines.push("  Path: packages/litt-companion");
  lines.push("  Framework: Expo React Native (SDK 57, RN 0.86)");
  lines.push("  Router: Expo Router");
  lines.push("  Primary platform: Android");
  lines.push("  Backend: https://litlabs.net");
  lines.push("  Validation command: pnpm mobile:check");
  lines.push("  Instructions: packages/litt-companion/LITT_MOBILE.md");

  return lines.join("\n");
}
