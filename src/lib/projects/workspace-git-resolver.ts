/**
 * Workspace Git Resolver — reads git state from the ACTUAL workspace filesystem.
 *
 * This is the canonical way to resolve HEAD SHA, branch, and base SHA for a
 * workspace. It does NOT read from stale DB metadata — it runs git commands
 * against the workspace root directory.
 *
 * Used by /api/project-runtime to populate ProjectRuntimeState.headSha/baseSha.
 *
 * Phase 3 — Studio Control Plane V1
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export interface WorkspaceGitState {
  /** HEAD commit SHA, or null if not a git repo / unreadable */
  headSha: string | null;
  /** Current branch name, or null if detached/not a git repo */
  branch: string | null;
  /** The merge-base of HEAD and the default branch (e.g. main), or null.
   *  Used to compute the diff range for the Changes tab.
   *  For projects where HEAD IS the default branch, baseSha === headSha. */
  baseSha: string | null;
  /** True if the workspace root contains a .git directory */
  isGitRepo: boolean;
}

const NULL_SHA: WorkspaceGitState = {
  headSha: null,
  branch: null,
  baseSha: null,
  isGitRepo: false,
};

/**
 * Resolve git state from the workspace filesystem.
 *
 * @param workspaceRoot Absolute path to the workspace root directory
 * @param defaultBranch The project's default branch (e.g. "main"), used to
 *                      compute baseSha. If null, baseSha falls back to headSha.
 * @returns WorkspaceGitState, or NULL_SHA if not a git repo
 */
export function resolveWorkspaceGit(
  workspaceRoot: string | null,
  defaultBranch?: string | null,
): WorkspaceGitState {
  if (!workspaceRoot) return NULL_SHA;

  // Verify the workspace root exists and is a git repo
  if (!existsSync(workspaceRoot)) return NULL_SHA;
  if (!existsSync(join(workspaceRoot, ".git"))) return NULL_SHA;

  const headSha = safeGit("rev-parse HEAD", workspaceRoot);
  if (!headSha) return NULL_SHA;

  const branch = safeGit("rev-parse --abbrev-ref HEAD", workspaceRoot);
  // "HEAD" means detached HEAD — normalize to null
  const normalizedBranch = branch === "HEAD" ? null : branch;

  // Compute baseSha: merge-base of HEAD and the default branch.
  // If HEAD IS the default branch (or no defaultBranch given), baseSha = headSha.
  let baseSha = headSha;
  if (defaultBranch && normalizedBranch && normalizedBranch !== defaultBranch) {
    const mergeBase = safeGit(
      `merge-base HEAD origin/${defaultBranch}`,
      workspaceRoot,
    ) ?? safeGit(`merge-base HEAD ${defaultBranch}`, workspaceRoot);
    if (mergeBase) {
      baseSha = mergeBase;
    }
  }

  return {
    headSha,
    branch: normalizedBranch,
    baseSha,
    isGitRepo: true,
  };
}

/**
 * Run a git command in the workspace directory with a timeout.
 * Returns trimmed stdout, or null on any error.
 */
function safeGit(args: string, cwd: string): string | null {
  try {
    const result = execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}
