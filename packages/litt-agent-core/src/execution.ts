/**
 * Structured execution boundary — Phase 3A.1 hardened.
 *
 * Security model (capability-based, not metacharacter filtering):
 *
 *   structured argv
 *         ↓
 *   executable resolver (resolve real path, don't trust PATH alone)
 *         ↓
 *   operation parser (command + subcommand → capability)
 *         ↓
 *   capability/risk classification (arbitrary-code vs read-only vs mutating)
 *         ↓
 *   package-script inspection (npm/pnpm/yarn run → resolve script body)
 *         ↓
 *   policy decision (PLAN/ACT/AUTO + approval gate)
 *         ↓
 *   workspace/environment constraints (cwd + path-bearing args + env filter)
 *         ↓
 *   execFile/spawn (structured argv, no shell string)
 *
 * Key principles:
 *   - execFile already prevents shell-string injection. We do NOT filter
 *     metacharacters in arguments — that causes false positives (URLs with
 *     &b=2, commit messages with "fix auth & billing", grep "foo|bar").
 *   - The real threat is arbitrary-code execution via interpreters (node,
 *     python) and package-manager scripts (npm run X). These are classified
 *     as elevated capabilities, not "safe" because the executable name is
 *     allowlisted.
 *   - runShellCommand() remains DISABLED. No legitimate caller exists.
 */

import type { ShellExecutor, ToolResult, StreamChunk } from "./types.js";
import type { RuntimeStore } from "./state.js";
import * as fs from "fs";
import * as path from "path";

// ─── Mission modes ────────────────────────────────────────────────

export type MissionMode = "plan" | "act" | "auto";

// ─── Capability classification ────────────────────────────────────

/**
 * Capability tier — what level of code execution this command grants.
 *
 * read_only:       cannot modify filesystem or external state
 * workspace_edit:  modifies files within the workspace
 * arbitrary_code:  executes project-controlled or user-supplied code
 * destructive:     irreversibly destroys data or state
 * external_action: affects systems outside the workspace (deploy, push, post)
 */
export type CapabilityTier =
  | "read_only"
  | "workspace_edit"
  | "arbitrary_code"
  | "destructive"
  | "external_action";

export type RiskLevel = "safe" | "elevated" | "dangerous";

export interface RiskAssessment {
  level: RiskLevel;
  capability: CapabilityTier;
  reason: string;
  mutating: boolean;
  /** For package-manager scripts: the resolved script body (untrusted code) */
  resolvedScriptBody?: string | null;
}

// ─── Execution error ──────────────────────────────────────────────

export type ExecutionErrorCode =
  | "COMMAND_NOT_ALLOWED"
  | "DEVICE_TARGET_UNVALIDATED"
  | "DEVICE_TARGET_REJECTED"
  | "PLAN_MODE_REJECTED"
  | "APPROVAL_REQUIRED"
  | "PATH_ESCAPE"
  | "PATH_ARG_ESCAPE"
  | "MALICIOUS_SCRIPT"
  | "SCRIPT_NOT_FOUND"
  | "ENV_VAR_BLOCKED"
  | "SYMLINK_ESCAPE"
  | "TIMEOUT"
  | "CANCELLED"
  | "STDIN_TOO_LARGE"
  | "SHELL_EXECUTION_DISABLED";

export class ExecutionError extends Error {
  code: ExecutionErrorCode;
  constructor(message: string, code: ExecutionErrorCode) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
  }
}

// ─── Command registry ─────────────────────────────────────────────

interface CommandSpec {
  /** Capability tier when called with no subcommand or read-only args */
  defaultCapability: CapabilityTier;
  /** Subcommand-specific capabilities */
  subcommands?: Record<string, CapabilityTier>;
  /** Args that carry path values — validated against workspace root */
  pathArgs?: string[];
  /** Whether this command can execute arbitrary code */
  arbitraryCode?: boolean;
}

