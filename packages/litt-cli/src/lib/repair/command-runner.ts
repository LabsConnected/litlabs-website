import { createShellExecutor, type ShellExecutor } from "@litt/agent-core";
import { redact } from "../secret-redaction.js";
import type { CommandEvidence, RepairCommand } from "./contracts.js";

export interface RunCommandOptions {
  name: string;
  cwd: string;
  signal?: AbortSignal;
  shell?: ShellExecutor;
}

export async function runEvidenceCommand(
  command: RepairCommand,
  options: RunCommandOptions,
): Promise<CommandEvidence> {
  const shell = options.shell ?? createShellExecutor(options.cwd);
  const startedAt = new Date().toISOString();
  const abort = (): void => {
    void shell.cancel();
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    if (options.signal?.aborted) {
      return cancelledEvidence(command, options, startedAt);
    }
    const outcome = await shell.execute({
      command: command.command,
      args: command.args,
      cwd: options.cwd,
      timeoutMs: command.timeoutMs,
      maxOutputBytes: command.maxOutputBytes,
    });
    const isSpawnError = outcome.pid === null && Boolean(outcome.error);
    return {
      name: options.name,
      command: outcome.command,
      args: [...outcome.args],
      cwd: options.cwd,
      status: isSpawnError ? "spawn-error" : outcome.status,
      exitCode: outcome.exitCode,
      signal: null,
      stdout: redact(outcome.stdout),
      stderr: redact(outcome.stderr || outcome.error || ""),
      stdoutTruncated: outcome.truncated,
      stderrTruncated: outcome.truncated,
      startedAt,
      durationMs: outcome.durationMs,
    };
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

function cancelledEvidence(
  command: RepairCommand,
  options: RunCommandOptions,
  startedAt: string,
): CommandEvidence {
  return {
    name: options.name,
    command: command.command,
    args: [...command.args],
    cwd: options.cwd,
    status: "cancelled",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: "Cancelled before execution",
    stdoutTruncated: false,
    stderrTruncated: false,
    startedAt,
    durationMs: 0,
  };
}
