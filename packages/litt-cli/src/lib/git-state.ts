/**
 * Canonical git state — the ONE helper for Git facts across CLI surfaces.
 *
 * Used by:
 *   - `litt doctor`        (branch, clean/changed/untracked)
 *   - `litt status`        (branch, clean/changed/untracked, files)
 *   - `litt cockpit`       (FILES counter: modified + untracked)
 *
 * All surfaces must read Git through this module so they can never
 * disagree. Runs git via execFileSync (no shell) — immune to shell
 * profiles/aliases that can corrupt `git status` when spawned through
 * PowerShell.
 *
 * The agent mission path uses the agent-core `project.status` tool on
 * the same cwd — same repository, same counts (see tests/git-state-
 * agreement.test.ts).
 */

import { execFileSync } from "node:child_process";

export interface GitState {
  /** Whether the cwd is inside a git work tree. */
  isGitRepo: boolean;
  /** Current branch name (null when detached or not a repo). */
  branch: string | null;
  /** The root the state was read from. */
  root: string;
  /** Number of tracked files with changes (modified/staged/renamed/etc). */
  changed: number;
  /** Number of untracked files/directories. */
  untracked: number;
  /** True when there are no changes at all (changed === 0 && untracked === 0). */
  clean: boolean;
  /** Raw porcelain v1 lines. */
  files: string[];
  /** Raw `git status --porcelain=v1` output (trimmed). */
  porcelain: string;
}

function runGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Parse porcelain v1 output into changed/untracked counts.
 * A line is "untracked" when it starts with `??`; every other line is
 * a change to a tracked file. Exported for direct unit testing.
 */
export function countGitChanges(porcelain: string): { changed: number; untracked: number } {
  const lines = porcelain.split("\n").filter((l) => l.trim().length > 0);
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  return { changed: lines.length - untracked, untracked };
}

/**
 * Read the canonical git state for a directory.
 * Never throws — returns isGitRepo: false when git is unavailable or
 * the directory is not a repository.
 */
export function getGitState(cwd: string): GitState {
  const isRepo = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  if (isRepo !== "true") {
    return {
      isGitRepo: false,
      branch: null,
      root: cwd,
      changed: 0,
      untracked: 0,
      clean: true,
      files: [],
      porcelain: "",
    };
  }

  const branchOut = runGit(["branch", "--show-current"], cwd);
  const porcelain = runGit(["status", "--porcelain=v1"], cwd) ?? "";
  const files = porcelain.split("\n").filter((l) => l.trim().length > 0);
  const { changed, untracked } = countGitChanges(porcelain);

  return {
    isGitRepo: true,
    branch: branchOut && branchOut.length > 0 ? branchOut : null,
    root: cwd,
    changed,
    untracked,
    clean: changed === 0 && untracked === 0,
    files,
    porcelain,
  };
}
