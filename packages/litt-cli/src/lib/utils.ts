/**
 * Shared CLI utilities — colored output, exec, project detection.
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";

// ANSI colors (no dependency needed — use raw codes)
export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export function ok(msg: string): void {
  console.log(`${c.green}✓${c.reset} ${msg}`);
}

export function fail(msg: string): void {
  console.log(`${c.red}✗${c.reset} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${c.yellow}!${c.reset} ${msg}`);
}

export function info(msg: string): void {
  console.log(`${c.blue}ℹ${c.reset} ${msg}`);
}

export function header(title: string): void {
  console.log(`\n${c.bold}${c.magenta}${title}${c.reset}`);
  console.log(`${c.gray}${"─".repeat(Math.min(title.length + 4, 60))}${c.reset}`);
}

export function label(text: string): string {
  return `${c.dim}${text.padEnd(16)}${c.reset}`;
}

export function value(text: string, color = c.reset): string {
  return `${color}${text}${c.reset}`;
}

export function exec(cmd: string, options: { cwd?: string } = {}): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
      cwd: options.cwd,
      shell: process.platform === "win32" ? "powershell.exe" : undefined,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? "").toString().trim(),
      exitCode: e.status ?? 1,
    };
  }
}

export function hasCommand(cmd: string): boolean {
  const check = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
  return exec(check).exitCode === 0;
}

export interface ProjectInfo {
  hasPackageJson: boolean;
  packageJson: Record<string, unknown> | null;
  hasGit: boolean;
  gitBranch: string | null;
  gitStatus: string | null;
  gitRemote: string | null;
  hasTsConfig: boolean;
  framework: string | null;
  packageManager: string | null;
  rootDir: string;
  dirName: string;
}

export function detectProject(dir = process.cwd()): ProjectInfo {
  // Walk upward to find the project root.
  // Resolution order:
  //   1. Walk up looking for .git or pnpm-workspace.yaml (true project root)
  //   2. Walk up looking for package.json (may be a workspace package)
  //   3. Fall back to the starting directory
  let rootDir = resolve(dir);

  // First pass: look for .git or pnpm-workspace.yaml
  let searchDir = resolve(dir);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(searchDir, ".git")) ||
        existsSync(join(searchDir, "pnpm-workspace.yaml"))) {
      rootDir = searchDir;
      break;
    }
    const parent = dirname(searchDir);
    if (parent === searchDir) break;
    searchDir = parent;
  }

  // If no .git found, second pass: look for package.json
  if (rootDir === resolve(dir) && !existsSync(join(rootDir, ".git"))) {
    searchDir = resolve(dir);
    for (let i = 0; i < 20; i++) {
      if (existsSync(join(searchDir, "package.json"))) {
        rootDir = searchDir;
        break;
      }
      const parent = dirname(searchDir);
      if (parent === searchDir) break;
      searchDir = parent;
    }
  }

  const pkgPath = join(rootDir, "package.json");
  const hasPackageJson = existsSync(pkgPath);
  const packageJson = hasPackageJson
    ? (JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>)
    : null;

  const hasGit = existsSync(join(rootDir, ".git"));
  // Use execFileSync (no shell) for git commands — avoids spawning
  // PowerShell on Windows, saving ~600ms per call.
  // Fallback to exec() if execFileSync fails (e.g. git not in PATH
  // without shell resolution on some Windows setups).
  const gitBranch = hasGit
    ? (tryExecFileSync("git", ["branch", "--show-current"], rootDir) ??
       tryExecFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], rootDir) ??
       null)
    : null;
  const gitStatus = hasGit ? tryExecFileSync("git", ["status", "--short"], rootDir) : null;
  const gitRemote = hasGit ? tryExecFileSync("git", ["remote", "get-url", "origin"], rootDir) : null;

  const hasTsConfig = existsSync(join(rootDir, "tsconfig.json"));

  // Detect framework
  let framework: string | null = null;
  if (packageJson) {
    const deps = { ...(packageJson.dependencies as Record<string, string> ?? {}), ...(packageJson.devDependencies as Record<string, string> ?? {}) };
    if (deps["next"]) framework = "Next.js";
    else if (deps["react-scripts"]) framework = "Create React App";
    else if (deps["vite"] && deps["react"]) framework = "Vite + React";
    else if (deps["vite"]) framework = "Vite";
    else if (deps["astro"]) framework = "Astro";
    else if (deps["@remix-run/dev"]) framework = "Remix";
    else if (deps["svelte"]) framework = "Svelte";
    else if (deps["vue"]) framework = "Vue";
  }

  // Detect package manager — filesystem checks first (no subprocess),
  // then try execFileSync (no shell overhead) as fallback.
  let packageManager: string | null = null;
  if (existsSync(join(rootDir, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (existsSync(join(rootDir, "yarn.lock"))) packageManager = "yarn";
  else if (existsSync(join(rootDir, "package-lock.json"))) packageManager = "npm";
  else if (tryExecFileSync("pnpm", ["--version"])) packageManager = "pnpm";
  else if (tryExecFileSync("yarn", ["--version"])) packageManager = "yarn";
  else packageManager = "npm";

  return {
    hasPackageJson,
    packageJson,
    hasGit,
    gitBranch,
    gitStatus,
    gitRemote,
    hasTsConfig,
    framework,
    packageManager,
    rootDir,
    dirName: basename(rootDir),
  };
}

export function hasEnvVar(name: string): boolean {
  return Boolean(process.env[name]);
}

export function readStdin(): string {
  // Synchronous read from stdin if piped
  try {
    const data = readFileSync(0, "utf-8");
    return data.trim();
  } catch {
    return "";
  }
}

/**
 * Run a command via execFileSync (no shell) and return trimmed stdout.
 * Returns null if the command fails or is not found.
 * Avoids PowerShell shell overhead on Windows (~600ms per call).
 */
function tryExecFileSync(command: string, args: string[], cwd?: string): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      cwd,
    }).trim() || null;
  } catch {
    return null;
  }
}
