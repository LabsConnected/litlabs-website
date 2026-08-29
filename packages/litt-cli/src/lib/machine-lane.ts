/**
 * MACHINE LANE — deterministic local command execution without a model.
 *
 * WHY THIS EXISTS
 * ---------------
 * The cockpit's default execution target is REMOTE: the MODEL inference
 * is proxied through terminal-server, and tool calls returned by the
 * model execute locally. When terminal-server is unreachable, the model
 * never responds — `awaitRemoteReady()` throws after 15s and the whole
 * mission dies, even for requests that only need LOCAL read-only
 * commands like `where.exe adb` or `adb devices -l`.
 *
 * This lane sits alongside LOCAL/READ/MISSION/CHAT and handles EXPLICIT
 * local command execution requests deterministically:
 *
 *   - a `/local <command...>` slash command (single or multi-line), OR
 *   - natural language that combines a local-execution intent
 *     ("execute locally", "do not use REMOTE", "run locally") with an
 *     explicit command list (a "Run:" block or bare command lines).
 *
 * It does NOT:
 *   - contact the remote model server (no `awaitRemoteReady`, no
 *     `resolveModelProvider`, no synthesis call)
 *   - create a Mission or invoke the planner / VerificationGate
 *   - fabricate results — every command runs through the canonical
 *     ExecutionGateway → `project.run` → `runCommand`, which classifies
 *     risk, enforces PLAN/ACT mode, filters env, and redacts secrets
 *   - claim remote hardware is visible locally (USB/ADB requests resolve
 *     to LOCAL; a request for remote-only resources does not match this
 *     lane and falls through to the normal path, which fails correctly
 *     when remote is down)
 *
 * Truthfulness:
 *   - every result carries its execution locus (LOCAL)
 *   - missing tools report as missing (exit code / "not found"), never
 *     as "available" by inference
 *   - the canonical `classifyCommand` decides risk class — this lane
 *     does not invent a competing risk model
 *
 * Reuses (does NOT duplicate):
 *   - `classifyCommand` / `normalizeCommand` from @litt/agent-core
 *   - `redactSecrets` (applied inside runCommand, defense-in-depth)
 *   - the ExecutionGateway + ToolRegistry `project.run` tool
 */

import { classifyCommand, normalizeCommand, type ToolResult } from "@litt/agent-core";

// ─── Types ─────────────────────────────────────────────────────────

/** Where the command executes. The machine lane is always LOCAL. */
export type ExecutionLocus = "local" | "remote" | "companion" | "unknown";

/** A single parsed local command to execute. */
export interface MachineCommand {
  /** Executable name (e.g. "where.exe", "adb", "git"). */
  command: string;
  /** Structured arguments — never a concatenated shell string. */
  args: string[];
  /** The raw line as the user wrote it (for display). */
  raw: string;
}

/** A matched machine-lane request. */
export interface MachineMatch {
  /** The parsed commands to execute locally. */
  commands: MachineCommand[];
  /** Human-readable summary of what was matched. */
  summary: string;
  /** The execution locus for every command in this match (always "local"). */
  locus: ExecutionLocus;
}

/** Result of a single machine command execution. */
export interface MachineCommandResult {
  command: MachineCommand;
  result: ToolResult;
  ms: number;
  locus: ExecutionLocus;
}

// ─── Intent detection ──────────────────────────────────────────────

/**
 * Phrases that signal the user wants LOCAL execution and is explicitly
 * opting out of REMOTE. Matched case-insensitively as substrings.
 */
const LOCAL_INTENT_PHRASES = [
  "execute locally",
  "run locally",
  "do not use remote",
  "don't use remote",
  "no remote",
  "local only",
  "locally only",
  "use real tools",
  "use real tools only",
];

/**
 * Trailing policy text that is stripped before command extraction so it
 * is not mistaken for a command (e.g. "Do not modify anything.").
 */
const TRAILING_POLICY_PATTERNS = [
  /\bdo not modify( anything)?\b/i,
  /\bdon'?t modify( anything)?\b/i,
  /\bdon'?t change( anything)?\b/i,
  /\bno changes\b/i,
  /\bread only\b/i,
  /\bread-only\b/i,
  /\bshow execution locus\b/i,
  /\bshow (the )?execution locus\b/i,
];

function hasLocalIntent(input: string): boolean {
  const lower = input.toLowerCase();
  return LOCAL_INTENT_PHRASES.some((p) => lower.includes(p));
}

// ─── Command parsing ───────────────────────────────────────────────

/**
 * Parse a single command line into { command, args }.
 *
 * Splits on whitespace but respects double-quoted segments so paths
 * containing spaces survive as a single argument. Single quotes are
 * passed through literally (Windows cmd semantics — PowerShell uses
 * single quotes differently and we do not reinterpret them here).
 *
 * Empty lines and comment lines (starting with # or //) are skipped.
 */
