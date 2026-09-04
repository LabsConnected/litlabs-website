/**
 * Canonical Main Protection — P0-1.
 *
 * Prevents silent feature-branch checkout inside the canonical main worktree.
 *
 * Observed real failure:
 *   E:\LiTT\Worktrees\main was changed from branch `main` to
 *   `test/billing-state-machine-v2` while Larry was actively using LiTT.
 *
 * Contract:
 *   - Detect the canonical main path (E:\LiTT\Worktrees\main by default,
 *     overridable via LITT_CANONICAL_MAIN env).
 *   - Expected branch there: `main` (overridable via LITT_CANONICAL_BRANCH).
 *   - If the cwd IS the canonical main path but the current branch != expected:
 *     → return a WORKTREE MISMATCH warning (never throw — callers display it).
 *   - Never silently checkout a feature branch inside canonical main.
 *   - PLAN mode must never switch branches.
 *   - ACT work requiring a feature branch must create/use an isolated worktree.
 *   - Any operation attempting to mutate canonical main branch state requires
 *     explicit owner approval.
 *
 * Pure functions — no React, no Ink, no side effects. Testable in node.
 */

import { resolve } from "node:path";
import { readHeadStateFromGitDir, type GitHeadState } from "./git-state.js";

/** Default canonical main worktree path. */
export const DEFAULT_CANONICAL_MAIN_PATH = "E:\\LiTT\\Worktrees\\main";

/** Default expected branch on canonical main. */
export const DEFAULT_CANONICAL_BRANCH = "main";

/** Resolve the canonical main path from env or default. */
export function getCanonicalMainPath(): string {
  return resolve(process.env.LITT_CANONICAL_MAIN ?? DEFAULT_CANONICAL_MAIN_PATH);
}

/** Resolve the expected canonical branch from env or default. */
export function getCanonicalBranch(): string {
  return process.env.LITT_CANONICAL_BRANCH ?? DEFAULT_CANONICAL_BRANCH;
}

/** Check if a given path is the canonical main worktree. */
export function isCanonicalMainPath(cwd: string): boolean {
  const canonical = getCanonicalMainPath();
  return resolve(cwd).toLowerCase() === canonical.toLowerCase();
}

/** The result of checking canonical main state. */
export interface CanonicalMainCheck {
  /** Whether the cwd is the canonical main path. */
  isCanonicalMain: boolean;
  /** The expected branch on canonical main. */
  expectedBranch: string;
  /** The actual branch found (null if not a git repo / detached). */
  actualBranch: string | null;
  /** Whether the branch matches the expected branch. */
  branchMatches: boolean;
  /** Whether the HEAD is detached (a separate concern from wrong branch). */
  isDetached: boolean;
  /** A human-readable warning if there is a mismatch (null when all good). */
  warning: string | null;
}

/**
 * Check the canonical main worktree state.
 *
 * If the cwd is NOT the canonical main path, returns { isCanonicalMain: false,
 * warning: null } — no opinion about non-canonical worktrees.
 *
 * If the cwd IS the canonical main path, reads the current branch from
 * `.git/HEAD` (no subprocess) and compares it to the expected branch.
 * When they differ, returns a loud WORKTREE MISMATCH warning.
 */
