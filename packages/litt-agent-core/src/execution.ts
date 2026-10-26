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
  /**
   * Every operand (non-flag token) is a filesystem path that must resolve
   * inside the workspace. For file-reading commands (cat, grep, find, ...)
   * the operands ARE the target paths — without this, `cat ../../.env`
   * reads outside the workspace while staying classified read_only.
   * Non-path operands (grep patterns, find predicates) still resolve
   * inside the workspace, so legitimate use is unaffected.
   */
  confineOperands?: boolean;
  /**
   * Global (pre-subcommand) flags that consume the NEXT argv token as
   * their value (e.g. `git -C <dir>`, `git -c k=v`). Without this, a
   * flag's value could be mistaken for the subcommand — and worse, the
   * real subcommand could be shifted out of the position the classifier
   * checks (`git -C . commit` must still resolve `commit`).
   * `--flag=value` forms are self-delimiting and need no entry here.
   */
  valueFlags?: string[];
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
  type: { defaultCapability: "read_only", confineOperands: true }, // cmd: print file · sh builtin: describe command — both read-only
  stat: { defaultCapability: "read_only", confineOperands: true },
  file: { defaultCapability: "read_only", confineOperands: true },
  tree: { defaultCapability: "read_only", confineOperands: true },
  du: { defaultCapability: "read_only", confineOperands: true },
  df: { defaultCapability: "read_only" },
  diff: { defaultCapability: "read_only", confineOperands: true },
  cmp: { defaultCapability: "read_only", confineOperands: true },
  cut: { defaultCapability: "read_only", confineOperands: true },
  // sort is arg-sensitive: `sort -o out in` writes a file — see
  // classifyArgSensitive(). -o/--output stay path-confined.
  sort: { defaultCapability: "read_only", pathArgs: ["-o", "--output"], confineOperands: true },
  uniq: { defaultCapability: "read_only", confineOperands: true },
  md5sum: { defaultCapability: "read_only", confineOperands: true },
  sha256sum: { defaultCapability: "read_only", confineOperands: true },
  findstr: { defaultCapability: "read_only", confineOperands: true },
  more: { defaultCapability: "read_only", confineOperands: true },
  less: { defaultCapability: "read_only", confineOperands: true },
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

  // Git — read-only vs mutating. Subcommand detection is flag-aware:
  // value-taking global flags (-C, -c, --git-dir, ...) are skipped so
  // `git -C <dir> commit` still resolves `commit`. `branch`, `tag`,
  // `remote`, `config`, `reflog`, `worktree`, `submodule` and
  // `symbolic-ref` are arg-sensitive — see gitSubcommandCapability().
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
      "ls-remote": "read_only",
      "ls-tree": "read_only",
      remote: "read_only",
      tag: "read_only",
      describe: "read_only",
      rev: "read_only",
      "rev-parse": "read_only",
      "rev-list": "read_only",
      "cat-file": "read_only",
      "for-each-ref": "read_only",
      "count-objects": "read_only",
      "name-rev": "read_only",
      "show-branch": "read_only",
      whatchanged: "read_only",
      fsck: "read_only",
      grep: "read_only",
      var: "read_only",
      "verify-tag": "read_only",
      "verify-commit": "read_only",
      shortlog: "read_only",
      help: "read_only",
      reflog: "read_only",
      worktree: "read_only",
      submodule: "read_only",
      "symbolic-ref": "read_only",
      config: "workspace_edit",
      checkout: "workspace_edit",
      switch: "workspace_edit",
      restore: "workspace_edit",
      add: "workspace_edit",
      stage: "workspace_edit",
      commit: "workspace_edit",
      merge: "workspace_edit",
      rebase: "workspace_edit",
      cherry: "workspace_edit",
      "cherry-pick": "workspace_edit",
      revert: "workspace_edit",
      stash: "workspace_edit",
      bisect: "workspace_edit",
      gc: "workspace_edit",
      prune: "workspace_edit",
      repack: "workspace_edit",
      archive: "workspace_edit",
      bundle: "workspace_edit",
      am: "workspace_edit",
      apply: "workspace_edit",
      "format-patch": "workspace_edit",
      "checkout-index": "workspace_edit",
      "update-index": "workspace_edit",
      "read-tree": "workspace_edit",
      "write-tree": "workspace_edit",
      "commit-tree": "workspace_edit",
      "update-ref": "workspace_edit",
      "pack-refs": "workspace_edit",
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
    valueFlags: ["-C", "-c", "--git-dir", "--work-tree", "--exec-path", "--namespace", "--config-env"],
  },

  // Build tools — mostly read-only
  tsc: { defaultCapability: "read_only", pathArgs: ["--project", "-p", "--outDir", "--out", "--declarationDir"] },
  "tsc-watch": { defaultCapability: "read_only", pathArgs: ["--project", "-p"] },
  eslint: { defaultCapability: "read_only", pathArgs: ["--config", "-c", "--output-file"] },
  prettier: { defaultCapability: "read_only", pathArgs: ["--config", "-c"] },
  vitest: { defaultCapability: "arbitrary_code", arbitraryCode: true, pathArgs: ["--config", "-c"] },
  jest: { defaultCapability: "arbitrary_code", arbitraryCode: true, pathArgs: ["--config", "-c"] },

  // File inspection — read-only
  cat: { defaultCapability: "read_only", confineOperands: true },
  ls: { defaultCapability: "read_only", confineOperands: true },
  dir: { defaultCapability: "read_only", confineOperands: true },
  echo: { defaultCapability: "read_only" },
  head: { defaultCapability: "read_only", confineOperands: true },
  tail: { defaultCapability: "read_only", confineOperands: true },
  wc: { defaultCapability: "read_only", confineOperands: true },
  find: { defaultCapability: "read_only", confineOperands: true },
  grep: { defaultCapability: "read_only", confineOperands: true },
  rg: { defaultCapability: "read_only", confineOperands: true },

  // System info — read-only
  whoami: { defaultCapability: "read_only" },
  hostname: { defaultCapability: "read_only" },
  uname: { defaultCapability: "read_only" },
  pwd: { defaultCapability: "read_only" },
  // env is a command WRAPPER: `env [opts] [K=V ...] CMD [ARGS...]` runs
  // CMD. unwrapEnvCommand() exposes the inner command before this spec
  // is used. -C/--chdir is a path arg: `env -C /outside cat x` must not
  // escape the workspace.
  env: { defaultCapability: "read_only", pathArgs: ["-C", "--chdir"] },
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

