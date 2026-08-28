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
import { hasProviderKey } from "../lib/model-provider.js";
import { CLI_VERSION, CLI_PACKAGE_NAME } from "../lib/version.js";
import { ensureConfig, getConfigPath } from "../lib/config.js";
import { getTerminalUrl } from "../lib/auth/auth-config.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { createRequire } from "node:module";
import { tryCommandOutputAsync, type WhichEnv } from "../lib/which.js";

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

  // Git + package managers — probed in parallel through the canonical
  // executable resolver (lib/which.ts). See probeToolVersions below for
  // why the resolver is mandatory rather than a nicety.
  const { git: gitVer, pnpm: pnpmVer, npm: npmVer, yarn: yarnVer } =
    await probeToolVersions();

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
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "LITT_TERMINAL_URL",
    "LITT_MODE",
  ];
  for (const envVar of envVars) {
    if (process.env[envVar]) ok(`${envVar}: set`);
    else warn(`${envVar}: not set`);
  }
  if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY && !process.env.GROQ_API_KEY) {
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
  const providerStatus = process.env.OPENAI_API_KEY
    ? value("OpenAI (key set)", c.green)
    : process.env.GROQ_API_KEY
      ? value("Groq (key set)", c.green)
      : process.env.OPENROUTER_API_KEY
        ? value("OpenRouter (key set)", c.green)
        : value("not configured", c.yellow);
  console.log(`${label("Model Provider:")} ${providerStatus}`);
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

/** The tool versions `litt doctor` reports. `null` means genuinely absent. */
export interface ToolVersions {
  git: string | null;
  pnpm: string | null;
  npm: string | null;
  yarn: string | null;
}

/**
 * Probe the version of each tool doctor reports on, in parallel.
 *
 * This MUST go through the canonical resolver in lib/which.ts. The
 * previous implementation called `execFileSync(cmd, args, { shell: false })`
 * directly, which on Windows is a raw CreateProcess and can only launch
 * real PE executables. `git` resolves to `git.exe` and worked; `pnpm`,
 * `npm` and `yarn` are `.CMD` batch shims, so every call threw ENOENT and
 * doctor reported "pnpm: not installed" on machines where pnpm was
 * installed and actively running the build. A diagnostic that lies is
 * worse than no diagnostic.
 *
 * `whichSync` walks PATH with PATHEXT applied and routes genuine batch
 * shims through cmd.exe, so detection matches what would actually run.
 * The parallel-probe performance win of the old code is kept: resolution
 * is pure filesystem work and nothing here ever spawns a shell to FIND a
 * command.
 *
 * `env` is injected by tests; production always uses the real PATH.
 */
export async function probeToolVersions(env: WhichEnv = {}): Promise<ToolVersions> {
  const [git, pnpm, npm, yarn] = await Promise.all([
    tryCommandOutputAsync("git", ["--version"], env),
    tryCommandOutputAsync("pnpm", ["--version"], env),
    tryCommandOutputAsync("npm", ["--version"], env),
    tryCommandOutputAsync("yarn", ["--version"], env),
  ]);
  return { git, pnpm, npm, yarn };
}