export function parseCommandLine(line: string): MachineCommand | null {
  const trimmed = line.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) {
    return null;
  }

  const tokens: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    // skip whitespace
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length) break;

    if (trimmed[i] === '"') {
      // double-quoted segment — consume until closing quote
      i++;
      let seg = "";
      while (i < trimmed.length && trimmed[i] !== '"') {
        seg += trimmed[i];
        i++;
      }
      i++; // skip closing quote
      tokens.push(seg);
    } else {
      // bare token — consume until whitespace
      let seg = "";
      while (i < trimmed.length && !/\s/.test(trimmed[i])) {
        seg += trimmed[i];
        i++;
      }
      tokens.push(seg);
    }
  }

  if (tokens.length === 0) return null;
  const [command, ...args] = tokens;
  return { command, args, raw: trimmed };
}

/**
 * Extract command lines from a natural-language request.
 *
 * Recognizes:
 *   - a "Run:" / "run:" / "Run these:" header followed by command lines
 *     (until a blank line or a trailing policy line)
 *   - bare command lines that look like executable invocations when the
 *     request has explicit local intent
 *
 * Returns the parsed commands, or null if no command lines were found.
 */
export function extractCommands(input: string): MachineCommand[] | null {
  // Strip trailing policy lines so "Do not modify anything." is not
  // mistaken for a command. Applied per-line.
  const lines = input.split(/\r?\n/);

  // Find a "Run:" header — commands follow it.
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*run\s*:?\s*$/i.test(lines[i]) || /^\s*run these\s*:?\s*$/i.test(lines[i])) {
      startIdx = i + 1;
      break;
    }
  }

  let candidateLines: string[];

  if (startIdx >= 0) {
    // Collect lines after the header until a blank line or a trailing
    // policy line. Policy lines that appear AFTER the command block are
    // stripped; command lines are not.
    candidateLines = [];
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") break;
      if (TRAILING_POLICY_PATTERNS.some((p) => p.test(line))) break;
      candidateLines.push(line);
    }
  } else {
    // No "Run:" header — collect lines that look like commands. A line
    // "looks like a command" if its first token contains no sentence
    // punctuation and the line is not prose (heuristic: <= 6 tokens and
    // the first token looks like an executable name — no vowels-only
    // words, no sentence-ending punctuation).
    candidateLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      // Skip prose lines (contain sentence punctuation or are long)
      if (/[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length > 2) continue;
      if (trimmed.split(/\s+/).length > 8) continue;
      // Skip lines that are clearly instructions, not commands
      if (/^(do not|don't|please|show|use|run|check|tell|list|verify|no |read)/i.test(trimmed) && !looksLikeCommand(trimmed)) {
        continue;
      }
      if (looksLikeCommand(trimmed)) {
        candidateLines.push(line);
      }
    }
  }

  const commands: MachineCommand[] = [];
  for (const line of candidateLines) {
    const parsed = parseCommandLine(line);
    if (parsed) commands.push(parsed);
  }

  return commands.length > 0 ? commands : null;
}

/**
 * Heuristic: does a line look like an executable invocation rather than
 * prose? True when the first token contains a path separator, a Windows
 * drive letter, an executable extension, OR is a known command-shaped
 * token (lowercase with optional dots/dashes, no spaces).
 */
function looksLikeCommand(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  if (firstToken === "") return false;

  // Path separator or drive letter → almost certainly a command/path
  if (/[\\/]/.test(firstToken) || /^[a-zA-Z]:/.test(firstToken)) return true;
  // Executable extension
  if (/\.(exe|cmd|bat|ps1|com|sh|py)$/i.test(firstToken)) return true;
  // Known command verbs that are also executable names
  const known = new Set([
    "git", "node", "npm", "npx", "pnpm", "pnpx", "yarn", "python", "python3",
    "pip", "powershell", "pwsh", "cmd", "adb", "fastboot", "docker", "railway",
    "gh", "cloudflared", "ffmpeg", "winget", "choco", "scoop", "curl", "ssh",
    "rg", "where", "which", "type", "cat", "ls", "dir", "echo", "head", "tail",
    "wc", "find", "grep", "whoami", "hostname", "uname", "pwd", "env", "printenv",
    "tsc", "eslint", "prettier", "vitest", "jest", "tsx",
  ]);
  if (known.has(firstToken.toLowerCase())) return true;
  // get-/stop-/start- PowerShell cmdlet shape
  if (/^(get|set|new|remove|stop|start|restart|invoke|test|select|measure|update|out|where|sort|compare|convert|write|read|add|clear|disable|enable|export|import|wait|watch|resume|suspend)-/i.test(firstToken)) {
    return true;
  }
  return false;
}

// ─── Matching ──────────────────────────────────────────────────────

/**
 * Try to match `input` as an explicit local command execution request.
 *
 * Returns a MachineMatch when:
 *   - the input is a `/local` slash command with at least one command, OR
 *   - the input has explicit local-execution intent AND contains at
 *     least one parseable command line.
 *
 * Returns null otherwise (the controller falls through to the normal
 * READ/MISSION/CHAT path, which may contact the remote model server).
 */
