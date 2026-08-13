import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GitInfo } from "./types.js";

export function detectGitInfo(cwd: string): GitInfo {
  const gitDir = path.join(cwd, ".git");

  if (!fs.existsSync(gitDir) && !fs.existsSync(path.join(cwd, ".git")) && !isInsideGitRepo(cwd)) {
    return { isRepo: false, root: cwd, branch: null };
  }

  try {
    const root = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    let branch: string | null;
    try {
      branch = execSync("git branch --show-current", {
        cwd: root,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || null;
    } catch {
      branch = null;
    }

    let remote: string | undefined;
    try {
      remote = execSync("git remote get-url origin", {
        cwd: root,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim() || undefined;
    } catch {
      // no remote
    }

    return { isRepo: true, root, branch, remote };
  } catch {
    return { isRepo: false, root: cwd, branch: null };
  }
}

function isInsideGitRepo(dir: string): boolean {
  let current = dir;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}
