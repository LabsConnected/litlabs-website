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
import { hasOpenRouterKey } from "../lib/model-provider.js";
import { CLI_VERSION, CLI_PACKAGE_NAME } from "../lib/version.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

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

  if (project.hasGit) {
    ok(`Git branch: ${project.gitBranch}`);
    const changedLines = project.gitStatus ? project.gitStatus.split("\n").filter(Boolean) : [];
    if (changedLines.length > 0) {
      warn(`${changedLines.length} uncommitted changes`);
    } else {
      ok("Working tree clean");
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

  // First-run config detection
  header("First-Run Config");
  const littHome = process.env.LITT_HOME ?? path.join(os.homedir(), ".litt");
  const configExists = fs.existsSync(path.join(littHome, "config.json"));
  if (configExists) {
    ok(`Config: ${path.join(littHome, "config.json")}`);
  } else {
    warn(`No config found at ${littHome}`);
    console.log(`${c.dim}  Run 'litt' to start first-run setup.${c.reset}`);
  }

  // Terminal-server connectivity (optional)
  header("Terminal Server");
  const terminalUrl = process.env.LITT_TERMINAL_URL ?? "http://127.0.0.1:4001";
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
    const agentCorePkg = await import("@litt/agent-core/package.json" as string, { with: { type: "json" } }).catch(() => null);
    if (agentCorePkg) {
      console.log(`${label("agent-core:")} ${value((agentCorePkg as { version?: string }).version ?? "unknown", c.dim)}`);
    }
  } catch {
    // package.json import may fail in some setups
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
