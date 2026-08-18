#!/usr/bin/env node
/**
 * LiTT CLI — AI operating system for your terminal.
 *
 * Two user surfaces share one canonical RuntimeSession:
 *   1. Ink/PowerShell operator cockpit  — bare `litt` / `litt shell` / `litt cockpit` / `litt tui`
 *   2. Desktop/Tauri GUI application    — `litt desktop`
 *
 * Bare `litt` stays inside the current terminal and renders the Ink cockpit.
 * It never opens a GUI window. Both surfaces connect to the same shared
 * RuntimeSession / RuntimeStore / AgentLoop — one brain, one truth.
 *
 * Commands:
 *   litt            — Launch the Ink operator cockpit (default)
 *   litt shell      — Explicit alias for the Ink cockpit
 *   litt cockpit    — Alias for the Ink cockpit
 *   litt tui        — Alias for the Ink cockpit
 *   litt desktop    — Launch the Desktop/Tauri GUI application
 *   litt doctor     — Check system health (Node, Git, pnpm, network, auth)
 *   litt version    — Show CLI version
 *   litt status     — Show project + git status (via @litt/agent-core)
 *   litt diff       — Show git diff (via @litt/agent-core)
 *   litt check      — Run typecheck (via @litt/agent-core)
 *   litt test       — Run tests (via @litt/agent-core)
 *   litt build      — Run build (via @litt/agent-core)
 *   litt run        — Run arbitrary command through hardened CommandExecutor
 *   litt inspect    — Deep repo inspection (framework, scripts, deploy)
 *   litt ask        — Ask LiTT a question about your project
 *   litt explain    — Pipe errors/diffs and get actionable advice
 *
 * Options:
 *   --remote       Dispatch through terminal-server's canonical CommandRouter
 *                  (shares the same RuntimeStore as Studio Web — same runId)
 *   --mode <mode>  Permission mode: plan, act, or auto (default: act)
 *   --tui          Redundant — bare `litt` already launches the cockpit (kept for compat)
 */

import { doctorCommand } from "./commands/doctor.js";
import { versionCommand } from "./commands/version.js";
import { statusCommand } from "./commands/status.js";
import { diffCommand } from "./commands/diff.js";
import { checkCommand } from "./commands/check.js";
import { testCommand } from "./commands/test.js";
import { buildCommand } from "./commands/build.js";
import { runCommand } from "./commands/run.js";
import { inspectCommand } from "./commands/inspect.js";
import { askCommand } from "./commands/ask.js";
import { explainCommand } from "./commands/explain.js";
import { desktopCommand } from "./commands/desktop.js";
import { dispatchRemote } from "./lib/remote.js";
import { createRuntimeSession } from "./lib/runtime-session.js";
import { detectProject, ok, fail, header, c } from "./lib/utils.js";
import { CLI_VERSION } from "./lib/version.js";
import { resolveDispatch } from "./lib/dispatch.js";
import type { RuntimeSession } from "./lib/runtime-session.js";

// Lazy-loaded commands that pull in heavy dependencies (Ink/React).
// These are only imported when the user actually runs them, so
// `litt doctor` / `litt run` / etc. don't need Ink installed.
type CommandHandler = (args: string[], session?: RuntimeSession) => Promise<number>;
const lazyCockpit = async (): Promise<CommandHandler> =>
  (await import("./commands/cockpit.js")).cockpitCommand;

const VERSION = CLI_VERSION;

/** Commands that can be dispatched remotely through terminal-server */
const REMOTEABLE_COMMANDS = new Set(["status", "diff", "check", "test", "build", "run", "ask", "explain", "desktop"]);

/** Commands that use the RuntimeSession (shared runtime truth). */
const SESSION_COMMANDS = new Set(["status", "diff", "check", "test", "build", "run", "ask"]);

const COMMANDS: Record<string, CommandHandler> = {
  doctor: doctorCommand,
  version: versionCommand,
  status: statusCommand,
  diff: diffCommand,
  check: checkCommand,
  test: testCommand,
  build: buildCommand,
  run: runCommand,
  inspect: inspectCommand,
  ask: askCommand,
  explain: explainCommand,
  desktop: desktopCommand,
  // cockpit / shell / tui are lazy-loaded below (heavy Ink/React dependency)
};

/** Commands that require lazy loading (heavy deps like Ink/React).
 *  `shell` is an explicit alias for the same Ink cockpit as bare `litt`. */
const LAZY_COMMANDS = new Set(["cockpit", "shell", "tui"]);

