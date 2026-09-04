/**
 * P1: Approve Plan → Isolated ACT Workflow — tests.
 *
 * Proves:
 *   - generateTaskBranchName produces a safe branch name.
 *   - generateTaskWorktreePath places the worktree as a sibling.
 *   - createIsolatedWorktree creates a worktree on a task branch.
 *   - The source worktree (canonical main) is never switched off its branch.
 *   - removeIsolatedWorktree cleans up after merge.
 *   - approvePlan returns the worktree + branch for ACT execution.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

import {
  generateTaskBranchName,
  generateTaskWorktreePath,
  createIsolatedWorktree,
  removeIsolatedWorktree,
  approvePlan,
} from "../lib/approve-plan-workflow.js";
import { newLeaseSessionId } from "../lib/worktree-lease.js";

const tmpBase = path.join(os.tmpdir(), `litt-p1-approve-${Date.now()}`);
const sourceWorktree = path.join(tmpBase, "main-worktree");

beforeEach(() => {
  fs.mkdirSync(tmpBase, { recursive: true });
  // Create a bare repo and a main worktree
  const bareRepo = path.join(tmpBase, "repo.git");
  execFileSync("git", ["init", "--bare", bareRepo], { stdio: "pipe", timeout: 5000 });
  // Clone into the source worktree
  execFileSync("git", ["clone", bareRepo, sourceWorktree], { stdio: "pipe", timeout: 10000 });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: sourceWorktree, stdio: "pipe", timeout: 5000 });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: sourceWorktree, stdio: "pipe", timeout: 5000 });
  // Create an initial commit on main
  fs.writeFileSync(path.join(sourceWorktree, "README.md"), "# Test");
  execFileSync("git", ["add", "README.md"], { cwd: sourceWorktree, stdio: "pipe", timeout: 5000 });
  execFileSync("git", ["commit", "-m", "init"], { cwd: sourceWorktree, stdio: "pipe", timeout: 5000 });
  execFileSync("git", ["branch", "-M", "main"], { cwd: sourceWorktree, stdio: "pipe", timeout: 5000 });
});

afterEach(() => {
  try {
    // Clean up worktrees first
    try {
      execFileSync("git", ["worktree", "prune"], { cwd: sourceWorktree, stdio: "pipe", timeout: 5000 });
    } catch { /* ignore */ }
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("P1: Approve Plan → Isolated ACT Workflow", () => {
  describe("generateTaskBranchName", () => {
    it("produces a safe branch name with litt/task- prefix", () => {
      const name = generateTaskBranchName("Fix the billing bug");
      expect(name).toMatch(/^litt\/task-fix-the-billing-bug-/);
    });

    it("handles special characters", () => {
      const name = generateTaskBranchName("Fix @special #chars! & symbols?");
      expect(name).toMatch(/^litt\/task-/);
      expect(name).not.toContain("@");
      expect(name).not.toContain("#");
      expect(name).not.toContain("!");
    });
  });

  describe("generateTaskWorktreePath", () => {
    it("places the worktree as a sibling of the source", () => {
      const source = path.join(tmpBase, "main-worktree");
      const wtPath = generateTaskWorktreePath(source, "litt/task-test-abc");
      expect(path.dirname(wtPath)).toBe(path.dirname(source));
    });
  });

  describe("createIsolatedWorktree", () => {
    it("creates a worktree on a new task branch", () => {
      const result = createIsolatedWorktree(sourceWorktree, "Test task", {
        sessionId: newLeaseSessionId(),
      });
      expect(result.ok).toBe(true);
      expect(result.worktreePath).not.toBe(null);
      expect(result.branch).not.toBe(null);
      expect(result.created).toBe(true);
      expect(fs.existsSync(result.worktreePath!)).toBe(true);
    });

    it("does not switch the source worktree off its branch", () => {
      createIsolatedWorktree(sourceWorktree, "Test task", {
        sessionId: newLeaseSessionId(),
      });
      // Source should still be on main
      const branch = execFileSync("git", ["branch", "--show-current"], {
        cwd: sourceWorktree, encoding: "utf8", stdio: "pipe", timeout: 5000,
      }).trim();
      expect(branch).toBe("main");
    });

    it("acquires a write lease on the new worktree", () => {
      const sess = newLeaseSessionId();
      const result = createIsolatedWorktree(sourceWorktree, "Test task", { sessionId: sess });
      expect(result.ok).toBe(true);
      const leaseFile = path.join(result.worktreePath!, ".litt", "worktree-lease.json");
      expect(fs.existsSync(leaseFile)).toBe(true);
    });

    it("fails gracefully when not a git repo", () => {
      const nonGit = path.join(tmpBase, "non-git");
      fs.mkdirSync(nonGit, { recursive: true });
      const result = createIsolatedWorktree(nonGit, "Test task");
      expect(result.ok).toBe(false);
      expect(result.message).toContain("not a git repository");
    });
  });

  describe("removeIsolatedWorktree", () => {
    it("removes the worktree and branch after merge", () => {
      const sess = newLeaseSessionId();
      const created = createIsolatedWorktree(sourceWorktree, "Test cleanup", { sessionId: sess });
      expect(created.ok).toBe(true);

      // Make a commit in the task worktree and merge it back
      const taskWt = created.worktreePath!;
      const branch = created.branch!;
      fs.writeFileSync(path.join(taskWt, "test.txt"), "test");
      execFileSync("git", ["add", "test.txt"], { cwd: taskWt, stdio: "pipe", timeout: 5000 });
      execFileSync("git", ["commit", "-m", "test"], { cwd: taskWt, stdio: "pipe", timeout: 5000 });
      // Merge into main
      execFileSync("git", ["merge", branch], { cwd: sourceWorktree, stdio: "pipe", timeout: 5000 });

      const removed = removeIsolatedWorktree(sourceWorktree, taskWt, branch, sess);
      expect(removed.ok).toBe(true);
      expect(fs.existsSync(taskWt)).toBe(false);
    });
  });

  describe("approvePlan", () => {
    it("returns the worktree and branch for ACT execution", () => {
      const sess = newLeaseSessionId();
      const result = approvePlan(sourceWorktree, "Audit the codebase", sess);
      expect("worktree" in result).toBe(true);
      if ("worktree" in result) {
        expect(result.worktree).toBeTruthy();
        expect(result.branch).toMatch(/^litt\/task-/);
      }
    });

    it("returns an error when the source is not a git repo", () => {
      const nonGit = path.join(tmpBase, "non-git-2");
      fs.mkdirSync(nonGit, { recursive: true });
      const result = approvePlan(nonGit, "Test", newLeaseSessionId());
      expect("error" in result).toBe(true);
    });
  });

  describe("canonical main is untouched", () => {
    it("the source worktree stays on main after creating an isolated worktree", () => {
      const sess = newLeaseSessionId();
      approvePlan(sourceWorktree, "Important task", sess);
      const branch = execFileSync("git", ["branch", "--show-current"], {
        cwd: sourceWorktree, encoding: "utf8", stdio: "pipe", timeout: 5000,
      }).trim();
      expect(branch).toBe("main");
    });

    it("the source worktree has no uncommitted changes from the task", () => {
      const sess = newLeaseSessionId();
      const result = approvePlan(sourceWorktree, "Task that changes files", sess);
      if ("worktree" in result) {
        // Make changes in the TASK worktree, not the source
        fs.writeFileSync(path.join(result.worktree, "new-file.txt"), "content");
      }
      // Source worktree should still be clean (only README.md)
      const status = execFileSync("git", ["status", "--porcelain"], {
        cwd: sourceWorktree, encoding: "utf8", stdio: "pipe", timeout: 5000,
      }).trim();
      expect(status).toBe("");
    });
  });
});
