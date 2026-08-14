/**
 * Project detection and read-only Git tools.
 *
 * These are the first capabilities extracted from the PowerShell cockpit
 * (LiTT-Code.ps1) into the platform-independent core.
 *
 * No hardcoded paths. The project root is resolved through:
 *   1. Explicit argument
 *   2. Git detection from cwd
 *   3. cwd fallback
 *
 * No Supabase, no Clerk, no Next.js.
 */

import * as fs from "fs";
import * as path from "path";
import type { ShellExecutor, ProjectContext, ToolResult } from "./types.js";

// ─── Project Detection ────────────────────────────────────────────

/**
 * Detect the project root from a starting directory.
 *
 * Resolution order:
 *   1. If explicitRoot is provided and valid, use it.
 *   2. Walk up from startDir looking for .git (preferred) or
 *      pnpm-workspace.yaml (monorepo root).
 *   3. If no .git found, walk up looking for package.json.
 *   4. Fall back to startDir.
 */
export function detectProjectRoot(
  startDir: string,
  explicitRoot?: string,
): string {
  if (explicitRoot && fs.existsSync(explicitRoot)) {
    return path.resolve(explicitRoot);
  }

  let dir = path.resolve(startDir);

  // First pass: look for .git or pnpm-workspace.yaml (true project root)
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, ".git")) ||
        fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Second pass: look for package.json (may be a workspace package)
  dir = path.resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.resolve(startDir);
}

/**
 * Resolve full project context: root, name, git status, remote.
 */
export async function resolveProjectContext(
  shell: ShellExecutor,
  cwd?: string,
  explicitRoot?: string,
): Promise<ProjectContext> {
  const root = detectProjectRoot(cwd ?? shell.cwd, explicitRoot);
  const name = path.basename(root);

  // Check if it's a git repo
  const gitDirResult = await shell.execute({
    command: "git",
    args: ["rev-parse", "--is-inside-work-tree"],
    cwd: root,
    timeoutMs: 3000,
  });

  const isGitRepo = gitDirResult.ok && gitDirResult.stdout.trim() === "true";

  if (!isGitRepo) {
    return {
      root,
      name,
      isGitRepo: false,
      branch: null,
      remote: null,
    };
  }

  // Get branch
  const branchResult = await shell.execute({
    command: "git",
    args: ["branch", "--show-current"],
    cwd: root,
    timeoutMs: 3000,
  });

  const branch = branchResult.ok ? branchResult.stdout.trim() || null : null;

  // Get remote
  const remoteResult = await shell.execute({
    command: "git",
    args: ["remote", "get-url", "origin"],
    cwd: root,
    timeoutMs: 3000,
  });

  const remote = remoteResult.ok ? remoteResult.stdout.trim() || null : null;

  return {
    root,
    name,
    isGitRepo: true,
    branch,
    remote,
  };
}

// ─── Read-Only Git Tools ──────────────────────────────────────────

/**
 * Get git status (porcelain format).
 */
export async function gitStatus(shell: ShellExecutor, cwd?: string): Promise<ToolResult> {
  const root = cwd ?? shell.cwd;
  const res = await shell.execute({
    command: "git",
    args: ["status", "--porcelain=v1"],
    cwd: root,
    timeoutMs: 5000,
  });

  if (!res.ok) {
    return {
      success: false,
      message: `git status failed: ${res.error ?? res.stderr}`,
      data: {},
    };
  }

  const lines = res.stdout.trim().split("\n").filter((l) => l.trim());
  return {
    success: true,
    message: lines.length === 0 ? "Working tree clean" : `${lines.length} change(s)`,
    data: {
      porcelain: res.stdout.trim(),
      changeCount: lines.length,
      files: lines,
    },
  };
}

/**
 * Get git diff (unstaged changes).
 */
export async function gitDiff(shell: ShellExecutor, cwd?: string, staged = false): Promise<ToolResult> {
  const root = cwd ?? shell.cwd;
  const args = staged ? ["diff", "--cached"] : ["diff"];
  const res = await shell.execute({
    command: "git",
    args,
    cwd: root,
    timeoutMs: 10000,
  });

  if (!res.ok) {
    return {
      success: false,
      message: `git diff failed: ${res.error ?? res.stderr}`,
      data: {},
    };
  }

  const diff = res.stdout.trim();
  return {
    success: true,
    message: diff ? `${diff.split("\n").length} line(s) of diff` : "No changes",
    data: {
      diff,
      staged,
    },
  };
}

/**
 * Get git log (recent commits).
 */
