/**
 * litt cockpit — interactive runtime cockpit mode.
 *
 * Connects to terminal-server via RuntimeClient (Socket.IO primary),
 * displays canonical runtime state, and allows dispatching commands
 * that stream real-time lifecycle events.
 *
 * Usage:  litt cockpit
 *         litt cockpit check
 *         litt cockpit build
 */

import { RuntimeClient } from "../lib/runtime-client.js";
import { Cockpit } from "../lib/cockpit.js";
import { SignalHandler } from "../lib/signal-handler.js";
import { ok, fail, header, c } from "../lib/utils.js";

const REMOTEABLE_COMMANDS = new Set([
  "status", "diff", "check", "test", "build", "debug", "ship", "log", "branch",
]);

export async function cockpitCommand(args: string[]): Promise<number> {
  header("LiTT Runtime Cockpit");

  const client = new RuntimeClient();

  // Try to connect via Socket.IO
  try {
    await client.connect();
  } catch (err) {
    fail(`Cannot connect to runtime: ${err instanceof Error ? err.message : String(err)}`);
    fail("Make sure terminal-server is running and TERMINAL_AUTH_SECRET is set.");
    return 1;
  }

  // Wait for initial snapshot
  await new Promise((r) => setTimeout(r, 1000));

  const cockpit = new Cockpit(client);
  cockpit.start();

  // Install Ctrl+C handler
  const signals = new SignalHandler(client);
  const cleanupSignals = signals.install();

  // If a command was provided, dispatch it
  const command = args[0];
  if (command) {
    if (!REMOTEABLE_COMMANDS.has(command)) {
      fail(`Unknown cockpit command: ${command}`);
      fail(`Available: ${[...REMOTEABLE_COMMANDS].join(", ")}`);
      cleanupSignals();
      cockpit.stop();
      client.disconnect();
      return 1;
    }

    console.log(`\n${c.cyan}▶${c.reset} Dispatching: ${c.bold}${command}${c.reset}\n`);

    try {
      const result = await client.dispatchCommand(command, undefined, process.cwd());

      if (result.ok) {
        ok(`Command completed successfully`);
      } else {
        fail(`Command failed`);
      }

      console.log(`\n${cockpit.renderStatusLine()}`);
    } catch (err) {
      fail(`Dispatch error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Interactive mode — just show the cockpit panel and wait
    console.log(cockpit.renderPanel());
    console.log(`\n${c.gray}Press Ctrl+C to exit${c.reset}`);

    // Keep the process alive
    await new Promise<void>((resolve) => {
      const cleanup = client.onConnectionChange((state) => {
        if (state === "error") {
          resolve();
        }
      });
      // Also exit on SIGINT (handled by SignalHandler)
      process.on("exit", () => {
        cleanup();
        resolve();
      });
    });
  }

  // Cleanup
  cleanupSignals();
  cockpit.stop();
  client.disconnect();

  return 0;
}
