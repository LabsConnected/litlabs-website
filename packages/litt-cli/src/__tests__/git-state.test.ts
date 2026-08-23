/**
 * Canonical git state — the single helper behind `litt doctor`,
 * `litt status`, and the cockpit FILES counter.
 *
 * First-run acceptance failure #5/#6: `litt doctor` reported
 * "Git branch: main / 8 uncommitted changes" while direct git reported
 * the feature branch and a clean tree. Root cause: surfaces read Git
 * through different ad-hoc paths. All CLI surfaces now read the same
 * helper (execFileSync — no shell, no profile interference).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { getGitState, countGitChanges } from "../lib/git-state.js";

const REPO_ROOT = process.cwd();

function directGit(args: string[], cwd = REPO_ROOT): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

describe("getGitState (real worktree)", () => {
  it("returns the actual branch from the current worktree", () => {
    const git = getGitState(REPO_ROOT);
    expect(git.isGitRepo).toBe(true);
    // git branch --show-current returns "" for detached HEAD, but
    // getGitState returns null for detached HEAD. Normalize both to
    // null so the comparison is correct in detached worktrees.
    const directBranch = directGit(["branch", "--show-current"]);
    expect(git.branch).toBe(directBranch === "" ? null : directBranch);
  });

  it("detects a clean worktree exactly like direct git", () => {
    const git = getGitState(REPO_ROOT);
    const directClean = directGit(["status", "--porcelain=v1"]).length === 0;
    expect(git.clean).toBe(directClean);
    expect(git.changed + git.untracked).toBe(directGit(["status", "--porcelain=v1"]).split("\n").filter((l) => l.trim()).length);
  });

  it("changed/untracked split matches direct git parsing", () => {
    const git = getGitState(REPO_ROOT);
    const porcelain = directGit(["status", "--porcelain=v1"]);
    const lines = porcelain.split("\n").filter((l) => l.trim());
    const untracked = lines.filter((l) => l.startsWith("??")).length;
    expect(git.untracked).toBe(untracked);
    expect(git.changed).toBe(lines.length - untracked);
  });

  it("reports isGitRepo: false outside a repository", () => {
    // Use a temp directory that is not inside a git repo.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "litt-not-repo-"));
    try {
      const git = getGitState(tmp);
      expect(git.isGitRepo).toBe(false);
      expect(git.branch).toBe(null);
      expect(git.clean).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("countGitChanges", () => {
  it("counts modified and untracked from porcelain v1", () => {
    const porcelain = [
      " M src/a.ts",
      "M  src/b.ts",
      "?? new-file.ts",
      "?? dir/",
    ].join("\n");
    const { changed, untracked } = countGitChanges(porcelain);
    expect(changed).toBe(2);
    expect(untracked).toBe(2);
  });

  it("empty porcelain → clean", () => {
    const { changed, untracked } = countGitChanges("");
    expect(changed).toBe(0);
    expect(untracked).toBe(0);
  });

  it("matches the cockpit FILES counter contract", () => {
    // cockpit.ts: gitModified = gitState.changed; gitUntracked = gitState.untracked.
    const git = getGitState(REPO_ROOT);
    const counted = countGitChanges(git.porcelain);
    expect(counted.changed).toBe(git.changed);
    expect(counted.untracked).toBe(git.untracked);
  });
});

describe("git state is stable across calls (no caching drift)", () => {
  beforeAll(() => {
    // Sanity: the helper does not cache — two calls return identical data.
  });

  it("two consecutive calls agree", () => {
    const a = getGitState(REPO_ROOT);
    const b = getGitState(REPO_ROOT);
    expect(a.branch).toBe(b.branch);
    expect(a.changed).toBe(b.changed);
    expect(a.untracked).toBe(b.untracked);
    expect(a.clean).toBe(b.clean);
  });
});
