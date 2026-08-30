/**
 * Focused tests for the consolidated projectStatus() function.
 *
 * projectStatus replaces the old pattern of resolveProjectContext + gitStatus
 * (4 git subprocess calls) with a single git status --porcelain=v1 --branch
 * call + one git remote get-url origin call (2 total).
 *
 * These tests verify the consolidated result matches the canonical
 * git-state.ts output (same source of truth).
 */

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "path";
import * as fs from "fs";
import { projectStatus, createShellExecutor } from "../index.js";

let REPO_ROOT: string;
const testDir = __dirname;
if (testDir.includes("__tests__")) {
  REPO_ROOT = path.resolve(testDir, "../../..");
} else {
  REPO_ROOT = path.resolve(testDir, "..");
}
let checkDir = REPO_ROOT;
for (let i = 0; i < 5; i++) {
  if (fs.existsSync(path.join(checkDir, "package.json")) &&
      fs.existsSync(path.join(checkDir, "pnpm-workspace.yaml"))) {
    REPO_ROOT = checkDir;
    break;
  }
  checkDir = path.dirname(checkDir);
}

const SHELL = createShellExecutor(REPO_ROOT);

describe("projectStatus — consolidated git state", () => {
  it("returns project name from package.json", async () => {
    const result = await projectStatus(SHELL, REPO_ROOT);
    assert.ok(result.name.length > 0, "name should be non-empty");
    // Should be the workspace root package name, not a sub-package
    const pkgPath = path.join(REPO_ROOT, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert.equal(result.name, pkg.name ?? path.basename(REPO_ROOT));
  });

  it("detects git repo and branch correctly", async () => {
    const result = await projectStatus(SHELL, REPO_ROOT);
    assert.equal(result.isGitRepo, true);
    assert.ok(result.branch !== null, "should have a branch name");
    // Branch should match `git branch --show-current`
    const { execFileSync } = await import("node:child_process");
    const currentBranch = execFileSync("git", ["branch", "--show-current"], {
      cwd: REPO_ROOT, encoding: "utf8"
    }).trim();
    assert.equal(result.branch, currentBranch || null);
  });

  it("counts changed and untracked files correctly", async () => {
    const result = await projectStatus(SHELL, REPO_ROOT);
    // We know the repo has modified files (from git status)
    assert.ok(result.changed >= 0, "changed should be >= 0");
    assert.ok(result.untracked >= 0, "untracked should be >= 0");
    // Should match the file list
    const { execFileSync } = await import("node:child_process");
    const porcelain = execFileSync("git", ["status", "--porcelain=v1"], {
      cwd: REPO_ROOT, encoding: "utf8"
    }).trim();
    const lines = porcelain.split("\n").filter((l) => l.trim());
    const expectedChanged = lines.filter((l) => !l.startsWith("??")).length;
    const expectedUntracked = lines.filter((l) => l.startsWith("??")).length;
    assert.equal(result.changed, expectedChanged);
    assert.equal(result.untracked, expectedUntracked);
  });

  it("reports clean state correctly", async () => {
    const result = await projectStatus(SHELL, REPO_ROOT);
    const expectedClean = result.changed === 0 && result.untracked === 0;
    assert.equal(result.clean, expectedClean);
  });

  it("detects project root correctly", async () => {
    const result = await projectStatus(SHELL, REPO_ROOT);
    assert.ok(result.root.length > 0, "root should be non-empty");
    assert.ok(fs.existsSync(path.join(result.root, "package.json")),
      "root should contain package.json");
  });

  it("handles subdirectory as cwd", async () => {
    const subDir = path.join(REPO_ROOT, "packages", "litt-cli", "src");
    const result = await projectStatus(SHELL, subDir);
    // Should still detect the repo root
    const repoName = path.basename(REPO_ROOT);
    assert.ok(result.root.endsWith(repoName),
      `root should be the repo root, got: ${result.root}`);
    assert.equal(result.isGitRepo, true);
  });

  it("returns isGitRepo=false for non-git directory", async () => {
    // Use a temp directory that is not a git repo
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "litt-test-"));
    try {
      const result = await projectStatus(SHELL, tmpDir);
      assert.equal(result.isGitRepo, false);
      assert.equal(result.branch, null);
      assert.equal(result.remote, null);
      assert.equal(result.changed, 0);
      assert.equal(result.untracked, 0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("fetches remote URL when in a git repo", async () => {
    const result = await projectStatus(SHELL, REPO_ROOT);
    if (result.isGitRepo) {
      // Remote may be null if no origin remote is configured, but if
      // git remote get-url origin succeeds it should be a non-empty string.
      const { execFileSync } = await import("node:child_process");
      let expectedRemote: string | null = null;
      try {
        expectedRemote = execFileSync("git", ["remote", "get-url", "origin"], {
          cwd: REPO_ROOT, encoding: "utf8"
        }).trim() || null;
      } catch {
        expectedRemote = null;
      }
      assert.equal(result.remote, expectedRemote,
        `remote should match git remote get-url origin`);
    }
  });

  it("result shape matches expected ProjectStatusResult schema", async () => {
    const result = await projectStatus(SHELL, REPO_ROOT);
    // Verify all expected fields exist
    assert.ok("root" in result);
    assert.ok("name" in result);
    assert.ok("isGitRepo" in result);
    assert.ok("branch" in result);
    assert.ok("remote" in result);
    assert.ok("clean" in result);
    assert.ok("changed" in result);
    assert.ok("untracked" in result);
    assert.ok("files" in result);
    assert.ok(Array.isArray(result.files));
    assert.equal(typeof result.changed, "number");
    assert.equal(typeof result.untracked, "number");
    assert.equal(typeof result.isGitRepo, "boolean");
    assert.equal(typeof result.clean, "boolean");
  });
});
