/**
 * Approve Plan → Isolated ACT Workflow — P1.
 *
 * Ideal workflow:
 *   1. Larry launches LiTT from canonical main.
 *   2. PLAN: read-only audit on main.
 *   3. APPROVE PLAN.
 *   4. LiTT creates: dedicated task branch + dedicated task worktree.
 *   5. ACT runs there.
 *   6. tests → commit → push → PR → CI.
 *   7. Canonical main remains untouched.
 *   8. After merge: refresh main safely, remove task worktree.
 *
 * Pure functions — no React, no Ink. Testable in node.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { getGitState } from "./git-state.js";
import { checkCanonicalMain, guardBranchSwitch } from "./canonical-main.js";
import { acquireLease, releaseLease, checkLease, type LeaseCheck } from "./worktree-lease.js";

/** The result of creating an isolated worktree for ACT. */
export interface IsolatedWorktreeResult {
  ok: boolean;
  worktreePath: string | null;
  branch: string | null;
  message: string;
  /** Whether the worktree was newly created vs reused. */
  created: boolean;
}

/**
 * Generate a safe task branch name from a plan description.
 */
export function generateTaskBranchName(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const timestamp = Date.now().toString(36);
  return `litt/task-${slug}-${timestamp}`;
}

/**
 * Generate a worktree path for a task branch.
 * Places the worktree as a sibling of the source worktree.
 */
export function generateTaskWorktreePath(sourceWorktree: string, branchName: string): string {
  const parent = dirname(sourceWorktree);
  const shortName = branchName.replace(/^litt\//, "").replace(/[^a-z0-9-]/gi, "-");
  return join(parent, shortName);
}

/**
 * Create an isolated worktree for ACT execution.
 *
 * Steps:
 *   1. Verify the source is NOT being switched off its branch (canonical main guard).
 *   2. Generate a task branch name (or use the provided one).
 *   3. Generate a worktree path (sibling of the source).
 *   4. Create the worktree with `git worktree add -b <branch> <path>`.
 *   5. Acquire a write lease on the new worktree.
 *
 * The source worktree (canonical main) is NEVER switched off its branch.
 */
export function createIsolatedWorktree(
  sourceWorktree: string,
  planDescription: string,
  options?: {
    branchName?: string;
    worktreePath?: string;
    sessionId?: string;
  },
): IsolatedWorktreeResult {
  const gitState = getGitState(sourceWorktree);
  if (!gitState.isGitRepo) {
    return { ok: false, worktreePath: null, branch: null, message: "Source is not a git repository", created: false };
  }

  // Verify canonical main is not being switched
  const canonicalCheck = checkCanonicalMain(sourceWorktree);
  if (canonicalCheck.isCanonicalMain && !canonicalCheck.branchMatches) {
    return {
      ok: false,
      worktreePath: null,
      branch: null,
      message: `Cannot create isolated worktree: canonical main is on wrong branch "${canonicalCheck.actualBranch}". Fix canonical main first.`,
      created: false,
    };
  }

  const branch = options?.branchName ?? generateTaskBranchName(planDescription);
  const worktreePath = resolve(options?.worktreePath ?? generateTaskWorktreePath(sourceWorktree, branch));

  // Check if worktree already exists
  if (existsSync(worktreePath)) {
    // Try to acquire a lease — if it's available, reuse it
    const leaseCheck = checkLeaseSafe(worktreePath, options?.sessionId);
    if (leaseCheck.available) {
      return {
        ok: true,
        worktreePath,
        branch,
        message: `Reusing existing worktree at ${worktreePath}`,
        created: false,
      };
    }
    return {
      ok: false,
      worktreePath: null,
      branch: null,
      message: `Worktree path already exists and is in use: ${worktreePath}`,
      created: false,
    };
  }

  // Create the worktree
  try {
    execFileSync("git", ["worktree", "add", "-b", branch, worktreePath], {
      cwd: sourceWorktree,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      ok: false,
      worktreePath: null,
      branch: null,
      message: `Failed to create worktree: ${(e.stderr ?? e.message ?? "").toString().trim()}`,
      created: false,
    };
  }

  // Acquire a write lease
  if (options?.sessionId) {
    const leaseResult = acquireLease(worktreePath, branch, options.sessionId);
    if (!leaseResult.ok) {
      return {
        ok: false,
        worktreePath,
        branch,
        message: `Worktree created but lease acquisition failed: ${leaseResult.reason}`,
        created: true,
      };
    }
  }

  return {
    ok: true,
    worktreePath,
    branch,
    message: `Created isolated worktree at ${worktreePath} on branch ${branch}`,
    created: true,
  };
}

/** Safe lease check wrapper that doesn't throw. */
function checkLeaseSafe(worktreePath: string, sessionId?: string): LeaseCheck {
  try {
    return checkLease(worktreePath, sessionId);
  } catch {
    return { available: true, activeLease: null, staleLease: false, status: "available", reason: null };
  }
}

/**
 * Remove an isolated task worktree after merge.
 *
 * Steps:
 *   1. Release the write lease.
 *   2. Remove the worktree with `git worktree remove`.
 *   3. Delete the task branch (if merged).
 */
export function removeIsolatedWorktree(
  sourceWorktree: string,
  taskWorktree: string,
  branch: string,
  sessionId?: string,
): { ok: boolean; message: string } {
  // Release lease
  if (sessionId) {
    try { releaseLease(taskWorktree, sessionId); } catch { /* ignore */ }
  }

  // Remove the worktree
  try {
    execFileSync("git", ["worktree", "remove", taskWorktree, "--force"], {
      cwd: sourceWorktree,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      ok: false,
      message: `Failed to remove worktree: ${(e.stderr ?? e.message ?? "").toString().trim()}`,
    };
  }

  // Delete the branch (only if merged — use -d not -D)
  try {
    execFileSync("git", ["branch", "-d", branch], {
      cwd: sourceWorktree,
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Branch not merged or already deleted — non-fatal
  }

  return { ok: true, message: `Removed worktree ${taskWorktree} and branch ${branch}` };
}

/**
 * The full approve-plan workflow:
 *   1. Create an isolated worktree.
 *   2. Return the worktree path + branch for ACT execution.
 *
 * The caller (controller) then runs ACT in the isolated worktree.
 * After ACT completes, the caller calls removeIsolatedWorktree().
 */
export function approvePlan(
  sourceWorktree: string,
  planDescription: string,
  sessionId: string,
): { worktree: string; branch: string } | { error: string } {
  const result = createIsolatedWorktree(sourceWorktree, planDescription, { sessionId });
  if (!result.ok || !result.worktreePath || !result.branch) {
    return { error: result.message };
  }
  return { worktree: result.worktreePath, branch: result.branch };
}
