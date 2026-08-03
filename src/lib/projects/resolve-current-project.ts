/**
 * Shared server helper to resolve the authenticated user's current project.
 *
 * Resolution order:
 * 1. Explicit project ID (from URL selection or canonical store)
 * 2. Most recently updated studio_projects row
 * 3. Most recently updated legacy projects row
 * 4. null
 *
 * This is the single source of truth for project identity across
 * /api/capabilities, useConnectionSummary, and useCanonicalConversation.
 */

import { supabaseAdmin } from "@/lib/supabase";
import type { StudioProjectRow, LegacyProjectRow } from "./types";

export interface CurrentProject {
  projectId: string;
  projectName: string;
  source: "studio_projects" | "projects";
  sourceType: "github" | "blank" | "template";
  repositoryFullName: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  defaultBranch: string | null;
  activeBranch: string | null;
  workspaceStatus: string | null;
}

interface ResolveOptions {
  /** Explicit project ID from URL or canonical selection */
  explicitProjectId?: string | null;
  /** Authenticated user ID */
  userId: string;
}

/**
 * Resolve the current project for a user.
 * Returns null if no project is found.
 * Logs errors instead of silently swallowing them.
 */
export async function resolveCurrentProject({
  explicitProjectId,
  userId,
}: ResolveOptions): Promise<CurrentProject | null> {
  // 1. Try explicit project ID first
  if (explicitProjectId) {
    const explicit = await resolveById(explicitProjectId, userId);
    if (explicit) return explicit;
    // Fall through to auto-resolution if explicit ID is invalid
  }

  // 2. Most recently updated studio_projects row
  const studioProject = await resolveLatestStudioProject(userId);
  if (studioProject) return studioProject;

  // 3. Most recently updated legacy projects row
  const legacyProject = await resolveLatestLegacyProject(userId);
  if (legacyProject) return legacyProject;

  return null;
}

async function resolveById(
  projectId: string,
  userId: string,
): Promise<CurrentProject | null> {
  // Check studio_projects first
  const { data: studioRow, error: studioErr } = await supabaseAdmin
    .from("studio_projects")
    .select("id, user_id, name, github_full_name, github_owner, github_repo, github_default_branch, github_branch, workspace_status, source_type, updated_at")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (studioErr) {
    console.error("[resolveCurrentProject] studio_projects by-id error:", {
      table: "studio_projects",
      code: studioErr.code,
      message: studioErr.message,
      userIdHash: hashUserId(userId),
    });
  }

  if (studioRow) {
    return normalizeStudioRow(studioRow as StudioProjectRow);
  }

  // Fall back to legacy projects — do NOT select `name` (not in schema)
  const { data: legacyRow, error: legacyErr } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, repository, repository_full_name, owner, default_branch, working_branch, connection_status, status, updated_at")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (legacyErr) {
    console.error("[resolveCurrentProject] projects by-id error:", {
      table: "projects",
      code: legacyErr.code,
      message: legacyErr.message,
      userIdHash: hashUserId(userId),
    });
  }

  if (legacyRow) {
    return normalizeLegacyRow(legacyRow as LegacyProjectRow);
  }

  return null;
}

async function resolveLatestStudioProject(
  userId: string,
): Promise<CurrentProject | null> {
  const { data, error } = await supabaseAdmin
    .from("studio_projects")
    .select("id, user_id, name, github_full_name, github_owner, github_repo, github_default_branch, github_branch, workspace_status, source_type, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[resolveCurrentProject] studio_projects latest error:", {
      table: "studio_projects",
      code: error.code,
      message: error.message,
      userIdHash: hashUserId(userId),
    });
    return null;
  }

  if (data && data.length > 0) {
    return normalizeStudioRow(data[0] as StudioProjectRow);
  }

  return null;
}

async function resolveLatestLegacyProject(
  userId: string,
): Promise<CurrentProject | null> {
  // IMPORTANT: Do NOT select `name` from the legacy projects table.
  // That column is not part of the original projects schema.
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, user_id, repository, repository_full_name, owner, default_branch, working_branch, connection_status, status, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[resolveCurrentProject] projects latest error:", {
      table: "projects",
      code: error.code,
      message: error.message,
      userIdHash: hashUserId(userId),
    });
    return null;
  }

  if (data && data.length > 0) {
    return normalizeLegacyRow(data[0] as LegacyProjectRow);
  }

  return null;
}

function normalizeStudioRow(row: StudioProjectRow): CurrentProject {
  return {
    projectId: row.id,
    projectName: row.name,
    source: "studio_projects",
    sourceType: row.source_type,
    repositoryFullName: row.github_full_name ?? null,
    repositoryOwner: row.github_owner ?? null,
    repositoryName: row.github_repo ?? null,
    defaultBranch: row.github_default_branch ?? row.github_branch ?? null,
    activeBranch: row.github_branch ?? row.github_default_branch ?? null,
    workspaceStatus: row.workspace_status ?? null,
  };
}

function normalizeLegacyRow(row: LegacyProjectRow): CurrentProject {
  return {
    projectId: row.id,
    projectName: row.repository_full_name || row.repository,
    source: "projects",
    sourceType: "github",
    repositoryFullName: row.repository_full_name ?? null,
    repositoryOwner: row.owner ?? null,
    repositoryName: row.repository ?? null,
    defaultBranch: row.default_branch ?? row.working_branch ?? null,
    activeBranch: row.working_branch ?? row.default_branch ?? null,
    workspaceStatus: row.connection_status ?? row.status ?? null,
  };
}

function hashUserId(userId: string): string {
  // Simple hash for logging — not for security
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return `u_${Math.abs(hash).toString(36)}`;
}
