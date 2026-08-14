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
 *   litt inspect   — Deep repo inspection (framework, scripts, deploy)
 *   litt ask       — Ask LiTT a question about your project
 *   litt explain   — Pipe errors/diffs and get actionable advice
 */

import { parseArgs } from "node:util";
import { doctorCommand } from "./commands/doctor.js";
import { versionCommand } from "./commands/version.js";
import { statusCommand } from "./commands/status.js";
import { diffCommand } from "./commands/diff.js";
import { checkCommand } from "./commands/check.js";
import { testCommand } from "./commands/test.js";
import { buildCommand } from "./commands/build.js";
import { inspectCommand } from "./commands/inspect.js";
import { askCommand } from "./commands/ask.js";
import { explainCommand } from "./commands/explain.js";

const VERSION = "0.1.0";

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  doctor: doctorCommand,
  version: versionCommand,
  status: statusCommand,
  diff: diffCommand,
  check: checkCommand,
  test: testCommand,
  build: buildCommand,
  inspect: inspectCommand,
  ask: askCommand,
  explain: explainCommand,
};

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "--version" || command === "-v") {
    console.log(`litt ${VERSION}`);
    return 0;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'litt --help' for available commands.");
    return 1;
  }

  try {
    return await handler(rest);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
  inspect    Deep repo inspection (framework, scripts, deploy)
  ask        Ask LiTT a question about your project
  explain    Pipe errors/diffs and get actionable advice

Options:
  -h, --help     Show this help
  -v, --version  Show version

Examples:
  litt doctor
  litt status
  litt diff
  litt diff --staged
  litt check
  litt test
  litt build
  litt inspect
  echo "TypeError: Cannot read property 'x' of undefined" | litt explain
  litt ask "How do I fix the TypeScript error in src/app/page.tsx?"
`);
}

main().then((code) => {
  process.exit(code);
});