// ─── Operand walking ──────────────────────────────────────────────

/**
 * Return the argv indices of operand (non-flag) tokens.
 *
 * Flag tokens (`-x`, `--foo`) are skipped. A flag listed in
 * spec.valueFlags also consumes the following token as its value
 * (`git -C <dir>`); `--flag=value` is self-contained. This prevents
 * flag/value pairs from shifting the subcommand out of argv[0] —
 * `git -C . commit` must still resolve the `commit` subcommand, and
 * `git -c k=v commit` must not see `k=v` as an unknown subcommand.
 */
function operandIndices(spec: CommandSpec, args: string[]): number[] {
  const valueFlags = new Set(spec.valueFlags ?? []);
  const out: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.length > 1 && arg.startsWith("-")) {
      if (!arg.includes("=") && valueFlags.has(arg)) i++; // flag consumes next token
      continue;
    }
    out.push(i);
  }
  return out;
}

// ─── Command wrappers ─────────────────────────────────────────────

/**
 * `env` is a command wrapper: `env [opts] [K=V ...] CMD [ARGS ...]`
 * executes CMD — `env FOO=1 rm -rf x` runs rm, so registering `env` as
 * read_only would let any command bypass classification. Unwrap env's
 * own options and assignments to expose the real command.
 *
 * Returns the inner command, or null when env is only printing the
 * environment (no command operand) or just setting variables.
 */
function unwrapEnvCommand(args: string[]): { command: string; args: string[] } | null {
  // env options that consume the next argv token as their value
  const VALUE_OPTS = new Set(["-u", "--unset", "-C", "--chdir", "-a", "--argv0", "-P"]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      i++;
      return i < args.length ? { command: args[i], args: args.slice(i + 1) } : null;
    }
    // -S/--split-string: the VALUE is a command line — split it and
    // classify the result (`env -S 'touch x'` runs touch).
    if (arg === "-S" || arg === "--split-string") {
      const line = args[i + 1];
      if (line === undefined) return null;
      const parts = line.trim().split(/\s+/).filter(Boolean);
      return parts.length > 0 ? { command: parts[0], args: parts.slice(1) } : null;
    }
    const splitEq = arg.match(/^(--split-string=|-S)([\s\S]*)$/);
    if (splitEq && splitEq[2]) {
      const parts = splitEq[2].trim().split(/\s+/).filter(Boolean);
      return parts.length > 0 ? { command: parts[0], args: parts.slice(1) } : null;
    }
    if (arg.length > 1 && arg.startsWith("-")) {
      if (!arg.includes("=") && VALUE_OPTS.has(arg)) i++; // consume value
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) continue; // K=V assignment
    return { command: arg, args: args.slice(i + 1) }; // inner command
  }
  return null;
}