export async function gitLog(
  shell: ShellExecutor,
  cwd?: string,
  count = 10,
): Promise<ToolResult> {
  const root = cwd ?? shell.cwd;
  const res = await shell.execute({
    command: "git",
    args: ["log", `--oneline`, `-n`, String(count)],
    cwd: root,
    timeoutMs: 5000,
  });

  if (!res.ok) {
    return {
      success: false,
      message: `git log failed: ${res.error ?? res.stderr}`,
      data: {},
    };
  }

  const commits = res.stdout.trim().split("\n").filter((l) => l.trim());
  return {
    success: true,
    message: `${commits.length} commit(s)`,
    data: {
      commits,
      raw: res.stdout.trim(),
    },
  };
}

/**
 * Get the current branch name.
 */
export async function gitBranch(shell: ShellExecutor, cwd?: string): Promise<ToolResult> {
  const root = cwd ?? shell.cwd;
  const res = await shell.execute({
    command: "git",
    args: ["branch", "--show-current"],
    cwd: root,
    timeoutMs: 3000,
  });

  if (!res.ok) {
    return {
      success: false,
      message: `git branch failed: ${res.error ?? res.stderr}`,
      data: {},
    };
  }

  const branch = res.stdout.trim();
  return {
    success: true,
    message: branch ? `On branch ${branch}` : "Detached HEAD",
    data: { branch: branch || null },
  };
}

// ─── File Tools (read-only) ───────────────────────────────────────

/**
 * List files in a directory (non-recursive).
 */
export async function listFiles(
  shell: ShellExecutor,
  dirPath: string,
): Promise<ToolResult> {
  const root = path.resolve(shell.cwd, dirPath);

  if (!fs.existsSync(root)) {
    return {
      success: false,
      message: `Directory not found: ${dirPath}`,
      data: {},
    };
  }

  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    const files = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
    }));
    return {
      success: true,
      message: `${files.length} entr(y/ies)`,
      data: { files },
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to list: ${err instanceof Error ? err.message : String(err)}`,
      data: {},
    };
  }
}

/**
 * Read a file's contents (with path safety).
 */
export async function readFile(
  shell: ShellExecutor,
  filePath: string,
  maxBytes = 100_000,
): Promise<ToolResult> {
  const root = path.resolve(shell.cwd, filePath);

  // Path safety — block sensitive files
  if (!isSafePath(filePath)) {
    return {
      success: false,
      message: `Blocked: ${filePath} matches sensitive file pattern`,
      data: {},
    };
  }

  if (!fs.existsSync(root)) {
    return {
      success: false,
      message: `File not found: ${filePath}`,
      data: {},
    };
  }

  try {
    const stat = fs.statSync(root);
    if (stat.size > maxBytes) {
      return {
        success: false,
        message: `File too large: ${stat.size} bytes (max ${maxBytes})`,
        data: { size: stat.size },
      };
    }
    const content = fs.readFileSync(root, "utf8");
    return {
      success: true,
      message: `${content.length} chars from ${filePath}`,
      data: { content, size: stat.size },
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to read: ${err instanceof Error ? err.message : String(err)}`,
      data: {},
    };
  }
}

/**
 * Search file contents using a simple substring match.
 * (grep/ripgrep integration comes later — this is the baseline.)
 */
export async function searchFiles(
  shell: ShellExecutor,
  query: string,
  filePattern = "*.ts",
  maxResults = 50,
): Promise<ToolResult> {
  // Use git grep if inside a repo, fallback to nothing
  const res = await shell.execute({
    command: "git",
    args: ["grep", "-n", "--", query],
    cwd: shell.cwd,
    timeoutMs: 10000,
  });

  if (res.ok) {
    const lines = res.stdout.trim().split("\n").filter((l) => l.trim()).slice(0, maxResults);
    return {
      success: true,
      message: `${lines.length} match(es)`,
      data: { matches: lines, query },
    };
  }

  // Not a git repo or no matches — return empty
  return {
    success: true,
    message: "No matches (not a git repo or empty result)",
    data: { matches: [], query },
  };
}

// ─── Package.json Inspection ──────────────────────────────────────

/**
 * Read and parse package.json from a directory.
 */
