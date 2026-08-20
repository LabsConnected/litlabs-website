/**
 * Safe Git write workflow — branch, stage, commit, push, PR.
 *
 * Safety controls built in from the start:
 *   - Never commits directly to `main` (or master)
 *   - Never uses `git add -A`, `git add .`, or `git add --all`
 *   - Stages ONLY explicitly listed files
 *   - Preserves unrelated dirty/untracked files
 *   - No force push, no reset, no clean, no destructive git commands
 *   - Push rejection handled truthfully (reports failure, doesn't force)
 *   - PR creation reuses existing matching PRs rather than duplicating
 *   - Default new PRs to draft
 *   - Every step has truthful success/failure state
 *
 * All operations use execFileSync (no shell) — immune to PowerShell
 * profile corruption, same pattern as git-state.ts.
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { getGitState } from "./git-state.js";

// ─── Types ────────────────────────────────────────────────────────

export interface GitWorkflowResult {
  ok: boolean;
  message: string;
  branch?: string;
  commitSha?: string;
  prUrl?: string;
  prNumber?: number;
  stagedFiles?: string[];
}

export interface CreateBranchResult extends GitWorkflowResult {
  branch: string;
  created: boolean;
}

export interface CommitResult extends GitWorkflowResult {
  commitSha: string;
  stagedFiles: string[];
}

export interface PushResult extends GitWorkflowResult {
  branch: string;
}

export interface CreatePRResult extends GitWorkflowResult {
  prUrl: string;
  prNumber: number;
  created: boolean;
}

export interface ShipWorkflowOptions {
  cwd: string;
  /** Files to stage (relative paths only). Never uses `git add -A`. */
  files: string[];
  /** Commit message. */
  message: string;
  /** Branch name. If omitted, creates a safe feature branch. */
  branch?: string;
  /** Whether to push after commit. Default: true. */
  push?: boolean;
  /** Whether to create a draft PR after push. Default: true. */
  createPR?: boolean;
  /** Protected branches that must never be committed to directly. */
  protectedBranches?: string[];
}

// ─── Constants ────────────────────────────────────────────────────

const DEFAULT_PROTECTED_BRANCHES = ["main", "master", "release/*", "prod", "production"];

/** Git commands that are NEVER allowed in the workflow. */
const BLOCKED_COMMANDS = [
  "push --force",
  "push -f",
  "push --force-with-lease", // allowed separately with explicit flag
  "reset --hard",
  "clean -fd",
  "clean -f",
  "checkout -- .",
  "checkout .",
  "rm -r",
  "branch -D",
  "push --delete",
  "commit --amend", // no history rewriting in V1
  "rebase",
];

// ─── Internal helpers ─────────────────────────────────────────────

function runGit(args: string[], cwd: string, options?: { stdin?: string }): { ok: boolean; stdout: string; stderr: string } {
  try {
    const opts: ExecFileSyncOptions = {
      cwd,
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    };
    if (options?.stdin) {
      opts.input = options.stdin;
    }
    const stdout = String(execFileSync("git", args, opts)).trim();
    return { ok: true, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? e.message ?? "").toString().trim(),
    };
  }
}

function runGh(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = String(execFileSync("gh", args, {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    })).trim();
    return { ok: true, stdout, stderr: "" };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? e.message ?? "").toString().trim(),
    };
  }
}

/** Check if a branch name matches any protected branch pattern. */
export function isProtectedBranch(branch: string, patterns: string[] = DEFAULT_PROTECTED_BRANCHES): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return branch === prefix || branch.startsWith(prefix + "/");
    }
    return branch === pattern;
  });
}

/** Generate a safe feature branch name from a description. */
export function generateBranchName(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const timestamp = Date.now().toString(36);
  return `litt/${slug}-${timestamp}`;
}

