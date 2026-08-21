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

import { exec, hasCommand, ok, fail, warn, header, label, value, detectProject, c } from "../lib/utils.js";
import { getGitState } from "../lib/git-state.js";
import { hasOpenRouterKey } from "../lib/model-provider.js";
import { CLI_VERSION, CLI_PACKAGE_NAME } from "../lib/version.js";
import { ensureConfig, getConfigPath } from "../lib/config.js";
import { getTerminalUrl } from "../lib/auth/auth-config.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createRequire } from "node:module";

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

  // Git
  if (hasCommand("git")) {
    const gitVersion = exec("git --version").stdout;
    ok(`Git: ${gitVersion}`);
  } else {
    fail("Git not found");
  }

  // Package managers
  for (const pm of ["pnpm", "npm", "yarn"]) {
    if (hasCommand(pm)) {
      const ver = exec(`${pm} --version`).stdout;
      ok(`${pm}: v${ver}`);
    } else {
      warn(`${pm}: not installed`);
    }
  }

  // Network — check if litlabs.net is reachable
  header("Network");
  try {
    const result = exec(
      process.platform === "win32"
        ? "powershell -Command (Invoke-WebRequest -Uri https://litlabs.net -Method Head -TimeoutSec 5 -UseBasicParsing).StatusCode"
        : "curl -sI https://litlabs.net | head -1",
    );
    if (result.exitCode === 0 && (result.stdout.includes("200") || result.stdout.includes("301") || result.stdout.includes("302"))) {
      ok("litlabs.net reachable");
    } else {
      warn("litlabs.net not reachable (may be offline)");
    }
  } catch {
    warn("Network check failed");
  }

  // Project
  header("Project");
  const project = detectProject();
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
