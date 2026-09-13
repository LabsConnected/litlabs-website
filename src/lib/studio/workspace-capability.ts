/**
 * Workspace capability classification.
 *
 * A static workspace with no repository has no git, no package manager and
 * no toolchain — by design, not by defect. Running repo-only or
 * toolchain-only checks there produces failures that describe the workspace
 * type, not the project's health, and LiTT then reports them as project
 * failures ("tsc is broken", "ESLint config missing", "git is not
 * installed") and proposes installs and config rewrites for a workspace
 * that never wanted them.
 *
 * Checks that cannot apply are classified NOT APPLICABLE, never FAILED.
 */

/** The subset of project fields that determine workspace capability. */
export interface WorkspaceShape {
  /** Runtime technology: static, nextjs, vite, expo. */
  framework: string | null;
  /** pnpm, npm, yarn, or "none". */
  packageManager: string | null;
  /** owner/repo when a repository is connected. */
  githubFullName: string | null;
  sourceType: "github" | "blank" | "template" | "upload" | null;
}

export type Applicability = "applicable" | "not_applicable";

/** Tools that require a git repository to mean anything. */
const REPO_ONLY_TOOLS = new Set([
  "git_status",
  "git_diff",
  "git_log",
  "create_branch",
  "commit_changes",
  "push_branch",
  "create_pull_request",
  "create_checkpoint",
  "restore_checkpoint",
  "apply_patch",
  "github_list_pull_requests",
  "github_read_file",
]);

/** A real package manager, i.e. a runnable JS toolchain. */
function hasToolchain(workspace: WorkspaceShape): boolean {
  const pm = workspace.packageManager;
  return pm === "pnpm" || pm === "npm" || pm === "yarn";
}

/** Whether a git repository backs this workspace. */
export function hasRepository(workspace: WorkspaceShape): boolean {
  return !!workspace.githubFullName;
}

/**
 * Whether this is a static workspace: plain files served as-is, with no
 * build toolchain. Intentional, not broken.
 */
export function isStaticWorkspace(workspace: WorkspaceShape): boolean {
  return workspace.framework === "static" || !hasToolchain(workspace);
}

/**
 * Whether a predefined check (typecheck, lint, test, build) can apply.
 *
 * These depend on a package manager, not on a repository — a template
 * project with pnpm and no repo can genuinely run them.
 */
export function checkApplicability(workspace: WorkspaceShape, _checkId: string): Applicability {
  return hasToolchain(workspace) ? "applicable" : "not_applicable";
}

/** Whether a repo-only tool can apply. */
export function repoOnlyToolApplicability(workspace: WorkspaceShape, toolId: string): Applicability {
  if (!REPO_ONLY_TOOLS.has(toolId)) return "applicable";
  return hasRepository(workspace) ? "applicable" : "not_applicable";
}

/**
 * Why a check or tool does not apply — phrased as a property of the
 * workspace, never as a defect and never as a remediation proposal.
 */
export function notApplicableReason(workspace: WorkspaceShape, id: string): string {
  if (REPO_ONLY_TOOLS.has(id)) {
    return `Not applicable: this workspace has no repository, so "${id}" has nothing to operate on.`;
  }
  return `Not applicable: this is a static workspace with no package manager, so "${id}" is not part of it.`;
}

/**
 * A one-line capability statement for the LLM's runtime context, so the
 * model never reports an absent toolchain as a project failure.
 */
export function capabilityNotice(workspace: WorkspaceShape): string | null {
  const staticWorkspace = isStaticWorkspace(workspace);
  const repo = hasRepository(workspace);
  if (!staticWorkspace && repo) return null;

  const parts: string[] = [];
  if (!repo) parts.push("no repository (git tooling is not applicable)");
  if (staticWorkspace) parts.push("no package manager (typecheck, lint, test and build are not applicable)");
  return `WORKSPACE TYPE: static — ${parts.join("; ")}. These are properties of the workspace, NOT failures. Do not report them as project errors and do not propose installing Git or TypeScript or rewriting an ESLint config.`;
}