const COMMAND_SPECS: Record<string, CommandSpec> = {
  // Discovery / lookup — pure read-only, no side effects.
  // `where.exe bash 2>&1` is an executable lookup, NOT arbitrary code.
  // Note: Windows executables invoked with their extension (`where.exe`,
  // `where.cmd`) are normalized before this lookup — see normalizeCommand().
  where: { defaultCapability: "read_only" },
  which: { defaultCapability: "read_only" },
  type: { defaultCapability: "read_only" }, // cmd: print file · sh builtin: describe command — both read-only
  stat: { defaultCapability: "read_only" },
  file: { defaultCapability: "read_only" },
  tree: { defaultCapability: "read_only" },
  du: { defaultCapability: "read_only" },
  df: { defaultCapability: "read_only" },
  diff: { defaultCapability: "read_only" },
  cmp: { defaultCapability: "read_only" },
  cut: { defaultCapability: "read_only" },
  sort: { defaultCapability: "read_only" },
  uniq: { defaultCapability: "read_only" },
  md5sum: { defaultCapability: "read_only" },
  sha256sum: { defaultCapability: "read_only" },
  findstr: { defaultCapability: "read_only" },
  more: { defaultCapability: "read_only" },
  less: { defaultCapability: "read_only" },
  date: { defaultCapability: "read_only" },
  cal: { defaultCapability: "read_only" },
  id: { defaultCapability: "read_only" },
  groups: { defaultCapability: "read_only" },
  // PowerShell read-only cmdlets (matched lowercase — PS is case-insensitive)
  "get-location": { defaultCapability: "read_only" },
  "get-childitem": { defaultCapability: "read_only" },
  "get-content": { defaultCapability: "read_only" },
  "get-command": { defaultCapability: "read_only" },
  "get-item": { defaultCapability: "read_only" },
  "get-process": { defaultCapability: "read_only" },
  "get-date": { defaultCapability: "read_only" },
  "test-path": { defaultCapability: "read_only" },
  "select-string": { defaultCapability: "read_only" },
  "measure-object": { defaultCapability: "read_only" },
  // Common PowerShell aliases for the above
  gci: { defaultCapability: "read_only" },
  gc: { defaultCapability: "read_only" },
  gi: { defaultCapability: "read_only" },
  gl: { defaultCapability: "read_only" },
  sls: { defaultCapability: "read_only" },

  // Interpreters — arbitrary code execution
  node: { defaultCapability: "arbitrary_code", arbitraryCode: true, pathArgs: ["--require", "-r", "--input-type"] },
  npx: { defaultCapability: "arbitrary_code", arbitraryCode: true },
  pnpx: { defaultCapability: "arbitrary_code", arbitraryCode: true },
  tsx: { defaultCapability: "arbitrary_code", arbitraryCode: true, pathArgs: ["--require", "-r"] },
  python: { defaultCapability: "arbitrary_code", arbitraryCode: true },
  python3: { defaultCapability: "arbitrary_code", arbitraryCode: true },

  // Package managers — run executes arbitrary project code
  npm: {
    defaultCapability: "workspace_edit",
    subcommands: {
      run: "arbitrary_code",
      exec: "arbitrary_code",
      install: "workspace_edit",
      i: "workspace_edit",
      add: "workspace_edit",
      remove: "workspace_edit",
      uninstall: "workspace_edit",
      rm: "workspace_edit",
      publish: "external_action",
      deprecate: "external_action",
      unpublish: "external_action",
      audit: "read_only",
      ls: "read_only",
      list: "read_only",
      outdated: "read_only",
      view: "read_only",
      info: "read_only",
      root: "read_only",
      pack: "workspace_edit",
      test: "arbitrary_code",
      start: "arbitrary_code",
      build: "arbitrary_code",
    },
    pathArgs: ["--prefix", "--globalconfig", "--userconfig"],
  },
  pnpm: {
    defaultCapability: "workspace_edit",
    subcommands: {
      run: "arbitrary_code",
      exec: "arbitrary_code",
      install: "workspace_edit",
      i: "workspace_edit",
      add: "workspace_edit",
      remove: "workspace_edit",
      rm: "workspace_edit",
      uninstall: "workspace_edit",
      publish: "external_action",
      test: "arbitrary_code",
      start: "arbitrary_code",
      build: "arbitrary_code",
      dlx: "arbitrary_code",
    },
    pathArgs: ["--prefix", "--dir", "-C", "--config"],
  },
  yarn: {
    defaultCapability: "workspace_edit",
    subcommands: {
      run: "arbitrary_code",
      add: "workspace_edit",
      remove: "workspace_edit",
      publish: "external_action",
      test: "arbitrary_code",
      build: "arbitrary_code",
      dlx: "arbitrary_code",
    },
    pathArgs: ["--cwd", "--prefix"],
  },

  // Git — read-only vs mutating
  git: {
    defaultCapability: "read_only",
    subcommands: {
      status: "read_only",
      diff: "read_only",
      log: "read_only",
      show: "read_only",
      branch: "read_only",
      blame: "read_only",
      ls: "read_only",
      "ls-files": "read_only",
      remote: "read_only",
      tag: "read_only",
      describe: "read_only",
      rev: "read_only",
      "rev-parse": "read_only",
      config: "workspace_edit",
      checkout: "workspace_edit",
      switch: "workspace_edit",
      restore: "workspace_edit",
      add: "workspace_edit",
      commit: "workspace_edit",
      merge: "workspace_edit",
      rebase: "workspace_edit",
      cherry: "workspace_edit",
      "cherry-pick": "workspace_edit",
      revert: "workspace_edit",
      stash: "workspace_edit",
      reset: "destructive",
      clean: "destructive",
      push: "external_action",
      pull: "workspace_edit",
      fetch: "workspace_edit",
      clone: "workspace_edit",
      init: "workspace_edit",
      mv: "workspace_edit",
      rm: "destructive",
    },
    pathArgs: ["-C", "--git-dir", "--work-tree"],
  },

  // Build tools — mostly read-only
  tsc: { defaultCapability: "read_only", pathArgs: ["--project", "-p", "--outDir", "--out", "--declarationDir"] },
  "tsc-watch": { defaultCapability: "read_only", pathArgs: ["--project", "-p"] },
  eslint: { defaultCapability: "read_only", pathArgs: ["--config", "-c", "--output-file"] },
  prettier: { defaultCapability: "read_only", pathArgs: ["--config", "-c"] },
  vitest: { defaultCapability: "arbitrary_code", arbitraryCode: true, pathArgs: ["--config", "-c"] },
  jest: { defaultCapability: "arbitrary_code", arbitraryCode: true, pathArgs: ["--config", "-c"] },

  // File inspection — read-only
  cat: { defaultCapability: "read_only" },
  ls: { defaultCapability: "read_only" },
  dir: { defaultCapability: "read_only" },
  echo: { defaultCapability: "read_only" },
  head: { defaultCapability: "read_only" },
  tail: { defaultCapability: "read_only" },
  wc: { defaultCapability: "read_only" },
  find: { defaultCapability: "read_only" },
  grep: { defaultCapability: "read_only" },
  rg: { defaultCapability: "read_only" },

  // System info — read-only
  whoami: { defaultCapability: "read_only" },
  hostname: { defaultCapability: "read_only" },
  uname: { defaultCapability: "read_only" },
  pwd: { defaultCapability: "read_only" },
  env: { defaultCapability: "read_only" },
  printenv: { defaultCapability: "read_only" },

  // LiTT CLI self-introspection — read-only diagnostic subcommands.
  // Allows the agent to run `litt doctor`, `litt status`, `litt whoami`,
  // `litt --remote doctor` etc. to truthfully answer questions about
  // its own runtime/auth/REMOTE state. Mutating subcommands (login,
  // logout, build, test, run) are NOT here — they stay arbitrary_code.
  litt: {
    defaultCapability: "arbitrary_code", // safe default for unknown subcommands
    subcommands: {
      doctor: "read_only",
      status: "read_only",
      whoami: "read_only",
      version: "read_only",
      inspect: "read_only",
      diff: "read_only",
      check: "read_only",
    },
  },

  // adb — device-facing command. defaultCapability is the floor for
  // unrecognized subcommands; the special-case refinement below maps
  // the real per-subcommand surface (including -s/-t/-H/-P flag forms
  // and `adb shell <device-cmd>` granularity) so raw project.run adb
  // cannot bypass the validated Android operation allowlist.
  adb: { defaultCapability: "arbitrary_code" },
};

