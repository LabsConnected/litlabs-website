/**
 * DiffView — canonical git diff data for the /diff viewer.
 *
 * Pure data access (execFileSync, no shell) so the diff overlay can
 * render the same truth `litt diff` prints. Exported helpers are unit-
 * tested (diff-view.test.ts).
 */

import { execFileSync } from "node:child_process";

export interface DiffFileEntry {
  path: string;
  /** Porcelain status letter: M A D R C U. */
  status: string;
  additions: number;
  deletions: number;
}

export interface DiffData {
  files: DiffFileEntry[];
  /** Full `git diff` text (unstaged by default). */
  raw: string;
}

function runGit(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    return stderr || String(err);
  }
}

const STATUS_LETTERS = new Set(["M", "A", "D", "R", "C", "U", "T"]);

/** Parse `git diff --numstat` lines into entries. Exported for tests. */
export function parseNumstat(numstat: string): DiffFileEntry[] {
  const files: DiffFileEntry[] = [];
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [a, d, ...rest] = line.split("\t");
    const path = rest.join("\t").trim();
    if (!path) continue;
    files.push({
      path,
      status: "M",
      additions: a === "-" ? 0 : parseInt(a, 10) || 0,
      deletions: d === "-" ? 0 : parseInt(d, 10) || 0,
    });
  }
  return files;
}

/** Parse `git diff --name-status` into a path → status map. Exported for tests.
 *  Rename/copy lines carry two paths (old, new) — the map keys the NEW
 *  path (the file that exists now). */
export function parseNameStatus(nameStatus: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    // Status letter may carry a similarity suffix (R100, C75) — strip it.
    const m = line.match(/^([MADRCUT])\d*\s+(.+)$/);
    if (!m || !STATUS_LETTERS.has(m[1])) continue;
    const rest = m[2].trim();
    const parts = rest.split("\t");
    const key = parts.length > 1 ? parts[parts.length - 1].trim() : rest;
    if (key) map.set(key, m[1]);
  }
  return map;
}

/** Parse raw diff text into added/removed line counts. Exported for tests. */
export function countChangedLines(diffText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

export function getDiffData(cwd: string, staged = false): DiffData {
  const diffTarget = staged ? "--staged" : "--";
  const numstat = runGit(["diff", diffTarget, "--numstat"], cwd);
  const files = parseNumstat(numstat);
  const nameStatus = runGit(["diff", diffTarget, "--name-status"], cwd);
  const statusMap = parseNameStatus(nameStatus);
  for (const f of files) {
    f.status = statusMap.get(f.path) ?? f.status;
  }
  return {
    files,
    raw: runGit(["diff", diffTarget, "--no-color"], cwd),
  };
}

export function getFileDiff(cwd: string, path: string, staged = false): string {
  return runGit(["diff", staged ? "--staged" : "--", "--no-color", "--", path], cwd);
}

/** Suggest a commit message from the last commit's type/scope + changes. */
export function suggestCommitMessage(cwd: string, files: DiffFileEntry[]): string {
  let type = "feat";
  let scope = "cli";
  try {
    const last = execFileSync("git", ["log", "-1", "--format=%s"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const m = last.match(/^(feat|fix|chore|refactor|docs|test|perf|build|ci|style)(\(([^)]+)\))?:/);
    if (m) {
      type = m[1];
      if (m[3]) scope = m[3];
    }
  } catch {
    // not a repo or no commits — keep defaults
  }

  const first = files[0];
  if (!first) return `${type}(${scope}): update`;
  const base = first.path.split(/[\\/]/).pop() ?? first.path;
  const name = base.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
  const summary = files.length > 1 ? `${name} and ${files.length - 1} more` : name;
  return `${type}(${scope}): ${summary}`;
}
