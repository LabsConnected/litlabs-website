/**
 * LiTT Tool Handlers — real execution handlers for internal tools.
 *
 * These handlers connect tool definitions to actual filesystem and
 * process operations. They are the "hands" of the LiTT agent.
 *
 * Security model:
 * - Read-only tools (project.scan, files.list, files.read, git.status)
 *   execute automatically without approval.
 * - Mutation tools (files.write, terminal.execute for mutations)
 *   require explicit approval before execution.
 * - terminal.execute uses a safe-command allowlist for auto-approved
 *   read-only commands and blocks dangerous patterns.
 */

import "server-only";
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { execSync } from "child_process";
import { scanProject, type ScanInput } from "./project-scanner";

// ─── Helpers ──────────────────────────────────────────────────────

function getRepoRoot(): string {
  return process.cwd();
}

function safeExec(cmd: string, cwd?: string, timeoutMs = 10000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      cwd: cwd ?? getRepoRoot(),
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 1024 * 1024,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? "").toString().trim(),
      exitCode: e.status ?? 1,
    };
  }
}

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ─── Safe terminal command allowlist ──────────────────────────────

const SAFE_READ_ONLY_COMMANDS = [
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "find",
  "grep",
  "rg",
  "git status",
  "git branch",
  "git log",
  "git diff",
  "git show",
  "git remote",
  "git rev-parse",
  "git ls-files",
  "git stash list",
  "npm list",
  "npm outdated",
  "npm audit",
  "pnpm list",
  "pnpm outdated",
  "yarn list",
  "node --version",
  "npm --version",
  "pnpm --version",
  "npx tsc --noEmit",
  "npx tsc --version",
  "eslint",
  "prettier --check",
  "vitest --run",
  "vitest --version",
  "jest",
  "playwright",
];

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b:\(\)\s*\{/i, // fork bomb
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bkill\s+-9\b/i,
  /\bpkill\b/i,
  /\bchmod\s+777\b/i,
  /\bsudo\b/i,
  /\bsu\s+/i,
  /\b>\s*\/dev\/sd/i,
  /\bcurl\s+.*\|\s*sh/i,
  /\bwget\s+.*\|\s*sh/i,
  /\beval\s+/i,
  /\bexport\s+PATH=/i,
];

function isSafeReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();

  // Block dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Check against allowlist
  const lowerCmd = trimmed.toLowerCase();
  return SAFE_READ_ONLY_COMMANDS.some((safe) => lowerCmd.startsWith(safe));
}

function isMutationCommand(command: string): boolean {
  const lower = command.trim().toLowerCase();
  return [
    /\bgit\s+(add|commit|push|merge|rebase|reset|checkout|stash\s+drop)/,
    /\bnpm\s+(install|uninstall|update|publish)/,
    /\bpnpm\s+(add|remove|install|update|publish)/,
    /\byarn\s+(add|remove|install|publish)/,
    /\brm\s+/,
    /\bmv\s+/,
    /\bmkdir\s+/,
    /\btouch\s+/,
    /\bcp\s+/,
    /\becho\s+.*>\s*/,
    /\bcat\s+.*>\s*/,
  ].some((p) => p.test(lower));
}

// ─── Tool Handlers ────────────────────────────────────────────────

/**
 * Project Scan handler — runs the deterministic project scanner.
 */
