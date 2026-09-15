import { describe, it, expect } from "vitest";

/**
 * Workspace capability classification — regression tests.
 *
 * Production evidence (Ember Roast V1 Acceptance): the Studio workspace UI
 * reported "No repository · —", framework "static", terminal disconnected.
 * LiTT simultaneously claimed TypeScript/tsc was broken, the ESLint config
 * was missing, tests returned 0 tests, and git was not installed — and
 * proposed installing Git/TypeScript and rewriting the ESLint config.
 *
 * Those tools are absent because the workspace is intentionally static,
 * not because the project is broken. Toolchain-only checks must be
 * classified NOT APPLICABLE, never FAILED.
 *
 * The "No repository · —" half of that report was a SEPARATE defect and
 * is fixed too: Git is not GitHub. A managed project has its own Git
 * repository and history, so local Git tooling stays applicable there —
 * only tools that call the GitHub API need a connected repository.
 * See tests/managed-project-source.test.ts.
 */

import {
  hasRepository,
  hasVersionControl,
  isStaticWorkspace,
  checkApplicability,
  notApplicableReason,
  repoOnlyToolApplicability,
  type WorkspaceShape,
} from "./workspace-capability";

/** The workspace shape observed in the failing production test. */
const STATIC_NO_REPO: WorkspaceShape = {
  framework: "static",
  packageManager: "none",
  githubFullName: null,
  sourceType: "blank",
};

const NEXTJS_WITH_REPO: WorkspaceShape = {
  framework: "nextjs",
  packageManager: "pnpm",
  githubFullName: "LabsConnected/litlabs-website",
  sourceType: "github",
};

describe("hasRepository (GitHub connectivity)", () => {
  it("is false for a workspace with no GitHub repository", () => {
    expect(hasRepository(STATIC_NO_REPO)).toBe(false);
  });

  it("is true for a GitHub-backed workspace", () => {
    expect(hasRepository(NEXTJS_WITH_REPO)).toBe(true);
  });

  it("does not imply anything about local version control", () => {
    // The deprecated name read as "has Git", which is what caused
    // checkpoints and diff to be disabled on managed projects.
    expect(hasVersionControl(STATIC_NO_REPO)).toBe(true);
  });
});

describe("isStaticWorkspace", () => {
  it("recognises the static/no-package-manager workspace", () => {
    expect(isStaticWorkspace(STATIC_NO_REPO)).toBe(true);
  });

  it("does not treat a pnpm Next.js workspace as static", () => {
    expect(isStaticWorkspace(NEXTJS_WITH_REPO)).toBe(false);
  });
});

/* ── Case B: repo health checks on a static/no-repository workspace ── */

describe("B. repo health checks on a static workspace with no repository", () => {
  it("classifies typecheck, lint, test and build as not_applicable — never failed", () => {
    for (const check of ["typecheck", "lint", "test", "build"] as const) {
      const applicability = checkApplicability(STATIC_NO_REPO, check);
      expect(applicability).toBe("not_applicable");
      expect(applicability).not.toBe("failed");
    }
  });

  it("explains why, without proposing an install or a config rewrite", () => {
    const reason = notApplicableReason(STATIC_NO_REPO, "typecheck");
    expect(reason).toMatch(/static workspace/i);
    // Must not read as a defect or a remediation proposal.
    expect(reason).not.toMatch(/broken|missing|failed|install|rewrite/i);
  });

  it("keeps LOCAL git tooling applicable — a managed project has its own Git repo", () => {
    // Git is not GitHub. A provisioned managed workspace is git init-ed,
    // so status, diff, log, commits and checkpoints all operate on real
    // history even with no GitHub repository connected.
    for (const tool of ["git_status", "git_diff", "git_log", "commit_changes", "create_checkpoint", "restore_checkpoint"]) {
      expect(repoOnlyToolApplicability(STATIC_NO_REPO, tool)).toBe("applicable");
    }
  });

  it("classifies only GitHub-API tooling as not_applicable without a connected repo", () => {
    for (const tool of ["push_branch", "create_pull_request", "github_read_file"]) {
      expect(repoOnlyToolApplicability(STATIC_NO_REPO, tool)).toBe("not_applicable");
    }
  });

  it("does not report a missing git binary as a project failure", () => {
    const reason = notApplicableReason(STATIC_NO_REPO, "push_branch");
    expect(reason).toMatch(/no GitHub repository/i);
    expect(reason).not.toMatch(/git is not installed|install git/i);
  });

  it("keeps every check applicable on a real repository workspace", () => {
    for (const check of ["typecheck", "lint", "test", "build"] as const) {
      expect(checkApplicability(NEXTJS_WITH_REPO, check)).toBe("applicable");
    }
    expect(repoOnlyToolApplicability(NEXTJS_WITH_REPO, "git_status")).toBe("applicable");
  });

  it("still runs toolchain checks for a repo-less project that has a package manager", () => {
    // No repository, but a real toolchain — typecheck/lint/test/build are
    // genuinely runnable, so they must not be waved away as N/A.
    const npmNoRepo: WorkspaceShape = {
      framework: "vite",
      packageManager: "pnpm",
      githubFullName: null,
      sourceType: "template",
    };
    expect(checkApplicability(npmNoRepo, "typecheck")).toBe("applicable");
    // Git tooling is applicable too — the workspace has its own Git repo.
    expect(repoOnlyToolApplicability(npmNoRepo, "git_status")).toBe("applicable");
    // Only the GitHub remote is missing.
    expect(repoOnlyToolApplicability(npmNoRepo, "push_branch")).toBe("not_applicable");
  });
});