async function main(): Promise<number> {
  // Engine check — LiTT CLI requires Node 22+
  const major = parseInt(process.version.slice(1), 10);
  if (major < 22) {
    console.error(`${c.red}LiTT CLI requires Node.js 22 or later.${c.reset}`);
    console.error(`${c.dim}You are running Node ${process.version}.${c.reset}`);
    console.error(`${c.dim}Upgrade: https://nodejs.org/${c.reset}`);
    return 1;
  }

  const args = process.argv.slice(2);

  // Resolve dispatch through the single shared routing module.
  // This is the canonical routing contract:
  //   litt             → cockpit (Ink, current terminal)
  //   litt shell       → cockpit (Ink, explicit alias)
  //   litt desktop     → desktop (Tauri GUI)
  // Both surfaces share one RuntimeSession — one brain, one truth.
  const dispatch = resolveDispatch(args);

  if (dispatch.isHelp) {
    printHelp();
    return 0;
  }

  if (dispatch.isVersion) {
    console.log(`litt ${VERSION}`);
    return 0;
  }

  const command = dispatch.command!;
  const rest = dispatch.rest;
  const mode = dispatch.mode;

  // --remote: dispatch through terminal-server's canonical CommandRouter
  if (dispatch.useRemote) {
    if (!REMOTEABLE_COMMANDS.has(command)) {
      console.error(`--remote is only supported for: ${[...REMOTEABLE_COMMANDS].join(", ")}`);
      return 1;
    }
    return await runRemote(command, rest);
  }

  // Resolve handler — lazy-load heavy commands (Ink/React) on demand
  let handler: CommandHandler | undefined;
  if (LAZY_COMMANDS.has(command)) {
    handler = await lazyCockpit();
  } else {
    handler = COMMANDS[command];
  }
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'litt --help' for available commands.");
    return 1;
  }

  // Create a shared RuntimeSession for session commands.
  // Use the detected project root (walks upward from cwd) — not process.cwd()
  // directly — so the user can run commands from any subdirectory.
  let session: RuntimeSession | undefined;
  if (SESSION_COMMANDS.has(command)) {
    const project = detectProject();
    session = createRuntimeSession({ cwd: project.rootDir, mode });
    // Install Ctrl+C handler for all session commands
    session.installSigintHandler();
  }

  try {
    return await handler(rest, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${c.red}Error:${c.reset} ${message}`);

    // Provide helpful hints for common errors
    if (message.includes("OPENROUTER_API_KEY")) {
      console.error(`${c.dim}  Get an API key at https://openrouter.ai and set it:${c.reset}`);
      console.error(`${c.dim}  set OPENROUTER_API_KEY=sk-or-v1-...${c.reset}`);
    } else if (message.includes("TERMINAL_INTERNAL_SERVICE_KEY")) {
      console.error(`${c.dim}  --remote requires a terminal-server running with TERMINAL_INTERNAL_SERVICE_KEY set.${c.reset}`);
      console.error(`${c.dim}  Run without --remote for local execution.${c.reset}`);
    } else if (message.includes("ENOENT") || message.includes("not found")) {
      console.error(`${c.dim}  The command was not found. Check that it's installed and in your PATH.${c.reset}`);
    }

    // Show stack trace only with --debug
    if (process.env.LITT_DEBUG === "1" && error instanceof Error && error.stack) {
      console.error(`${c.dim}\n${error.stack}${c.reset}`);
    }
    return 1;
  }
}

/**
 * Dispatch a command through terminal-server's canonical CommandRouter.
 * The same CommandRouter that Studio Web uses — so CLI and Studio share
 * the same RuntimeStore, same runId, same Socket.IO broadcasts.
 */
async function runRemote(command: string, _args: string[]): Promise<number> {
  header(`${command} (remote)`);
  try {
    const result = await dispatchRemote(command, undefined, {
      cwd: detectProject().rootDir,
    });

    if (!result.ok) {
      fail(result.result.result.message);
      const stderr = result.result.result.data?.stderr as string | undefined;
      if (stderr) console.log(`${c.gray}${stderr}${c.reset}`);
      return 1;
    }

    ok(result.result.result.message);
    const stdout = result.result.result.data?.stdout as string | undefined;
    if (stdout) console.log(`${c.gray}${stdout}${c.reset}`);

    // Show runId for cross-surface verification
    console.log(`${c.gray}runId: ${result.runId}${c.reset}`);
    return 0;
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function printHelp(): void {
  console.log(`
LiTT CLI v${VERSION} — AI operating system for your terminal

Usage: litt [command] [options]

  Bare 'litt' launches the Ink operator cockpit inside the current terminal.
  Use 'litt desktop' to open the Desktop/Tauri GUI surface.
  Both surfaces share one canonical RuntimeSession — same brain, same truth.

Commands:
  (default)  Launch the Ink operator cockpit in the current terminal
  shell      Explicit alias for the Ink cockpit (same as bare 'litt')
  cockpit    Alias for the Ink cockpit
  tui        Alias for the Ink cockpit
  desktop    Launch the LiTT Desktop (Tauri) GUI application
  doctor     Check system health (Node, Git, pnpm, network, auth)
  version    Show CLI version
  status     Show project + git status (via @litt/agent-core)
  diff       Show git diff (via @litt/agent-core)
  check      Run typecheck (via @litt/agent-core)
  test       Run tests (via @litt/agent-core)
  build      Run build (via @litt/agent-core)
  run        Run arbitrary command through hardened CommandExecutor (streaming + cancel)
  inspect    Deep repo inspection (framework, scripts, deploy)
  ask        Ask LiTT a question about your project
  explain    Pipe errors/diffs and get actionable advice

Options:
  -h, --help     Show this help
  -v, --version  Show version
  --remote       Dispatch through terminal-server (shared RuntimeStore with Studio)
  --mode <mode>  Permission mode: plan, act, or auto (default: act)
  --tui          Redundant — bare 'litt' already launches the cockpit (kept for compat)

Examples:
  litt                     (Ink cockpit in current terminal)
  litt shell               (explicit alias for the Ink cockpit)
  litt desktop             (launch Desktop GUI app)
  litt doctor
  litt status
  litt diff
  litt diff --staged
  litt check
  litt test
  litt build
  litt build --remote    (Studio sees the same run)
  litt run echo hello    (streaming + Ctrl+C cancel)
  litt run pnpm test --mode auto
  litt cockpit check     (dispatch check via cockpit)
  litt inspect
  echo "TypeError: Cannot read property 'x' of undefined" | litt explain
  litt ask "How do I fix the TypeScript error in src/app/page.tsx?"
`);
}

main().then((code) => {
  process.exit(code);
});
