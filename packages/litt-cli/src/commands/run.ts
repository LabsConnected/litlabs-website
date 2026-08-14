/**
 * litt run <command> [args...] — Run an arbitrary command through
 * the hardened CommandExecutor with live streaming and cancellation.
 *
 * This is the direct execution path:
 *   RuntimeSession → CommandExecutor → ShellExecutor
 *
 * Features:
 *   - Live stdout/stderr streaming (not buffered)
 *   - runId + toolCallId lifecycle events
 *   - Ctrl+C cancels the command (not the CLI)
 *   - litt_event broadcast
 *   - Process-tree cancellation (zero orphans)
 */

import { RuntimeSession } from "../lib/runtime-session.js";
import { ok, fail, header, c } from "../lib/utils.js";
import type { StreamChunk } from "@litt/agent-core";

export async function runCommand(args: string[], session?: RuntimeSession): Promise<number> {
  if (args.length === 0) {
    fail("Usage: litt run <command> [args...]");
    return 1;
  }

  const command = args[0];
  const cmdArgs = args.slice(1);

  // Create session with live streaming
  const sess = session ?? new RuntimeSession({
    cwd: process.cwd(),
    onStream: (chunk: StreamChunk) => {
      // Stream directly to terminal — no buffering
      if (chunk.stream === "stderr") {
        process.stderr.write(chunk.text);
      } else {
        process.stdout.write(chunk.text);
      }
    },
  });

  // Install Ctrl+C handler — cancels the active run, keeps CLI alive
  sess.installSigintHandler();

  header(`run: ${command} ${cmdArgs.join(" ")}`);

  const run = await sess.execute(command, cmdArgs, {
    label: command,
    timeoutMs: 300_000, // 5 min default
  });

  // Show runId + toolCallId
  console.log(`\n${c.gray}runId: ${run.runId} · toolCallId: ${run.toolCallId} · status: ${run.status} · ${run.durationMs}ms${c.reset}`);

  if (run.status === "cancelled") {
    fail("Command was cancelled");
    return 130;
  }

  if (run.status === "timeout") {
    fail("Command timed out");
    return 124;
  }

  if (run.status !== "success") {
    fail(run.result.message);
    return 1;
  }

  ok(run.result.message);
  return 0;
}