// ─── Arg-sensitive read-only commands ─────────────────────────────
//
// These commands are registered read_only, but specific flags or
// operands turn them into mutating or arbitrary-code operations. The
// classification must reflect the args, not just the binary name —
// otherwise PLAN mode and the approval gate let the mutating forms
// through (`find -delete`, `sort -o`, `date -s`, `eslint --fix`, ...).

const FIND_EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const FIND_WRITE_FLAGS = new Set(["-fprint", "-fprint0", "-fprintf", "-fls"]);
const DATE_VALUE_FLAGS = new Set(["-d", "--date", "-r", "--reference", "-f", "--file"]);

function classifyArgSensitive(cmd: string, args: string[]): RiskAssessment | null {
  switch (cmd) {
    case "find": {
      if (args.some((a) => FIND_EXEC_FLAGS.has(a))) {
        return {
          level: "elevated",
          capability: "arbitrary_code",
          reason: "find -exec/-ok runs an embedded command",
          mutating: true,
        };
      }
      if (args.includes("-delete")) {
        return {
          level: "dangerous",
          capability: "destructive",
          reason: "find -delete removes matched files",
          mutating: true,
        };
      }
      if (args.some((a) => FIND_WRITE_FLAGS.has(a))) {
        return {
          level: "elevated",
          capability: "workspace_edit",
          reason: "find -fprint/-fprintf writes an output file",
          mutating: true,
        };
      }
      return null;
    }
    case "sort": {
      if (
        args.some(
          (a) =>
            a === "-o" ||
            a === "--output" ||
            a.startsWith("--output=") ||
            (a.startsWith("-o") && a.length > 2),
        )
      ) {
        return {
          level: "elevated",
          capability: "workspace_edit",
          reason: "sort -o/--output writes a file",
          mutating: true,
        };
      }
      return null;
    }
    case "date": {
      if (args.some((a) => a === "-s" || a === "--set" || a.startsWith("--set="))) {
        return {
          level: "dangerous",
          capability: "external_action",
          reason: "date -s/--set changes the system clock",
          mutating: true,
        };
      }
      // A bare operand (not a flag value, not a +FORMAT) is a new time
      // to set (MMDDhhmm). Skip values of flags that take one.
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.length > 1 && a.startsWith("-")) {
          if (!a.includes("=") && DATE_VALUE_FLAGS.has(a)) i++;
          continue;
        }
        if (!a.startsWith("+")) {
          return {
            level: "dangerous",
            capability: "external_action",
            reason: "date <operand> sets the system clock",
            mutating: true,
          };
        }
      }
      return null;
    }
    case "hostname": {
      // `hostname` prints the name; `hostname NAME` sets it.
      // -F/--file also sets it (from file contents).
      if (
        args.some((a) => a === "-F" || a === "--file") ||
        args.some((a) => !(a.length > 1 && a.startsWith("-")))
      ) {
        return {
          level: "dangerous",
          capability: "external_action",
          reason: "hostname <name>/-F changes the system hostname",
          mutating: true,
        };
      }
      return null;
    }
    case "rg": {
      if (
        args.some(
          (a) =>
            a === "--pre" ||
            a.startsWith("--pre=") ||
            a === "--pre-glob" ||
            a.startsWith("--pre-glob=") ||
            a === "--hostname-bin" ||
            a.startsWith("--hostname-bin="),
        )
      ) {
        return {
          level: "elevated",
          capability: "arbitrary_code",
          reason: "rg --pre/--hostname-bin runs an external program",
          mutating: true,
        };
      }
      return null;
    }
    case "eslint": {
      if (
        args.some(
          (a) =>
            a === "--fix" ||
            a === "--cache" ||
            a === "-o" ||
            a === "--output-file" ||
            a.startsWith("--output-file="),
        )
      ) {
        return {
          level: "elevated",
          capability: "workspace_edit",
          reason: "eslint --fix/--cache/-o writes files",
          mutating: true,
        };
      }
      return null;
    }
    case "prettier": {
      if (args.some((a) => a === "-w" || a === "--write")) {
        return {
          level: "elevated",
          capability: "workspace_edit",
          reason: "prettier --write modifies files",
          mutating: true,
        };
      }
      return null;
    }
    case "tsc":
    case "tsc-watch": {
      // tsc emits build artifacts by default; only explicitly
      // non-emitting modes stay read-only.
      const nonEmitting = args.some((a) =>
        ["--noEmit", "--showConfig", "--listFilesOnly", "--noCheck"].includes(a),
      );
      if (!nonEmitting) {
        return {
          level: "elevated",
          capability: "workspace_edit",
          reason: "tsc emits build artifacts (no --noEmit)",
          mutating: true,
        };
      }
      return null;
    }
    default:
      return null;
  }
}

