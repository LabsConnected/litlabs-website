/**
 * Project state — canonical branch detection.
 *
 * ONE helper for branch truth. Called from:
 *   - startup (app.tsx)
 *   - chat submit (controller.ts)
 *   - mission submit (controller.ts)
 *   - git-changing slash commands (controller.ts)
 *
 * Same cwd. Same behavior. Same error handling. Same detached-HEAD
 * fallback. app.tsx consumes project truth — it does not implement
 * Git detection.
 *
 * Behavior:
 *   1. `git branch --show-current` — returns the branch name when on a branch.
 *   2. If empty (detached HEAD), fall back to `git rev-parse --short HEAD`
 *      and return `DETACHED · a1b2c3d`.
 *   3. On any failure (not a git repo, git not installed, timeout), return
 *      the previous known branch so the header never goes blank.
 */

import { execSync } from "child_process";

export interface BranchRefreshResult {
  /** The branch display string (e.g. "feat/x", "DETACHED · a1b2c3d"). */
  branch: string;
  /** Whether the branch was successfully refreshed from git. */
  refreshed: boolean;
  /** Whether we're in detached HEAD state. */
  detached: boolean;
}

/**
 * Refresh the git branch from the given cwd.
 *
 * @param cwd - the working directory to run git in (must match tool cwd)
 * @param previousBranch - the previously known branch, used as fallback on failure
 * @returns BranchRefreshResult — always returns a non-empty branch string
 */
export function refreshProjectBranch(
  cwd: string,
  previousBranch: string = "unknown",
): BranchRefreshResult {
  try {
    const branch = execSync("git branch --show-current", {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (branch) {
      return { branch, refreshed: true, detached: false };
    }

    // Empty output → detached HEAD. Fall back to short SHA.
    try {
      const shortSha = execSync("git rev-parse --short HEAD", {
        cwd,
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (shortSha) {
        return {
          branch: `DETACHED · ${shortSha}`,
          refreshed: true,
          detached: true,
        };
      }
    } catch {
      // rev-parse also failed — fall through to previousBranch
    }

    // Both commands returned empty — keep previous
    return { branch: previousBranch, refreshed: false, detached: false };
  } catch {
    // git not available, not a git repo, or timeout — preserve previous
    return { branch: previousBranch, refreshed: false, detached: false };
  }
}

/**
 * Apply a branch refresh to the cockpit store.
 *
 * This is the canonical wrapper that all call sites use. It only updates
 * the store when the refresh succeeded, preserving the previous known
 * branch on failure.
 *
 * @param cwd - the working directory to run git in
 * @param setBranch - the store's setBranch action
 * @param previousBranch - the current branch in the store
 * @returns the refreshed branch string (or previousBranch if refresh failed)
 */
export function applyBranchRefresh(
  cwd: string,
  setBranch: (branch: string) => void,
  previousBranch: string,
): string {
  const result = refreshProjectBranch(cwd, previousBranch);
  if (result.refreshed) {
    setBranch(result.branch);
    return result.branch;
  }
  // On failure, preserve the previous known branch — don't blank the header.
  return previousBranch;
}
