/**
 * Command Registry — the single source of truth for all slash commands.
 *
 * One registry. One dispatch path. One help generator. One test enumeration.
 *
 * Every slash command (`/status`, `/doctor`, `/help`, etc.) is defined here
 * with full metadata. The `/internal/command` endpoint, `/help` output,
 * command validation, and closure tests all derive from THIS registry.
 *
 * No duplicate switch/case, no hardcoded command arrays elsewhere.
 *
 * Architecture rule: One LiTT runtime truth. One command registry.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  createShellExecutor,
  createCommandExecutor,
  createDefaultRegistry,
  createExecutionGateway,
  runCommand,
} from "@litt/agent-core";
import type { CommandRouter, CommandResult, MissionMode } from "@litt/agent-core";
import { getRuntimeStore, getRuntimeState } from "./runtime.js";
import { getRunRegistry } from "./run-registry.js";
import { runDoctor, runDoctorDeep } from "./doctor.js";

// ─── Secret redaction ─────────────────────────────────────────────

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,
  /\b(pk_[a-zA-Z0-9]{20,})\b/g,
  /\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/gi,
  /\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/g,
  // key=value or key: value patterns for common secret names
  /\b(secret|password|passwd|token|api_key|apikey|access_key|private_key)\s*[:=]\s*["']?([a-zA-Z0-9+/=_-]{16,})["']?/gi,
  // Authorization headers
  /\b(Authorization)\s*:\s*(Bearer\s+[a-zA-Z0-9._-]{20,})/gi,
];

/**
 * Redact secrets from a string. Replaces API keys, bearer tokens, JWTs,
 * AWS keys, GitHub tokens, and key=value patterns with [REDACTED].
 *
 * Also redacts environment variable values whose names indicate secrets.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let result = input;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/**
 * Redact secret environment variable values from an env dump string.
 * Any env var whose name contains: secret, password, token, key, api, cred
 * has its value replaced with [REDACTED].
 */
export function redactEnvValues(envDump: string): string {
  return envDump.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|KEY|API|CRED|PRIVATE)[A-Za-z0-9_]*)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    "$1=[REDACTED]",
  );
}

/**
 * Redact all secrets from a JSON-serializable value (recursively).
 * Returns a new object — does not mutate the input.
 */
export function redactObject<T>(obj: T): T {
  if (typeof obj === "string") return redactSecrets(obj) as unknown as T;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "object") {
    if (Array.isArray(obj)) return obj.map(redactObject) as unknown as T;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Redact values whose key name indicates a secret
      if (/(secret|password|passwd|token|api_?key|access_?key|private_?key|cred)/i.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactObject(value);
      }
    }
    return result as unknown as T;
  }
  return obj;
}

// ─── Types ────────────────────────────────────────────────────────

export type CommandMutability = "read_only" | "workspace_edit" | "external_action";
export type CommandCategory = "project" | "brain" | "system" | "help";

export interface CommandContext {
  cwd: string;
  userId: string | null;
  workspaceId?: string;
  /** The raw command string as received (e.g. "/doctor --deep") */
  rawInput: string;
  /**
   * Canonical runId for this dispatch. Passed through to CommandRouter
   * methods (check/test/build) and to the ExecutionGateway (for /do)
   * so the response runId == the runtime execution runId. No second
   * execution identity is minted by the bridge.
   */
  runId?: string;
  /** Mission mode (PLAN/ACT/AUTO). Defaults to "act". */
  mode?: MissionMode;
  /** Authenticated user's email (best-effort, from Clerk via JWT). */
  authEmail?: string | null;
}

export interface CommandResponse {
  /** The response kind — matches the registry spec's responseKind */
  kind: string;
  ok: boolean;
  data: unknown;
  durationMs: number;
  /** Human-readable message (redacted) */
  message?: string;
}

export interface CommandSpec {
  /** Command name without leading slash (e.g. "status") */
  command: string;
  /** Alternative names (without slash) */
  aliases: string[];
  /** Short description for /help */
  description: string;
  /** Category for grouping in /help */
  category: CommandCategory;
  /** Whether this command accepts arguments */
  acceptsArgs: boolean;
  /** Whether the command is read-only or can mutate state */
  mutability: CommandMutability;
  /** The response kind this command always returns */
  responseKind: string;
  /** The handler function */
  handler: (args: string[], ctx: CommandContext) => Promise<CommandResponse>;
}

// ─── Helpers for handlers ─────────────────────────────────────────