// ─── Git arg-sensitive subcommands ────────────────────────────────

const GIT_CONFIG_MUTATE_FLAGS = new Set([
  "--add",
  "--unset",
  "--unset-all",
  "--replace-all",
  "--rename-section",
  "--remove-section",
  "-e",
  "--edit",
]);
const GIT_CONFIG_VALUE_FLAGS = new Set([
  "-f",
  "--file",
  "--blob",
  "--default",
  "--type",
  "--get",
  "--get-all",
  "--get-regexp",
  "--get-urlmatch",
  "--fixed-value",
]);
const GIT_REF_LIST_FLAGS = new Set([
  "-l",
  "--list",
  "--show-current",
  "-r",
  "--remotes",
  "-v",
  "-vv",
  "-q",
  "--quiet",
  "-i",
  "--ignore-case",
  "--omit-empty",
  "--sort",
  "--format",
  "--points-at",
  "--merged",
  "--no-merged",
  "--contains",
  "--no-contains",
  "--column",
  "--no-column",
  "--color",
  "--no-color",
  "--abbrev",
  "--no-abbrev",
  "--exclude",
  "-n",
]);
// `-a`/`--all` mean "list all" for `git branch` but `-a` is `--annotate`
// (creates a tag) for `git tag` — kept out of the shared set.
const GIT_BRANCH_LIST_FLAGS = new Set(["-a", "--all"]);
const GIT_REF_MUTATE_FLAGS = new Set([
  "-m",
  "-M",
  "--move",
  "-c",
  "-C",
  "--copy",
  "-u",
  "--set-upstream-to",
  "--unset-upstream",
  "-f",
  "--force",
  "-t",
  "--track",
  "-s",
  "--sign",
  "--annotate",
  "-e",
  "--edit-description",
]);
const GIT_REMOTE_MUTATE_OPS = new Set([
  "add",
  "rename",
  "remove",
  "rm",
  "set-url",
  "set-head",
  "set-branches",
  "prune",
  "update",
]);

/** Count operand tokens (non-flag args, skipping values of known value-flags). */
function countOperands(args: string[], valueFlags: Set<string>): number {
  let count = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.length > 1 && a.startsWith("-")) {
      if (!a.includes("=") && valueFlags.has(a)) i++;
      continue;
    }
    count++;
  }
  return count;
}

/**
 * Argument-sensitive capability for git subcommands registered
 * read_only whose operands can mutate (`git branch foo` creates a
 * branch, `git tag v1` creates a tag, `git remote add` writes config).
 * Returns the corrected tier, or null to keep the map value.
 */
