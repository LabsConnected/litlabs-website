/**
 * command-executor.ts
 * Single chokepoint for all server-side shell commands.
 * Uses child_process.execFile (no shell) with a strict allowlist,
 * cwd validation, timeout, output truncation, and secret redaction.
 */

import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ExecuteCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ExecuteCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  command: string;
  args: string[];
  truncated: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/*  Allowlist / Denylist                                               */
/* ------------------------------------------------------------------ */

const ALLOWED_COMMANDS = new Set([
  "git",
  "npm",
  "node",
  "npx",
  "pnpm",
  "tsc",
  "eslint",
  "ls",
  "dir",
  "cat",
  "type",
  "pwd",
  "mkdir",
  "find",
  "gh",
  "vercel",
  "wrangler",
]);

const DENIED_PATTERNS = [
  /^rm$/i,
  /^del$/i,
  /^sudo$/i,
  /^curl$/i,
  /^wget$/i,
  /^bash$/i,
  /^sh$/i,
  /^zsh$/i,
  /^powershell$/i,
  /^pwsh$/i,
  /^cmd$/i,
  /^eval$/i,
  /^exec$/i,
  /^python$/i,
  /^ruby$/i,
];

const DANGEROUS_ARG_PATTERNS = [
  /[;&|`$(){}[\]<>]/,  // shell meta characters
  /\$\(/,              // command substitution
  /`/,                 // backtick substitution
  /&&/,                // AND chaining
  /\|\|/,              // OR chaining
  /\.\.\//,            // path traversal
  /\.\./,              // path traversal short form
];

/* ------------------------------------------------------------------ */
/*  Project root validation                                            */
/* ------------------------------------------------------------------ */

function getProjectRoot(): string {
  // turbopackIgnore: true — runtime-only, not a static import
  return process.env.PROJECT_ROOT ?? process.cwd();
}

function validateCwd(requestedCwd?: string): { ok: true; cwd: string } | { ok: false; error: string } {
  const root = getProjectRoot();
  // Use path.join with a known prefix to avoid overly-broad NFT tracing
  const cwd = requestedCwd ? path.normalize(requestedCwd) : root;

  const resolvedRoot = path.normalize(root);
  const resolvedCwd = path.normalize(cwd);

  if (!resolvedCwd.startsWith(resolvedRoot)) {
    return { ok: false, error: `cwd '${cwd}' is outside project root '${root}'` };
  }

  try {
    const stat = fs.statSync(resolvedCwd);
    if (!stat.isDirectory()) {
      return { ok: false, error: `cwd '${cwd}' is not a directory` };
    }
  } catch {
    return { ok: false, error: `cwd '${cwd}' does not exist` };
  }

  return { ok: true, cwd: resolvedCwd };
}

/* ------------------------------------------------------------------ */
/*  Secret redaction                                                   */
/* ------------------------------------------------------------------ */

const SECRET_PATTERNS = [
  /\b([A-Z_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL)[A-Z_]*)\s*=\s*\S+/gi,
  /\b(sk-[A-Za-z0-9]{20,})/g,
  /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,})/g,
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, g1) => {
      if (g1 && /[A-Z_]+=/.test(match)) {
        return match.replace(/=\S+/, "=[REDACTED]");
      }
      return "[REDACTED]";
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Core executor                                                      */
/* ------------------------------------------------------------------ */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 65_536; // 64 KB

export async function executeCommand(
  opts: ExecuteCommandOptions,
): Promise<ExecuteCommandResult> {
  const { command, args = [], cwd: requestedCwd, timeoutMs, maxOutputBytes } = opts;

  const resolvedTimeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const resolvedMaxOutput = maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  // 1. Validate command is not explicitly denied
  for (const pattern of DENIED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        ok: false,
        stdout: "",
        stderr: "",
        exitCode: null,
        durationMs: 0,
        command,
        args,
        truncated: false,
        error: `Command '${command}' is explicitly denied`,
      };
    }
  }

  // 2. Validate command is on the allowlist
  const baseCommand = path.basename(command).replace(/\.exe$/i, "").toLowerCase();
  if (!ALLOWED_COMMANDS.has(baseCommand)) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0,
      command,
      args,
      truncated: false,
      error: `Command '${command}' is not on the allowlist`,
    };
  }

  // 3. Validate arguments for dangerous patterns
  for (const arg of args) {
    for (const pattern of DANGEROUS_ARG_PATTERNS) {
      if (pattern.test(arg)) {
        return {
          ok: false,
          stdout: "",
          stderr: "",
          exitCode: null,
          durationMs: 0,
          command,
          args,
          truncated: false,
          error: `Argument '${arg}' contains a dangerous pattern`,
        };
      }
    }
  }

  // 4. Validate cwd
  const cwdCheck = validateCwd(requestedCwd);
  if (!cwdCheck.ok) {
    const cwdErr = cwdCheck as { ok: false; error: string };
    return {
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0,
      command,
      args,
      truncated: false,
      error: cwdErr.error,
    };
  }
  const resolvedCwd = (cwdCheck as { ok: true; cwd: string }).cwd;

  // 5. Execute
  const startTime = Date.now();

  return new Promise<ExecuteCommandResult>((resolve) => {
    let truncated = false;

    const child = execFile(
      command,
      args,
      {
        cwd: resolvedCwd,
        timeout: resolvedTimeout,
        maxBuffer: resolvedMaxOutput * 2,
        windowsHide: true,
        shell: false,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;

        let finalStdout = redactSecrets(stdout ?? "");
        let finalStderr = redactSecrets(stderr ?? "");

        if (Buffer.byteLength(finalStdout) > resolvedMaxOutput) {
          finalStdout = finalStdout.slice(0, resolvedMaxOutput) + "\n[OUTPUT TRUNCATED]";
          truncated = true;
        }
        if (Buffer.byteLength(finalStderr) > resolvedMaxOutput) {
          finalStderr = finalStderr.slice(0, resolvedMaxOutput) + "\n[OUTPUT TRUNCATED]";
          truncated = true;
        }

        const exitCode = error?.code !== undefined
          ? (typeof error.code === "number" ? error.code : null)
          : 0;

        if (error && (error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
          resolve({
            ok: false,
            stdout: finalStdout,
            stderr: finalStderr,
            exitCode: null,
            durationMs,
            command,
            args,
            truncated,
            error: `Command timed out after ${resolvedTimeout}ms`,
          });
          return;
        }

        resolve({
          ok: !error || exitCode === 0,
          stdout: finalStdout,
          stderr: finalStderr,
          exitCode: exitCode ?? 0,
          durationMs,
          command,
          args,
          truncated,
        });
      },
    );

    // Safety: kill if still running past timeout (belt + suspenders)
    setTimeout(() => {
      try { child.kill(); } catch { /* already done */ }
    }, resolvedTimeout + 1000);
  });
}

/* ------------------------------------------------------------------ */
/*  Convenience helpers                                                */
/* ------------------------------------------------------------------ */

export function isCommandAllowed(command: string): boolean {
  const base = path.basename(command).replace(/\.exe$/i, "").toLowerCase();
  for (const pattern of DENIED_PATTERNS) {
    if (pattern.test(base)) return false;
  }
  return ALLOWED_COMMANDS.has(base);
}

export function getAllowedCommands(): string[] {
  return [...ALLOWED_COMMANDS];
}
