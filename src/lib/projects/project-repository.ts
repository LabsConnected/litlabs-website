/**
 * Canonical Project Repository.
 *
 * Server-side service for all Project operations. New code should use
 * this instead of querying `projects` or `studio_projects` directly.
 *
 * - studio_projects is the canonical table (supports blank + GitHub projects)
 * - projects (legacy) is read-only here, surfaced via compatibility mapping
 * - Neither table is dropped or destructively migrated
 */

import { supabaseAdmin } from "@/lib/supabase";
import type { StudioProjectRow, LegacyProjectRow } from "./types";
import {
  rowToCanonical,
  legacyRowToCanonical,
  type CanonicalProject,
  type CreateBlankProjectInput,
  type CreateGithubProjectInput,
  type ProjectListResult,
  type ProjectTemplateId,
} from "./types";

const TABLE = "studio_projects";
const LEGACY_TABLE = "projects";

/** Templates with their default file structure and commands. */
export const PROJECT_TEMPLATES: Record<
  ProjectTemplateId,
  {
    label: string;
    description: string;
    framework: string;
    packageManager: string;
    installCommand: string;
    developmentCommand: string;
    buildCommand: string;
    testCommand: string;
  }
> = {
  "blank-static": {
    label: "Blank Static Site",
    description: "A single index.html with minimal CSS. No build step.",
    framework: "static",
    packageManager: "none",
    installCommand: "",
    developmentCommand: "",
    buildCommand: "",
    testCommand: "",
  },
  nextjs: {
    label: "Next.js Application",
    description: "Next.js 16 with React 19, Tailwind CSS, TypeScript.",
    framework: "nextjs",
    packageManager: "pnpm",
    installCommand: "pnpm install",
    developmentCommand: "pnpm dev",
    buildCommand: "pnpm build",
    testCommand: "pnpm test",
  },
  "react-vite": {
    label: "React + Vite",
    description: "React 19 with Vite, TypeScript, Tailwind CSS.",
    framework: "vite",
    packageManager: "pnpm",
    installCommand: "pnpm install",
    developmentCommand: "pnpm dev",
    buildCommand: "pnpm build",
    testCommand: "pnpm test",
  },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Create a blank (non-GitHub) project in the canonical studio_projects table.
 */
export async function createBlankProject(
  input: CreateBlankProjectInput,
): Promise<CanonicalProject> {
  const template = PROJECT_TEMPLATES[input.templateId];
  if (!template) {
    throw new Error(`Unknown template: ${input.templateId}`);
  }

  const slug = slugify(input.name) || `project-${Date.now()}`;

  const insert: Record<string, unknown> = {
    user_id: input.userId,
    name: input.name,
    slug,
    source_type: "blank",
    access_mode: input.accessMode ?? "private",
    template_id: input.templateId,
    github_installation_id: null,
    github_repository_id: null,
    github_owner: null,
    github_repo: null,
    github_full_name: null,
    github_default_branch: null,
    github_branch: null,
    framework: template.framework,
    package_manager: template.packageManager,
    root_directory: ".",
    development_command: template.developmentCommand || null,
    build_command: template.buildCommand || null,
    test_command: template.testCommand || null,
    install_command: template.installCommand || null,
    workspace_status: "not_prepared",
    runtime_status: "stopped",
  };

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert(insert)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create project: ${error?.message ?? "unknown error"}`);
  }

  return rowToCanonical(data as StudioProjectRow);
}

/**
 * Create a GitHub-backed project in the canonical studio_projects table.
 * Does NOT touch the legacy `projects` table.
 */
export async function createGithubProject(
  input: CreateGithubProjectInput,
): Promise<CanonicalProject> {
  const slug = input.slug || slugify(input.githubRepo);

  const insert: Record<string, unknown> = {
    user_id: input.userId,
    name: input.name,
    slug,
    source_type: "github",
    access_mode: input.accessMode ?? "private",
    template_id: null,
    github_installation_id: input.githubInstallationId,
    github_repository_id: input.githubRepositoryId,
    github_owner: input.githubOwner,
    github_repo: input.githubRepo,
    github_full_name: input.githubFullName,
    github_default_branch: input.githubDefaultBranch ?? "main",
    github_branch: input.githubBranch ?? "main",
    workspace_status: "not_prepared",
    runtime_status: "stopped",
  };

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert(insert)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create project: ${error?.message ?? "unknown error"}`);
  }

  return rowToCanonical(data as StudioProjectRow);
}

/**
 * Get a single canonical project by ID.
 * Checks studio_projects first, then falls back to legacy projects table.
 * Verifies ownership.
 */
export async function getProject(
  projectId: string,
  userId: string,
): Promise<CanonicalProject | null> {
  // Check canonical table first
  const { data: studioRow } = await supabaseAdmin
    .from(TABLE)
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (studioRow) {
    return rowToCanonical(studioRow as StudioProjectRow);
  }

  // Fall back to legacy table
  const { data: legacyRow } = await supabaseAdmin
    .from(LEGACY_TABLE)
    .select("*")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (legacyRow) {
    return legacyRowToCanonical(legacyRow as LegacyProjectRow);
  }

  return null;
}