export async function inspectPackageJson(
  shell: ShellExecutor,
  cwd?: string,
): Promise<ToolResult> {
  const root = cwd ?? shell.cwd;
  const pkgPath = path.join(root, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return {
      success: false,
      message: "No package.json found",
      data: {},
    };
  }

  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    return {
      success: true,
      message: `${pkg.name ?? "unnamed"}@${pkg.version ?? "0.0.0"}`,
      data: {
        name: pkg.name,
        version: pkg.version,
        scripts: pkg.scripts ?? {},
        dependencies: Object.keys(pkg.dependencies ?? {}),
        devDependencies: Object.keys(pkg.devDependencies ?? {}),
      },
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`,
      data: {},
    };
  }
}

// ─── Terminal Execution ───────────────────────────────────────────

/**
 * Run a command in the project directory and return structured output.
 *
 * This is the canonical terminal execution function. It uses the shell
 * executor (execFile, no shell-string) for cross-platform safety.
 *
 * Returns stdout, stderr, exit code, and duration.
 */
export async function runCommand(
  shell: ShellExecutor,
  command: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<ToolResult> {
  const cwd = options?.cwd ?? shell.cwd;
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const result = await shell.execute({ command, args, cwd, timeoutMs });

  return {
    success: result.ok,
    message: result.ok
      ? `${command} ${args.join(" ")} — exit 0 (${result.durationMs}ms)`
      : `${command} ${args.join(" ")} — exit ${result.exitCode} (${result.durationMs}ms)`,
    data: {
      command,
      args,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      truncated: result.truncated,
    },
  };
}

/**
 * Run an npm/pnpm script from package.json.
 * Detects the package manager (pnpm > yarn > npm) and runs the script.
 */
export async function runScript(
  shell: ShellExecutor,
  scriptName: string,
  cwd?: string,
): Promise<ToolResult> {
  const root = cwd ?? shell.cwd;
  const pkgPath = path.join(root, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return { success: false, message: "No package.json found", data: {} };
  }

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    return { success: false, message: "Failed to parse package.json", data: {} };
  }

  if (!pkg.scripts?.[scriptName]) {
    const available = Object.keys(pkg.scripts ?? {});
    return {
      success: false,
      message: `No "${scriptName}" script in package.json. Available: ${available.join(", ") || "none"}`,
      data: { availableScripts: available },
    };
  }

  // Detect package manager
  const hasPnpm = fs.existsSync(path.join(root, "pnpm-lock.yaml"));
  const hasYarn = fs.existsSync(path.join(root, "yarn.lock"));
  const pm = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";

  return runCommand(shell, pm, ["run", scriptName], { cwd: root });
}

/**
 * Run typecheck via the project's typecheck script or tsc --noEmit.
 */
export async function runTypecheck(
  shell: ShellExecutor,
  cwd?: string,
): Promise<ToolResult> {
  const root = cwd ?? shell.cwd;
  const pkgPath = path.join(root, "package.json");

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.scripts?.typecheck) {
        return runScript(shell, "typecheck", root);
      }
    } catch { /* fall through to tsc */ }
  }

  // Fallback: run tsc --noEmit directly
  return runCommand(shell, "npx", ["tsc", "--noEmit"], { cwd: root });
}

/**
 * Run tests via the project's test script.
 */
export async function runTest(
  shell: ShellExecutor,
  cwd?: string,
): Promise<ToolResult> {
  return runScript(shell, "test", cwd ?? shell.cwd);
}

/**
 * Run build via the project's build script.
 */
export async function runBuild(
  shell: ShellExecutor,
  cwd?: string,
): Promise<ToolResult> {
  return runScript(shell, "build", cwd ?? shell.cwd);
}

// ─── Path Safety ──────────────────────────────────────────────────

const BLOCKED_PATH_PATTERNS: readonly RegExp[] = [
  /^\.env(\.|$)/i,
  /(^|[/\\])\.env(\.|$)/i,
  /(^|[/\\])node_modules([/\\]|$)/i,
  /(^|[/\\])\.git([/\\]|$)/i,
  /(^|[/\\])\.ssh([/\\]|$)/i,
  /(^|[/\\])\.aws([/\\]|$)/i,
  /(^|[/\\])\.npmrc$/i,
  /(^|[/\\])credentials(\.json)?$/i,
  /(^|[/\\])id_rsa($|\.)/i,
  /(^|[/\\])\.htpasswd$/i,
  /(^|[/\\])secrets?(\.json|\.yaml|\.yml|\.toml)?$/i,
];

export function isSafePath(filePath: string): boolean {
  // Block absolute paths
  if (path.isAbsolute(filePath)) return false;
  // Block path traversal
  if (filePath.includes("..")) return false;
  // Block null bytes
  if (filePath.includes("\0")) return false;
  // Block sensitive patterns
  return !BLOCKED_PATH_PATTERNS.some((re) => re.test(filePath));
}
