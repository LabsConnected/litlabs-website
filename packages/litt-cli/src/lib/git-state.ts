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
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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

// ─── Fresh branch via .git/HEAD filesystem read ───────────────────
//
// Reads the current branch directly from Git's metadata without
// spawning a git subprocess. This is a filesystem read (~1ms) vs
// a subprocess (~100-200ms), and it is ALWAYS fresh — the file is
// updated by `git switch`, `git checkout`, `git pull`, etc.
//
// Handles:
//   - normal branch:  "ref: refs/heads/feature/a" → "feature/a"
//   - detached HEAD:  "a1b2c3d..." (40 hex chars) → null
//   - worktree:       .git is a file with "gitdir: /path/to/.git/worktrees/xxx"
//                     → follow indirection, read HEAD from the real gitdir
//   - non-git dir:    no .git file or directory → null
//   - missing/locked: any read error → null (caller falls back to subprocess)

/**
 * Resolve the `.git` directory for a working directory.
 * Handles worktrees where `.git` is a file containing `gitdir: /path`.
 * Returns the path to the actual gitdir, or null if not a git repo.
 */
function resolveGitDir(cwd: string): string | null {
  const dotGit = join(cwd, ".git");

  // .git doesn't exist → not a git repo (or we're in a subdirectory)
  if (!existsSync(dotGit)) {
    // Walk up to find .git (we might be in a subdirectory of the repo)
    let dir = resolve(cwd);
    for (let i = 0; i < 20; i++) {
      const parent = join(dir, ".git");
      if (existsSync(parent)) {
        return resolveGitDirEntry(parent);
      }
      const parentDir = resolve(dir, "..");
      if (parentDir === dir) break; // reached filesystem root
      dir = parentDir;
    }
    return null;
  }

  return resolveGitDirEntry(dotGit);
}

/**
 * Given a `.git` path (file or directory), resolve to the actual gitdir.
 */
