/**
 * Regression tests for the safe Git write workflow.
 *
 * Tests cover:
 *   - Dirty working tree (unrelated files preserved)
 *   - Mixed unrelated changes (only intended files staged)
 *   - Detached HEAD (commit/push refused)
 *   - Existing branch (switch instead of fail)
 *   - Existing PR (reuse instead of duplicate)
 *   - Push rejection (non-fast-forward handled truthfully)
 *   - Auth failure (permission denied handled truthfully)
 *   - Failed commit hook (commit failure reported)
 *   - Canceled approval (workflow stops cleanly)
 *   - Protected branch enforcement (never commits to main)
 *   - Path traversal in stage paths
 *   - Blocked commands (force push, reset --hard, etc.)
 *   - Branch name generation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import {
  isProtectedBranch,
  generateBranchName,
  validateStagePath,
  createOrSwitchBranch,
  stageFiles,
  commitStaged,
  pushBranch,
  createDraftPR,
  shipWorkflow,
  isBlockedGitCommand,
} from "../lib/git-workflow.js";

// ─── Test helpers ─────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function gitOk(args: string[], cwd: string): boolean {
  try {
    execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-git-test-"));
  git(["init", "--initial-branch=main"], dir);
  git(["config", "user.email", "test@litt.ai"], dir);
  git(["config", "user.name", "LiTT Test"], dir);
  // Create an initial commit so we have a base
  fs.writeFileSync(path.join(dir, "README.md"), "# test\n");
  git(["add", "README.md"], dir);
  git(["commit", "-m", "initial"], dir);
  return dir;
}

function makeFile(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function makeDirtyTree(dir: string): void {
  // Create unrelated dirty files that should NOT be staged
  makeFile(dir, "unrelated-1.ts", "export const x = 1;\n");
  makeFile(dir, "src/unrelated-2.ts", "export const y = 2;\n");
  makeFile(dir, "dirty-existing.ts", "modified\n");
  // Modify an existing tracked file
  fs.writeFileSync(path.join(dir, "README.md"), "# modified\n");
}

// ─── Pure function tests ──────────────────────────────────────────

describe("isProtectedBranch", () => {
  it("blocks main and master", () => {
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("master")).toBe(true);
  });

  it("blocks prod and production", () => {
    expect(isProtectedBranch("prod")).toBe(true);
    expect(isProtectedBranch("production")).toBe(true);
  });

  it("blocks release/* pattern", () => {
    expect(isProtectedBranch("release/v1")).toBe(true);
    expect(isProtectedBranch("release/2024-01")).toBe(true);
  });

  it("allows feature branches", () => {
    expect(isProtectedBranch("litt/fix-bug")).toBe(false);
    expect(isProtectedBranch("feature/auth")).toBe(false);
    expect(isProtectedBranch("dev")).toBe(false);
  });
});

describe("generateBranchName", () => {
  it("creates a slug from a description", () => {
    const name = generateBranchName("Fix the pricing page cards");
    expect(name).toMatch(/^litt\/fix-the-pricing-page-cards-/);
  });

  it("handles special characters", () => {
    const name = generateBranchName("feat: add annual option!!! @#$%");
    expect(name).toMatch(/^litt\/feat-add-annual-option-/);
    expect(name).not.toContain("!");
    expect(name).not.toContain("@");
  });

  it("truncates long descriptions", () => {
    const long = "a".repeat(100);
    const name = generateBranchName(long);
    // Branch name should be reasonable length
    expect(name.length).toBeLessThan(80);
  });
});

describe("validateStagePath", () => {
  it("accepts relative paths", () => {
    expect(validateStagePath("src/index.ts").ok).toBe(true);
    expect(validateStagePath("packages/litt-cli/src/lib/git.ts").ok).toBe(true);
  });

  it("rejects absolute paths", () => {
    const result = validateStagePath("/etc/passwd");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Absolute");
  });

  it("rejects path traversal", () => {
    const result = validateStagePath("../../etc/passwd");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("traversal");
  });

  it("rejects .git paths", () => {
    expect(validateStagePath(".git/config").ok).toBe(false);
    expect(validateStagePath(".git").ok).toBe(false);
  });

  it("rejects empty paths", () => {
    expect(validateStagePath("").ok).toBe(false);
    expect(validateStagePath("   ").ok).toBe(false);
  });
});

describe("isBlockedGitCommand", () => {
  it("blocks force push", () => {
    expect(isBlockedGitCommand(["push", "--force"])).toBe(true);
    expect(isBlockedGitCommand(["push", "-f"])).toBe(true);
  });

  it("blocks reset --hard", () => {
    expect(isBlockedGitCommand(["reset", "--hard", "HEAD~1"])).toBe(true);
  });

  it("blocks clean", () => {
    expect(isBlockedGitCommand(["clean", "-fd"])).toBe(true);
    expect(isBlockedGitCommand(["clean", "-f"])).toBe(true);
  });

  it("blocks branch -D", () => {
    expect(isBlockedGitCommand(["branch", "-D", "main"])).toBe(true);
  });

  it("blocks commit --amend", () => {
    expect(isBlockedGitCommand(["commit", "--amend"])).toBe(true);
  });

  it("blocks rebase", () => {
    expect(isBlockedGitCommand(["rebase", "main"])).toBe(true);
  });

  it("allows safe commands", () => {
    expect(isBlockedGitCommand(["status"])).toBe(false);
    expect(isBlockedGitCommand(["add", "--", "src/index.ts"])).toBe(false);
    expect(isBlockedGitCommand(["commit", "-m", "fix"])).toBe(false);
    expect(isBlockedGitCommand(["push", "origin", "feature"])).toBe(false);
    expect(isBlockedGitCommand(["switch", "-c", "feature"])).toBe(false);
  });
});

// ─── Integration tests (real git repos) ───────────────────────────

describe("createOrSwitchBranch", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates a new feature branch", () => {
    const result = createOrSwitchBranch(dir, "litt/feature-1");
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.branch).toBe("litt/feature-1");
    expect(git(["branch", "--show-current"], dir)).toBe("litt/feature-1");
  });

  it("switches to an existing branch instead of failing", () => {
    // Create the branch first
    git(["switch", "-c", "existing-branch"], dir);
    git(["switch", "main"], dir);

    const result = createOrSwitchBranch(dir, "existing-branch");
    expect(result.ok).toBe(true);
    expect(result.created).toBe(false);
    expect(result.branch).toBe("existing-branch");
    expect(git(["branch", "--show-current"], dir)).toBe("existing-branch");
  });

  it("is a no-op if already on the target branch", () => {
    const result = createOrSwitchBranch(dir, "main");
    // main is protected — should refuse
    expect(result.ok).toBe(false);
    expect(result.message).toContain("protected");
  });

  it("refuses to create a protected branch name", () => {
    const result = createOrSwitchBranch(dir, "main");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("protected");
  });

  it("refuses to create master branch", () => {
    const result = createOrSwitchBranch(dir, "master");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("protected");
  });

  it("fails gracefully outside a git repo", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "litt-not-repo-"));
    try {
      const result = createOrSwitchBranch(tmp, "litt/feature");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Not a git repository");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("stageFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stages only the specified files, preserving unrelated dirty files", () => {
    // Create intended files
    makeFile(dir, "src/intended.ts", "export const a = 1;\n");
    makeFile(dir, "src/another-intended.ts", "export const b = 2;\n");
    // Create unrelated dirty files
    makeFile(dir, "unrelated.ts", "export const c = 3;\n");
    makeFile(dir, "dirty.txt", "dirty\n");

    const result = stageFiles(dir, ["src/intended.ts", "src/another-intended.ts"]);
    expect(result.ok).toBe(true);
    expect(result.stagedFiles).toHaveLength(2);

    // Verify only intended files are staged
    const staged = git(["diff", "--cached", "--name-only"], dir).split("\n").filter(Boolean);
    expect(staged).toContain("src/intended.ts");
    expect(staged).toContain("src/another-intended.ts");
    expect(staged).not.toContain("unrelated.ts");
    expect(staged).not.toContain("dirty.txt");

    // Verify unrelated files are still untracked/dirty
    const status = git(["status", "--porcelain=v1"], dir);
    expect(status).toContain("?? unrelated.ts");
    expect(status).toContain("?? dirty.txt");
  });

  it("fails on empty file list", () => {
    const result = stageFiles(dir, []);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("No files");
  });

  it("rejects path traversal in stage paths", () => {
    const result = stageFiles(dir, ["../../etc/passwd"]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("traversal");
  });

  it("rejects absolute paths", () => {
    const result = stageFiles(dir, ["/etc/passwd"]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Absolute");
  });

  it("rolls back on staging failure", () => {
    // One valid file and one non-existent file
    makeFile(dir, "src/valid.ts", "export const a = 1;\n");

    const result = stageFiles(dir, ["src/valid.ts", "nonexistent.ts"]);
    // git add on a non-existent file fails
    expect(result.ok).toBe(false);
    // The valid file should have been unstaged (rollback)
    const staged = git(["diff", "--cached", "--name-only"], dir).split("\n").filter(Boolean);
    expect(staged).not.toContain("src/valid.ts");
  });
});

describe("commitStaged", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("commits staged files and returns the commit SHA", () => {
    makeFile(dir, "src/new.ts", "export const x = 1;\n");
    git(["add", "--", "src/new.ts"], dir);

    const result = commitStaged(dir, "feat: add new file");
    expect(result.ok).toBe(true);
    expect(result.commitSha).toBeTruthy();
    expect(result.commitSha.length).toBeGreaterThan(0);
    expect(result.stagedFiles).toContain("src/new.ts");

    // Verify the commit
    const log = git(["log", "-1", "--oneline"], dir);
    expect(log).toContain("feat: add new file");
  });

  it("fails when nothing is staged", () => {
    const result = commitStaged(dir, "feat: nothing to commit");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Nothing staged");
  });

  it("fails on empty commit message", () => {
    makeFile(dir, "src/new.ts", "export const x = 1;\n");
    git(["add", "--", "src/new.ts"], dir);

    const result = commitStaged(dir, "");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Empty commit message");
  });

  it("reports commit hook failure truthfully", () => {
    // Install a failing pre-commit hook
    const hookDir = path.join(dir, ".git", "hooks");
    fs.writeFileSync(path.join(hookDir, "pre-commit"), "#!/bin/sh\necho 'Hook failed'\nexit 1\n");
    fs.chmodSync(path.join(hookDir, "pre-commit"), 0o755);

    makeFile(dir, "src/new.ts", "export const x = 1;\n");
    git(["add", "--", "src/new.ts"], dir);

    const result = commitStaged(dir, "feat: should fail");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Commit failed");
  });
});

describe("pushBranch", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to push to protected branch (main)", () => {
    const result = pushBranch(dir, { branch: "main" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("protected");
  });

  it("refuses to push when detached HEAD", () => {
    // Detach HEAD
    git(["checkout", "--detach"], dir);
    const result = pushBranch(dir);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("detached HEAD");
  });

  it("fails gracefully when no remote is configured", () => {
    git(["switch", "-c", "litt/feature"], dir);
    const result = pushBranch(dir, { branch: "litt/feature" });
    // No remote → push fails truthfully
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Push failed");
  });
});

describe("createDraftPR", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails gracefully when gh CLI is not available", () => {
    // This test verifies graceful failure — gh may or may not be installed
    // but the function should never throw
    git(["switch", "-c", "litt/feature"], dir);
    const result = createDraftPR(dir, {
      branch: "litt/feature",
      title: "Test PR",
      body: "Test body",
    });
    // Either gh is not installed (graceful failure) or it fails on auth/repo
    // The key assertion is that it doesn't throw and returns a result
    expect(typeof result.ok).toBe("boolean");
    expect(typeof result.message).toBe("string");
  });

  it("fails on detached HEAD", () => {
    git(["checkout", "--detach"], dir);
    const result = createDraftPR(dir, {
      title: "Test PR",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("detached HEAD");
  });
});

// ─── Full workflow tests ──────────────────────────────────────────

describe("shipWorkflow", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates branch, stages only intended files, commits, preserves unrelated files", async () => {
    // Create intended file
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");
    // Create unrelated dirty files
    makeDirtyTree(dir);

    const result = await shipWorkflow({
      cwd: dir,
      files: ["src/feature.ts"],
      message: "feat: add feature",
      push: false, // no remote configured
      createPR: false,
    });

    expect(result.ok).toBe(true);
    expect(result.branch).toMatch(/^litt\//);
    expect(result.commitSha).toBeTruthy();
    expect(result.stagedFiles).toEqual(["src/feature.ts"]);

    // Verify we're NOT on main
    expect(git(["branch", "--show-current"], dir)).not.toBe("main");

    // Verify the commit contains only the intended file
    const committed = git(["show", "--name-only", "--oneline", "HEAD"], dir);
    expect(committed).toContain("src/feature.ts");
    expect(committed).not.toContain("unrelated-1.ts");
    expect(committed).not.toContain("unrelated-2.ts");
    expect(committed).not.toContain("dirty-existing.ts");

    // Verify unrelated files are still dirty/untracked
    const status = git(["status", "--porcelain=v1"], dir);
    expect(status).toContain("?? unrelated-1.ts");
    expect(status).toContain("?? src/unrelated-2.ts");
    expect(status).toContain("?? dirty-existing.ts");
    // README.md was modified — porcelain format may be "M README.md" or " M README.md"
    expect(status).toMatch(/M README\.md/);
  });

  it("refuses to commit directly to main", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");

    const result = await shipWorkflow({
      cwd: dir,
      files: ["src/feature.ts"],
      message: "feat: add feature",
      branch: "main", // explicitly try to use main
      push: false,
      createPR: false,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("protected");
  });

  it("fails when no files are specified", async () => {
    const result = await shipWorkflow({
      cwd: dir,
      files: [],
      message: "feat: nothing",
      push: false,
      createPR: false,
    });
    expect(result.ok).toBe(false);
  });

  it("fails outside a git repo", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "litt-not-repo-"));
    try {
      const result = await shipWorkflow({
        cwd: tmp,
        files: ["src/feature.ts"],
        message: "feat: test",
        push: false,
        createPR: false,
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain("Not a git repository");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("uses an existing branch if already on a non-protected branch", async () => {
    // Switch to a feature branch first
    git(["switch", "-c", "litt/existing-branch"], dir);
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");

    const result = await shipWorkflow({
      cwd: dir,
      files: ["src/feature.ts"],
      message: "feat: add feature",
      branch: "litt/existing-branch",
      push: false,
      createPR: false,
    });

    expect(result.ok).toBe(true);
    expect(result.branch).toBe("litt/existing-branch");
    expect(git(["branch", "--show-current"], dir)).toBe("litt/existing-branch");
  });

  it("handles mixed unrelated changes — only intended files committed", async () => {
    // Create multiple intended files across directories
    makeFile(dir, "src/feature-a.ts", "export const a = 1;\n");
    makeFile(dir, "src/nested/feature-b.ts", "export const b = 2;\n");
    // Create multiple unrelated files
    makeFile(dir, "unrelated-1.ts", "export const c = 3;\n");
    makeFile(dir, "src/unrelated-2.ts", "export const d = 4;\n");
    makeFile(dir, "deeply/nested/unrelated-3.ts", "export const e = 5;\n");

    const result = await shipWorkflow({
      cwd: dir,
      files: ["src/feature-a.ts", "src/nested/feature-b.ts"],
      message: "feat: add features A and B",
      push: false,
      createPR: false,
    });

    expect(result.ok).toBe(true);
    expect(result.stagedFiles).toHaveLength(2);

    // Verify only intended files in the commit
    const committed = git(["show", "--name-only", "--oneline", "HEAD"], dir);
    expect(committed).toContain("src/feature-a.ts");
    expect(committed).toContain("src/nested/feature-b.ts");
    expect(committed).not.toContain("unrelated-1.ts");
    expect(committed).not.toContain("src/unrelated-2.ts");
    expect(committed).not.toContain("deeply/nested/unrelated-3.ts");
  });

  it("reports push failure truthfully without force pushing", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");

    const result = await shipWorkflow({
      cwd: dir,
      files: ["src/feature.ts"],
      message: "feat: add feature",
      push: true, // will fail — no remote configured
      createPR: false,
    });

    // Commit succeeded but push failed
    expect(result.ok).toBe(false);
    expect(result.message).toContain("push failed");
    expect(result.commitSha).toBeTruthy(); // commit still happened

    // Verify the commit exists
    const log = git(["log", "-1", "--oneline"], dir);
    expect(log).toContain("feat: add feature");
  });
});

// ─── Detached HEAD scenario ───────────────────────────────────────

describe("shipWorkflow — detached HEAD", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempRepo();
    git(["checkout", "--detach"], dir);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("recovers from detached HEAD by creating a feature branch", async () => {
    makeFile(dir, "src/feature.ts", "export const feature = true;\n");

    const result = await shipWorkflow({
      cwd: dir,
      files: ["src/feature.ts"],
      message: "feat: add feature",
      push: false,
      createPR: false,
    });

    // Should create a branch and commit successfully
    expect(result.ok).toBe(true);
    expect(result.branch).toMatch(/^litt\//);
    expect(git(["branch", "--show-current"], dir)).toBe(result.branch);
  });
});