/**
 * Commands that are always destructive — require explicit approval
 * even in AUTO mode, even with an approval provider.
 */
const DESTRUCTIVE_COMMANDS = new Set([
  "rm",
  "rmdir",
  "del",
  "format",
  "shutdown",
  "reboot",
  "mkfs",
  "dd",
  "kill",
  "killall",
  "taskkill",
]);

// ─── adb capability refinement ──────────────────────────────────
//
// adb global flags that consume the NEXT arg as a value. When the
// subcommand position is computed these flag+value pairs are skipped
// so `adb -s SERIAL shell getprop` resolves "shell", not "SERIAL".
const ADB_VALUE_FLAGS = new Set(["-s", "-t", "-H", "-P", "-L"]);

// Host-side subcommands (first non-flag token).
const ADB_READONLY_SUBS = new Set([
  "devices", "get-state", "get-serialno", "get-devpath", "version",
  "help", "jdwp", "keygen", "show-features", "logcat",
]);
const ADB_EXTERNAL_SUBS = new Set(["push", "pull"]);
const ADB_WORKSPACE_SUBS = new Set([
  "forward", "reverse", "connect", "disconnect", "pair",
  "start-server", "kill-server", "reconnect", "wait-for-device",
]);
const ADB_DESTRUCTIVE_SUBS = new Set([
  "shell", "install", "uninstall", "root", "unroot", "reboot",
  "reboot-bootloader", "reboot-recovery", "remount", "disable-verity",
  "usb", "tcpip", "emu", "sideload", "sync",
]);

// On-device commands inside `adb shell <cmd>` — read-only diagnostics
// only; anything that writes device state or runs unrecognized
// programs stays at the strict tier.
const ADB_SHELL_READONLY = new Set([
  "getprop", "dumpsys", "ls", "stat", "cat", "ps", "echo", "id",
  "uname", "whoami", "date", "uptime", "df", "printenv", "env",
]);
const ADB_SHELL_ELEVATED = new Set([
  "input", "monkey", "am", "screencap", "screenrecord", "mkdir",
  "touch", "cp", "mv", "wm", "logcat",
]);

/**
 * Refine the capability tier for `adb` based on its real subcommand
 * and (for `adb shell`) the on-device command being run. Only ever
 * returns an existing CapabilityTier — the mapping tightens or keeps
 * the spec default, so it cannot weaken classification.
 */
