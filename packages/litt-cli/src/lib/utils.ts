/**
 * Shared CLI utilities — colored output, exec, project detection.
 */

import { execSync, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

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

export function exec(cmd: string, options: { cwd?: string; timeout?: number } = {}): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: options.timeout ?? 15000,
      cwd: options.cwd,
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === "win32" ? "powershell.exe" : undefined,
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; status?: number; signal?: string };
    // On timeout, execSync throws with signal "SIGTERM"
    if (e.signal === "SIGTERM") {
      return {
        stdout: (e.stdout ?? "").toString().trim(),
        stderr: "Command timed out",
        exitCode: 124,
      };
    }
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
  /**
   * True when the detected root is LiTT's own install/runtime directory
   * (the CLI package dir or a dir whose package.json name is a known
   * LiTT runtime package). When true, the caller should NOT treat this
   * as the user's active project — it's the launcher chdir'ing into the
   * install dir before exec'ing node.
   */
  isSelfInstall: boolean;
}

/**
 * Resolve the effective starting directory for project detection.
 *
 * Priority:
 *   1. `cwdFlag` — the `--cwd <path>` value parsed by resolveDispatch()
 *      (lets a launcher that must chdir into the LiTT install dir pass
 *      the caller's real working directory).
 *   2. `process.env.LITT_CWD` — same purpose, env-var form (convenient
 *      for shell wrappers that can't easily rewrite argv).
 *   3. `process.cwd()` — the default when neither override is set.
 *
 * The resolved path is normalized to absolute. A non-existent override
 * is ignored (falls back to process.cwd()) so a stale env var can never
 * break startup.
 */
export function resolveProjectCwd(cwdFlag?: string): string {
  const override = cwdFlag ?? process.env.LITT_CWD;
  if (override) {
    const abs = resolve(override);
    if (existsSync(abs)) return abs;
  }
  return process.cwd();
}

/**
 * Package.json `name` values that identify a LiTT runtime/install dir.
 * If `detectProject` walks upward and lands on a directory whose
 * package.json has one of these names, that's LiTT inspecting itself —
 * not the user's project.
 */
const LITT_RUNTIME_PACKAGE_NAMES = new Set([
  "litt-runtime",
  "litt-cli",
  "@litlabs/litt-cli",
  "@litt/litt-cli",
  "@litt/agent-core",
]);

/**
 * The on-disk location of THIS CLI package, computed from import.meta.url.
 * Used to detect when the detected project root is the LiTT install dir
 * itself (compare against rootDir). Computed once, lazily.
 */
let cliPackageDir: string | null | undefined;
function getCliPackageDir(): string | null {
  if (cliPackageDir !== undefined) return cliPackageDir;
  try {
    // dist/lib/utils.js → dist → package root (packages/litt-cli)
    const here = dirname(fileURLToPath(import.meta.url));
    cliPackageDir = resolve(here, "..");
  } catch {
    cliPackageDir = null;
  }
  return cliPackageDir;
}

/**
 * Returns true if `dir` is LiTT's own install/runtime directory:
 *   - `dir` equals the CLI package dir (packages/litt-cli), OR
 *   - `dir`'s package.json `name` is a known LiTT runtime package name.
 *
 * Used by `detectProject` to reject self-inspection: when a launcher
 * chdirs into ~/litt before exec'ing node, the upward walk would land
 * on the install dir and LiTT would inspect itself instead of the
 * user's real repo.
 */
export function isLiTTInstallDir(dir: string): boolean {
  const abs = resolve(dir);
  const cliDir = getCliPackageDir();
  if (cliDir && abs === cliDir) return true;

  const pkgPath = join(abs, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: unknown };
      if (typeof pkg.name === "string" && LITT_RUNTIME_PACKAGE_NAMES.has(pkg.name)) {
        return true;
      }
    } catch {
      // unreadable package.json — not enough evidence to call it self-install
    }
  }
  return false;
}

export function detectProject(dir = process.cwd()): ProjectInfo {
  // Walk upward to find the project root.
  // Resolution order:
  //   1. Walk up looking for .git or pnpm-workspace.yaml (true project root)
  //   2. Walk up looking for package.json (may be a workspace package)
  //   3. Fall back to the starting directory
  let rootDir = resolve(dir);
  const startDir = resolve(dir);

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
  if (rootDir === startDir && !existsSync(join(rootDir, ".git"))) {
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

  // ─── Self-install guard ──────────────────────────────────────────
  // If the upward walk landed on LiTT's own install/runtime directory
  // (a launcher chdir'd into ~/litt before exec'ing node, so process.cwd()
  // IS the install dir), do NOT inspect LiTT itself. Fall back to the
  // starting directory and flag it so the caller can warn the user.
  // This is the workspace-context bug: without this guard, LiTT reports
  // `litt-runtime@0.0.0` / "unknown branch" / "no scripts" because it's
  // inspecting its own runtime copy instead of the user's real repo.
  let isSelfInstall = false;
  if (isLiTTInstallDir(rootDir)) {
    isSelfInstall = true;
    rootDir = startDir;
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
    isSelfInstall,
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
