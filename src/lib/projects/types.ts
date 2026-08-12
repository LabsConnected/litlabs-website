/**
 * Canonical Project types.
 *
 * These types represent the unified Project model used by new code.
 * The `studio_projects` table is the canonical store. The legacy
 * `projects` table is read via a compatibility mapper but not written
 * to by new code.
 */

export type ProjectSourceType = "github" | "blank" | "template";
export type ProjectAccessMode = "private" | "shared";
export type WorkspaceStatus =
  | "not_prepared"
  | "provisioning"
  | "preparing"
  | "ready"
  | "failed"
  | "error"
  | "stopped";
export type RuntimeStatus = "stopped" | "starting" | "ready" | "failed";

/** Template identifiers for blank project creation. */
export type ProjectTemplateId = "blank-static" | "nextjs" | "react-vite" | "expo-react-native";

export interface CanonicalProject {
  id: string;
  userId: string;
  name: string;
  slug: string;
  sourceType: ProjectSourceType;
  accessMode: ProjectAccessMode;
  templateId: string | null;

  // GitHub fields (nullable for blank/template projects)
  githubInstallationId: number | null;
  githubRepositoryId: number | null;
  githubOwner: string | null;
  githubRepo: string | null;
  githubFullName: string | null;
  githubDefaultBranch: string | null;
  githubBranch: string | null;
  latestCommitSha: string | null;

  // Workspace fields
  workspaceId: string | null;
  workspaceStatus: WorkspaceStatus;
  workspaceRoot: string | null;
  workspaceError: string | null;
  workspacePreparedAt: string | null;

  // Runtime fields
  runtimeStatus: RuntimeStatus;
  previewUrl: string | null;
  runtimeError: string | null;

  // Metadata
  framework: string | null;
  packageManager: string | null;
  rootDirectory: string;
  developmentCommand: string | null;
  buildCommand: string | null;
  testCommand: string | null;
  installCommand: string | null;

  // LiTT Creation Workspace type (website, html, game2d, game3d, app, component)
  // Separate from framework — framework is for runtime technology (static, nextjs, vite, expo)
  workspaceType: string;

  createdAt: string;
  updatedAt: string;
}

/** Row shape from the studio_projects table. */
export interface StudioProjectRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  source_type: ProjectSourceType;
  access_mode: ProjectAccessMode;
  template_id: string | null;
  github_installation_id: number | null;
  github_repository_id: number | null;
  github_owner: string | null;
  github_repo: string | null;
  github_full_name: string | null;
  github_default_branch: string | null;
  github_branch: string | null;
  latest_commit_sha: string | null;
  workspace_id: string | null;
  workspace_status: WorkspaceStatus;
  workspace_root: string | null;
  workspace_error: string | null;
  workspace_prepared_at: string | null;
  runtime_status: RuntimeStatus;
  preview_url: string | null;
  runtime_error: string | null;
  framework: string | null;
  package_manager: string | null;
  root_directory: string;
  development_command: string | null;
  build_command: string | null;
  test_command: string | null;
  install_command: string | null;
  workspace_type: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape from the legacy projects table. */
export interface LegacyProjectRow {
  id: string;
  user_id: string;
  github_installation_id: number;
  repository_id: number;
  owner: string;
  repository: string;
  default_branch: string;
  working_branch: string;
  workspace_id: string | null;
  vercel_project_id: string | null;
  status: string;
  connection_status: string;
  connection_error: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  selected_branch: string | null;
  repository_full_name: string | null;
  repository_html_url: string | null;
  repository_private: boolean;
  created_at: string;
  updated_at: string;
}

/** Convert a studio_projects row to the canonical shape. */
export function rowToCanonical(row: StudioProjectRow): CanonicalProject {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    sourceType: row.source_type,
    accessMode: row.access_mode,
    templateId: row.template_id,
    githubInstallationId: row.github_installation_id,
    githubRepositoryId: row.github_repository_id,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    githubFullName: row.github_full_name,
    githubDefaultBranch: row.github_default_branch,
    githubBranch: row.github_branch,
    latestCommitSha: row.latest_commit_sha,
    workspaceId: row.workspace_id,
    workspaceStatus: row.workspace_status,
    workspaceRoot: row.workspace_root,
    workspaceError: row.workspace_error,
    workspacePreparedAt: row.workspace_prepared_at,
    runtimeStatus: row.runtime_status,
    previewUrl: row.preview_url,
    runtimeError: row.runtime_error,
    framework: row.framework,
    packageManager: row.package_manager,
    rootDirectory: row.root_directory,
    developmentCommand: row.development_command,
    buildCommand: row.build_command,
    testCommand: row.test_command,
    installCommand: row.install_command,
    workspaceType: row.workspace_type ?? "website",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Convert a legacy projects row to the canonical shape (compatibility). */
export function legacyRowToCanonical(row: LegacyProjectRow): CanonicalProject {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.repository_full_name || row.repository,
    slug: row.repository,
    sourceType: "github",
    accessMode: "private",
    templateId: null,
    githubInstallationId: row.github_installation_id,
    githubRepositoryId: row.repository_id,
    githubOwner: row.owner,
    githubRepo: row.repository,
    githubFullName: row.repository_full_name,
    githubDefaultBranch: row.default_branch,
    githubBranch: row.working_branch,
    latestCommitSha: null,
    workspaceId: row.workspace_id,
    workspaceStatus: "not_prepared",
    workspaceRoot: null,
    workspaceError: null,
    workspacePreparedAt: null,
    runtimeStatus: "stopped",
    previewUrl: null,
    runtimeError: null,
    framework: null,
    packageManager: null,
    rootDirectory: ".",
    developmentCommand: null,
    buildCommand: null,
    testCommand: null,
    installCommand: null,
    workspaceType: "website",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Input for creating a blank project. */
export interface CreateBlankProjectInput {
  userId: string;
  name: string;
  templateId: ProjectTemplateId;
  accessMode?: ProjectAccessMode;
}

/** Input for creating a GitHub-backed project. */
export interface CreateGithubProjectInput {
  userId: string;
  name: string;
  slug: string;
  githubInstallationId: number;
  githubRepositoryId: number;
  githubOwner: string;
  githubRepo: string;
  githubFullName: string;
  githubDefaultBranch?: string;
  githubBranch?: string;
  accessMode?: ProjectAccessMode;
}

export type CreateProjectInput = CreateBlankProjectInput | CreateGithubProjectInput;

/** Result of a project operation. */
export interface ProjectResult {
  project: CanonicalProject;
}

export interface ProjectListResult {
  projects: CanonicalProject[];
  /** Projects from the legacy table that don't exist in studio_projects yet. */
  legacyOnly: CanonicalProject[];
}