export function classifyAdbCapability(args: string[], current: CapabilityTier): CapabilityTier {
  // Locate the subcommand: first non-flag token, skipping value-flags.
  let subIdx = -1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (ADB_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    subIdx = i;
    break;
  }
  const sub = subIdx >= 0 ? args[subIdx].toLowerCase() : "";

  if (sub === "shell") {
    const devCmd = (args[subIdx + 1] ?? "").toLowerCase();
    if (devCmd === "pm") {
      // `pm list …` is inspection; everything else (uninstall, clear,
      // disable, grant, revoke) mutates device state destructively.
      return (args[subIdx + 2] ?? "").toLowerCase() === "list" ? "read_only" : "destructive";
    }
    if (ADB_SHELL_READONLY.has(devCmd)) return "read_only";
    if (ADB_SHELL_ELEVATED.has(devCmd)) return "arbitrary_code";
    // Bare `adb shell` (interactive) or any unrecognized on-device
    // command = unrestricted device execution → strictest tier.
    return "destructive";
  }
  if (ADB_READONLY_SUBS.has(sub)) return "read_only";
  if (ADB_EXTERNAL_SUBS.has(sub)) return "external_action";
  if (ADB_DESTRUCTIVE_SUBS.has(sub)) return "destructive";
  if (ADB_WORKSPACE_SUBS.has(sub)) return "workspace_edit";
  return current;
}

// ─── adb device-identity boundary ───────────────────────────────
//
// Operation-risk classification (above) decides WHAT an adb command
// may do. This boundary decides WHICH device it may do it to. Raw
// `project.run adb …`, `/local`, and `litt run` all funnel through
// runCommand() — validating the target serial here means no routing
// path can bypass the Android device allowlist.
//
// Host-level adb subcommands that never touch a device.
const ADB_HOST_ONLY_SUBS = new Set([
  "devices", "version", "help", "start-server", "kill-server",
  "reconnect", "connect", "disconnect", "pair", "forward", "reverse",
  "keygen", "show-features", "mdns", "nodaemon", "features", "doc",
]);

export interface AdbInvocationParts {
  /** First non-flag token (the subcommand), lowercased. "" when absent. */
  sub: string;
  /** Value of -s, when present. */
  serial?: string;
  /** Value of -t (transport id — NOT a serial), when present. */
  transportId?: string;
}

/** Parse adb argv into subcommand + device selectors. */
export function extractAdbInvocation(args: string[]): AdbInvocationParts {
  let serial: string | undefined;
  let transportId: string | undefined;
  let sub = "";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-s") { serial = args[++i]; continue; }
    if (a === "-t") { transportId = args[++i]; continue; }
    if (ADB_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith("-")) continue;
    if (sub === "") sub = a.toLowerCase();
  }
  return { sub, serial, transportId };
}

/** True when the adb invocation acts on a device (vs. host-only ops). */
export function adbTargetsDevice(args: string[]): boolean {
  const { sub } = extractAdbInvocation(args);
  return sub !== "" && !ADB_HOST_ONLY_SUBS.has(sub);
}

export interface AdbTargetValidation {
  ok: boolean;
  reason?: string;
}

/**
 * The device-identity validator. Registered once by the surface that
 * owns the Android policy (litt-cli registers its allowlist-backed
 * validator). runCommand() consults it for every device-targeting adb
 * invocation — before classification completes, before approval, and
 * always before the shell executor is invoked.
 */
export type AdbTargetValidator = (
  args: string[],
  shell: ShellExecutor,
) => Promise<AdbTargetValidation>;

let _adbTargetValidator: AdbTargetValidator | null = null;

/** Register (or clear with null) the shared adb target validator. */
export function setAdbTargetValidator(v: AdbTargetValidator | null): void {
  _adbTargetValidator = v;
}

/** Current validator, for tests/introspection. */
export function getAdbTargetValidator(): AdbTargetValidator | null {
  return _adbTargetValidator;
}

/**
 * Shared device-identity check for EVERY adb spawn leg — the secure
 * runCommand() below AND the thin project.ts runCommand() used by the
 * script helpers. Returns a failed ToolResult when the invocation
 * targets a device that fails validation; null when it may proceed.
 *
 * Fail-closed: a device-targeting adb command with no registered
 * validator is rejected outright. Compare on basename+normalize so a
 * path-qualified adb.exe is validated like bare `adb` (tightening
 * only — other commands keep normalizeCommand() semantics).
 */
export async function assertAdbTargetAllowed(
  command: string,
  args: string[],
  shell: ShellExecutor,
): Promise<ToolResult | null> {
  const base = command.split(/[\/]/).pop() ?? command;
  if (normalizeCommand(base) !== "adb" || !adbTargetsDevice(args)) return null;
  if (!_adbTargetValidator) {
    return executionError(
      new ExecutionError(
        "adb device-targeting command blocked: no Android device-identity validator is configured",
        "DEVICE_TARGET_UNVALIDATED",
      ),
    );
  }
  const verdict = await _adbTargetValidator(args, shell);
  if (verdict.ok) return null;
  return executionError(
    new ExecutionError(
      `adb device target rejected: ${verdict.reason ?? "not authorized"}`,
      "DEVICE_TARGET_REJECTED",
    ),
  );
}

// ─── Capability → risk mapping ────────────────────────────────────