export function matchMachineLane(input: string): MachineMatch | null {
  // ─── /local slash command ───────────────────────────────────────
  if (input.startsWith("/local ") || input === "/local") {
    const body = input.slice("/local".length).trim();
    if (body === "") return null;
    // /local supports multi-line: each line is a separate command.
    const commands: MachineCommand[] = [];
    for (const line of body.split(/\r?\n/)) {
      const parsed = parseCommandLine(line);
      if (parsed) commands.push(parsed);
    }
    if (commands.length === 0) return null;
    return {
      commands,
      summary: commands.length === 1
        ? `LOCAL · ${commands[0].raw}`
        : `LOCAL · ${commands.length} commands`,
      locus: "local",
    };
  }

  // ─── Natural language with explicit local intent ────────────────
  if (!hasLocalIntent(input)) return null;
  const commands = extractCommands(input);
  if (!commands || commands.length === 0) return null;

  return {
    commands,
    summary: commands.length === 1
      ? `LOCAL · ${commands[0].raw}`
      : `LOCAL · ${commands.length} commands`,
    locus: "local",
  };
}

// ─── Risk pre-check ────────────────────────────────────────────────

/**
 * Pre-classify a command using the canonical risk model.
 *
 * The gateway's `project.run` → `runCommand` performs the authoritative
 * classification and mode/approval enforcement. This pre-check lets the
 * machine lane reject DESTRUCTIVE commands up front (the user asked for
 * read-only local inspection) and report the locus + risk class in the
 * activity feed BEFORE execution.
 *
 * Returns the RiskAssessment from `classifyCommand`.
 */
export function classifyMachineCommand(command: MachineCommand) {
  return classifyCommand(command.command, command.args);
}

/**
 * Commands that are always destructive and must NOT run through the
 * machine lane without explicit, specific user intent — even in ACT
 * mode. The machine lane is for read-only local inspection; destructive
 * operations belong on the mission path with full approval UX.
 */
const DESTRUCTIVE_NORMALIZED = new Set([
  "rm", "rmdir", "del", "format", "shutdown", "reboot", "mkfs", "dd",
  "kill", "killall", "taskkill",
]);

/**
 * fastboot subcommands that are device-destructive. Everything else
 * (devices, getvar, oem get-security-state, etc.) is read-only discovery.
 */
const FASTBOOT_DESTRUCTIVE_SUBS = new Set([
  "flash", "erase", "format", "wipe", "reboot-bootloader",
]);

/**
 * Should this command be refused by the machine lane up front?
 *
 * The machine lane is a read-only local inspection path. Destructive
 * commands (rm, format, fastboot flash, etc.) are refused here — they
 * require the full mission + approval flow, not a deterministic lane.
 * The gateway still enforces mode/approval for anything that passes.
 *
 * fastboot is handled by subcommand: `fastboot devices` / `fastboot
 * getvar` are read-only discovery and allowed; `fastboot flash` /
 * `fastboot erase` / `fastboot wipe` are device-destructive and refused.
 */
export function shouldRefuseUpFront(command: MachineCommand): boolean {
  const cmd = normalizeCommand(command.command);
  if (DESTRUCTIVE_NORMALIZED.has(cmd)) return true;
  if (cmd === "fastboot" && command.args.length > 0) {
    const sub = command.args[0].toLowerCase();
    if (FASTBOOT_DESTRUCTIVE_SUBS.has(sub)) {
      return true;
    }
  }
  return false;
}

// ─── Result formatting ─────────────────────────────────────────────

/**
 * Format a single command result for the transcript / activity feed.
 * Includes the execution locus so the user can see WHERE it ran.
 */
export function formatMachineResult(res: MachineCommandResult): string {
  const locus = res.locus.toUpperCase();
  const cmd = res.command.raw;
  if (res.result.success) {
    const stdout = typeof res.result.data?.stdout === "string"
      ? (res.result.data.stdout as string).trim()
      : "";
    const tail = stdout ? `\n${stdout}` : "";
    return `${locus} · ${cmd} — exit 0 (${res.ms}ms)${tail}`;
  }
  // Failed / not found — report honestly, never infer availability
  const stderr = typeof res.result.data?.stderr === "string"
    ? (res.result.data.stderr as string).trim()
    : "";
  const code = res.result.data?.exitCode;
  const tail = stderr ? `\n${stderr}` : "";
  return `${locus} · ${cmd} — ${res.result.message}${tail}`;
}

/**
 * Format the full machine-lane result (all commands) into a single
 * assistant message. No model synthesis — pure deterministic formatting
 * of the real tool outputs.
 */
export function formatMachineLaneOutput(results: MachineCommandResult[]): string {
  const lines: string[] = [];
  for (const res of results) {
    lines.push(formatMachineResult(res));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
