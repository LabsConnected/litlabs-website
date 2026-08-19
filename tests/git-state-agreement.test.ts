/**
 * Git-state agreement — CLI surfaces and the agent mission path must
 * report the SAME repository facts.
 *
 * First-run acceptance failure #5/#6: the cockpit FILES counter and
 * `litt doctor` disagreed with direct git (8 changed / 8 untracked /
 * "branch main" vs a clean feature branch). This test proves the CLI
 * canonical helper (getGitState) and the agent mission tool path
 * (agent-core gitStatus) agree on the same cwd.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { getGitState, countGitChanges } from "../packages/litt-cli/src/lib/git-state.js";
import { NodeShellExecutor, gitStatus, resolveProjectContext } from "@litt/agent-core";

const REPO_ROOT = process.cwd();

describe("CLI ↔ agent-mission git agreement", () => {
  it("branch agrees: getGitState === agent resolveProjectContext === direct git", async () => {
    const shell = new NodeShellExecutor(REPO_ROOT);
    const cli = getGitState(REPO_ROOT);
    const project = await resolveProjectContext(shell, REPO_ROOT);
    const direct = execFileSync("git", ["branch", "--show-current"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    expect(cli.branch).toBe(direct);
    expect(project.branch).toBe(direct);
  });

  it("change counts agree: getGitState === agent project.status tool", async () => {
    const shell = new NodeShellExecutor(REPO_ROOT);
    const cli = getGitState(REPO_ROOT);
    const toolResult = await gitStatus(shell, REPO_ROOT);

    expect(toolResult.success).toBe(true);
    const toolData = toolResult.data as { changeCount: number; porcelain: string };
    expect(cli.changed + cli.untracked).toBe(toolData.changeCount);

    const counted = countGitChanges(cli.porcelain);
    const directLines = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim().split("\n").filter((l) => l.trim());
    expect(counted.changed + counted.untracked).toBe(directLines.length);
  });

  it("clean state agrees across surfaces", async () => {
    const shell = new NodeShellExecutor(REPO_ROOT);
    const cli = getGitState(REPO_ROOT);
    const toolResult = await gitStatus(shell, REPO_ROOT);
    const toolData = toolResult.data as { changeCount: number };
    const directClean = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim().length === 0;

    expect(cli.clean).toBe(directClean);
    expect(toolData.changeCount === 0).toBe(directClean);
  });

  it("project name agrees: agent resolveProjectContext uses package.json name", async () => {
    const shell = new NodeShellExecutor(REPO_ROOT);
    const project = await resolveProjectContext(shell, REPO_ROOT);
    // The CLI displays package.json name (litlabs-website) — the agent
    // tool must report the same name, not the folder basename.
    const fs = await import("node:fs");
    const pkgName = (JSON.parse(fs.readFileSync(`${REPO_ROOT}/package.json`, "utf8")) as { name: string }).name;
    expect(project.name).toBe(pkgName);
  });
});
