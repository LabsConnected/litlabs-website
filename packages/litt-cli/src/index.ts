/**
 * LiTT CLI — AI operating system for your terminal.
 *
 * Commands:
 *   litt doctor    — Check system health (Node, Git, pnpm, network, auth)
 *   litt version   — Show CLI version
 *   litt status    — Show project + git status (via @litt/agent-core)
 *   litt diff      — Show git diff (via @litt/agent-core)
 *   litt check     — Run typecheck (via @litt/agent-core)
 *   litt test      — Run tests (via @litt/agent-core)
 *   litt build     — Run build (via @litt/agent-core)
 *   litt run       — Run arbitrary command through hardened CommandExecutor
 *   litt inspect   — Deep repo inspection (framework, scripts, deploy)
 *   litt ask       — Ask LiTT a question about your project
 *   litt explain   — Pipe errors/diffs and get actionable advice
 *
 * Options:
 *   --remote       Dispatch through terminal-server's canonical CommandRouter
 *                  (shares the same RuntimeStore as Studio Web — same runId)
 *   --mode <mode>  Permission mode: plan, act, or auto (default: act)
 */

import { parseArgs } from "node:util";
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
import { dispatchRemote } from "./lib/remote.js";
import { createRuntimeSession } from "./lib/runtime-session.js";
import { ok, fail, header, c } from "./lib/utils.js";
import type { RuntimeSession } from "./lib/runtime-session.js";

const VERSION = "0.1.0";

/** Commands that can be dispatched remotely through terminal-server */
const REMOTEABLE_COMMANDS = new Set(["status", "diff", "check", "test", "build"]);

/** Commands that use the RuntimeSession (shared runtime truth).
 * `run` is excluded — it creates its own session with live streaming. */
const SESSION_COMMANDS = new Set(["status", "diff", "check", "test", "build"]);

const COMMANDS: Record<string, (args: string[], session?: RuntimeSession) => Promise<number>> = {
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
};

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  // Extract --remote flag (can appear anywhere before or after command)
  const remoteIdx = args.indexOf("--remote");
  const useRemote = remoteIdx !== -1;
  const cleanArgs = remoteIdx !== -1
    ? [...args.slice(0, remoteIdx), ...args.slice(remoteIdx + 1)]
    : args;

  // Extract --mode flag
  const modeIdx = cleanArgs.indexOf("--mode");
  let mode: "plan" | "act" | "auto" = "act";
  let finalArgs = cleanArgs;
  if (modeIdx !== -1 && modeIdx + 1 < cleanArgs.length) {
    const modeVal = cleanArgs[modeIdx + 1];
    if (modeVal === "plan" || modeVal === "act" || modeVal === "auto") {
      mode = modeVal;
    }
    finalArgs = [...cleanArgs.slice(0, modeIdx), ...cleanArgs.slice(modeIdx + 2)];
  }

  const command = finalArgs[0];
  const rest = finalArgs.slice(1);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "--version" || command === "-v") {
    console.log(`litt ${VERSION}`);
    return 0;
  }

  // --remote: dispatch through terminal-server's canonical CommandRouter
  if (useRemote) {
    if (!REMOTEABLE_COMMANDS.has(command)) {
      console.error(`--remote is only supported for: ${[...REMOTEABLE_COMMANDS].join(", ")}`);
      return 1;
    }
    return await runRemote(command, rest);
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'litt --help' for available commands.");
    return 1;
  }

  // Create a shared RuntimeSession for session commands
  let session: RuntimeSession | undefined;
  if (SESSION_COMMANDS.has(command)) {
    session = createRuntimeSession({ cwd: process.cwd(), mode });
    // Install Ctrl+C handler for all session commands
    session.installSigintHandler();
  }

  try {
    return await handler(rest, session);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
      cwd: process.cwd(),
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

Usage: litt <command> [options]

Commands:
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

Examples:
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
  litt inspect
  echo "TypeError: Cannot read property 'x' of undefined" | litt explain
  litt ask "How do I fix the TypeScript error in src/app/page.tsx?"
`);
}

main().then((code) => {
  process.exit(code);
});