export function checkCanonicalMain(cwd: string): CanonicalMainCheck {
  const expectedBranch = getCanonicalBranch();
  const isCanonicalMain = isCanonicalMainPath(cwd);

  if (!isCanonicalMain) {
    return {
      isCanonicalMain: false,
      expectedBranch,
      actualBranch: null,
      branchMatches: false,
      isDetached: false,
      warning: null,
    };
  }

  const headState: GitHeadState = readHeadStateFromGitDir(cwd);

  if (headState.kind === "not-git") {
    return {
      isCanonicalMain: true,
      expectedBranch,
      actualBranch: null,
      branchMatches: false,
      isDetached: false,
      warning: `WORKTREE MISMATCH: ${cwd} is the canonical main path but is not a git repository.`,
    };
  }

  if (headState.kind === "detached") {
    return {
      isCanonicalMain: true,
      expectedBranch,
      actualBranch: null,
      branchMatches: false,
      isDetached: true,
      warning: `WORKTREE MISMATCH: canonical main is in detached HEAD state (${headState.commit}). Expected branch: ${expectedBranch}. Run: git switch ${expectedBranch}`,
    };
  }

  // headState.kind === "branch"
  const actualBranch = headState.branch;
  const branchMatches = actualBranch === expectedBranch;

  if (!branchMatches) {
    return {
      isCanonicalMain: true,
      expectedBranch,
      actualBranch,
      branchMatches: false,
      isDetached: false,
      warning: `WORKTREE MISMATCH: canonical main (${cwd}) is on branch "${actualBranch}" but expected "${expectedBranch}". This worktree must stay on ${expectedBranch}. Run: git switch ${expectedBranch}`,
    };
  }

  return {
    isCanonicalMain: true,
    expectedBranch,
    actualBranch,
    branchMatches: true,
    isDetached: false,
    warning: null,
  };
}

/**
 * Guard a branch-switch attempt against canonical main.
 *
 * Returns { allowed: true } when:
 *   - the cwd is NOT the canonical main path (free to switch), OR
 *   - the cwd IS canonical main AND the target branch IS the expected branch.
 *
 * Returns { allowed: false, reason } when:
 *   - the cwd IS canonical main AND the target branch is NOT the expected
 *     branch — this would silently move canonical main off `main`.
 *
 * The `ownerApproved` flag allows an explicit override when the owner has
 * confirmed the operation. This is never set automatically.
 */
export interface BranchSwitchGuard {
  allowed: boolean;
  reason: string | null;
  isCanonicalMain: boolean;
}

export function guardBranchSwitch(
  cwd: string,
  targetBranch: string,
  ownerApproved = false,
): BranchSwitchGuard {
  const check = checkCanonicalMain(cwd);

  if (!check.isCanonicalMain) {
    return { allowed: true, reason: null, isCanonicalMain: false };
  }

  // We're on canonical main. Only allow switching TO the expected branch
  // (e.g. returning to main), or any switch with explicit owner approval.
  if (targetBranch === check.expectedBranch) {
    return { allowed: true, reason: null, isCanonicalMain: true };
  }

  if (ownerApproved) {
    return {
      allowed: true,
      reason: `Owner-approved branch switch on canonical main: ${targetBranch} (expected: ${check.expectedBranch})`,
      isCanonicalMain: true,
    };
  }

  return {
    allowed: false,
    reason: `REFUSED: cannot switch canonical main (${cwd}) from "${check.expectedBranch}" to "${targetBranch}". Canonical main must stay on ${check.expectedBranch}. Use an isolated worktree for feature work. To override, set ownerApproved=true.`,
    isCanonicalMain: true,
  };
}

/**
 * Guard any mutation attempt against canonical main in PLAN mode.
 *
 * PLAN mode must NEVER mutate canonical main branch state — no checkout,
 * no branch switch, no commit, no push, no deploy.
 *
 * Returns { allowed: false, reason } when the cwd is canonical main and
 * the mode is "plan" and the operation is a mutation.
 */
export interface PlanModeGuard {
  allowed: boolean;
  reason: string | null;
}

export function guardPlanModeMutation(
  cwd: string,
  mode: "plan" | "act" | "auto",
  operation: "branch-switch" | "commit" | "push" | "deploy" | "write" | "delete",
): PlanModeGuard {
  if (mode !== "plan") {
    return { allowed: true, reason: null };
  }

  const check = checkCanonicalMain(cwd);

  if (check.isCanonicalMain) {
    return {
      allowed: false,
      reason: `PLAN mode must not ${operation} on canonical main (${cwd}). PLAN is read-only.`,
    };
  }

  // PLAN mode on a non-canonical worktree — still deny mutations per P0-6,
  // but that's enforced by the execution gateway, not here. Here we only
  // guard canonical main specifically.
  return { allowed: true, reason: null };
}
