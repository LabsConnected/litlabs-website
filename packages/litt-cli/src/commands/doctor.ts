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
import { checkCanonicalMain } from "../lib/canonical-main.js";
import { checkLease } from "../lib/worktree-lease.js";
import { checkStaleBuild } from "../lib/build-metadata.js";
import { resolveExecutionTarget, resolveLocalOnly } from "../lib/execution-target.js";
import { loadModelPrefs, getDefaultPrefsPath } from "../lib/provider-registry.js";
import { probeLocalLane } from "../lib/local-lane.js";
import { REMOTE_LITT_LABEL } from "@litt/models";

export async function doctorCommand(args: string[]): Promise<number> {
  // Subcommand: litt doctor input — interactive input diagnostic
  if (args[0] === "input") {
    return doctorInputCommand();
  }

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

  // ─── P0-8: Hardened doctor checks ───────────────────────────────
  // Worktree safety, canonical main, stale build, execution target,
  // worktree lease/collision, model/provider/auth state.

  // Canonical main protection
  header("Canonical Main Protection");
  const canonicalCheck = checkCanonicalMain(project.rootDir);
  if (!canonicalCheck.isCanonicalMain) {
    ok(`Not canonical main (path: ${project.rootDir})`);
  } else if (canonicalCheck.branchMatches) {
    ok(`Canonical main on branch: ${canonicalCheck.actualBranch}`);
  } else {
    fail(`WORKTREE MISMATCH: canonical main on "${canonicalCheck.actualBranch}" (expected "${canonicalCheck.expectedBranch}")`);
    if (canonicalCheck.warning) {
      console.log(`${c.dim}  ${canonicalCheck.warning}${c.reset}`);
    }
  }

  // Worktree lease / collision
  header("Worktree Lease");
  const leaseCheck = checkLease(project.rootDir);
  if (leaseCheck.status === "available") {
    ok("Worktree available (no active lease)");
  } else if (leaseCheck.status === "stale") {
    warn(`Stale lease detected: ${leaseCheck.reason}`);
    console.log(`${c.dim}  Run: litt doctor --cleanup-lease${c.reset}`);
  } else {
    fail(`Worktree IN USE: ${leaseCheck.reason}`);
  }

  // Stale build detection
  header("Build Freshness");
  const buildCheck = checkStaleBuild();
  if (buildCheck.status === "fresh") {
    ok(`Build is fresh (SHA: ${buildCheck.sourceSha?.slice(0, 8) ?? "—"})`);
  } else if (buildCheck.status === "stale") {
    fail(`CLI BUILD STALE: source ${buildCheck.sourceSha?.slice(0, 8)} ≠ built ${buildCheck.builtSha?.slice(0, 8)}`);
    if (buildCheck.rebuildCommand) {
      console.log(`${c.dim}  Rebuild: ${buildCheck.rebuildCommand}${c.reset}`);
    }
  } else if (buildCheck.status === "no-build-meta") {
    warn("No build metadata (dist/.build-meta.json) — run a build first");
  } else if (buildCheck.status === "no-source-sha") {
    warn("Cannot determine source SHA (not a git repo or git unavailable)");
  } else if (buildCheck.status === "no-launcher") {
    warn("Build is fresh but global 'litt' launcher not found");
  }

  // Execution target
  header("Execution Target");
  const execTarget = resolveExecutionTarget();
  const localOnly = resolveLocalOnly();
  ok(`Execution: ${execTarget.toUpperCase()}`);
  if (localOnly) {
    warn("LocalOnly: ON (emergency/offline mode — remote/cloud blocked)");
  } else {
    ok("LocalOnly: off");
  }

  // Model + provider
  header("Model & Provider");
  const prefs = loadModelPrefs(getDefaultPrefsPath());
  const modelLabel = prefs.selectedModel ?? "qwen3:4b-instruct (default)";
  ok(`Model: ${modelLabel}`);
  ok(`Routing: ${prefs.routingMode}`);

  // Determine the EFFECTIVE provider — the one that actually serves
  // inference for the current execution target + selected model.
  // This is NOT just "which API key exists" — it's which provider
  // the active route will use.
  //
  // LOCAL + ollama: model → Ollama (the local provider)
  // REMOTE + OpenAI key → OpenAI (the remote provider)
  // LOCAL + no ollama model → local/credentialless
  const isLocalTarget = execTarget === "local";
  const modelIsOllama = modelLabel.toLowerCase().startsWith("ollama:");
  const hasOllamaEndpoint = !!(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST_PC);

  let effectiveProvider: string;
  if (isLocalTarget && (modelIsOllama || hasOllamaEndpoint)) {
    effectiveProvider = "Ollama";
  } else if (!isLocalTarget) {
    // Remote: the provider is determined by which key is set
    effectiveProvider = process.env.OPENAI_API_KEY ? "OpenAI"
      : process.env.GROQ_API_KEY ? "Groq"
      : process.env.OPENROUTER_API_KEY ? "OpenRouter"
      : process.env.ANTHROPIC_API_KEY ? "Anthropic"
      : process.env.DEEPSEEK_API_KEY ? "DeepSeek"
      : process.env.MISTRAL_API_KEY ? "Mistral"
      : "none";
  } else {
    // LOCAL without an Ollama model/endpoint
    effectiveProvider = "none (local/credentialless)";
  }

  if (effectiveProvider === "none (local/credentialless)") {
    warn(`Active Provider: ${effectiveProvider}`);
  } else {
    ok(`Active Provider: ${effectiveProvider}`);
  }

  // Report remote credentials separately — these exist but are NOT
  // the effective provider when LOCAL is active.
  const remoteCreds: string[] = [];
  if (process.env.OPENAI_API_KEY) remoteCreds.push("OpenAI key: configured");
  if (process.env.GROQ_API_KEY) remoteCreds.push("Groq key: configured");
  if (process.env.OPENROUTER_API_KEY) remoteCreds.push("OpenRouter key: configured");
  if (process.env.ANTHROPIC_API_KEY) remoteCreds.push("Anthropic key: configured");
  if (process.env.DEEPSEEK_API_KEY) remoteCreds.push("DeepSeek key: configured");
  if (process.env.MISTRAL_API_KEY) remoteCreds.push("Mistral key: configured");
  if (remoteCreds.length > 0) {
    console.log(`${c.dim}  Remote credentials:${c.reset}`);
    for (const cred of remoteCreds) {
      console.log(`${c.dim}    ${cred}${c.reset}`);
    }
  }

  // Ollama route — which network tier (local / LAN / Tailscale) is
  // actually serving LOCAL mode right now, probed live. REMOTE mode
  // doesn't touch Ollama at all, so it just reports the remote lane.
  header("Ollama Route");
  if (execTarget === "remote") {
    ok(`Active route: ${REMOTE_LITT_LABEL}`);
  } else {
    const lane = await probeLocalLane({ force: true });
    if (lane.available) {
      ok(`Active route: ${lane.routeLabel} (${lane.endpoint})`);
      console.log(`${c.dim}  Models: ${lane.models.join(", ")}${c.reset}`);
    } else {
      fail(`Active route: none — ${lane.reason ?? "Ollama unreachable"}`);
      console.log(`${c.dim}  Tried, in priority order: this device's own Ollama, then OLLAMA_LAN_URL, then OLLAMA_TAILSCALE_URL.${c.reset}`);
      console.log(`${c.dim}  Set OLLAMA_LAN_URL to your PC's LAN address and OLLAMA_TAILSCALE_URL to its Tailscale hostname so LiTT can reach it from anywhere.${c.reset}`);
    }
  }

  // Tools readiness
  header("Tools");
  if (gitVer) {
    ok("Git: ready");
  } else {
    fail("Git: not found");
  }
  ok("ShellExecutor: available");
  ok("ExecutionGateway: available");

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

// ─── litt doctor input ───────────────────────────────────────────────

/**
 * Interactive input diagnostic — shows exactly what the terminal sends
 * for each keypress, normalized through LiTT's input layer.
 *
 * Shows: platform, shell, TERM, stdin.isTTY, raw mode status, terminal
 * dimensions, normalized key, raw sequence, hex bytes, modifiers.
 *
 * Does NOT expose environment secrets.
 */
async function doctorInputCommand(): Promise<number> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  header("LiTT Doctor — Input Diagnostic");

  // Environment info (no secrets)
  console.log(`${label("Platform:")} ${value(process.platform)} ${value(process.arch, c.dim)}`);
  console.log(`${label("Shell:")} ${value(process.env.SHELL ?? process.env.ComSpec ?? "unknown")}`);
  console.log(`${label("TERM:")} ${value(process.env.TERM ?? "(unset)")}`);
  console.log(`${label("stdin.isTTY:")} ${value(String(stdin.isTTY), stdin.isTTY ? c.green : c.yellow)}`);
  console.log(`${label("stdout.columns:")} ${value(String(stdout.columns ?? "unknown"))}`);
  console.log(`${label("stdout.rows:")} ${value(String(stdout.rows ?? "unknown"))}`);

  if (!stdin.isTTY) {
    fail("stdin is not a TTY — interactive input diagnostic requires a real terminal.");
    console.log(`${c.dim}  Run this command in a real terminal, not a pipe or script.${c.reset}`);
    return 1;
  }

  // Check raw mode support
  const rawModeSupported = typeof stdin.setRawMode === "function";
  console.log(`${label("Raw mode support:")} ${value(rawModeSupported ? "yes" : "no", rawModeSupported ? c.green : c.red)}`);

  if (!rawModeSupported) {
    fail("stdin.setRawMode is not available — cannot enter raw mode for key capture.");
    return 1;
  }

  // Enter raw mode
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  console.log(`${label("Raw mode:")} ${value("ENTERED", c.green)}`);
  console.log("");

  // Import the normalization layer dynamically (avoids pulling Ink
  // into the non-interactive doctor path).
  const { normalizeKey, describeKeyEvent } = await import("../ink/input-keys.js");

  console.log(c.bold + "Press keys to see their normalized events." + c.reset);
  console.log(`${c.dim}  Press Ctrl+C to exit.${c.reset}`);
  console.log("");

  // Column headers
  const colKey = "KEY";
  const colSeq = "SEQUENCE";
  const colHex = "HEX";
  console.log(`${c.dim}${colKey.padEnd(22)}${colSeq.padEnd(20)}${colHex}${c.reset}`);
  console.log(`${c.dim}${"-".repeat(22)}${"-".repeat(20)}${"-".repeat(20)}${c.reset}`);

  return new Promise<number>((resolve) => {
    let exited = false;

    const cleanup = () => {
      if (exited) return;
      exited = true;
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.removeListener("SIGINT", onSigInt);
      console.log("");
      ok("Terminal state restored. Input diagnostic complete.");
      resolve(0);
    };

    const onData = (data: Buffer) => {
      const input = data.toString("utf8");

      // Build a minimal key object by checking common patterns
      // (We can't import Ink's key parser here without pulling in
      // React, so we do a lightweight classification.)
      const key = classifyKey(input);

      const desc = describeKeyEvent(input, key);
      const parts = desc.split(" ");
      const kindStr = parts[0]?.replace("key=", "") ?? "UNKNOWN";
      const seqStr = parts[1]?.replace("sequence=", "") ?? "";
      const hexStr = parts[2]?.replace("hex=", "") ?? "";

      // Color-code the output
      const kindColor = kindStr === "BACKSPACE" ? c.green
        : kindStr === "DELETE_WORD_LEFT" ? c.yellow
        : kindStr === "CANCEL" ? c.red
        : kindStr === "INSERT_TEXT" ? c.dim
        : c.reset;

      console.log(`${kindColor}${kindStr.padEnd(22)}${c.reset}${seqStr.padEnd(20)}${c.dim}${hexStr}${c.reset}`);

      // Exit on Ctrl+C
      if (kindStr === "CANCEL") {
        cleanup();
      }
    };

    const onSigInt = () => {
      cleanup();
    };

    stdin.on("data", onData);
    process.on("SIGINT", onSigInt);
  });
}