function capabilityToRisk(cap: CapabilityTier): { level: RiskLevel; mutating: boolean } {
  switch (cap) {
    case "read_only":
      return { level: "safe", mutating: false };
    case "workspace_edit":
      return { level: "elevated", mutating: true };
    case "arbitrary_code":
      return { level: "elevated", mutating: true };
    case "destructive":
      return { level: "dangerous", mutating: true };
    case "external_action":
      return { level: "dangerous", mutating: true };
  }
}

// ─── Version flag detection ────────────────────────────────────────

/**
 * Flags that only request version/introspection info — no side effects.
 * Used to downgrade interpreters/package managers from arbitrary_code to
 * read_only when the user (or agent) just wants the version string.
 */
const VERSION_FLAGS = new Set(["--version", "-version", "-v", "-V", "--help", "-h", "--help"]);

function isVersionFlag(arg: string): boolean {
  return VERSION_FLAGS.has(arg);
}

// ─── Operation parser ─────────────────────────────────────────────

/**
 * Normalize a command token for registry lookup.
 *
 * Windows shells frequently invoke allowlisted tools with their extension
 * (`where.exe bash`, `git.exe status`, `rg.cmd …`). The extension changes
 * NOTHING about what the command can do, so it must not change the risk
 * class — otherwise harmless discovery commands get classified as
 * arbitrary code and block the run behind an approval prompt.
 *
 * This is a structural fix (suffix normalization), not a string whitelist:
 * ANY registry command keeps its class when invoked with an executable
 * extension, and unregistered commands remain arbitrary code.
 */
export function normalizeCommand(command: string): string {
  const lower = command.toLowerCase();
  return lower.replace(/\.(exe|cmd|bat|com|ps1)$/, "");
}

/**
 * Parse a command + args into a capability tier.
 * This is the core of the capability-based security model.
 */
export function classifyCommand(command: string, args: string[], cwd?: string): RiskAssessment {
  const cmd = normalizeCommand(command);

  // Destructive commands — always dangerous
  if (DESTRUCTIVE_COMMANDS.has(cmd)) {
    return {
      level: "dangerous",
      capability: "destructive",
      reason: `Command "${cmd}" is classified as destructive`,
      mutating: true,
    };
  }

  // Version/introspection flags — pure read-only, no side effects.
  // `node --version`, `pnpm -v`, `python -V`, etc. only print version info.
  // Must be checked BEFORE COMMAND_SPECS lookup because interpreters and
  // package managers default to arbitrary_code/workspace_edit, which would
  // deny these harmless introspection commands in act mode.
  if (args.length > 0 && args.every(isVersionFlag)) {
    return {
      level: "safe",
      capability: "read_only",
      reason: `${cmd} ${args.join(" ")} → version introspection (read-only)`,
      mutating: false,
    };
  }

  const spec = COMMAND_SPECS[cmd];
  if (!spec) {
    // Unknown command — treat as arbitrary code (most restrictive non-destructive)
    return {
      level: "elevated",
      capability: "arbitrary_code",
      reason: `Command "${cmd}" is not in the known registry — treated as arbitrary code`,
      mutating: true,
    };
  }

  // Determine capability from subcommand
  let capability = spec.defaultCapability;
  if (spec.subcommands && args.length > 0) {
    const subcmd = args[0].toLowerCase();
    if (spec.subcommands[subcmd]) {
      capability = spec.subcommands[subcmd];
    }
  }

  // Special case: git branch -D (destructive)
  if (cmd === "git" && args[0] === "branch" && (args.includes("-D") || args.includes("-d"))) {
    capability = "destructive";
  }

  // Special case: adb — per-subcommand + on-device-command tiers.
  // The validated android.* tool family is the governed path; raw
  // `project.run adb …` must be AT LEAST as strict. Unrestricted
  // on-device shell, install, root, reboot, and remount are
  // destructive. Read-only discovery is read_only. Input injection and
  // app launches map to the same elevated tier the tools carry.
  if (cmd === "adb") {
    capability = classifyAdbCapability(args, capability);
  }

  // Special case: litt --remote <subcommand> or litt <subcommand>
  // The --remote flag can appear before the subcommand, so we scan args
  // for the first non-flag token and check if it's a known read-only
  // subcommand. This lets the agent run `litt --remote doctor` etc.
  if (cmd === "litt" && spec.subcommands) {
    const firstNonFlag = args.find((a) => !a.startsWith("-"));
    if (firstNonFlag) {
      const subcmd = firstNonFlag.toLowerCase();
      if (spec.subcommands[subcmd]) {
        capability = spec.subcommands[subcmd];
      }
    }
  }

  // Special case: npm/pnpm/yarn run <script> — inspect package.json
  let resolvedScriptBody: string | null | undefined;
  if ((cmd === "npm" || cmd === "pnpm" || cmd === "yarn") && args[0] === "run" && args.length >= 2) {
    const scriptName = args[1];
    resolvedScriptBody = resolvePackageScript(cwd ?? process.cwd(), scriptName);
    if (resolvedScriptBody === null) {
      return {
        level: "safe",
        capability: "read_only",
        reason: `Script "${scriptName}" not found in package.json`,
        mutating: false,
      };
    }
    // The script body is arbitrary code — already classified as arbitrary_code
    // but we attach the body so callers/tests can inspect it
  }

  const { level, mutating } = capabilityToRisk(capability);
  return {
    level,
    capability,
    reason: `${cmd} ${args[0] ?? ""} → ${capability}`,
    mutating,
    resolvedScriptBody,
  };
}