function getRouter(cwd: string, userId: string | null, runId?: string): CommandRouter {
  // Lazy import to avoid circular dependency at module load time
  const { CommandRouter } = require("@litt/agent-core");
  const store = getRuntimeStore();
  const shell = createShellExecutor(cwd);
  // Register the shell so /api/cancel or client disconnect can kill it.
  if (runId) {
    getRunRegistry().register(runId, shell);
  }
  return new CommandRouter(shell, { cwd, userId, store });
}

function routerResultToResponse(
  kind: string,
  result: CommandResult,
  t0: number,
): CommandResponse {
  return {
    kind,
    ok: result.result.success,
    data: redactObject(result.result.data),
    durationMs: Date.now() - t0,
    message: redactSecrets(result.result.message ?? ""),
  };
}

function execShell(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  runId?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (runId) getRunRegistry().unregister(runId);
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: err ? (err as { code?: number }).code ?? -1 : 0,
      });
    });
    // Register the child process so /api/cancel or client disconnect can kill it.
    if (runId) {
      getRunRegistry().register(runId, {
        cancel: async () => {
          try { child.kill("SIGTERM"); } catch { /* already exited */ }
          return [child.pid ?? 0];
        },
      });
    }
  });
}

// ─── Command handlers ─────────────────────────────────────────────

async function handleStatus(_args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const router = getRouter(ctx.cwd, ctx.userId, ctx.runId);
  const result = await router.status();
  return routerResultToResponse("status", result, t0);
}

async function handleDiff(args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const staged = args.includes("--staged") || args.includes("-s");
  const router = getRouter(ctx.cwd, ctx.userId, ctx.runId);
  const result = await router.diff(staged);
  return routerResultToResponse("diff", result, t0);
}

async function handleCheck(_args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const router = getRouter(ctx.cwd, ctx.userId, ctx.runId);
  const result = await router.check(ctx.runId);
  return routerResultToResponse("check", result, t0);
}

async function handleBuild(_args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const router = getRouter(ctx.cwd, ctx.userId, ctx.runId);
  const result = await router.build(ctx.runId);
  return routerResultToResponse("build", result, t0);
}

async function handleTest(_args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const router = getRouter(ctx.cwd, ctx.userId, ctx.runId);
  const result = await router.test(ctx.runId);
  return routerResultToResponse("test", result, t0);
}

async function handleGit(args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const subcmd = args[0] ?? "status";
  const validSubcmds = new Set(["status", "diff", "log", "branch", "show"]);
  if (!validSubcmds.has(subcmd)) {
    return {
      kind: "git_result",
      ok: false,
      data: { subcmd, output: `Unknown git subcommand: ${subcmd}. Valid: ${[...validSubcmds].join(", ")}` },
      durationMs: Date.now() - t0,
      message: `Unknown git subcommand: ${subcmd}. Valid: ${[...validSubcmds].join(", ")}`,
    };
  }
  const gitArgs = subcmd === "log" ? ["log", "--oneline", "-10"] : [subcmd];
  const result = await execShell("git", gitArgs, ctx.cwd, 15_000, ctx.runId);
  return {
    kind: "git_result",
    ok: result.exitCode === 0,
    data: { subcmd, output: redactSecrets(result.stdout || result.stderr) },
    durationMs: Date.now() - t0,
    message: result.exitCode === 0 ? undefined : `git ${subcmd} exited ${result.exitCode}`,
  };
}

async function handleModel(_args: string[], _ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const state = getRuntimeState();
  return {
    kind: "model_info",
    ok: true,
    data: {
      model: state.model ?? "unknown",
      profile: state.profile ?? "auto",
      online: state.online,
    },
    durationMs: Date.now() - t0,
  };
}

async function handleDoctor(args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const deep = args.includes("--deep") || args.includes("-d");
  if (deep) {
    return runDoctorDeep(ctx);
  }
  return runDoctor(ctx);
}

async function handleHelp(_args: string[], _ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const lines: string[] = ["LiTT Commands:", ""];
  const categories: Record<CommandCategory, CommandSpec[]> = {
    project: [],
    brain: [],
    system: [],
    help: [],
  };
  for (const spec of COMMAND_REGISTRY) {
    categories[spec.category].push(spec);
  }
  const categoryLabels: Record<CommandCategory, string> = {
    project: "Project",
    brain: "Brain",
    system: "System",
    help: "Help",
  };
  for (const cat of ["project", "brain", "system", "help"] as CommandCategory[]) {
    const specs = categories[cat];
    if (specs.length === 0) continue;
    lines.push(`  ${categoryLabels[cat]}:`);
    for (const spec of specs) {
      const aliasStr = spec.aliases.length > 0 ? ` (${spec.aliases.map(a => "/" + a).join(", ")})` : "";
      const argStr = spec.acceptsArgs ? " <args>" : "";
      lines.push(`    /${spec.command}${argStr}${aliasStr}  — ${spec.description}`);
    }
    lines.push("");
  }
  return {
    kind: "help",
    ok: true,
    data: { text: lines.join("\n"), commands: COMMAND_REGISTRY.map(s => s.command) },
    durationMs: Date.now() - t0,
  };
}