function resolveGitDirEntry(dotGit: string): string | null {
  try {
    const stat = statSync(dotGit);
    if (stat.isDirectory()) {
      return dotGit;
    }

    // .git is a file → worktree or submodule. Read the gitdir pointer.
    const content = readFileSync(dotGit, "utf8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return null;

    const gitdirPath = match[1].trim();
    // gitdirPath may be relative to the .git file's location
    const resolved = resolve(join(dotGit, ".."), gitdirPath);
    if (existsSync(resolved)) {
      return resolved;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Structured Git HEAD state — the ONE truth for what `.git/HEAD` says.
 * Used by the local fast lane to feed both the response AND the cockpit
 * header from the same resolution, so they can never disagree.
 */
export type GitHeadState =
  | { kind: "branch"; branch: string }
  | { kind: "detached"; commit: string }
  | { kind: "not-git" };

/**
 * Read the structured HEAD state directly from `.git/HEAD` — no git subprocess.
 *
 * Returns:
 *   - { kind: "branch", branch: "feature/a" } when on a branch
 *   - { kind: "detached", commit: "a1b2c3d" } when detached (short SHA)
 *   - { kind: "not-git" } when not a git repo or metadata unreadable
 *
 * This is ALWAYS fresh — the file is updated atomically by git on every
 * branch switch. The short SHA for detached HEAD is extracted from the
 * 40-char SHA in `.git/HEAD` without spawning `git rev-parse --short HEAD`.
 */
export function readHeadStateFromGitDir(cwd: string): GitHeadState {
  const gitDir = resolveGitDir(cwd);
  if (!gitDir) return { kind: "not-git" };

  try {
    const headPath = join(gitDir, "HEAD");
    const head = readFileSync(headPath, "utf8").trim();

    // Normal branch: "ref: refs/heads/feature/a"
    const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (refMatch) {
      return { kind: "branch", branch: refMatch[1] };
    }

    // Detached HEAD: 40-char hex SHA
    if (/^[0-9a-f]{40}$/i.test(head)) {
      return { kind: "detached", commit: head.slice(0, 7) };
    }

    return { kind: "not-git" };
  } catch {
    return { kind: "not-git" };
  }
}

/**
 * Read the current branch directly from `.git/HEAD` — no git subprocess.
 *
 * Returns:
 *   - branch name string (e.g. "feature/a") when on a branch
 *   - null when detached HEAD, not a git repo, or metadata is unreadable
 *
 * Delegates to `readHeadStateFromGitDir` — there is ONE source of truth
 * for `.git/HEAD` parsing, not two.
 *
 * For detached HEAD, the file contains a 40-char SHA. The caller should
 * use `readHeadStateFromGitDir()` if they need the structured state
 * (including the short SHA for display).
 */
export function readBranchFromGitDir(cwd: string): string | null {
  const state = readHeadStateFromGitDir(cwd);
  return state.kind === "branch" ? state.branch : null;
}

/**
 * Git subprocess budget.
 *
 * Normal Windows/macOS/Linux filesystems keep the fast 5s fail-closed
 * budget. WSL operating directly on a Windows DrvFS mount (/mnt/c,
 * /mnt/e, etc.) can legitimately take substantially longer to refresh
 * a large Git index, so give that environment a larger budget rather
 * than falsely reporting "not a git repo".
 *
 * LITT_GIT_TIMEOUT_MS is an explicit diagnostic/CI override.
 */
function gitCommandTimeoutMs(cwd: string): number {
  const override = Number.parseInt(process.env.LITT_GIT_TIMEOUT_MS ?? "", 10);

  if (Number.isFinite(override) && override >= 1000 && override <= 60_000) {
    return override;
  }

  const isWsl =
    process.platform === "linux" &&
    Boolean(
      process.env.WSL_INTEROP ||
      process.env.WSL_DISTRO_NAME ||
      existsSync("/proc/sys/fs/binfmt_misc/WSLInterop"),
    );

  const normalizedCwd = resolve(cwd).replace(/\\/g, "/");
  const isDrvFs = /^\/mnt\/[a-z](?:\/|$)/i.test(normalizedCwd);

  return isWsl && isDrvFs ? 20_000 : 5_000;
}

function runGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: gitCommandTimeoutMs(cwd),
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
 * Parse the branch line from `git status --porcelain=v1 --branch` output.
 * The first line starts with `## ` and contains the branch info:
 *   `## release/litt-v1-acceptance...origin/release/litt-v1-acceptance`
 *   `## HEAD (no branch)` (detached HEAD)
 * Returns the branch name, or null for detached HEAD.
 */
function parseBranchFromPorcelainBranch(branchLine: string): string | null {
  // Strip the `## ` prefix
  const rest = branchLine.replace(/^##\s+/, "");
  // Detached HEAD: `## HEAD (no branch)`
  if (rest.startsWith("HEAD (no branch)") || rest === "HEAD") {
    return null;
  }
  // Normal branch: `## branchname...upstream` or `## branchname`
  const branchMatch = rest.match(/^([^.\s]+)/);
  return branchMatch ? branchMatch[1] : null;
}

/**
 * Read the canonical git state for a directory.
 * Never throws — returns isGitRepo: false when git is unavailable or
 * the directory is not a repository.
 *
 * Uses a SINGLE `git status --porcelain=v1 --branch` call to get both
 * the branch name and dirty state in one subprocess invocation (~180ms
 * on Windows vs ~500ms for three separate calls).
 */
export function getGitState(cwd: string): GitState {
  // Single combined call — fails if not a git repo
  const combined = runGit(["status", "--porcelain=v1", "--branch"], cwd);
  if (combined === null) {
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

  const lines = combined.split("\n");
  // First line is the branch header (`## ...`)
  const branchLine = lines[0] ?? "";
  const branch = branchLine.startsWith("## ")
    ? parseBranchFromPorcelainBranch(branchLine)
    : null;

  // Remaining lines are file status entries
  const fileLines = lines.slice(1).filter((l) => l.trim().length > 0);
  const porcelain = fileLines.join("\n");
  const { changed, untracked } = countGitChanges(porcelain);

  return {
    isGitRepo: true,
    branch,
    root: cwd,
    changed,
    untracked,
    clean: changed === 0 && untracked === 0,
    files: fileLines,
    porcelain,
  };
}