// ─── Shell-syntax rejection (NOT shell injection filtering) ───────
//
// This is a different concern from the capability classification above.
// A model frequently emits shell-style invocations — `echo 'x' >
// file.html`, `mkdir a && cd a` — as a single `command` string, or as a
// `>` token inside `args`. Because execFile/spawn here is never given
// shell:true (see module docstring), none of that shell syntax is
// interpreted: `>` is passed as a literal argv byte, not a redirect.
// The previous behavior let this reach spawn() and fail with a raw,
// confusing ENOENT (the OS looking for a binary literally named
// "echo 'x' > file.html"). This detects the SHAPE of a shell
// invocation — not characters that merely appear inside a legitimate
// single argument (a commit message with "&", a grep pattern with "|")
// — and rejects it early with an actionable message, before ever
// reaching spawn(). It does not loosen approval or risk
// classification: classifyCommand() above still runs exactly as
// before on whatever is left.
//
// Two narrow, low-false-positive signals, not metacharacter scanning:
//   1. `command` contains whitespace. A real executable name never
//      does — spawn()'s `command` is a single binary, not a shell
//      line. Whitespace in it only happens when a model concatenated
//      a whole shell invocation into one string.
//   2. `args` contains a standalone shell-control token (`>`, `>>`,
//      `<`, `|`, `&&`, `;`, `&`) as one COMPLETE array element — i.e.
//      the model DID split argv correctly, but one token is itself a
//      shell operator that spawn() will pass through literally instead
//      of interpreting.
const SHELL_CONTROL_TOKENS = new Set([">", ">>", "<", "<<", "|", "&&", "||", ";", "&", "`"]);

/**
 * Returns a human-actionable rejection message if `command`/`args` has
 * the shape of a shell invocation that spawn() (no shell) cannot
 * execute as intended, or null if it looks like ordinary structured
 * argv. See the section comment above for what this does and does not
 * check.
 */
export function detectUnsupportedShellSyntax(command: string, args: string[]): string | null {
  if (/\s/.test(command)) {
    return (
      `"${command}" looks like a full shell command line, not a single executable. ` +
      `project.run has no shell — it calls the executable directly, so this would ` +
      `fail (or silently do nothing useful) rather than run as written. Pass the ` +
      `executable as "command" and each remaining word as its own entry in "args". ` +
      `To create or overwrite a file (e.g. the "> file" part of a command like ` +
      `this), use the project.write_file tool instead — it is not interpreted by a shell.`
    );
  }
  const badToken = args.find((a) => SHELL_CONTROL_TOKENS.has(a));
  if (badToken !== undefined) {
    return (
      `The argument "${badToken}" is a shell operator. project.run has no shell, so ` +
      `it is passed to the program literally instead of being interpreted — it will ` +
      `not redirect, pipe, or chain anything. To create or overwrite a file, use the ` +
      `project.write_file tool instead. To run multiple commands, call project.run ` +
      `once per command.`
    );
  }
  return null;
}

// ─── Package script inspection ────────────────────────────────────

/**
 * Resolve a script name from package.json and return the script body.
 * Returns null if the script doesn't exist.
 * Returns undefined if package.json can't be read.
 *
 * The script body is UNTRUSTED — it's project-controlled arbitrary code.
 * Callers must treat it as arbitrary code execution.
 */
export function resolvePackageScript(cwd: string, scriptName: string): string | null {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return undefined as unknown as string; // no package.json — can't resolve
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (!pkg.scripts?.[scriptName]) return null;
    return pkg.scripts[scriptName] as string;
  } catch {
    return undefined as unknown as string;
  }
}

/**
 * Check if a package script body contains suspicious patterns.
 * This is defense-in-depth, not the primary boundary — the primary
 * boundary is classifying `npm run X` as arbitrary_code (elevated).
 *
 * Returns an array of suspicious patterns found, or empty if clean.
 */
