/**
 * Structured execution boundary.
 *
 * Two distinct APIs:
 *   runCommand(command, args[])  — structured, allowlisted, no shell strings
 *   runShellCommand(cmdString)   — unrestricted shell execution (DISABLED by default)
 *
 * No implicit structured → shell-string fallback.
 * User input cannot transform an argument into arbitrary shell syntax.
 *
 * Security model:
 *   PLAN mode — rejects all mutations (read-only)
 *   ACT mode  — requires approval for risky commands
 *   AUTO mode — pre-approved for safe commands, approval for sensitive ops
 *
 * Windows .cmd/.bat package-manager shims are encapsulated inside the
 * structured executor. The caller never sees shell:true.
 */

import type { ShellExecutor, ToolResult, RuntimeState } from "./types.js";
import type { RuntimeStore } from "./state.js";

// ─── Mission modes ────────────────────────────────────────────────

export type MissionMode = "plan" | "act" | "auto";

// ─── Risk classification ──────────────────────────────────────────

export type RiskLevel = "safe" | "elevated" | "dangerous";

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
  /** True if this command can modify the filesystem, git state, or external services */
  mutating: boolean;
}

// ─── Allowlisted executables ──────────────────────────────────────

/**
 * Executables that are safe to run without approval.
 * These are development tools that cannot deploy, pay, or post externally.
 */
const ALLOWED_EXECUTABLES = new Set([
  // Build tools
  "node",
  "npm",
  "npx",
  "pnpm",
  "pnpx",
  "yarn",
  "tsc",
  "tsc-watch",
  "eslint",
  "prettier",
  "vitest",
  "jest",
  "tsx",
  // Git (read-only operations are safe; mutations are elevated)
  "git",
  // File inspection
  "cat",
  "ls",
  "dir",
  "echo",
  "head",
  "tail",
  "wc",
  "find",
  "grep",
  "rg",
  // System info
  "whoami",
  "hostname",
  "uname",
  "pwd",
  "env",
  "printenv",
]);

/**
 * Commands that are always dangerous — require explicit approval
 * even in AUTO mode.
 */
const DANGEROUS_COMMANDS = new Set([
  "rm",
  "rmdir",
  "del",
  "format",
  "shutdown",
  "reboot",
  "mkfs",
  "dd",
  "chmod",
  "chown",
  "kill",
  "killall",
  "taskkill",
]);

/**
 * Git subcommands that mutate state — elevated risk.
 */
const GIT_MUTATING_SUBCOMMANDS = new Set([
  "push",
  "commit",
  "reset",
  "rebase",
  "merge",
  "cherry-pick",
  "revert",
  "clean",
  "stash",
  "branch -D",
  "branch -d",
  "tag -d",
  "force-push",
]);

// ─── Argument sanitization ────────────────────────────────────────

/**
 * Patterns that indicate shell injection attempts in arguments.
 * If any argument matches these, the command is rejected.
 */
