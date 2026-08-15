/**
 * litt run <command> [args...] — Run an arbitrary command through
 * the ExecutionGateway with live streaming and cancellation.
 *
 * Canonical path:
 *   RuntimeSession → ExecutionGateway → CommandExecutor → ShellExecutor
 *
 * Features:
 *   - Live stdout/stderr streaming (not buffered)
 *   - runId + toolCallId lifecycle events
 *   - Ctrl+C cancels the command (not the CLI)
 *   - litt_event broadcast
 *   - Process-tree cancellation (zero orphans)
 *   - Policy enforcement (PLAN/ACT/AUTO)
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

  // Route through the ExecutionGateway — the ONE canonical authority
  const gateway = sess.getGateway();
  const gwResult = await gateway.execute({
    toolId: "project.run",
    inputs: { command, args: cmdArgs },
    cwd: process.cwd(),
    mode: sess.getMode(),
    identity: {
      tenantId: "cli-tenant",
      userId: "cli-user",
      actorId: "cli-user",
      trusted: false,
      interaction: "interactive",
    },
    onStream: (chunk: StreamChunk) => {
      if (chunk.stream === "stderr") {
        process.stderr.write(chunk.text);
      } else {
        process.stdout.write(chunk.text);
      }
    },
  });

  const runId = gwResult.runId;
  const toolCallId = gwResult.toolCallId;
  const status = gwResult.result.status as "success" | "failed" | "cancelled" | "timeout";
  const durationMs = gwResult.durationMs;

  // Show runId + toolCallId
  console.log(`\n${c.gray}runId: ${runId} · toolCallId: ${toolCallId} · status: ${status} · ${durationMs}ms${c.reset}`);

  if (status === "cancelled") {
    fail("Command was cancelled");
    return 130;
  }

  if (status === "timeout") {
    fail("Command timed out");
    return 124;
  }

  if (status !== "success") {
    fail(gwResult.result.message);
    return 1;
  }

  ok(gwResult.result.message);
  return 0;
}
