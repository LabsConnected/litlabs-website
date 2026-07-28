/**
 * Consolidated chat context builder for LiTT.
 *
 * This is the single server-side function that all chat routes should call
 * to build the full context block injected into LLM prompts. It:
 *   1. Fetches project details from both `projects` and `studio_projects` tables
 *   2. Merges them into a unified ProjectInfo
 *   3. Calls getStudioContext for capability/repo connection state
 *   4. Returns a structured ChatContextResult
 *
 * This replaces the scattered fetchProjectDetails / getStudioContext calls
 * that were duplicated across /api/gemini/chat and /api/agents/chat.
 */

import { getSupabaseAdmin } from "@/lib/supabase";
import { getStudioContext, buildCapabilityContextForChat } from "@/lib/capabilities/studio-context";
import type { ProjectInfo } from "@/lib/litt-kernel";

export interface ChatContextResult {
  projectInfo?: ProjectInfo;
  projectId: string | null;
  capabilityContextBlock: string;
  repoName: string | null;
}

/**
 * Build the full chat context for a user.
 *
 * @param userId       Clerk user ID
 * @param hints        Optional hints from the frontend (projectId, repoName)
 * @returns            ChatContextResult with project info, capability block, etc.
 */
export async function buildChatContext(
  userId: string | null,
  hints?: {
    projectId?: string | null;
    repositoryName?: string | null;
  },
): Promise<ChatContextResult> {
  const empty: ChatContextResult = {
    projectInfo: undefined,
    projectId: hints?.projectId ?? null,
    capabilityContextBlock: "",
    repoName: null,
  };

  if (!userId) return empty;

  try {
    // 1. Get studio context (repo connection, terminal, etc.)
    const studioCtx = await getStudioContext(userId);
    const repoName = hints?.repositoryName ?? studioCtx.repositoryName ?? null;
    const capabilityContextBlock = buildCapabilityContextForChat(studioCtx);

    // 2. Fetch project details from Supabase
    const projectInfo = await fetchProjectDetails(userId, repoName, hints?.projectId);

    return {
      projectInfo,
      projectId: projectInfo?.id ?? hints?.projectId ?? null,
      capabilityContextBlock,
      repoName,
    };
  } catch {
    return empty;
  }
}

/**
 * Fetch project details from both `projects` and `studio_projects` tables,
 * merging into a unified ProjectInfo.
 *
 * - `projects` table: has name, repository_full_name, description, tech_stack,
 *   goals, owner, repository, default_branch, working_branch, selected_branch
 * - `studio_projects` table: has github_owner, github_repo, github_full_name,
 *   github_default_branch, github_branch, framework, package_manager, name
 */
async function fetchProjectDetails(
  userId: string,
  repoName?: string | null,
  projectId?: string | null,
): Promise<ProjectInfo | undefined> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return undefined;

    // Query the legacy `projects` table (has description, tech_stack, goals)
    let query = admin
      .from("projects")
      .select(
        "id, name, repository_full_name, description, tech_stack, goals, owner, repository, default_branch, working_branch, selected_branch",
      )
      .eq("user_id", userId);

    if (repoName) {
      query = query.eq("repository_full_name", repoName);
    }

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      // Fallback: try studio_projects table
      return await fetchStudioProjectDetails(userId, repoName, projectId);
    }

    const p = data[0];

    // Try to enrich with studio_projects data (framework, github_owner, etc.)
    const studioData = await fetchStudioProjectDetails(userId, p.repository_full_name, p.id);

    return {
      id: p.id,
      name: p.name || studioData?.name,
      repoUrl: p.repository_full_name || studioData?.repoUrl,
      description: p.description,
      stack: p.tech_stack || studioData?.stack,
      goals: p.goals,
      branch: p.selected_branch || p.working_branch || p.default_branch || studioData?.branch,
      framework: studioData?.framework,
      language: studioData?.language,
      repoOwner: p.owner || studioData?.repoOwner,
    };
  } catch {
    return undefined;
  }
}

/**
 * Fetch from the `studio_projects` table (has framework, github_owner, etc.)
 */
async function fetchStudioProjectDetails(
  userId: string,
  repoName?: string | null,
  projectId?: string | null,
): Promise<ProjectInfo | undefined> {
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return undefined;

    let query = admin
      .from("studio_projects")
      .select(
        "id, name, github_owner, github_repo, github_full_name, github_default_branch, github_branch, framework, package_manager",
      )
      .eq("user_id", userId);

    if (projectId && !repoName) {
      query = query.eq("id", projectId);
    } else if (repoName) {
      query = query.eq("github_full_name", repoName);
    }

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) return undefined;

    const p = data[0];
    return {
      id: p.id,
      name: p.name,
      repoUrl: p.github_full_name,
      stack: p.framework,
      branch: p.github_branch || p.github_default_branch,
      framework: p.framework,
      repoOwner: p.github_owner,
    };
  } catch {
    return undefined;
  }
}