function gitSubcommandCapability(sub: string, rest: string[]): CapabilityTier | null {
  switch (sub) {
    case "config": {
      if (rest.some((a) => GIT_CONFIG_MUTATE_FLAGS.has(a))) return "workspace_edit";
      // `git config <key>` reads; `git config <key> <value>` writes.
      return countOperands(rest, GIT_CONFIG_VALUE_FLAGS) >= 2 ? "workspace_edit" : "read_only";
    }
    case "branch":
    case "tag": {
      if (rest.some((a) => a === "-d" || a === "-D" || a === "--delete")) return "destructive";
      const isListFlag = (a: string) =>
        GIT_REF_LIST_FLAGS.has(a) ||
        GIT_REF_LIST_FLAGS.has(a.split("=")[0]) ||
        (sub === "branch" && GIT_BRANCH_LIST_FLAGS.has(a));
      if (rest.some(isListFlag)) return "read_only";
      // A name operand (or a mutate flag) creates/moves the ref.
      // `git tag -a` is annotate (mutating) — for tag, -a is not a list flag.
      const isMutateFlag = (a: string) =>
        GIT_REF_MUTATE_FLAGS.has(a) || (sub === "tag" && a === "-a");
      if (rest.some(isMutateFlag)) return "workspace_edit";
      if (countOperands(rest, new Set(["-u", "--set-upstream-to", "-m", "-F"])) > 0)
        return "workspace_edit";
      return null;
    }
    case "remote": {
      const op = rest.find((a) => !(a.length > 1 && a.startsWith("-")));
      return op !== undefined && GIT_REMOTE_MUTATE_OPS.has(op) ? "workspace_edit" : null;
    }
    case "reflog": {
      const op = rest.find((a) => !(a.length > 1 && a.startsWith("-")));
      return op === "expire" || op === "delete" ? "destructive" : "read_only";
    }
    case "worktree": {
      const op = rest.find((a) => !(a.length > 1 && a.startsWith("-")));
      return op === undefined || op === "list" ? "read_only" : "workspace_edit";
    }
    case "submodule": {
      const op = rest.find((a) => !(a.length > 1 && a.startsWith("-")));
      if (op === "foreach") return "arbitrary_code";
      return op === undefined || op === "status" ? "read_only" : "workspace_edit";
    }
    case "symbolic-ref": {
      if (rest.some((a) => a === "-d" || a === "--delete")) return "workspace_edit";
      // `symbolic-ref -q HEAD` reads; `symbolic-ref HEAD <ref>` writes.
      return countOperands(rest, new Set(["-m"])) >= 2 ? "workspace_edit" : "read_only";
    }
    // The diff-family commands share diff machinery's --output flag, which
    // writes output to a file — `git diff --output=/abs/path` escapes the
    // workspace while looking read-only. Classify as a workspace write.
    case "diff":
    case "log":
    case "show":
    case "whatchanged":
    case "shortlog":
    case "blame": {
      if (rest.some((a) => a === "--output" || a === "-o" || a.startsWith("--output="))) {
        return "workspace_edit";
      }
      return null;
    }
    default:
      return null;
  }
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

  // Command wrappers: `env CMD ...` executes CMD — classify the inner
  // command so a wrapper can't launder a mutation through a read-only
  // registration (`env rm -rf x`, `env -S 'rm -rf x'`).
  if (cmd === "env") {
    const inner = unwrapEnvCommand(args);
    if (inner) {
      const innerRisk = classifyCommand(inner.command, inner.args, cwd);
      return { ...innerRisk, reason: `env wrapper → ${innerRisk.reason}` };
    }
    return {
      level: "safe",
      capability: "read_only",
      reason: "env → prints environment (no wrapped command)",
      mutating: false,
    };
  }

  // Registered read_only commands whose flags/operands turn them
  // mutating or arbitrary-code (find -exec, sort -o, eslint --fix, ...).
  const argSensitive = classifyArgSensitive(cmd, args);
  if (argSensitive) return argSensitive;

  // Determine capability from the subcommand — the first OPERAND
  // token. Flag/value pairs before it must not shift it out of place:
  // `git -C <dir> commit` and `git -c k=v commit` still resolve
  // `commit`. If the first operand is unknown but a later operand is a
  // known subcommand (a value-flag we don't model consumed nothing),
  // use it — fail closed toward the known capability.
  let capability = spec.defaultCapability;
  let subIndex: number | null = null;
  if (spec.subcommands) {
    const ops = operandIndices(spec, args);
    if (ops.length > 0) {
      if (spec.subcommands[args[ops[0]].toLowerCase()]) {
        subIndex = ops[0];
      } else {
        const hit = ops.find((i) => spec.subcommands![args[i].toLowerCase()]);
        if (hit !== undefined) {
          subIndex = hit;
        } else if (cmd === "git") {
          // `git <unknown-op>` resolves an external `git-<op>` binary
          // from PATH — arbitrary code, not a read-only builtin.
          capability = "arbitrary_code";
        }
      }
      if (subIndex !== null) {
        capability = spec.subcommands[args[subIndex].toLowerCase()];
      }
    }
  }

  // Arg-sensitive git subcommands: `git branch foo` creates a branch,
  // `git remote add` writes config — the subcommand name alone is
  // registered read_only, so the operands decide.
  if (cmd === "git" && subIndex !== null) {
    const upgraded = gitSubcommandCapability(
      args[subIndex].toLowerCase(),
      args.slice(subIndex + 1),
    );
    if (upgraded) capability = upgraded;
  }

  // Special case: npm/pnpm/yarn run <script> — inspect package.json
  let resolvedScriptBody: string | null | undefined;
  if (
    (cmd === "npm" || cmd === "pnpm" || cmd === "yarn") &&
    subIndex !== null &&
    args[subIndex] === "run" &&
    args[subIndex + 1] !== undefined
  ) {
    const scriptName = args[subIndex + 1];
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

/**
 * For commands marked confineOperands, every operand (non-flag token)
 * is resolved against the command cwd and must stay inside the
 * workspace. This closes the read-escape path — `cat ../../.env`,
 * `grep -r secret /`, `find /` — that flag-level pathArgs checking
 * cannot reach, because for these commands the operand IS the path.
 *
 * Non-path operands are unaffected: a grep pattern or find predicate
 * resolves to a (probably nonexistent) path inside the workspace.
 * Flag tokens (`-x`, `--foo`) are skipped; `--flag=value` tokens are
 * skipped because value-carrying flags are covered by pathArgs.
 */
function validateOperandPaths(
  command: string,
  args: string[],
  cwd: string,
  workspaceRoot: string,
): ExecutionError | null {
  const spec = COMMAND_SPECS[command.toLowerCase()];
  if (!spec?.confineOperands) return null;
  for (const arg of args) {
    if (arg.length > 1 && arg.startsWith("-")) continue;
    if (!arg) continue;
    const resolved = path.resolve(cwd, arg);
    if (!isWithinWorkspace(resolved, workspaceRoot)) {
      return new ExecutionError(
        `Operand "${arg}" resolves outside workspace root`,
        "PATH_ARG_ESCAPE",
      );
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
 * Infrastructure/service-role credentials that must never leak into
 * workspace child processes. Deliberately narrow: provider API keys
 * (OPENAI_API_KEY etc.) stay, because workspace dev servers and test
 * runners legitimately need them — but host-level secrets (service-role
 * DB keys, internal service tokens, deploy tokens, Stripe, webhook
 * secrets) are never part of a project's runtime environment; the
 * project reads its own values from workspace .env files instead.
 */
const BLOCKED_INFRA_ENV_VARS = new Set([
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "TERMINAL_AUTH_SECRET",
  "INTERNAL_API_KEY",
  "AGENT_API_KEY",
  "AUTH_SECRET",
  "VOICE_AUTH_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RAILWAY_API_TOKEN",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "META_APP_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "VAPID_PRIVATE_KEY",
  "LIVEKIT_API_SECRET",
  "SUPERMEMORY_API_KEY",
]);

/**
 * Filter environment variables to remove dangerous ones.
 * Merges process.env with provided env, then strips blocked vars.
 */
function filterEnv(provided?: Record<string, string>): Record<string, string> {
  const merged = { ...process.env, ...provided };
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (BLOCKED_ENV_VARS.has(key) || BLOCKED_INFRA_ENV_VARS.has(key)) continue;
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
  // Named secret assignments: NAME_SECRET, NAME_TOKEN, NAME_KEY, etc.
  // Catches `SUPABASE_SERVICE_ROLE_KEY=x`, `RAILWAY_API_TOKEN=y`,
  // `DATABASE_URL=postgres://u:p@h` — the *_KEY/SECRET/TOKEN family the
  // generic value-shape patterns above miss. Underscore-suffixed match
  // avoids false positives like MONKEY= or TURKEY=.
  /\b((?:[A-Za-z][A-Za-z0-9_]*_)?(?:SECRET_KEY|PRIVATE_KEY|ACCESS_KEY|SERVICE_KEY|ROLE_KEY|API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|DATABASE_URL|CONNECTION_STRING|DSN|CREDENTIALS?|KEY)[A-Za-z0-9_]*)\s*[=:]\s*[^\s"']{3,}/gi,
  // URL-embedded credentials: scheme://user:pass@host
  /\b([a-z][a-z0-9+.-]*):\/\/[^\s/:]+:[^\s/@]+@/gi,
  // PEM private key blocks
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
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

  // 6b. For file-reading commands, confine path operands to the workspace
  const operandError = validateOperandPaths(command, args, cwd, workspaceRoot);
  if (operandError) {
    return executionError(operandError);
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
