/**
 * P0-1: Canonical Main Protection — regression tests.
 *
 * Proves:
 *   - Canonical main path detection works.
 *   - WORKTREE MISMATCH warning when canonical main is on wrong branch.
 *   - Branch switch guard refuses to move canonical main off `main`.
 *   - PLAN mode mutation guard denies mutations on canonical main.
 *   - Non-canonical worktrees are free to switch branches.
 *   - Owner approval override works.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  isCanonicalMainPath,
  checkCanonicalMain,
  guardBranchSwitch,
  guardPlanModeMutation,
  getCanonicalMainPath,
  getCanonicalBranch,
} from "../lib/canonical-main.js";

// Use a temp dir as the "canonical main" for testing
const tmpDir = path.join(os.tmpdir(), `litt-p0-canonical-${Date.now()}`);
const canonicalPath = path.join(tmpDir, "main");

beforeEach(() => {
  // Set env to point canonical main at our temp dir
  process.env.LITT_CANONICAL_MAIN = canonicalPath;
  process.env.LITT_CANONICAL_BRANCH = "main";
  // Create the dir structure
  fs.mkdirSync(canonicalPath, { recursive: true });
  // Create a .git dir with HEAD on main
  const gitDir = path.join(canonicalPath, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
});

afterEach(() => {
  delete process.env.LITT_CANONICAL_MAIN;
  delete process.env.LITT_CANONICAL_BRANCH;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

describe("P0-1: Canonical Main Protection", () => {
  describe("isCanonicalMainPath", () => {
    it("returns true for the canonical main path", () => {
      expect(isCanonicalMainPath(canonicalPath)).toBe(true);
    });

    it("returns false for a non-canonical path", () => {
      const other = path.join(tmpDir, "feature-work");
      expect(isCanonicalMainPath(other)).toBe(false);
    });

    it("is case-insensitive on Windows", () => {
      // On Windows, paths are case-insensitive
      if (process.platform === "win32") {
        expect(isCanonicalMainPath(canonicalPath.toUpperCase())).toBe(true);
      }
    });
  });

  describe("checkCanonicalMain", () => {
    it("returns branchMatches=true when canonical main is on main", () => {
      const check = checkCanonicalMain(canonicalPath);
      expect(check.isCanonicalMain).toBe(true);
      expect(check.actualBranch).toBe("main");
      expect(check.branchMatches).toBe(true);
      expect(check.warning).toBe(null);
    });

    it("returns WORKTREE MISMATCH when canonical main is on wrong branch", () => {
      // Change HEAD to a feature branch
      fs.writeFileSync(path.join(canonicalPath, ".git", "HEAD"), "ref: refs/heads/test/billing-state-machine-v2\n");
      const check = checkCanonicalMain(canonicalPath);
      expect(check.isCanonicalMain).toBe(true);
      expect(check.actualBranch).toBe("test/billing-state-machine-v2");
      expect(check.branchMatches).toBe(false);
      expect(check.warning).toContain("WORKTREE MISMATCH");
      expect(check.warning).toContain("test/billing-state-machine-v2");
      expect(check.warning).toContain("main");
    });

    it("returns WORKTREE MISMATCH when canonical main is detached", () => {
      fs.writeFileSync(path.join(canonicalPath, ".git", "HEAD"), "a1b2c3d4e5f6789012345678901234567890abcd\n");
      const check = checkCanonicalMain(canonicalPath);
      expect(check.isCanonicalMain).toBe(true);
      expect(check.isDetached).toBe(true);
      expect(check.warning).toContain("WORKTREE MISMATCH");
      expect(check.warning).toContain("detached HEAD");
    });

    it("returns isCanonicalMain=false for non-canonical paths", () => {
      const check = checkCanonicalMain(path.join(tmpDir, "other-worktree"));
      expect(check.isCanonicalMain).toBe(false);
      expect(check.warning).toBe(null);
    });
  });

  describe("guardBranchSwitch", () => {
    it("refuses to switch canonical main to a feature branch", () => {
      const guard = guardBranchSwitch(canonicalPath, "feat/test-work");
      expect(guard.allowed).toBe(false);
      expect(guard.reason).toContain("REFUSED");
      expect(guard.reason).toContain("canonical main");
      expect(guard.reason).toContain("feat/test-work");
    });

    it("allows switching canonical main back to main", () => {
      const guard = guardBranchSwitch(canonicalPath, "main");
      expect(guard.allowed).toBe(true);
      expect(guard.reason).toBe(null);
    });

    it("allows owner-approved override", () => {
      const guard = guardBranchSwitch(canonicalPath, "feat/test-work", true);
      expect(guard.allowed).toBe(true);
      expect(guard.reason).toContain("Owner-approved");
    });

    it("allows branch switch on non-canonical worktree", () => {
      const other = path.join(tmpDir, "feature-work");
      const guard = guardBranchSwitch(other, "feat/anything");
      expect(guard.allowed).toBe(true);
      expect(guard.isCanonicalMain).toBe(false);
    });
  });

  describe("guardPlanModeMutation", () => {
    it("denies branch-switch on canonical main in PLAN mode", () => {
      const guard = guardPlanModeMutation(canonicalPath, "plan", "branch-switch");
      expect(guard.allowed).toBe(false);
      expect(guard.reason).toContain("PLAN mode");
      expect(guard.reason).toContain("branch-switch");
    });

    it("denies commit on canonical main in PLAN mode", () => {
      const guard = guardPlanModeMutation(canonicalPath, "plan", "commit");
      expect(guard.allowed).toBe(false);
    });

    it("denies push on canonical main in PLAN mode", () => {
      const guard = guardPlanModeMutation(canonicalPath, "plan", "push");
      expect(guard.allowed).toBe(false);
    });

    it("denies deploy on canonical main in PLAN mode", () => {
      const guard = guardPlanModeMutation(canonicalPath, "plan", "deploy");
      expect(guard.allowed).toBe(false);
    });

    it("allows mutations in ACT mode on canonical main", () => {
      const guard = guardPlanModeMutation(canonicalPath, "act", "commit");
      expect(guard.allowed).toBe(true);
    });

    it("allows PLAN mode mutations on non-canonical worktree (gateway enforces)", () => {
      const other = path.join(tmpDir, "feature-work");
      const guard = guardPlanModeMutation(other, "plan", "write");
      expect(guard.allowed).toBe(true);
    });
  });

  describe("env override", () => {
    it("getCanonicalMainPath respects LITT_CANONICAL_MAIN", () => {
      expect(getCanonicalMainPath()).toBe(path.resolve(canonicalPath));
    });

    it("getCanonicalBranch respects LITT_CANONICAL_BRANCH", () => {
      expect(getCanonicalBranch()).toBe("main");
    });

    it("defaults when env not set", () => {
      delete process.env.LITT_CANONICAL_MAIN;
      delete process.env.LITT_CANONICAL_BRANCH;
      // Just verify it doesn't throw and returns something
      expect(typeof getCanonicalMainPath()).toBe("string");
      expect(getCanonicalBranch()).toBe("main");
    });
  });
});
