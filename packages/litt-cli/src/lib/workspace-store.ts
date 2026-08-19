/**
 * WorkspaceStore — discover switchable workspaces for /workspace.
 *
 * Sources (in priority order, deduplicated):
 *   1. Git worktrees of the current repository
 *   2. Sibling directories of the current project root (dirs that look
 *      like projects: package.json or .git present)
 *   3. Explicitly configured directories in ~/.litt/workspaces.json
 *      ({ "dirs": ["C:\\path\\to\\repo"] })
 *
 * Pure data access — no React, no Ink. Each entry carries live git
 * facts via the canonical git-state module.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getGitState } from "./git-state.js";

export type WorkspaceSource = "worktree" | "sibling" | "configured";

export interface WorkspaceEntry {
  name: string;
  root: string;
  branch: string | null;
  changed: number;
  untracked: number;
  current: boolean;
  source: WorkspaceSource;
}

function readConfigDirs(): string[] {
  try {
    // LITT_WORKSPACES_FILE overrides the location (tests use a temp file).
    const file = process.env.LITT_WORKSPACES_FILE ?? join(homedir(), ".litt", "workspaces.json");
    const raw = readFileSync(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { dirs?: unknown }).dirs)) {
      return (parsed as { dirs: unknown[] }).dirs.filter((d): d is string => typeof d === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Discover switchable workspaces for a project root.
 * Never throws — unreadable sources are skipped.
 */
export function discoverWorkspaces(currentRoot: string): WorkspaceEntry[] {
  const entries: WorkspaceEntry[] = [];
  const seen = new Set<string>();

  const add = (root: string, source: WorkspaceSource): void => {
    try {
      if (!existsSync(root)) return;
      if (!statSync(root).isDirectory()) return;
    } catch {
      return;
    }
    // Normalize trailing separators so dedupe works on Windows.
    const normalized = root.replace(/[\\/]+$/, "");
    if (seen.has(normalized)) return;
    seen.add(normalized);

    const gs = getGitState(normalized);
    entries.push({
      name: normalized.split(/[\\/]/).pop() ?? normalized,
      root: normalized,
      branch: gs.branch,
      changed: gs.changed,
      untracked: gs.untracked,
      current: normalized === currentRoot.replace(/[\\/]+$/, ""),
      source,
    });
  };

  // 1. Git worktrees of the current repo.
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: currentRoot,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const block of out.split("\n\n")) {
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) add(line.slice(9).trim(), "worktree");
      }
    }
  } catch {
    // Not a git repo — fine.
  }

  // 2. Sibling project dirs (same parent).
  const parent = dirname(currentRoot);
  try {
    const names = readdirSync(parent);
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const root = join(parent, name);
      if (root.replace(/[\\/]+$/, "") === currentRoot.replace(/[\\/]+$/, "")) continue;
      try {
        if (!statSync(root).isDirectory()) continue;
      } catch {
        continue;
      }
      if (existsSync(join(root, "package.json")) || existsSync(join(root, ".git"))) {
        add(root, "sibling");
      }
    }
  } catch {
    // Parent unreadable — fine.
  }

  // 3. Configured dirs.
  for (const dir of readConfigDirs()) add(dir, "configured");

  return entries.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