/** Validate that a file path is safe to stage (no path traversal, no absolute paths). */
export function validateStagePath(filePath: string): { ok: boolean; reason?: string } {
  if (!filePath || filePath.trim().length === 0) {
    return { ok: false, reason: "Empty file path" };
  }
  if (filePath.startsWith("/")) {
    return { ok: false, reason: `Absolute paths not allowed: ${filePath}` };
  }
  if (filePath.includes("..")) {
    return { ok: false, reason: `Path traversal not allowed: ${filePath}` };
  }
  // Block .git/ paths
  if (filePath === ".git" || filePath.startsWith(".git/")) {
    return { ok: false, reason: `Cannot stage .git paths: ${filePath}` };
  }
  return { ok: true };
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Create or switch to a safe feature branch.
 * Never creates a branch from a protected branch name.
 * If the branch already exists, switches to it instead of failing.
 */
export function createOrSwitchBranch(cwd: string, branchName: string, options?: {
  protectedBranches?: string[];
}): CreateBranchResult {
  const state = getGitState(cwd);
  if (!state.isGitRepo) {
    return { ok: false, message: "Not a git repository", branch: "", created: false };
  }

  // Never allow committing directly to protected branches
  const protectedList = options?.protectedBranches ?? DEFAULT_PROTECTED_BRANCHES;
  if (isProtectedBranch(branchName, protectedList)) {
    return {
      ok: false,
      message: `Refusing to create/switch to protected branch: ${branchName}. Use a feature branch instead.`,
      branch: "",
      created: false,
    };
  }

  // Check if already on the target branch
  if (state.branch === branchName) {
    return { ok: true, message: `Already on branch ${branchName}`, branch: branchName, created: false };
  }

  // Check if branch already exists
  const existing = runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], cwd);
  if (existing.ok) {
    // Branch exists — switch to it
    const switchResult = runGit(["switch", branchName], cwd);
    if (!switchResult.ok) {
      return {
        ok: false,
        message: `Failed to switch to existing branch ${branchName}: ${switchResult.stderr}`,
        branch: "",
        created: false,
      };
    }
    return { ok: true, message: `Switched to existing branch ${branchName}`, branch: branchName, created: false };
  }

  // Create new branch
  const createResult = runGit(["switch", "-c", branchName], cwd);
  if (!createResult.ok) {
    return {
      ok: false,
      message: `Failed to create branch ${branchName}: ${createResult.stderr}`,
      branch: "",
      created: false,
    };
  }
  return { ok: true, message: `Created and switched to branch ${branchName}`, branch: branchName, created: true };
}

/**
 * Stage ONLY the specified files. Never uses `git add -A`, `git add .`, or `git add --all`.
 * Validates each path before staging.
 * Preserves unrelated dirty/untracked files.
 */
export function stageFiles(cwd: string, files: string[]): GitWorkflowResult {
  if (files.length === 0) {
    return { ok: false, message: "No files specified to stage" };
  }

  const state = getGitState(cwd);
  if (!state.isGitRepo) {
    return { ok: false, message: "Not a git repository" };
  }

  // Validate all paths first
  for (const f of files) {
    const validation = validateStagePath(f);
    if (!validation.ok) {
      return { ok: false, message: validation.reason ?? "Invalid file path" };
    }
  }

  // Stage each file individually — never `git add -A` or `git add .`
  const staged: string[] = [];
  for (const f of files) {
    const result = runGit(["add", "--", f], cwd);
    if (!result.ok) {
      // If staging fails, unstage what we've staged so far (rollback)
      if (staged.length > 0) {
        runGit(["reset", "HEAD", "--", ...staged], cwd);
      }
      return {
        ok: false,
        message: `Failed to stage ${f}: ${result.stderr}`,
        stagedFiles: staged,
      };
    }
    staged.push(f);
  }

  return {
    ok: true,
    message: `Staged ${staged.length} file${staged.length === 1 ? "" : "s"}`,
    stagedFiles: staged,
  };
}

/**
 * Commit staged changes with a message.
 * Fails truthfully if there's nothing staged or if the commit hook fails.
 * Does NOT stage anything — use stageFiles() first.
 */
export function commitStaged(cwd: string, message: string): CommitResult {
  const state = getGitState(cwd);
  if (!state.isGitRepo) {
    return { ok: false, message: "Not a git repository", commitSha: "", stagedFiles: [] };
  }

  if (!message || message.trim().length === 0) {
    return { ok: false, message: "Empty commit message", commitSha: "", stagedFiles: [] };
  }

  // Check that something is actually staged
  const diffCached = runGit(["diff", "--cached", "--name-only"], cwd);
  if (!diffCached.ok || diffCached.stdout.length === 0) {
    return { ok: false, message: "Nothing staged to commit", commitSha: "", stagedFiles: [] };
  }

  const stagedFiles = diffCached.stdout.split("\n").filter((l) => l.trim().length > 0);

  // Commit with the message
  const result = runGit(["commit", "-m", message], cwd);
  if (!result.ok) {
    return {
      ok: false,
      message: `Commit failed: ${result.stderr || result.stdout}`,
      commitSha: "",
      stagedFiles,
    };
  }

  // Get the commit SHA
  const shaResult = runGit(["rev-parse", "HEAD"], cwd);
  const commitSha = shaResult.ok ? shaResult.stdout : "";

  return {
    ok: true,
    message: `Committed ${stagedFiles.length} file${stagedFiles.length === 1 ? "" : "s"}`,
    commitSha,
    stagedFiles,
  };
}

