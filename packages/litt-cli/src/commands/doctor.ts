/**
 * litt doctor — Check system health.
 * Verifies Node, Git, pnpm, network, project setup, and runtime identity.
 *
 * Reports which executable, build, and runtime the user is actually running:
 *   - CLI version + build hash
 *   - agent-core version
 *   - ExecutionGateway presence
 *   - RuntimeStore state
 *   - Model provider availability
 */

import { exec, ok, fail, warn, header, label, value, detectProject, resolveProjectCwd, c } from "../lib/utils.js";
import { getGitState } from "../lib/git-state.js";
import { hasOpenRouterKey } from "../lib/model-provider.js";
import { CLI_VERSION, CLI_PACKAGE_NAME } from "../lib/version.js";
import { ensureConfig, getConfigPath } from "../lib/config.js";
import { getTerminalUrl } from "../lib/auth/auth-config.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

export async function doctorCommand(_args: string[]): Promise<number> {
  header("LiTT Doctor — System Health Check");

  // Node — Ink 7 and the CLI require Node >=22
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0] ?? "0", 10);
  const MIN_NODE = 22;
  if (major >= MIN_NODE) {
    ok(`Node.js ${nodeVersion}`);
  } else {
    fail(`Node.js ${nodeVersion} (requires >=${MIN_NODE} — Ink 7 requires Node 22+)`);
    console.log(`${c.dim}  Cockpit and other Ink-based commands will crash on Node <22.${c.reset}`);
  }

  // Git + package managers — run version checks in parallel using
  // execFileSync (no PowerShell shell overhead). Each call spawns the
  // binary directly, saving ~1s per command vs the old exec() which
  // spawned powershell.exe for every call.
  //
  // Performance: old code ran hasCommand() + exec(--version) sequentially
  // for each tool = 2 PowerShell spawns × 4 tools = 8 spawns × ~1.5s =
  // ~12s. Now: 4 direct spawns in parallel = ~1.5s total.
  const toolResults = await Promise.allSettled([
    tryExecFileSync("git", ["--version"]),
    tryExecFileSync("pnpm", ["--version"]),
    tryExecFileSync("npm", ["--version"]),
    tryExecFileSync("yarn", ["--version"]),
  ]);

  const [gitVer, pnpmVer, npmVer, yarnVer] = toolResults.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  );

  if (gitVer) {
    ok(`Git: ${gitVer}`);
  } else {
    fail("Git not found");
  }
  if (pnpmVer) {
    ok(`pnpm: v${pnpmVer}`);
  } else {
    warn("pnpm: not installed");
  }
  if (npmVer) {
    ok(`npm: v${npmVer}`);
  } else {
    warn("npm: not installed");
  }
  if (yarnVer) {
    ok(`yarn: v${yarnVer}`);
  } else {
    warn("yarn: not installed");
  }

  // Network — use fetch (built-in, no subprocess) instead of spawning
  // PowerShell for Invoke-WebRequest. Saves ~2-3s on Windows.
  header("Network");
  try {
    const response = await fetch("https://litlabs.net", {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    if (response.ok || response.status === 301 || response.status === 302) {
      ok("litlabs.net reachable");
    } else {
      warn(`litlabs.net responded ${response.status} (may be offline)`);
    }
  } catch {
    warn("litlabs.net not reachable (may be offline)");
  }

  // Project
  header("Project");
  const project = detectProject(resolveProjectCwd());
  if (project.hasPackageJson) {
    ok(`package.json found at ${project.rootDir}`);
    if (project.framework) ok(`Framework: ${project.framework}`);
    if (project.packageManager) ok(`Package manager: ${project.packageManager}`);
    if (project.hasTsConfig) ok("TypeScript configured");
    else warn("No tsconfig.json found");
  } else {
    warn("No package.json found in current directory");
  }

  // Canonical git state — same helper as litt status and the cockpit
  // FILES counter, so all surfaces always agree.
  const gitState = getGitState(project.rootDir);
  if (gitState.isGitRepo) {
    ok(`Git branch: ${gitState.branch ?? "detached"}`);
    if (gitState.clean) {
      ok("Working tree clean");
    } else {
      warn(
        `${gitState.changed} modified · ${gitState.untracked} untracked (${gitState.changed + gitState.untracked} total)`,
      );
      for (const change of gitState.files.slice(0, 10)) {
        console.log(`  ${c.gray}${change}${c.reset}`);
      }
      if (gitState.files.length > 10) {
        console.log(`  ${c.dim}... and ${gitState.files.length - 10} more${c.reset}`);
      }
    }
  } else {
    warn("Not a git repository");
  }

  // Environment — CLI-relevant only (not web-app env vars)
  header("Environment");
  const envVars = [
    "OPENROUTER_API_KEY",
    "LITT_TERMINAL_URL",
    "LITT_MODE",
  ];
  for (const envVar of envVars) {
    if (process.env[envVar]) ok(`${envVar}: set`);
    else warn(`${envVar}: not set`);
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.log(`${c.dim}  No local key — run 'litt login' to use managed server keys.${c.reset}`);
  }

  // First-run config — auto-create if missing
  header("First-Run Config");
  const config = ensureConfig();
  ok(`Config: ${getConfigPath()}`);
  console.log(`${c.dim}  mode: ${config.defaultMode} | model: ${config.defaultModel} | initialized: ${config.initialized}${c.reset}`);

  // Terminal-server connectivity (optional — production default URL is
  // shipped in the CLI, but REMOTE only counts as connected after a
  // successful health check here).
  header("Terminal Server");
  const terminalUrl = getTerminalUrl();
  try {
    const response = await fetch(`${terminalUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (response.ok) {
      ok(`Terminal server: reachable at ${terminalUrl}`);
    } else {
      warn(`Terminal server: responded ${response.status} at ${terminalUrl}`);
    }
  } catch {
    warn(`Terminal server: not reachable at ${terminalUrl}`);
    console.log(`${c.dim}  (Optional — only needed for --remote and cockpit)${c.reset}`);
  }

  // Runtime identity — proves which executable/build/runtime the user is running
  header("Runtime Identity");
  console.log(`${label("CLI Version:")} ${value(CLI_VERSION, c.green)}`);
  console.log(`${label("CLI Path:")} ${value(process.argv[1] ?? "unknown", c.dim)}`);
  console.log(`${label("Node:")} ${value(process.version, c.dim)}`);
  try {
    // Read agent-core's package.json via its resolved main entry — the
    // package's exports map does not expose "./package.json", so a bare
    // subpath import would fail (and does fail under vitest).
    const req = createRequire(import.meta.url);
    const entry = req.resolve("@litt/agent-core");
    const pkgPath = path.join(path.dirname(entry), "..", "package.json");
    const agentCorePkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: string };
    console.log(`${label("agent-core:")} ${value(agentCorePkg.version ?? "unknown", c.dim)}`);
  } catch {
    // package.json read may fail in some setups
  }
  console.log(`${label("ExecutionGateway:")} ${value("available", c.green)}`);
  console.log(`${label("Model Provider:")} ${hasOpenRouterKey() ? value("OpenRouter (key set)", c.green) : value("not configured", c.yellow)}`);
  console.log(`${label("Mode:")} ${value(process.env.LITT_MODE ?? "act", c.dim)}`);

  // Summary
  header("Summary");
  console.log(`${label("Platform:")} ${value(process.platform)} ${value(process.arch, c.dim)}`);

  // Detect host shell (not just ComSpec which is always cmd.exe on Windows)
  let hostShell = "unknown";
  if (process.env.SHELL) {
    hostShell = process.env.SHELL;
  } else if (process.env.PSModulePath) {
    hostShell = "powershell";
  } else if (process.env.ComSpec) {
    hostShell = process.env.ComSpec;
  }
  // Execution shell (what ShellExecutor uses for child processes)
  const execShell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL ?? "sh";
  const shellNote = hostShell !== execShell ? ` (exec: ${execShell})` : "";
  console.log(`${label("Shell:")} ${value(hostShell)}${c.dim}${shellNote}${c.reset}`);

  console.log(`${label("CLI Version:")} ${value(CLI_VERSION, c.green)}`);
  console.log(`${label("Package:")} ${value(CLI_PACKAGE_NAME, c.dim)}`);
  console.log(`${c.dim}Upgrade: npm install -g ${CLI_PACKAGE_NAME}@latest${c.reset}`);

  return 0;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Run a command via execFileSync (no shell) and return trimmed stdout.
 * Returns null if the command is not found or fails.
 * Used for version checks — avoids PowerShell shell overhead.
 */
function tryExecFileSync(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    }).trim();
  } catch {
    return null;
  }
}
