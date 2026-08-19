/**
 * litt doctor acceptance — the doctor must report the ACTUAL git state
 * of the current worktree (first-run acceptance failures #5/#6).
 *
 * Previously `litt doctor` reported "Git branch: main / 8 uncommitted
 * changes" while direct git reported the feature branch and a clean
 * tree. The doctor now reads git through the canonical getGitState()
 * helper. These tests capture the doctor's output and assert it agrees
 * with direct git — whatever the current state actually is.
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { doctorCommand } from "../packages/litt-cli/src/commands/doctor.js";

const REPO_ROOT = process.cwd();

function directGit(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function captureDoctor(): Promise<string> {
  const chunks: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    chunks.push(args.map((a) => String(a)).join(" "));
  };
  try {
    await doctorCommand([]);
  } finally {
    console.log = originalLog;
  }
  return chunks.join("\n");
}

describe("litt doctor git truth", () => {
  afterEach(() => {
    // The network/terminal checks leave no state, but restore anyway.
  });

  it("reports the actual git branch from the current worktree", async () => {
    const output = await captureDoctor();
    const actualBranch = directGit(["branch", "--show-current"]);
    expect(output).toContain(`Git branch: ${actualBranch}`);
  });

  it("detects a clean worktree exactly like direct git", async () => {
    const output = await captureDoctor();
    const directClean = directGit(["status", "--porcelain=v1"]).length === 0;
    const directLineCount = directGit(["status", "--porcelain=v1"]).split("\n").filter((l) => l.trim()).length;

    if (directClean) {
      expect(output).toContain("Working tree clean");
    } else {
      expect(output).toContain(`${directLineCount} total`);
    }
  });
});
