/**
 * litt run <command> [args...] — Run an arbitrary command through
 * the ExecutionGateway with live streaming and cancellation.
 *
 * Also supports run-store subcommands (P0-5):
 *   litt run <id>          — Show run summary
 *   litt run result <id>   — Show the final result text
 *   litt run logs <id>     — Show the run activity logs
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
import { ok, fail, header, c, label, value } from "../lib/utils.js";
import type { StreamChunk } from "@litt/agent-core";
import { loadRun, formatRunListEntry } from "../lib/run-store.js";
import { formatFailureReport } from "../lib/failure-report.js";

export async function runCommand(args: string[], session?: RuntimeSession): Promise<number> {
  if (args.length === 0) {
    fail("Usage: litt run <command> [args...]");
    fail("       litt run <id>          (show run summary)");
    fail("       litt run result <id>   (show final result)");
    fail("       litt run logs <id>     (show activity logs)");
    return 1;
  }

  // ─── P0-5: Run-store subcommands ─────────────────────────────
  // `litt run result <id>` — show the final result text
  // `litt run logs <id>` — show the activity logs
  // `litt run <id>` — show the run summary (when arg looks like a run ID)
  if (args[0] === "result" && args[1]) {
    return showRunResult(args[1]);
  }
  if (args[0] === "logs" && args[1]) {
    return showRunLogs(args[1]);
  }
  // If the first arg looks like a run ID (starts with "run_"), show the summary
  if (args[0].startsWith("run_") && args.length === 1) {
    return showRunSummary(args[0]);
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

// ─── P0-5: Run-store subcommands ─────────────────────────────────

/** `litt run <id>` — show a run summary. */
function showRunSummary(runId: string): number {
  const run = loadRun(runId);
  if (!run) {
    fail(`Run not found: ${runId}`);
    console.log(`${c.dim}  List runs: litt runs${c.reset}`);
    return 1;
  }

  header(`Run: ${run.runId}`);
  console.log(`${label("Task:")} ${value(run.task, c.bold)}`);
  console.log(`${label("Status:")} ${run.status === "success" ? value(run.status, c.green) : value(run.status, c.red)}`);
  console.log(`${label("Mode:")} ${value(run.mode, c.dim)}`);
  console.log(`${label("Branch:")} ${value(run.branch, c.dim)}`);
  console.log(`${label("Model:")} ${value(run.model ?? "—", c.dim)}`);
  if (run.durationMs) {
    console.log(`${label("Duration:")} ${value(`${(run.durationMs / 1000).toFixed(1)}s`, c.dim)}`);
  }
  if (run.startedAt) {
    console.log(`${label("Started:")} ${value(new Date(run.startedAt).toISOString(), c.dim)}`);
  }
  if (run.endedAt) {
    console.log(`${label("Ended:")} ${value(new Date(run.endedAt).toISOString(), c.dim)}`);
  }

  if (run.failureReason) {
    console.log("");
    const report = formatFailureReport({
      task: run.task,
      reason: run.failureReason,
      lastSuccessfulStep: run.lastSuccessfulStep,
      recommendedNextAction: run.recommendedNextAction ?? "Review the error above.",
      runId: run.runId,
      failedAt: run.endedAt ?? Date.now(),
    });
    console.log(report);
  }

  if (run.result) {
    console.log("");
    console.log(`${c.dim}Result available — view with: litt run result ${run.runId}${c.reset}`);
  }

  console.log("");
  console.log(`${c.dim}Activities: ${run.activities.length} · View logs: litt run logs ${run.runId}${c.reset}`);
  return 0;
}

/** `litt run result <id>` — show the final result text. */
function showRunResult(runId: string): number {
  const run = loadRun(runId);
  if (!run) {
    fail(`Run not found: ${runId}`);
    return 1;
  }

  header(`Result: ${run.runId}`);
  console.log(`${label("Task:")} ${value(run.task, c.bold)}`);
  console.log(`${label("Status:")} ${run.status === "success" ? value(run.status, c.green) : value(run.status, c.red)}`);
  console.log("");

  if (run.result) {
    console.log(run.result);
  } else if (run.failureReason) {
    const report = formatFailureReport({
      task: run.task,
      reason: run.failureReason,
      lastSuccessfulStep: run.lastSuccessfulStep,
      recommendedNextAction: run.recommendedNextAction ?? "Review the error above.",
      runId: run.runId,
      failedAt: run.endedAt ?? Date.now(),
    });
    console.log(report);
  } else {
    console.log(`${c.dim}No result recorded (run may still be in progress).${c.reset}`);
  }

  return 0;
}

/** `litt run logs <id>` — show the activity logs. */
function showRunLogs(runId: string): number {
  const run = loadRun(runId);
  if (!run) {
    fail(`Run not found: ${runId}`);
    return 1;
  }

  header(`Logs: ${run.runId}`);
  console.log(`${label("Task:")} ${value(run.task, c.bold)}`);
  console.log("");

  if (run.activities.length === 0) {
    console.log(`${c.dim}No activity entries recorded.${c.reset}`);
    return 0;
  }

  for (const entry of run.activities) {
    const time = new Date(entry.ts).toISOString().slice(11, 19);
    const typeColor = entry.type.includes("failed") ? c.red
      : entry.type.includes("passed") || entry.type.includes("completed") ? c.green
      : entry.type.includes("started") ? c.yellow
      : c.dim;
    console.log(`${c.dim}${time}${c.reset} ${typeColor}${entry.type.padEnd(24)}${c.reset} ${entry.text}`);
  }

  return 0;
}