export function inspectScriptBody(body: string): string[] {
  const suspicious: string[] = [];
  // These patterns indicate the script does more than build/test
  if (/\bcurl\b|\bwget\b|\bInvoke-WebRequest\b/i.test(body)) suspicious.push("network_download");
  if (/\bpowershell\b|\bcmd\b|\bsh\b.*-c|\bbash\b.*-c/i.test(body)) suspicious.push("shell_invocation");
  if (/eval\s*\(|Function\s*\(/i.test(body)) suspicious.push("eval");
  if (/\bnc\b|\bnetcat\b|\breverse\b/i.test(body)) suspicious.push("network_backdoor");
  if (/\$\(.*\)|`.*`/i.test(body)) suspicious.push("command_substitution");
  if (/\|\s*(sh|bash|powershell|cmd)\b/i.test(body)) suspicious.push("pipe_to_shell");
  return suspicious;
}

// ─── Path safety ──────────────────────────────────────────────────

/**
 * Resolve a path to its real (symlink-resolved) absolute form.
 * Detects symlink/junction escapes from the workspace.
 */
function resolveRealPath(p: string): string {
  try {
    return fs.realpathSync(p).replace(/\\/g, "/").toLowerCase();
  } catch {
    // If realpath fails, normalize manually
    return path.resolve(p).replace(/\\/g, "/").toLowerCase();
  }
}

/**
 * Check if a path is within the workspace root.
 * Uses realpath to detect symlink/junction escapes.
 */
function isWithinWorkspace(p: string, workspaceRoot: string): boolean {
  const normalizedP = resolveRealPath(p);
  const normalizedRoot = resolveRealPath(workspaceRoot);
  return normalizedP === normalizedRoot || normalizedP.startsWith(normalizedRoot + "/");
}

/**
 * Extract path-bearing arguments from the args array and validate
 * that each path is within the workspace root.
 *
 * Handles both --flag value and --flag=value forms.
 */
function validatePathArgs(
  command: string,
  args: string[],
  workspaceRoot: string,
): ExecutionError | null {
  const spec = COMMAND_SPECS[command.toLowerCase()];
  if (!spec?.pathArgs) return null;

  const pathFlags = new Set(spec.pathArgs);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Check --flag value form
    if (pathFlags.has(arg) && i + 1 < args.length) {
      const pathValue = args[i + 1];
      // Skip non-path values (some flags take non-path args)
      if (pathValue.startsWith("-")) continue;
      const resolved = path.resolve(pathValue);
      if (!isWithinWorkspace(resolved, workspaceRoot)) {
        return new ExecutionError(
          `Path argument "${arg} ${pathValue}" resolves outside workspace root`,
          "PATH_ARG_ESCAPE",
        );
      }
    }

    // Check --flag=value form
    for (const flag of pathFlags) {
      if (arg.startsWith(flag + "=")) {
        const pathValue = arg.slice(flag.length + 1);
        if (pathValue.startsWith("-")) continue;
        const resolved = path.resolve(pathValue);
        if (!isWithinWorkspace(resolved, workspaceRoot)) {
          return new ExecutionError(
            `Path argument "${arg}" resolves outside workspace root`,
            "PATH_ARG_ESCAPE",
          );
        }
      }
    }
  }

  return null;
}

// ─── Environment variable filtering ───────────────────────────────

/**
 * Environment variables that are blocked from being passed to child processes.
 * These can be used to inject code or override security settings.
 */
const BLOCKED_ENV_VARS = new Set([
  "NODE_OPTIONS",      // can inject --require
  "NODE_PATH",         // can override module resolution
  "LD_PRELOAD",        // can inject shared libraries
  "LD_LIBRARY_PATH",   // can override library resolution
  "DYLD_INSERT_LIBRARIES", // macOS injection
  "PERL5OPT",          // can inject Perl modules
  "PYTHONSTARTUP",     // can inject Python code
  "PYTHONPATH",        // can override Python module resolution
  "ELECTRON_RUN_AS_NODE", // can change Electron behavior
  "FORCE_COLOR",       // not security but noisy
]);

/**
 * Filter environment variables to remove dangerous ones.
 * Merges process.env with provided env, then strips blocked vars.
 */
function filterEnv(provided?: Record<string, string>): Record<string, string> {
  const merged = { ...process.env, ...provided };
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (BLOCKED_ENV_VARS.has(key)) continue;
    filtered[key] = value ?? "";
  }
  return filtered;
}

// ─── Secret redaction (defense-in-depth) ──────────────────────────

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(pk_[a-zA-Z0-9]{20,})\b/g,
  /\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/gi,
  /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g,
  /\b(secret|password|passwd|token|api_key|apikey|access_key)\s*[:=]\s*["']?([a-zA-Z0-9+/=_-]{16,})["']?/gi,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/g,
];

export function redactSecrets(input: string): string {
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
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
  workspaceRoot?: string;
  mode?: MissionMode;
  approvalProvider?: ApprovalProvider;
  store?: RuntimeStore | null;
  commandLabel?: string;
  /** Skip package.json script inspection (for internal use) */
  skipScriptInspection?: boolean;
  /** Optional streaming callback — invoked for each stdout/stderr chunk */
  onStream?: (chunk: StreamChunk) => void;
  /**
   * Optional data piped to the child process's stdin (then EOF).
   * Capped at 1 MiB to bound memory use.
   */
  stdin?: string;
}

// ─── Structured execution ─────────────────────────────────────────