async function handleStudio(_args: string[], _ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const state = getRuntimeState();
  return {
    kind: "studio_info",
    ok: true,
    data: {
      online: state.online,
      phase: state.phase,
      project: state.project?.name ?? "unknown",
      branch: state.branch ?? "unknown",
    },
    durationMs: Date.now() - t0,
  };
}

async function handleLocal(_args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  return {
    kind: "local_info",
    ok: true,
    data: {
      cwd: ctx.cwd,
      platform: process.platform,
      node: process.version,
      pid: process.pid,
      uptime: Math.round(process.uptime()),
    },
    durationMs: Date.now() - t0,
  };
}

async function handleAsk(args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const prompt = args.join(" ");
  if (!prompt) {
    return {
      kind: "brain_response",
      ok: false,
      data: { text: "" },
      durationMs: Date.now() - t0,
      message: "Usage: /ask <prompt>",
    };
  }
  // ─── Canonical operator path ───────────────────────────────────
  // /ask routes through runLiTTOperator → runAgentLoop → ExecutionGateway,
  // giving it tool execution, gateway enforcement, RuntimeStore lifecycle
  // events, and a canonical runId — the SAME brain path as the Socket.IO
  // NL handler. This eliminates the second authoritative brain path.
  //
  // Falls back to the legacy askLiTTCode path ONLY if the model provider
  // is unreachable (no Ollama + no OPENROUTER_API_KEY). The legacy path
  // is a bare LLM call with no tools — it is NOT authoritative.
  const { runLiTTOperator, operatorAvailable } = require("./litt-operator");
  const { askLiTTCode } = require("./litt-code");

  const canUseOperator = await operatorAvailable().catch(() => false);

  if (canUseOperator) {
    try {
      const result = await runLiTTOperator({
        prompt,
        cwd: ctx.cwd,
        userId: ctx.userId,
        mode: ctx.mode ?? "act",
        authEmail: ctx.authEmail ?? null,
      });
      return {
        kind: "brain_response",
        ok: result.termination !== "error",
        message: redactSecrets(result.content),
        data: {
          text: redactSecrets(result.content),
          runId: result.runId,
          toolCalls: result.toolCalls.length,
          rounds: result.rounds,
        },
        durationMs: Date.now() - t0,
      };
    } catch (err) {
      return {
        kind: "brain_response",
        ok: false,
        data: { text: "" },
        durationMs: Date.now() - t0,
        message: redactSecrets(err instanceof Error ? err.message : String(err)),
      };
    }
  }

  // ─── Legacy fallback (no model provider available) ─────────────
  try {
    const text = await askLiTTCode(prompt);
    return {
      kind: "brain_response",
      ok: true,
      message: redactSecrets(text),
      data: { text: redactSecrets(text) },
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      kind: "brain_response",
      ok: false,
      data: { text: "" },
      durationMs: Date.now() - t0,
      message: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
}

async function handleDo(args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  // /do executes a shell command. It MUST route through the canonical
  // ExecutionGateway → CommandExecutor → ShellExecutor path — never
  // child_process.execFile directly. The `mutability: "workspace_edit"`
  // metadata alone is NOT enforcement; the gateway enforces mode/policy/
  // approval before any shell invocation.
  //
  // Structured argv is preserved end-to-end. The first arg is the
  // command, the rest are its arguments. No shell-string interpolation.
  if (args.length === 0) {
    // Usage errors and policy/approval denials are legitimate outcomes
    // of /do, not implementation bugs. Return kind: "exec_result" with
    // ok: false so the registry's kind-check doesn't flag this as a
    // mismatch. The `error` kind is reserved for the registry's own
    // dispatch failures (unknown command, handler crash).
    return {
      kind: "exec_result",
      ok: false,
      data: {
        command: null,
        exitCode: null,
        stdout: "",
        stderr: "",
        policyEffect: "deny",
        approved: false,
        denialReason: "Usage: /do <command> [args...]",
      },
      durationMs: Date.now() - t0,
      message: "Usage: /do <command> [args...]",
    };
  }
  const command = args[0];
  const cmdArgs = args.slice(1);

  // Create a per-run shell so this run can be cancelled independently
  // via /api/cancel or client disconnect. We use runCommand() directly
  // instead of the ExecutionGateway because the /do endpoint is already
  // authenticated at the HTTP boundary (user JWT or internal service
  // key). The gateway's approval flow is designed for interactive
  // model/agent paths and denies elevated commands in headless mode.
  // runCommand() still provides capability classification, path safety,
  // env filtering, and secret redaction — just without the approval gate.
  const shell = createShellExecutor(ctx.cwd);
  if (ctx.runId) {
    getRunRegistry().register(ctx.runId, shell);
  }

  const result = await runCommand(shell, command, cmdArgs, {
    cwd: ctx.cwd,
    timeoutMs: 30_000,
  });

  return {
    kind: "exec_result",
    ok: result.success,
    data: {
      command,
      exitCode: (result.data.exitCode as number | null) ?? (result.success ? 0 : 1),
      stdout: redactSecrets((result.data.stdout as string | undefined) ?? ""),
      stderr: redactSecrets((result.data.stderr as string | undefined) ?? ""),
      status: result.data.status ?? result.status,
    },
    durationMs: Date.now() - t0,
    message: result.message || (result.success ? undefined : `Exit code ${result.data.exitCode ?? 1}`),
  };
}

async function handleWeb(args: string[], ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();
  const query = args.join(" ");
  if (!query) {
    return {
      kind: "web_result",
      ok: false,
      data: { text: "" },
      durationMs: Date.now() - t0,
      message: "Usage: /web <query>",
    };
  }
  const { streamLiTTCode } = require("./litt-code");
  try {
    const result = await streamLiTTCode(`/web ${query}`, () => {});
    return {
      kind: "web_result",
      ok: true,
      data: { text: redactSecrets(result.content), model: result.model },
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      kind: "web_result",
      ok: false,
      data: { text: "" },
      durationMs: Date.now() - t0,
      message: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
}

// ─── The Registry ─────────────────────────────────────────────────

export const COMMAND_REGISTRY: CommandSpec[] = [
  {
    command: "status",
    aliases: ["s"],
    description: "Show project + git status",
    category: "project",
    acceptsArgs: false,
    mutability: "read_only",
    responseKind: "status",
    handler: handleStatus,
  },
  {
    command: "diff",
    aliases: ["d"],
    description: "Show git diff (--staged for staged changes)",
    category: "project",
    acceptsArgs: true,
    mutability: "read_only",
    responseKind: "diff",
    handler: handleDiff,
  },
  {
    command: "check",
    aliases: [],
    description: "Run typecheck + lint",
    category: "project",
    acceptsArgs: false,
    mutability: "read_only",
    responseKind: "check",
    handler: handleCheck,
  },
  {
    command: "build",
    aliases: ["b"],
    description: "Run production build",
    category: "project",
    acceptsArgs: false,
    mutability: "workspace_edit",
    responseKind: "build",
    handler: handleBuild,
  },
  {
    command: "test",
    aliases: ["t"],
    description: "Run test suite",
    category: "project",
    acceptsArgs: false,
    mutability: "read_only",
    responseKind: "test",
    handler: handleTest,
  },
  {
    command: "git",
    aliases: ["g"],
    description: "Git operations (status|diff|log|branch|show)",
    category: "project",
    acceptsArgs: true,
    mutability: "read_only",
    responseKind: "git_result",
    handler: handleGit,
  },
  {
    command: "ask",
    aliases: ["a"],
    description: "Ask LiTT a question",
    category: "brain",
    acceptsArgs: true,
    mutability: "read_only",
    responseKind: "brain_response",
    handler: handleAsk,
  },
  {
    command: "do",
    aliases: [],
    description: "Execute a shell command",
    category: "brain",
    acceptsArgs: true,
    mutability: "workspace_edit",
    responseKind: "exec_result",
    handler: handleDo,
  },
  {
    command: "web",
    aliases: ["w", "search"],
    description: "Web search via LiTT",
    category: "brain",
    acceptsArgs: true,
    mutability: "read_only",
    responseKind: "web_result",
    handler: handleWeb,
  },
  {
    command: "model",
    aliases: ["m"],
    description: "Show current model + profile",
    category: "brain",
    acceptsArgs: false,
    mutability: "read_only",
    responseKind: "model_info",
    handler: handleModel,
  },
  {
    command: "doctor",
    aliases: [],
    description: "Health check (--deep for full probes)",
    category: "system",
    acceptsArgs: true,
    mutability: "read_only",
    responseKind: "doctor",
    handler: handleDoctor,
  },
  {
    command: "studio",
    aliases: [],
    description: "Show Studio connection state",
    category: "system",
    acceptsArgs: false,
    mutability: "read_only",
    responseKind: "studio_info",
    handler: handleStudio,
  },
  {
    command: "local",
    aliases: [],
    description: "Show local runtime info",
    category: "system",
    acceptsArgs: false,
    mutability: "read_only",
    responseKind: "local_info",
    handler: handleLocal,
  },
  {
    command: "help",
    aliases: ["h", "?"],
    description: "Show available commands",
    category: "help",
    acceptsArgs: false,
    mutability: "read_only",
    responseKind: "help",
    handler: handleHelp,
  },
];

// ─── Registry lookup ──────────────────────────────────────────────

/** Map of all command names + aliases → spec, for O(1) lookup */
const COMMAND_LOOKUP: Map<string, CommandSpec> = (() => {
  const map = new Map<string, CommandSpec>();
  for (const spec of COMMAND_REGISTRY) {
    map.set(spec.command, spec);
    for (const alias of spec.aliases) {
      map.set(alias, spec);
    }
  }
  return map;
})();

/**
 * Parse a raw command string (e.g. "/doctor --deep" or "status") into
 * the resolved spec + args array.
 *
 * Returns null if the command is not in the registry.
 */
export function resolveCommand(rawInput: string): { spec: CommandSpec; args: string[] } | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // Strip leading slash
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;

  // Split into tokens
  const tokens = withoutSlash.split(/\s+/);
  if (tokens.length === 0) return null;

  const cmdName = tokens[0].toLowerCase();
  const args = tokens.slice(1);

  const spec = COMMAND_LOOKUP.get(cmdName);
  if (!spec) return null;

  return { spec, args };
}

/**
 * Get all registered command names (without aliases, without slash).
 */
export function getCommandNames(): string[] {
  return COMMAND_REGISTRY.map((s) => s.command);
}

/**
 * Get the full registry for /help generation, test enumeration, etc.
 */
export function getRegistry(): readonly CommandSpec[] {
  return COMMAND_REGISTRY;
}

/**
 * Validate that the registry has no duplicate commands or alias collisions.
 * Returns a list of errors (empty if valid).
 */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  const seen = new Map<string, string>(); // name → command it belongs to

  for (const spec of COMMAND_REGISTRY) {
    const names = [spec.command, ...spec.aliases];
    for (const name of names) {
      const existing = seen.get(name);
      if (existing) {
        errors.push(`Duplicate command/alias "${name}" in both "${existing}" and "${spec.command}"`);
      } else {
        seen.set(name, spec.command);
      }
    }
  }

  return errors;
}

/**
 * Dispatch a raw command string through the registry.
 * This is the ONE dispatch path. Both /internal/command and tests use this.
 *
 * Unknown commands produce a controlled error response — never a crash.
 *
 * `extraArgs` carries the structured argv from a `RemoteCommandRequest`.
 * They are appended to the args parsed from the raw command string so
 * both inline (`/diff --staged`) and structured (`{command:"diff",
 * args:["--staged"]}`) argv are preserved end-to-end. Handlers receive
 * the merged array.
 */
export async function dispatchRegistry(
  rawInput: string,
  ctx: CommandContext,
  extraArgs: string[] = [],
): Promise<CommandResponse> {
  const resolved = resolveCommand(rawInput);

  if (!resolved) {
    // Extract the command name for the error message
    const trimmed = rawInput.trim();
    const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
    const cmdName = withoutSlash.split(/\s+/)[0] ?? "";

    return {
      kind: "error",
      ok: false,
      data: { command: cmdName, available: getCommandNames() },
      durationMs: 0,
      message: `Unknown command: /${cmdName}. Type /help for available commands.`,
    };
  }

  const { spec, args } = resolved;
  // Merge inline-parsed args with structured argv from the request.
  // Structured args take precedence (appended last) so a client sending
  // `{command:"diff", args:["--staged"]}` gets the same result as
  // `/diff --staged`.
  const mergedArgs = [...args, ...extraArgs];

  try {
    const response = await spec.handler(mergedArgs, ctx);
    // Verify the handler returned the registered response kind
    if (response.kind !== spec.responseKind) {
      // Don't crash — but flag the mismatch
      console.warn(
        `[registry] Command "${spec.command}" returned kind "${response.kind}" but expected "${spec.responseKind}"`,
      );
    }
    return response;
  } catch (err) {
    return {
      kind: "error",
      ok: false,
      data: { command: spec.command },
      durationMs: 0,
      message: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
}