/**
 * Push the current branch to the remote.
 * Never force pushes. Handles push rejection truthfully.
 */
export function pushBranch(cwd: string, options?: {
  branch?: string;
  setUpstream?: boolean;
}): PushResult {
  const state = getGitState(cwd);
  if (!state.isGitRepo) {
    return { ok: false, message: "Not a git repository", branch: "" };
  }

  const branch = options?.branch ?? state.branch;
  if (!branch) {
    return { ok: false, message: "Cannot push: detached HEAD (no current branch)", branch: "" };
  }

  // Never push to protected branches
  if (isProtectedBranch(branch)) {
    return {
      ok: false,
      message: `Refusing to push to protected branch: ${branch}`,
      branch,
    };
  }

  const args = ["push"];
  if (options?.setUpstream ?? true) {
    args.push("-u", "origin", branch);
  } else {
    args.push("origin", branch);
  }

  const result = runGit(args, cwd);
  if (!result.ok) {
    // Check for common rejection scenarios
    const stderr = result.stderr.toLowerCase();
    if (stderr.includes("non-fast-forward") || stderr.includes("rejected")) {
      return {
        ok: false,
        message: `Push rejected (non-fast-forward). The remote has commits not in your local branch. Pull or rebase first. stderr: ${result.stderr}`,
        branch,
      };
    }
    if (stderr.includes("permission denied") || stderr.includes("403")) {
      return {
        ok: false,
        message: `Push denied (authentication). Check your GitHub credentials. stderr: ${result.stderr}`,
        branch,
      };
    }
    return {
      ok: false,
      message: `Push failed: ${result.stderr || result.stdout}`,
      branch,
    };
  }

  return {
    ok: true,
    message: `Pushed ${branch} to origin`,
    branch,
  };
}

/**
 * Create a draft PR using `gh pr create --draft`.
 * If a PR already exists for this branch, returns the existing PR instead of duplicating.
 */
export function createDraftPR(cwd: string, options: {
  branch?: string;
  title: string;
  body?: string;
  base?: string;
}): CreatePRResult {
  const state = getGitState(cwd);
  if (!state.isGitRepo) {
    return { ok: false, message: "Not a git repository", prUrl: "", prNumber: 0, created: false };
  }

  const branch = options?.branch ?? state.branch;
  if (!branch) {
    return { ok: false, message: "Cannot create PR: detached HEAD", prUrl: "", prNumber: 0, created: false };
  }

  // Check if a PR already exists for this branch
  const existingCheck = runGh(["pr", "list", "--head", branch, "--json", "number,url,state", "--limit", "1"], cwd);
  if (existingCheck.ok && existingCheck.stdout.length > 0) {
    try {
      const prs = JSON.parse(existingCheck.stdout) as Array<{ number: number; url: string; state: string }>;
      if (prs.length > 0) {
        const pr = prs[0];
        if (pr.state === "OPEN") {
          return {
            ok: true,
            message: `PR #${pr.number} already exists for ${branch}`,
            prUrl: pr.url,
            prNumber: pr.number,
            created: false,
          };
        }
      }
    } catch {
      // Fall through to create
    }
  }

  // Create a new draft PR
  const args = ["pr", "create", "--draft", "--title", options.title];
  if (options.body) {
    args.push("--body", options.body);
  }
  if (options.base) {
    args.push("--base", options.base);
  } else {
    args.push("--base", "main");
  }
  if (branch) {
    args.push("--head", branch);
  }

  const result = runGh(args, cwd);
  if (!result.ok) {
    // Check if gh is not installed
    if (result.stderr.includes("command not found") || result.stderr.includes("not recognized")) {
      return {
        ok: false,
        message: "GitHub CLI (gh) is not installed. Install it to create PRs.",
        prUrl: "",
        prNumber: 0,
        created: false,
      };
    }
    return {
      ok: false,
      message: `PR creation failed: ${result.stderr || result.stdout}`,
      prUrl: "",
      prNumber: 0,
      created: false,
    };
  }

  // gh pr create outputs the PR URL
  const prUrl = result.stdout.trim();
  // Extract PR number from URL (e.g., https://github.com/owner/repo/pull/123)
  const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
  const prNumber = numberMatch ? parseInt(numberMatch[1], 10) : 0;

  return {
    ok: true,
    message: `Created draft PR #${prNumber}`,
    prUrl,
    prNumber,
    created: true,
  };
}

