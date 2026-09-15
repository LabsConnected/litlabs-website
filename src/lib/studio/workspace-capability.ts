/**
 * Workspace capability classification.
 *
 * Two independent axes, previously conflated:
 *
 *   TOOLCHAIN — does this workspace have a package manager? A static
 *   site has none BY DESIGN. Running typecheck/lint/test/build there
 *   produces failures that describe the workspace type, not the
 *   project's health, and LiTT then reports them as project failures
 *   ("tsc is broken", "ESLint config missing") and proposes installs
 *   and config rewrites for a workspace that never wanted them.
 *
 *   VERSION CONTROL — does this workspace have Git? Every PROVISIONED
 *   LiTT workspace does, managed ones included: prepareManagedWorkspace()
 *   runs `git init` and commits the initial tree.
 *
 * Git is NOT GitHub. This module previously answered "does Git work
 * here?" with `!!githubFullName`, which disabled git_status, git_diff,
 * create_checkpoint, restore_checkpoint, commit_changes and apply_patch
 * on every managed project — projects that have a real Git repository
 * on disk — and told the model "this workspace has no repository".
 * Only tools that genuinely talk to GitHub's API need a connected
 * repository.
 *
 * Checks that cannot apply are classified NOT APPLICABLE, never FAILED.
 */

/** The subset of project fields that determine workspace capability. */
export interface WorkspaceShape {
  /** Runtime technology: static, nextjs, vite, expo. */
  framework: string | null;
  /** pnpm, npm, yarn, or "none". */
  packageManager: string | null;
  /** owner/repo when a GitHub repository is connected. Optional. */
  githubFullName: string | null;
  sourceType: "github" | "blank" | "template" | "managed" | "upload" | null;
  /**
   * Whether the workspace has a Git repository. Managed projects do.
   * Defaults to true when omitted: a provisioned LiTT workspace is
   * always Git-backed, so the safe default is "Git works here", not
   * "no version control".
   */
  gitInitialized?: boolean;
}

export type Applicability = "applicable" | "not_applicable";

/**
 * Tools that need LOCAL Git only. These work on managed projects with
 * no GitHub connection at all — that is the entire point of managed
 * source having real Git history.
 */
const GIT_TOOLS = new Set([
  "git_status",
  "git_diff",
  "git_log",
  "create_branch",
  "commit_changes",
  "create_checkpoint",
  "restore_checkpoint",
  "apply_patch",
]);

/**
 * Tools that genuinely call the GitHub API. These — and only these —
 * require a connected GitHub repository.
 */
const GITHUB_ONLY_TOOLS = new Set([
  "push_branch",
  "create_pull_request",
  "github_list_pull_requests",
  "github_read_file",
]);

/** A real package manager, i.e. a runnable JS toolchain. */
function hasToolchain(workspace: WorkspaceShape): boolean {
  const pm = workspace.packageManager;
  return pm === "pnpm" || pm === "npm" || pm === "yarn";
}

/**
 * Whether a GitHub repository is connected.
 *
 * This answers "can we reach GitHub?", NOT "is this project under
 * version control". For the latter use hasVersionControl().
 */
export function hasGithubRepository(workspace: WorkspaceShape): boolean {
  return !!workspace.githubFullName;
}

/**
 * Whether the workspace has a Git repository.
 *
 * True for managed projects: they are `git init`-ed at provisioning.
 * Callers that know provisioning has not happened yet pass
 * gitInitialized: false explicitly.
 */
export function hasVersionControl(workspace: WorkspaceShape): boolean {
  return workspace.gitInitialized ?? true;
}

/**
 * @deprecated Ambiguous — it meant GitHub, but read as "has Git".
 * Use hasGithubRepository() or hasVersionControl() explicitly.
 */
export function hasRepository(workspace: WorkspaceShape): boolean {
  return hasGithubRepository(workspace);
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

/**
 * Whether a Git- or GitHub-scoped tool can apply.
 *
 * Git tools need a Git repository (managed projects have one).
 * GitHub tools need a connected GitHub repository.
 */
export function repoOnlyToolApplicability(workspace: WorkspaceShape, toolId: string): Applicability {
  if (GIT_TOOLS.has(toolId)) {
    return hasVersionControl(workspace) ? "applicable" : "not_applicable";
  }
  if (GITHUB_ONLY_TOOLS.has(toolId)) {
    return hasGithubRepository(workspace) ? "applicable" : "not_applicable";
  }
  return "applicable";
}

/**
 * Why a check or tool does not apply — phrased as a property of the
 * workspace, never as a defect and never as a remediation proposal.
 */
export function notApplicableReason(workspace: WorkspaceShape, id: string): string {
  if (GITHUB_ONLY_TOOLS.has(id)) {
    return `Not applicable: no GitHub repository is connected to this project, so "${id}" has no remote to operate on. The project's own Git history is unaffected — connecting GitHub is optional.`;
  }
  if (GIT_TOOLS.has(id)) {
    return `Not applicable: this workspace has not been provisioned yet, so "${id}" has no working tree to operate on.`;
  }
  return `Not applicable: this is a static workspace with no package manager, so "${id}" is not part of it.`;
}

/**
 * A one-line capability statement for the LLM's runtime context, so the
 * model never reports an absent toolchain as a project failure, and
 * never tells the user to connect GitHub in order to edit their files.
 */
export function capabilityNotice(workspace: WorkspaceShape): string | null {
  const staticWorkspace = isStaticWorkspace(workspace);
  const git = hasVersionControl(workspace);
  const github = hasGithubRepository(workspace);

  if (!staticWorkspace && git && github) return null;

  const parts: string[] = [];
  if (git && !github) {
    parts.push(
      "this project uses LiTT-managed source with its own Git repository and history — " +
        "git status, diff, log, commits and checkpoints all work. No GitHub repository is " +
        "connected, which is normal and NOT a problem: GitHub is optional publishing, not a " +
        "requirement for building. Never tell the user to connect GitHub in order to edit files",
    );
  }
  if (!git) {
    parts.push("the workspace is not provisioned yet, so Git tooling has no working tree");
  }
  if (staticWorkspace) {
    parts.push(
      "no package manager (typecheck, lint, test and build are not applicable)",
    );
  }

  return `WORKSPACE CAPABILITIES: ${parts.join("; ")}. These are properties of the workspace, NOT failures. Do not report them as project errors and do not propose installing Git or TypeScript or rewriting an ESLint config.`;
}