/**
 * List all projects for a user.
 * Returns canonical projects from studio_projects plus any legacy-only
 * projects that don't have a studio_projects counterpart.
 */
export async function listProjects(userId: string): Promise<ProjectListResult> {
  // Fetch from both tables in parallel
  const [studioResult, legacyResult] = await Promise.all([
    supabaseAdmin
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabaseAdmin
      .from(LEGACY_TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
  ]);

  const studioProjects = (studioResult.data ?? []) as StudioProjectRow[];
  const legacyProjects = (legacyResult.data ?? []) as LegacyProjectRow[];

  // Build a set of GitHub repo IDs that exist in studio_projects
  // so we can identify legacy-only projects
  const studioGithubRepoIds = new Set(
    studioProjects
      .filter((p) => p.github_repository_id !== null)
      .map((p) => p.github_repository_id),
  );

  const canonical = studioProjects.map(rowToCanonical);
  const legacyOnly = legacyProjects
    .filter((p) => !studioGithubRepoIds.has(p.repository_id))
    .map(legacyRowToCanonical);

  return { projects: canonical, legacyOnly };
}

/**
 * Update workspace fields on a canonical project.
 * Only operates on studio_projects — does not modify legacy table.
 */
export async function updateProjectWorkspace(
  projectId: string,
  userId: string,
  updates: {
    workspaceId?: string;
    workspaceStatus?: string;
    workspaceRoot?: string | null;
    workspaceError?: string | null;
    workspacePreparedAt?: string;
  },
): Promise<CanonicalProject | null> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.workspaceId !== undefined) update.workspace_id = updates.workspaceId;
  if (updates.workspaceStatus !== undefined) update.workspace_status = updates.workspaceStatus;
  if (updates.workspaceRoot !== undefined) update.workspace_root = updates.workspaceRoot;
  if (updates.workspaceError !== undefined) update.workspace_error = updates.workspaceError;
  if (updates.workspacePreparedAt !== undefined)
    update.workspace_prepared_at = updates.workspacePreparedAt;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(update)
    .eq("id", projectId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return rowToCanonical(data as StudioProjectRow);
}

/**
 * Update runtime fields on a canonical project.
 */
export async function updateProjectRuntime(
  projectId: string,
  userId: string,
  updates: {
    runtimeStatus?: string;
    previewUrl?: string | null;
    runtimeError?: string | null;
  },
): Promise<CanonicalProject | null> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.runtimeStatus !== undefined) update.runtime_status = updates.runtimeStatus;
  if (updates.previewUrl !== undefined) update.preview_url = updates.previewUrl;
  if (updates.runtimeError !== undefined) update.runtime_error = updates.runtimeError;

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(update)
    .eq("id", projectId)
    .eq("user_id", userId)
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return rowToCanonical(data as StudioProjectRow);
}

/**
 * Delete a canonical project. Only deletes from studio_projects.
 * Does NOT delete from the legacy projects table.
 * Returns false if the project doesn't exist or doesn't belong to the user.
 *
 * The delete is ownership-scoped: the WHERE clause requires both the
 * project ID and the authenticated user ID to match. If no owned row is
 * deleted, returns false — callers should respond with a generic 404 so
 * a foreign user cannot determine whether the project exists.
 */
export async function deleteProject(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("id", projectId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) return false;
  return data !== null;
}

/**
 * Verify that a user owns a project and that the project has a ready workspace.
 * Throws with a specific code if verification fails.
 */
export async function verifyProjectWorkspace(
  projectId: string,
  userId: string,
): Promise<{ project: CanonicalProject; workspaceId: string; workspaceRoot: string }> {
  const project = await getProject(projectId, userId);
  if (!project) {
    throw new ProjectVerificationError("Project not found", "PROJECT_NOT_FOUND");
  }
  if (project.userId !== userId) {
    throw new ProjectVerificationError("Forbidden", "FORBIDDEN");
  }
  if (!project.workspaceId) {
    throw new ProjectVerificationError(
      "Workspace not provisioned",
      "WORKSPACE_NOT_PROVISIONED",
    );
  }
  if (project.workspaceStatus !== "ready") {
    throw new ProjectVerificationError(
      `Workspace not ready (current: ${project.workspaceStatus})`,
      "WORKSPACE_NOT_READY",
    );
  }
  if (!project.workspaceRoot) {
    throw new ProjectVerificationError(
      "Workspace root missing",
      "WORKSPACE_ROOT_MISSING",
    );
  }
  return {
    project,
    workspaceId: project.workspaceId,
    workspaceRoot: project.workspaceRoot,
  };
}

export class ProjectVerificationError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "ProjectVerificationError";
  }
}
