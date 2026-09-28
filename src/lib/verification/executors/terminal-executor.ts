/**
 * LiTT Verification Foundation — terminal executor.
 *
 * Executes a real command via child_process, captures exit code / sanitized
 * stdout+stderr / duration, and produces an evidence draft. "Tool call
 * completed" is never sufficient evidence by itself: the draft carries the
 * exit code, assertion results, and integrity metadata.
 *
 * Secrets are redacted from the command line and outputs BEFORE the draft
 * leaves this module.
 */
import { spawnSync } from "node:child_process";
import type { CommandResult, CommandSpec } from "../contracts/command";
import { commandResultSchema, commandSpecSchema } from "../contracts/command";
import { redactString } from "../redaction";
import { hashPayload, sha256Hex } from "../hashes";
import type { AssertionResult } from "../types";

const MAX_OUTPUT_CHARS = 32_000;
const TRUNCATION_MARKER = "\n…[truncated]";

function truncateOutput(out: string): { text: string; truncated: boolean } {
  if (out.length <= MAX_OUTPUT_CHARS) return { text: out, truncated: false };
  return { text: out.slice(0, MAX_OUTPUT_CHARS) + TRUNCATION_MARKER, truncated: true };
}

export interface EvidenceDraft {
  evidenceType: "command_result";
  claim: string;
  assertions: AssertionResult[];
  payload: Record<string, unknown>;
  integrity: { sha256: string; artifactIds?: string[] };
  /** Redacted stdout, for artifact persistence. */
  stdoutArtifact: { content: string; sha256: string; byteSize: number };
}

/**
 * Execute a command spec and return the raw result (redacted). Throws on
 * spawn errors; a non-zero exit code is a RESULT, not a throw.
 */
export function executeCommand(spec: CommandSpec): CommandResult {
  const parsed = commandSpecSchema.parse(spec);
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const sanitizedCommand = redactString(
    [parsed.command, ...parsed.args].join(" "),
  );

  let exitCode: number | null = null;
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  try {
    const res = spawnSync(parsed.command, parsed.args, {
      cwd: parsed.cwd,
      timeout: parsed.timeoutMs,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    exitCode = res.status;
    stdout = res.stdout ?? "";
    stderr = res.stderr ?? "";
    if (res.error) {
      const err = res.error as NodeJS.ErrnoException & { code?: string };
      if (err.code === "ETIMEDOUT") timedOut = true;
      stderr = `${stderr}\n[spawn error: ${err.message}]`.trim();
    }
  } catch (err) {
    stderr = `[spawn threw: ${err instanceof Error ? err.message : String(err)}]`;
  }

  const finishedAt = new Date().toISOString();
  const outTrunc = truncateOutput(stdout);
  const errTrunc = truncateOutput(stderr);

  const result: CommandResult = {
    identity: parsed.identity,
    command: parsed.command,
    sanitizedCommand,
    exitCode,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    stdout: redactString(outTrunc.text),
    stderr: redactString(errTrunc.text),
    truncated: outTrunc.truncated || errTrunc.truncated,
    executorId: parsed.executorId,
    timedOut,
  };
  return commandResultSchema.parse(result);
}

/**
 * Build an evidence draft from a command result. The exit-code assertion is
 * the machine proof; stdout is hashed into an artifact reference.
 */
export function commandResultToEvidenceDraft(result: CommandResult): EvidenceDraft {
  const exitOk = result.exitCode === 0 && !result.timedOut;
  const claim = `command '${result.identity}' ${exitOk ? "succeeded" : "failed"} with exit code ${result.exitCode}`;
  const assertions: AssertionResult[] = [
    {
      name: "exit_code_zero",
      expected: "0",
      observed: result.exitCode === null ? "null" : String(result.exitCode),
      pass: exitOk,
    },
    {
      name: "completed_without_timeout",
      expected: "true",
      observed: String(!result.timedOut),
      pass: !result.timedOut,
    },
  ];
  const artifactContent = result.stdout;
  const artifactSha = sha256Hex(artifactContent);
  const payload = {
    command_identity: result.identity,
    sanitized_command: result.sanitizedCommand,
    exit_code: result.exitCode,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    duration_ms: result.durationMs,
    executor_id: result.executorId,
    timed_out: result.timedOut,
    truncated: result.truncated,
    stderr_tail: result.stderr.slice(-2000),
  };
  // Tamper-evident seal over the canonical evidence content. The verdict
  // engine recomputes this from reloaded rows; any post-write mutation
  // invalidates the evidence (hash_mismatch => INCONCLUSIVE).
  const integritySha = hashPayload({ claim, assertions, payload });
  return {
    evidenceType: "command_result",
    claim,
    assertions,
    payload,
    integrity: { sha256: integritySha },
    stdoutArtifact: {
      content: artifactContent,
      sha256: artifactSha,
      byteSize: Buffer.byteLength(artifactContent, "utf8"),
    },
  };
}