/**
 * Execute a command with structured arguments.
 *
 * Security pipeline:
 *   1. Classify command by capability (not executable name alone)
 *   2. For npm/pnpm/yarn run — resolve and inspect the script body
 *   3. Enforce mission mode (PLAN rejects mutations)
 *   4. Approval gate for elevated/dangerous
 *   5. Validate cwd is within workspace (symlink-resolved)
 *   6. Validate path-bearing args are within workspace
 *   7. Filter dangerous environment variables
 *   8. Execute via execFile (structured argv, no shell string)
 *   9. Redact secrets from output (defense-in-depth)
 *   10. Track in RuntimeStore
 *
 * NOTE: We do NOT filter shell metacharacters in arguments. execFile
 * already passes args directly to the process without shell interpretation.
 * Filtering metacharacters causes false positives (URLs, commit messages)
 * while not addressing the real threat (arbitrary code via interpreters
 * and package scripts).
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

  // Bound stdin payload size — stdin is piped verbatim to the child.
  if (options?.stdin !== undefined && options.stdin.length > 1_048_576) {
    return executionError(
      new ExecutionError(
        `stdin payload exceeds 1 MiB limit (${options.stdin.length} chars)`,
        "STDIN_TOO_LARGE",
      ),
    );
  }

  // 1. Classify command by capability
  const risk = classifyCommand(command, args, cwd);

  // 2. For package-manager run — inspect script body
  if (!options?.skipScriptInspection && risk.resolvedScriptBody !== undefined) {
    const suspicious = inspectScriptBody(risk.resolvedScriptBody ?? "");
    if (suspicious.length > 0) {
      // Suspicious patterns in the script body — upgrade to dangerous
      risk.level = "dangerous";
      risk.capability = "arbitrary_code";
      risk.reason += ` — suspicious patterns: ${suspicious.join(", ")}`;
    }
  }

  // 3. Mission mode enforcement
  if (mode === "plan" && risk.mutating) {
    return executionError(
      new ExecutionError(
        `PLAN mode rejects ${risk.capability} command: ${command} ${args.join(" ")}`,
        "PLAN_MODE_REJECTED",
      ),
    );
  }

  // 3b. Device-identity boundary (adb) — shared check, see
  // assertAdbTargetAllowed().
  const adbDenied = await assertAdbTargetAllowed(command, args, shell);
  if (adbDenied) return adbDenied;

  // 4. Approval gate
  const needsApproval =
    risk.level === "dangerous" ||
    (risk.level === "elevated" && mode !== "auto");

  if (needsApproval) {
    if (options?.approvalProvider) {
      const approved = await options.approvalProvider(command, args, risk);
      if (!approved) {
        return executionError(
          new ExecutionError(
            `Approval denied for ${risk.level} command: ${command} ${args.join(" ")}`,
            "APPROVAL_REQUIRED",
          ),
        );
      }
    } else if (risk.level === "dangerous") {
      return executionError(
        new ExecutionError(
          `Dangerous command "${command}" requires an approval provider`,
          "APPROVAL_REQUIRED",
        ),
      );
    }
  }

  // 5. Validate cwd within workspace (symlink-resolved)
  if (!isWithinWorkspace(cwd, workspaceRoot)) {
    return executionError(
      new ExecutionError(
        `Command cwd "${cwd}" resolves outside workspace root "${workspaceRoot}"`,
        "PATH_ESCAPE",
      ),
    );
  }

  // 6. Validate path-bearing arguments
  const pathError = validatePathArgs(command, args, workspaceRoot);
  if (pathError) {
    return executionError(pathError);
  }

  // 7. Filter environment variables
  const filteredEnv = filterEnv(options?.env);

  // 8. Execute
  const store = options?.store ?? null;
  if (store) {
    store.commandStart(label, args, cwd);
  }

  const t0 = Date.now();
  const result = await shell.execute({
    command,
    args,
    cwd,
    timeoutMs,
    maxOutputBytes: options?.maxOutputBytes,
    env: filteredEnv,
    onStream: options?.onStream,
    stdin: options?.stdin,
  });
  const durationMs = Date.now() - t0;

  // 9. Redact secrets from output
  const stdout = redactSecrets(result.stdout);
  const stderr = redactSecrets(result.stderr);

  const toolResult: ToolResult = {
    status: result.status,
    success: result.status === "success",
    message: result.status === "success"
      ? `${command} ${args.join(" ")} — exit 0 (${durationMs}ms)`
      : result.status === "cancelled"
        ? `${command} ${args.join(" ")} — cancelled (${durationMs}ms)`
        : result.status === "timeout"
          ? `${command} ${args.join(" ")} — timeout after ${timeoutMs}ms`
          : `${command} ${args.join(" ")} — exit ${result.exitCode} (${durationMs}ms)`,
    data: {
      command,
      args,
      stdout,
      stderr,
      exitCode: result.exitCode,
      durationMs,
      truncated: result.truncated,
      status: result.status,
      pid: result.pid,
      riskLevel: risk.level,
      capability: risk.capability,
      mutating: risk.mutating,
      ...(risk.resolvedScriptBody !== undefined && { resolvedScriptBody: risk.resolvedScriptBody }),
    },
  };

  if (store) {
    store.commandEnd(label, result.status === "success", result.exitCode, durationMs, toolResult.message);
  }

  return toolResult;
}

// ─── Shell-string execution (DISABLED by default) ─────────────────

export async function runShellCommand(
  _shell: ShellExecutor,
  _commandString: string,
  _options?: ExecutionOptions,
): Promise<ToolResult> {
  return {
    status: "failed",
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
    status: "failed",
    success: false,
    message: err.message,
    data: {
      code: err.code,
      error: err.message,
    },
  };
}