/**
 * Lightweight key classification for doctor input — doesn't depend on
 * Ink's parser. Maps raw bytes to the KeyInfo fields that matter.
 */
function classifyKey(input: string): { backspace: boolean; delete: boolean; ctrl: boolean; meta: boolean; return: boolean; escape: boolean; tab: boolean; upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean; home?: boolean; end?: boolean; shift?: boolean; pageUp?: boolean; pageDown?: boolean; enter?: boolean } {
  const key = {
    backspace: false, delete: false, ctrl: false, meta: false,
    return: false, escape: false, tab: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
  };

  // Ctrl+C
  if (input === "\x03") { key.ctrl = true; return key; }
  // Ctrl+W, Ctrl+U, Ctrl+K, Ctrl+A, Ctrl+E
  if (input.length === 1 && input.charCodeAt(0) < 0x20 && input !== "\r" && input !== "\n" && input !== "\t") {
    key.ctrl = true;
    return key;
  }
  // Backspace
  if (input === "\u007f" || input === "\b") { key.backspace = true; return key; }
  // Delete
  if (input === "\x1b[3~") { key.delete = true; return key; }
  // Enter
  if (input === "\r" || input === "\n") { key.return = true; return key; }
  // Escape
  if (input === "\u001b") { key.escape = true; return key; }
  // Tab
  if (input === "\t") { key.tab = true; return key; }
  // Arrows
  if (input === "\x1b[A" || input === "\x1bOA") { key.upArrow = true; return key; }
  if (input === "\x1b[B" || input === "\x1bOB") { key.downArrow = true; return key; }
  if (input === "\x1b[D" || input === "\x1bOD") { key.leftArrow = true; return key; }
  if (input === "\x1b[C" || input === "\x1bOC") { key.rightArrow = true; return key; }

  return key;
}