/**
 * Full ship workflow: branch → stage → commit → push → draft PR.
 * Each step has truthful success/failure state.
 * Never uses `git add -A`. Never commits to protected branches.
 */
export async function shipWorkflow(options: ShipWorkflowOptions): Promise<GitWorkflowResult> {
  const {
    cwd,
    files,
    message,
    push = true,
    createPR = true,
    protectedBranches = DEFAULT_PROTECTED_BRANCHES,
  } = options;

  const state = getGitState(cwd);
  if (!state.isGitRepo) {
    return { ok: false, message: "Not a git repository" };
  }

  // Step 1: Branch
  let branch = options.branch;
  if (!branch) {
    // Generate a safe branch name from the commit message
    branch = generateBranchName(message);
  }

  // If we're on a protected branch, create/switch to the feature branch
  if (isProtectedBranch(state.branch ?? "", protectedBranches)) {
    const branchResult = createOrSwitchBranch(cwd, branch, { protectedBranches });
    if (!branchResult.ok) {
      return { ok: false, message: branchResult.message };
    }
    branch = branchResult.branch;
  } else if (state.branch !== branch) {
    // We're on a non-protected branch but not the target branch
    const branchResult = createOrSwitchBranch(cwd, branch, { protectedBranches });
    if (!branchResult.ok) {
      return { ok: false, message: branchResult.message };
    }
    branch = branchResult.branch;
  }

  // Step 2: Stage only the specified files
  const stageResult = stageFiles(cwd, files);
  if (!stageResult.ok) {
    return { ok: false, message: stageResult.message, branch, stagedFiles: stageResult.stagedFiles };
  }

  // Step 3: Commit
  const commitResult = commitStaged(cwd, message);
  if (!commitResult.ok) {
    return { ok: false, message: commitResult.message, branch, stagedFiles: stageResult.stagedFiles };
  }

  // Step 4: Push (optional)
  if (push) {
    const pushResult = pushBranch(cwd, { branch, setUpstream: true });
    if (!pushResult.ok) {
      return {
        ok: false,
        message: `Committed but push failed: ${pushResult.message}`,
        branch,
        commitSha: commitResult.commitSha,
        stagedFiles: commitResult.stagedFiles,
      };
    }
  }

  // Step 5: Create draft PR (optional)
  let prUrl: string | undefined;
  let prNumber: number | undefined;
  if (createPR && push) {
    const prResult = createDraftPR(cwd, {
      branch,
      title: message,
      body: `## Summary\n\n${message}\n\nGenerated with [LiTT](https://litlabs.net)`,
    });
    if (prResult.ok) {
      prUrl = prResult.prUrl;
      prNumber = prResult.prNumber;
    }
    // PR failure is non-fatal — the commit + push still succeeded
  }

  const parts = [`Committed ${commitResult.stagedFiles.length} file${commitResult.stagedFiles.length === 1 ? "" : "s"}`];
  if (push) parts.push("pushed");
  if (prUrl) parts.push(`draft PR #${prNumber}`);

  return {
    ok: true,
    message: parts.join(", "),
    branch,
    commitSha: commitResult.commitSha,
    stagedFiles: commitResult.stagedFiles,
    prUrl,
    prNumber,
  };
}

/**
 * Check if a command is blocked by the workflow safety controls.
 * Returns true for force push, reset --hard, clean, etc.
 */
export function isBlockedGitCommand(args: string[]): boolean {
  const joined = args.join(" ");
  return BLOCKED_COMMANDS.some((blocked) => {
    // Exact match on the joined string prefix
    return joined.includes(blocked);
  });
}