const SHELL_INJECTION_PATTERNS: readonly RegExp[] = [
  // Command chaining — & or && at any position
  /&{1,2}/,
  // Pipe — | or || at any position
  /\|{1,2}/,
  // Semicolon — command separator at any position
  /;/,
  // Command substitution
  /\$\(/, // $(...)
  /`/, // `...`
  // Redirection — > or >> or < or << at any position
  />{1,2}/,
  /<{1,2}/,
  // Windows env var expansion
  /%[^%]+%/, // %ENV%
  // PowerShell-specific
  /\$\w+/, // $variable
  /\$\{/, // ${...}
  // Background process — trailing &
  /&\s*$/,
];

/**
 * Check if an argument contains shell injection patterns.
 * Returns the matched pattern description, or null if clean.
 */
export function detectShellInjection(arg: string): string | null {
  for (const pattern of SHELL_INJECTION_PATTERNS) {
    if (pattern.test(arg)) {
      return `Argument matches shell injection pattern: ${pattern.source}`;
    }
  }
  return null;
}

/**
 * Sanitize and validate arguments.
 * Throws if any argument contains shell injection patterns.
 */
function validateArgs(args: string[]): void {
  for (const arg of args) {
    const injection = detectShellInjection(arg);
    if (injection) {
      throw new ExecutionError(injection, "ARG_INJECTION");
    }
  }
}

// ─── Path safety ──────────────────────────────────────────────────

/**
 * Check if a cwd is within the allowed workspace root.
 * Prevents path traversal/escape.
 */
function isWithinWorkspace(cwd: string, workspaceRoot: string): boolean {
  const normalizedCwd = resolvePath(cwd);
  const normalizedRoot = resolvePath(workspaceRoot);
  return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(normalizedRoot + sep());
}

function resolvePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function sep(): string {
  return "/";
}

// ─── Secret redaction ─────────────────────────────────────────────

/**
 * Patterns that look like secrets in command output.
 * Matches are replaced with [REDACTED].
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // API keys (common formats)
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(pk_[a-zA-Z0-9]{20,})\b/g,
  /\b(key-[a-zA-Z0-9]{20,})\b/g,
  // Bearer tokens
  /\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/gi,
  // JWT tokens
  /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g,
  // Generic long hex/base64 strings labeled as key/secret/token
  /\b(secret|password|passwd|token|api_key|apikey|access_key)\s*[:=]\s*["']?([a-zA-Z0-9+/=_-]{16,})["']?/gi,
  // AWS access keys
  /\b(AKIA[0-9A-Z]{16})\b/g,
  // GitHub tokens
  /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/g,
];

/**
 * Redact secrets from a string.
 * Returns the string with secrets replaced by [REDACTED].
 */
export function redactSecrets(input: string): string {
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

// ─── Execution error ──────────────────────────────────────────────

export type ExecutionErrorCode =
  | "ARG_INJECTION"
  | "COMMAND_NOT_ALLOWED"
  | "DANGEROUS_COMMAND"
  | "PLAN_MODE_REJECTED"
  | "APPROVAL_REQUIRED"
  | "PATH_ESCAPE"
  | "TIMEOUT"
  | "CANCELLED"
  | "SHELL_EXECUTION_DISABLED";

export class ExecutionError extends Error {
  code: ExecutionErrorCode;
  constructor(message: string, code: ExecutionErrorCode) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
  }
}

// ─── Risk assessment ──────────────────────────────────────────────

/**
 * Assess the risk level of a command.
 */
export function assessRisk(command: string, args: string[]): RiskAssessment {
  const cmd = command.toLowerCase();

  // Dangerous commands — always require approval
  if (DANGEROUS_COMMANDS.has(cmd)) {
    return {
      level: "dangerous",
      reason: `Command "${cmd}" is classified as dangerous`,
      mutating: true,
    };
  }

  // Git mutating subcommands
  if (cmd === "git" && args.length > 0) {
    const subcmd = args[0].toLowerCase();
    if (GIT_MUTATING_SUBCOMMANDS.has(subcmd)) {
      return {
        level: "elevated",
        reason: `git ${subcmd} mutates repository state`,
        mutating: true,
      };
    }
    // git branch -D / git branch -d
    if (subcmd === "branch" && args.includes("-D")) {
      return {
        level: "elevated",
        reason: "git branch -D deletes a branch",
        mutating: true,
      };
    }
  }

  // npm/pnpm install — modifies node_modules
  if (["npm", "pnpm", "yarn"].includes(cmd) && args.length > 0) {
    const subcmd = args[0].toLowerCase();
    if (["install", "add", "remove", "uninstall", "rm", "i"].includes(subcmd)) {
      return {
        level: "elevated",
        reason: `${cmd} ${subcmd} modifies dependencies`,
        mutating: true,
      };
    }
  }

  // Not in allowlist — elevated
  if (!ALLOWED_EXECUTABLES.has(cmd)) {
    return {
      level: "elevated",
      reason: `Command "${cmd}" is not in the allowlist`,
      mutating: false,
    };
  }

  return {
    level: "safe",
    reason: `Command "${cmd}" is allowlisted`,
    mutating: false,
  };
}

// ─── Approval provider ────────────────────────────────────────────

export type ApprovalProvider = (
  command: string,
  args: string[],
  risk: RiskAssessment,
) => Promise<boolean>;

// ─── Execution options ────────────────────────────────────────────

export interface ExecutionOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  /** Workspace root for path escape protection. Defaults to cwd. */
  workspaceRoot?: string;
  /** Mission mode. PLAN rejects all mutations. */
  mode?: MissionMode;
  /** Approval provider for elevated/dangerous commands in ACT/AUTO mode. */
  approvalProvider?: ApprovalProvider;
  /** RuntimeStore for command tracking. Optional. */
  store?: RuntimeStore | null;
  /** Label for the command in RuntimeStore (e.g. "check", "build"). */
  commandLabel?: string;
}

// ─── Structured execution ─────────────────────────────────────────

/**
 * Execute a command with structured arguments.
 *
 * This is the canonical execution API. It:
 *   - Validates arguments for shell injection
 *   - Checks the command against the allowlist
 *   - Enforces mission mode (PLAN rejects mutations)
 *   - Requires approval for elevated/dangerous commands
 *   - Enforces workspace path boundaries
 *   - Redacts secrets from output
 *   - Tracks execution in RuntimeStore
 *
 * No implicit fallback to shell-string execution.
 */
export async function runCommand(
  shell: ShellExecutor,
  command: string,
  args: string[],
  options?: ExecutionOptions,
): Promise<ToolResult> {
  const mode = options?.mode ?? "act";
  const cwd = options?.cwd ?? shell.cwd;
  const workspaceRoot = options?.workspaceRoot ?? cwd;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const label = options?.commandLabel ?? command;

  // 1. Validate arguments — no shell injection
  try {
    validateArgs(args);
  } catch (err) {
    if (err instanceof ExecutionError) {
      return executionError(err);
    }
    throw err;
  }

  // 2. Check command against allowlist
  const cmd = command.toLowerCase();
  if (!ALLOWED_EXECUTABLES.has(cmd) && !DANGEROUS_COMMANDS.has(cmd)) {
    const err = new ExecutionError(
      `Command "${command}" is not in the allowlist. Allowed: ${[...ALLOWED_EXECUTABLES].join(", ")}`,
      "COMMAND_NOT_ALLOWED",
    );
    return executionError(err);
  }

  // 3. Assess risk
  const risk = assessRisk(command, args);

  // 4. Mission mode enforcement
  if (mode === "plan" && risk.mutating) {
    const err = new ExecutionError(
      `PLAN mode rejects mutating command: ${command} ${args.join(" ")}`,
      "PLAN_MODE_REJECTED",
    );
    return executionError(err);
  }

  // 5. Approval gate for elevated/dangerous commands
  if (risk.level === "dangerous" || (risk.level === "elevated" && mode !== "auto")) {
    if (options?.approvalProvider) {
      const approved = await options.approvalProvider(command, args, risk);
      if (!approved) {
        const err = new ExecutionError(
          `Approval denied for ${risk.level} command: ${command} ${args.join(" ")}`,
          "APPROVAL_REQUIRED",
        );
        return executionError(err);
      }
    } else if (risk.level === "dangerous") {
      // Dangerous commands always require approval — no provider means reject
      const err = new ExecutionError(
        `Dangerous command "${command}" requires an approval provider`,
        "APPROVAL_REQUIRED",
      );
      return executionError(err);
    }
  }

  // 6. Path escape protection
  if (!isWithinWorkspace(cwd, workspaceRoot)) {
    const err = new ExecutionError(
      `Command cwd "${cwd}" is outside workspace root "${workspaceRoot}"`,
      "PATH_ESCAPE",
    );
    return executionError(err);
  }

  // 7. Execute with RuntimeStore tracking
  const store = options?.store ?? null;
  if (store) {
    store.commandStart(label, args, cwd);
  }

  const t0 = Date.now();
  const result = await shell.execute({ command, args, cwd, timeoutMs, maxOutputBytes: options?.maxOutputBytes, env: options?.env });
  const durationMs = Date.now() - t0;

  // 8. Redact secrets from output
  const stdout = redactSecrets(result.stdout);
  const stderr = redactSecrets(result.stderr);

  const toolResult: ToolResult = {
    success: result.ok,
    message: result.ok
      ? `${command} ${args.join(" ")} — exit 0 (${durationMs}ms)`
      : `${command} ${args.join(" ")} — exit ${result.exitCode} (${durationMs}ms)`,
    data: {
      command,
      args,
      stdout,
      stderr,
      exitCode: result.exitCode,
      durationMs,
      truncated: result.truncated,
      riskLevel: risk.level,
      mutating: risk.mutating,
    },
  };

  if (store) {
    store.commandEnd(
      label,
      result.ok,
      result.exitCode,
      durationMs,
      toolResult.message,
    );
  }

  return toolResult;
}

// ─── Shell-string execution (DISABLED by default) ─────────────────

/**
 * Execute a shell string.
 *
 * This is the UNRESTRICTED execution path. It is intentionally DISABLED
 * by default. There is no legitimate caller in the current LiTT runtime.
 *
 * If a future feature requires shell-string execution (e.g. running a
 * user-provided script), it must:
 *   1. Be explicitly enabled by the caller
 *   2. Go through the same risk assessment and approval gates
 *   3. Be classified as "dangerous" regardless of content
 *
 * DO NOT enable this merely because the interface exists.
 */
export async function runShellCommand(
  _shell: ShellExecutor,
  _commandString: string,
  _options?: ExecutionOptions,
): Promise<ToolResult> {
  return {
    success: false,
    message: "Shell-string execution is disabled. Use runCommand() with structured arguments.",
    data: {
      code: "SHELL_EXECUTION_DISABLED",
      reason: "No legitimate caller requires unrestricted shell execution.",
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function executionError(err: ExecutionError): ToolResult {
  return {
    success: false,
    message: err.message,
    data: {
      code: err.code,
      error: err.message,
    },
  };
}