export async function handleProjectScan(inputs: Record<string, unknown>): Promise<unknown> {
  const projectId = inputs.projectId as string;
  const repoRoot = getRepoRoot();

  const scanInput: ScanInput = {
    projectId,
    repoRoot,
  };

  try {
    const snapshot = scanProject(scanInput);
    return {
      success: true,
      snapshot,
      summary: {
        languages: snapshot.stack.languages,
        frameworks: snapshot.stack.frameworks,
        packageManagers: snapshot.stack.packageManagers,
        deploymentTargets: snapshot.stack.deploymentTargets,
        dependencyCount: snapshot.dependencies.length,
        testFramework: snapshot.tests.framework,
        testCount: snapshot.tests.testCount,
        riskCount: snapshot.risks.length,
        openWorkCount: snapshot.openWork.length,
        capabilities: snapshot.capabilities.map((c) => ({ id: c.id, state: c.state, evidence: c.evidence })),
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Scan failed",
    };
  }
}

/**
 * Files List handler — lists files in a project directory.
 */
export async function handleFilesList(inputs: Record<string, unknown>): Promise<unknown> {
  const repoRoot = getRepoRoot();
  const relPath = (inputs.path as string) || ".";
  const fullPath = join(repoRoot, relPath);

  if (!existsSync(fullPath)) {
    return { success: false, error: `Path not found: ${relPath}` };
  }

  const stat = statSync(fullPath);
  if (!stat.isDirectory()) {
    return { success: false, error: `Not a directory: ${relPath}` };
  }

  const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".cache", ".turbo", "coverage", ".vercel", "__pycache__", ".pnpm-store"]);

  try {
    const entries = readdirSync(fullPath, { withFileTypes: true });
    const items = entries
      .filter((e) => !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
        path: relative(repoRoot, join(fullPath, e.name)).replace(/\\/g, "/"),
        size: e.isFile() ? statSync(join(fullPath, e.name)).size : undefined,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return { success: true, path: relPath, items };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to list files" };
  }
}

/**
 * Files Read handler — reads a file from the project workspace.
 */
export async function handleFilesRead(inputs: Record<string, unknown>): Promise<unknown> {
  const repoRoot = getRepoRoot();
  const relPath = inputs.path as string;
  if (!relPath) {
    return { success: false, error: "path is required" };
  }

  const fullPath = join(repoRoot, relPath);

  if (!existsSync(fullPath)) {
    return { success: false, error: `File not found: ${relPath}` };
  }

  const stat = statSync(fullPath);
  if (stat.isDirectory()) {
    return { success: false, error: `Path is a directory, not a file: ${relPath}` };
  }

  // Limit file size to 256KB to avoid blowing up the prompt
  if (stat.size > 256 * 1024) {
    return { success: false, error: `File too large (${stat.size} bytes). Use terminal.execute with head/tail to inspect portions.` };
  }

  const content = safeReadFile(fullPath);
  if (content === null) {
    return { success: false, error: `Failed to read file: ${relPath}` };
  }

  return {
    success: true,
    path: relPath,
    size: stat.size,
    content,
    lines: content.split("\n").length,
  };
}

/**
 * Git Status handler — returns git status, branch, and recent commits.
 */
export async function handleGitStatus(_inputs: Record<string, unknown>): Promise<unknown> {
  const repoRoot = getRepoRoot();

  const status = safeExec("git status --short --branch", repoRoot);
  const branch = safeExec("git rev-parse --abbrev-ref HEAD", repoRoot);
  const recentCommits = safeExec("git log --oneline -10", repoRoot);
  const diff = safeExec("git diff --stat", repoRoot);

  return {
    success: true,
    branch: branch.stdout || "unknown",
    status: status.stdout || status.stderr || "Not a git repository",
    recentCommits: recentCommits.stdout || "",
    diffStat: diff.stdout || "",
    hasChanges: status.stdout.includes("modified") || status.stdout.includes("untracked") || status.stdout.includes("added"),
  };
}

/**
 * Terminal Execute handler — executes a terminal command.
 * Read-only safe commands execute automatically.
 * Mutation/dangerous commands are blocked unless approval is given.
 */
