/**
 * Shared CLI utilities — colored output, exec, project detection.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
  hasTsConfig: boolean;
  framework: string | null;
  packageManager: string | null;
  rootDir: string;
}

export function detectProject(dir = process.cwd()): ProjectInfo {
  const rootDir = resolve(dir);
  const pkgPath = join(rootDir, "package.json");
  const hasPackageJson = existsSync(pkgPath);
  const packageJson = hasPackageJson
    ? (JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>)
    : null;

  const hasGit = existsSync(join(rootDir, ".git"));
  const gitBranch = hasGit ? exec("git rev-parse --abbrev-ref HEAD", { cwd: rootDir }).stdout || null : null;
  const gitStatus = hasGit ? exec("git status --short", { cwd: rootDir }).stdout || null : null;

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

  // Detect package manager
  let packageManager: string | null = null;
  if (existsSync(join(rootDir, "pnpm-lock.yaml"))) packageManager = "pnpm";
  else if (existsSync(join(rootDir, "yarn.lock"))) packageManager = "yarn";
  else if (existsSync(join(rootDir, "package-lock.json"))) packageManager = "npm";
  else if (hasCommand("pnpm")) packageManager = "pnpm";
  else if (hasCommand("yarn")) packageManager = "yarn";
  else packageManager = "npm";

  return {
    hasPackageJson,
    packageJson,
    hasGit,
    gitBranch,
    gitStatus,
    hasTsConfig,
    framework,
    packageManager,
    rootDir,
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