export async function handleTerminalExecute(inputs: Record<string, unknown>): Promise<unknown> {
  const command = inputs.command as string;
  if (!command) {
    return { success: false, error: "command is required" };
  }

  const hasApproval = (inputs.hasApproval as boolean) ?? false;
  const repoRoot = getRepoRoot();

  // Check if command is dangerous — block entirely
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        success: false,
        error: `Command blocked: contains dangerous pattern. Command: ${command.slice(0, 200)}`,
        blocked: true,
      };
    }
  }

  // If it's a mutation command, require approval
  if (isMutationCommand(command) && !hasApproval) {
    return {
      success: false,
      error: "Approval required for mutation command",
      requiresApproval: true,
      command,
    };
  }

  // If it's not in the safe read-only allowlist and doesn't have approval, require approval
  if (!isSafeReadOnlyCommand(command) && !hasApproval) {
    return {
      success: false,
      error: `Command not in safe read-only allowlist. Approval required.`,
      requiresApproval: true,
      command,
    };
  }

  const result = safeExec(command, repoRoot, 30000);

  return {
    success: result.exitCode === 0,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

/**
 * Project Health handler — runs TypeScript check, lint, and tests.
 */
export async function handleProjectHealth(_inputs: Record<string, unknown>): Promise<unknown> {
  const repoRoot = getRepoRoot();
  const results: Array<{ check: string; status: "pass" | "fail" | "warn" | "skip"; output: string }> = [];

  // TypeScript check
  const tsc = safeExec("npx tsc --noEmit", repoRoot, 60000);
  results.push({
    check: "TypeScript",
    status: tsc.exitCode === 0 ? "pass" : "fail",
    output: (tsc.stdout || tsc.stderr || "No output").slice(0, 2000)
  });

  // Lint check
  const lint = safeExec("npx eslint src/ --max-warnings 0", repoRoot, 60000);
  results.push({
    check: "ESLint",
    status: lint.exitCode === 0 ? "pass" : lint.exitCode === 1 ? "fail" : "warn",
    output: (lint.stdout || lint.stderr || "No output").slice(0, 2000)
  });

  // Test check
  const test = safeExec("npx vitest --run", repoRoot, 60000);
  results.push({
    check: "Tests",
    status: test.exitCode === 0 ? "pass" : "fail",
    output: (test.stdout || test.stderr || "No output").slice(0, 2000)
  });

  // Git status
  const gitStatus = safeExec("git status --short", repoRoot);
  results.push({
    check: "Git Status",
    status: "pass",
    output: gitStatus.stdout || "Clean working tree",
  });

  const overallStatus = results.some((r) => r.status === "fail") ? "fail" : results.some((r) => r.status === "warn") ? "warn" : "pass";

  return {
    success: true,
    overallStatus,
    results,
  };
}

/**
 * Files Write handler — writes content to a file.
 * Always requires approval (enforced by the registry).
 */
export async function handleFilesWrite(inputs: Record<string, unknown>): Promise<unknown> {
  const relPath = inputs.path as string;
  const content = inputs.content as string;
  if (!relPath || content === undefined) {
    return { success: false, error: "path and content are required" };
  }

  const repoRoot = getRepoRoot();
  const fullPath = join(repoRoot, relPath);

  try {
    writeFileSync(fullPath, content, "utf-8");
    return {
      success: true,
      path: relPath,
      bytesWritten: Buffer.byteLength(content, "utf-8"),
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to write file" };
  }
}

/**
 * Image Generate handler — calls the shared media generation API.
 * Uses auto-free mode (Pollinations) by default to avoid wallet requirements.
 * Returns a downloadUrl that can be rendered inline in chat.
 */
export async function handleImageGenerate(inputs: Record<string, unknown>): Promise<unknown> {
  const prompt = inputs.prompt as string;
  const providerId = inputs.providerId as string | undefined;

  if (!prompt || prompt.length < 3) {
    return { success: false, error: "Prompt must be at least 3 characters" };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";
  const url = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;

  try {
    const response = await fetch(`${url}/api/media/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        format: "image",
        generationMode: "auto-free",
        ...(providerId ? { providerId, generationMode: "manual" } : {}),
      }),
    });

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;

    if (!response.ok || !payload) {
      const error = typeof payload?.error === "string" ? payload.error : `Generation failed (${response.status})`;
      return { success: false, error };
    }

    if (payload.success !== true) {
      const error = typeof payload.error === "string" ? payload.error : "Generation failed";
      return { success: false, error };
    }

    return {
      success: true,
      downloadUrl: payload.downloadUrl,
      thumbUrl: payload.thumbUrl ?? null,
      providerId: payload.providerId,
      title: payload.title,
      id: payload.id,
      cost: payload.cost ?? 0,
      free: payload.free ?? true,
      markdown: `![${prompt}](${payload.downloadUrl})`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Image generation request failed" };
  }
}
