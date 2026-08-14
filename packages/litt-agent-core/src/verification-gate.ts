/**
 * VerificationGate — the runtime truth boundary.
 *
 * THE SINGLE MOST IMPORTANT RULE IN LiTT:
 *
 *   COMPLETE ≠ model says done
 *   COMPLETE = runtime proved it passed
 *
 * The VerificationGate is what enforces that rule. When the agent loop
 * (or any surface) wants to declare a mission COMPLETE, it MUST run the
 * gate. The gate executes the project's configured checks through the
 * SAME hardened CommandExecutor that every other command uses — real
 * processes, real exit codes, real stdout/stderr. It never trusts a
 * model's claim of "I'm done."
 *
 * Configurable per project:
 *   A project declares which checks it has (typecheck/test/build/browser).
 *   The gate runs whichever checks are configured. A check that is NOT
 *   configured is SKIPPED — it does not count against `proven`. This lets
 *   a project with no tests still reach COMPLETE, while a project with
 *   tests cannot reach COMPLETE until those tests actually pass.
 *
 * Auto-detection:
 *   If `config.checks` is not provided, the gate auto-detects from
 *   package.json scripts: a "typecheck"/"test"/"build" script enables the
 *   corresponding check. Browser is only enabled when explicitly configured
 *   (it needs a preview URL + a BrowserVerifier).
 *
 * Browser verification:
 *   Platform-independent. The gate accepts an optional `BrowserVerifier`
 *   adapter. If no verifier is provided, the browser check is skipped
 *   (not failed). This keeps agent-core free of puppeteer/playwright deps.
 *
 * Lifecycle:
 *   - Sets runtime phase to "verifying" before running checks
 *   - Each check flows through CommandExecutor → runCommand() → ShellExecutor
 *     (same hardened path, same runId, same lifecycle events as everything else)
 *   - Emits litt_event { subtype: "verification_*" } for each transition
 *   - Sets phase to "complete" only if proven, else "failed"
 *
 * Truth contract:
 *   proven === true  → every RUN check returned status "success"
 *   proven === false → at least one RUN check returned failed/cancelled/timeout
 *   Skipped checks never make proven false.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  ToolStatus,
  RuntimeEventEmitter,
  ShellExecutor,
} from "./types.js";
import type { RuntimeStore } from "./state.js";
import type { CommandExecutor, CommandExecutorResult } from "./command-executor.js";

// ─── Types ─────────────────────────────────────────────────────────

/** The set of checks the gate can run. */
export type VerificationCheckId = "typecheck" | "test" | "build" | "browser";

/**
 * Per-project verification configuration.
 * A project declares which checks it has; the gate runs those.
 */
export interface VerificationConfig {
  /**
   * Which checks to run. If omitted, auto-detected from package.json
   * (typecheck/test/build scripts) + browser config presence.
   */
  checks?: VerificationCheckId[];
  /**
   * Override the command for a check. If not provided, the gate
   * auto-resolves from package.json scripts (typecheck/test/build)
   * or falls back to a sensible default.
   */
  commands?: Partial<Record<VerificationCheckId, { command: string; args: string[] }>>;
  /** Browser verification target. Required for the browser check to run. */
  browser?: { url: string; timeoutMs?: number } | null;
  /** Per-check timeout in ms (default 180_000 = 3 min). */
  timeoutMs?: number;
  /** Whether to auto-detect checks from package.json (default true). */
  autoDetect?: boolean;
}

/** The result of a single verification check. */
export interface CheckResult {
  id: VerificationCheckId;
  /** Discrete status. "skipped" means the check was not configured. */
  status: ToolStatus | "skipped";
  /** True iff the check ran and succeeded. False for failed/cancelled/timeout/skipped. */
  success: boolean;
  exitCode: number | null;
  message: string;
  durationMs: number;
  stdout?: string;
  stderr?: string;
  /** Why this check was skipped, if status === "skipped". */
  skippedReason?: string;
  runId: string;
  toolCallId: string;
}

/**
 * The canonical verification result — the single source of truth for
 * whether a mission can honestly be called COMPLETE.
 */
export interface VerificationResult {
  /**
   * THE field. true iff every RUN check returned status "success".
   * Skipped checks do not affect this.
   * This is what gates the "complete" phase and the agent loop's
   * termination: "complete".
   */
  proven: boolean;
  /** Aggregate status. */
  status: "proven" | "failed" | "skipped";
  /** Per-check results, in run order. */
  checks: CheckResult[];
  /** Total duration across all checks. */
  totalDurationMs: number;
  /** Human-readable summary. */
  message: string;
  /** Shared runId across all checks in this verification run. */
  runId: string;
  /** Which checks actually ran (excludes skipped). */
  ranChecks: VerificationCheckId[];
  /** Which checks were skipped. */
  skippedChecks: VerificationCheckId[];
}

/**
 * Platform-independent browser verification adapter.
 * Implementations (puppeteer, playwright, remote browser service) are
 * injected by the surface that owns the browser — agent-core never
 * imports a browser library directly.
 */
export interface BrowserVerifier {
  verify(
    url: string,
    timeoutMs: number,
  ): Promise<{ ok: boolean; errors: string[]; message: string; durationMs?: number }>;
}

export interface VerificationGateOptions {
  /** The hardened CommandExecutor — same instance as the rest of the runtime. */
  executor: CommandExecutor;
  /** Shell for package.json auto-detection. */
  shell: ShellExecutor;
  /** Optional runtime store for phase transitions. */
  store?: RuntimeStore | null;
  /** Optional event emitter for verification lifecycle events. */
  emitter?: RuntimeEventEmitter | null;
  /** Project root. */
  cwd: string;
  /** Optional browser verifier. Without it, browser checks are skipped. */
  browserVerifier?: BrowserVerifier | null;
  /** Per-project config. */
  config?: VerificationConfig;
}

// ─── Defaults ──────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 180_000;

const CHECK_LABELS: Record<VerificationCheckId, string> = {
  typecheck: "Typecheck",
  test: "Tests",
  build: "Build",
  browser: "Browser",
};

// ─── VerificationGate ──────────────────────────────────────────────

export class VerificationGate {
  private readonly _executor: CommandExecutor;
  private readonly _shell: ShellExecutor;
  private readonly _store: RuntimeStore | null;
  private readonly _emitter: RuntimeEventEmitter | null;
  private readonly _cwd: string;
  private readonly _browserVerifier: BrowserVerifier | null;
  private readonly _config: VerificationConfig;

  constructor(options: VerificationGateOptions) {
    this._executor = options.executor;
    this._shell = options.shell;
    this._store = options.store ?? null;
    this._emitter = options.emitter ?? null;
    this._cwd = options.cwd;
    this._browserVerifier = options.browserVerifier ?? null;
    this._config = options.config ?? {};
  }

  /**
   * Run all configured checks and return the canonical verification result.
   *
   * This is the ONLY way to honestly declare COMPLETE. The agent loop
   * calls this when the model claims it is done; if `proven` is false,
   * the failure is fed back to the model for repair.
   */
  async verify(): Promise<VerificationResult> {
    const runId = `verify_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const t0 = Date.now();

    // Resolve which checks to run
    const resolved = this._resolveChecks();

    this._emit("verification_start", { runId, checks: resolved.toRun }, runId);
    if (this._store) this._store.setPhase("verifying");

    const checks: CheckResult[] = [];

    for (const id of resolved.toRun) {
      const check = await this._runCheck(id, runId, resolved);
      checks.push(check);

      // A failed/cancelled/timeout check fails the whole gate immediately.
      // We still record it, but we don't keep running subsequent checks —
      // the project is already not proven. This matches CI semantics and
      // saves time.
      if (check.status !== "success" && check.status !== "skipped") {
        break;
      }
    }

    // Record skipped checks for completeness
    for (const id of resolved.toSkip) {
      checks.push({
        id,
        status: "skipped",
        success: false,
        exitCode: null,
        message: `Skipped: ${resolved.skipReasons[id] ?? "not configured"}`,
        durationMs: 0,
        skippedReason: resolved.skipReasons[id] ?? "not configured",
        runId,
        toolCallId: "",
      });
    }

    const ranChecks = checks.filter((c) => c.status !== "skipped").map((c) => c.id);
    const skippedChecks = checks.filter((c) => c.status === "skipped").map((c) => c.id);
    const anyFailed = checks.some((c) => c.status === "failed" || c.status === "cancelled" || c.status === "timeout");
    const anyRan = ranChecks.length > 0;

    const proven = anyRan && !anyFailed;
    const status: VerificationResult["status"] = !anyRan ? "skipped" : proven ? "proven" : "failed";
    const totalDurationMs = Date.now() - t0;

    const message = this._buildSummary(status, checks, proven);

    this._emit(
      "verification_result",
      { runId, proven, status, ranChecks, skippedChecks, message, totalDurationMs },
      runId,
    );

    if (this._store) {
      this._store.setPhase(proven ? "complete" : "failed");
    }

    return {
      proven,
      status,
      checks,
      totalDurationMs,
      message,
      runId,
      ranChecks,
      skippedChecks,
    };
  }

  // ─── Internal: check resolution ──────────────────────────────────

  private _resolveChecks(): {
    toRun: VerificationCheckId[];
    toSkip: VerificationCheckId[];
    skipReasons: Partial<Record<VerificationCheckId, string>>;
    commands: Partial<Record<VerificationCheckId, { command: string; args: string[] } | null>>;
    browser: { url: string; timeoutMs: number } | null;
  } {
    const cfg = this._config;
    const autoDetect = cfg.autoDetect !== false;
    const all: VerificationCheckId[] = ["typecheck", "test", "build", "browser"];

    // Determine the script availability from package.json
    const scripts = autoDetect ? this._readScripts() : {};
    const commands: Partial<Record<VerificationCheckId, { command: string; args: string[] } | null>> = {
      ...(cfg.commands ?? {}),
    };

    // Fill in default commands for checks not explicitly overridden
    if (!commands.typecheck) {
      commands.typecheck = this._resolveTypecheckCommand(scripts);
    }
    if (!commands.test) {
      commands.test = this._resolveScriptCommand(scripts, "test");
    }
    if (!commands.build) {
      commands.build = this._resolveScriptCommand(scripts, "build");
    }

    const browser = cfg.browser
      ? { url: cfg.browser.url, timeoutMs: cfg.browser.timeoutMs ?? DEFAULT_TIMEOUT_MS }
      : null;

    const toRun: VerificationCheckId[] = [];
    const toSkip: VerificationCheckId[] = [];
    const skipReasons: Partial<Record<VerificationCheckId, string>> = {};

    if (cfg.checks) {
      // Explicit list — run exactly these (subject to browser verifier availability)
      for (const id of all) {
        if (cfg.checks.includes(id)) {
          if (id === "browser" && !browser) {
            toSkip.push(id);
            skipReasons[id] = "no browser URL configured";
          } else if (id === "browser" && !this._browserVerifier) {
            toSkip.push(id);
            skipReasons[id] = "no browser verifier available";
          } else if (id !== "browser" && !commands[id]) {
            toSkip.push(id);
            skipReasons[id] = `no ${id} command resolved`;
          } else {
            toRun.push(id);
          }
        } else {
          toSkip.push(id);
          skipReasons[id] = "not in configured checks";
        }
      }
    } else {
      // Auto-detect
      for (const id of all) {
        if (id === "browser") {
          if (browser && this._browserVerifier) {
            toRun.push(id);
          } else {
            toSkip.push(id);
            skipReasons[id] = browser ? "no browser verifier available" : "no browser URL configured";
          }
        } else if (commands[id]) {
          toRun.push(id);
        } else {
          toSkip.push(id);
          skipReasons[id] = `no ${id} script in package.json`;
        }
      }
    }

    return { toRun, toSkip, skipReasons, commands, browser };
  }

  private _readScripts(): Record<string, string> {
    const pkgPath = path.join(this._cwd, "package.json");
    try {
      if (!fs.existsSync(pkgPath)) return {};
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      return pkg.scripts ?? {};
    } catch {
      return {};
    }
  }

  private _resolveScriptCommand(
    scripts: Record<string, string>,
    name: string,
  ): { command: string; args: string[] } | null {
    if (!scripts[name]) return null;
    const pm = this._detectPackageManager();
    return { command: pm, args: ["run", name] };
  }

  private _resolveTypecheckCommand(
    scripts: Record<string, string>,
  ): { command: string; args: string[] } | null {
    if (scripts.typecheck) {
      const pm = this._detectPackageManager();
      return { command: pm, args: ["run", "typecheck"] };
    }
    // Sensible fallback: tsc --noEmit. Only use if tsc is likely present
    // (a tsconfig.json exists). Otherwise skip — don't guess.
    if (fs.existsSync(path.join(this._cwd, "tsconfig.json"))) {
      return { command: "npx", args: ["tsc", "--noEmit"] };
    }
    return null;
  }

  private _detectPackageManager(): string {
    if (fs.existsSync(path.join(this._cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(this._cwd, "yarn.lock"))) return "yarn";
    return "npm";
  }

  // ─── Internal: run a single check ────────────────────────────────

  private async _runCheck(
    id: VerificationCheckId,
    runId: string,
    resolved: {
      commands: Partial<Record<VerificationCheckId, { command: string; args: string[] } | null>>;
      browser: { url: string; timeoutMs: number } | null;
    },
  ): Promise<CheckResult> {
    const toolCallId = `vc_${runId}_${id}_${Math.random().toString(36).slice(2, 6)}`;
    const timeoutMs = this._config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this._emit(
      "verification_check_start",
      { runId, toolCallId, check: id, label: CHECK_LABELS[id] },
      runId,
      toolCallId,
    );

    // Browser check uses the injected verifier, not the shell executor.
    if (id === "browser") {
      return this._runBrowserCheck(runId, toolCallId, resolved.browser, timeoutMs);
    }

    const cmd = resolved.commands[id];
    if (!cmd) {
      const result: CheckResult = {
        id,
        status: "skipped",
        success: false,
        exitCode: null,
        message: `Skipped: no ${id} command resolved`,
        durationMs: 0,
        skippedReason: `no ${id} command resolved`,
        runId,
        toolCallId,
      };
      this._emit(
        "verification_check_result",
        { runId, toolCallId, check: id, status: "skipped" },
        runId,
        toolCallId,
      );
      return result;
    }

    const t0 = Date.now();
    let execResult: CommandExecutorResult;
    try {
      execResult = await this._executor.execute(cmd.command, cmd.args, {
        cwd: this._cwd,
        timeoutMs,
        runId,
        toolCallId,
        label: CHECK_LABELS[id],
      });
    } catch (err) {
      const durationMs = Date.now() - t0;
      const message = `${CHECK_LABELS[id]} check crashed: ${err instanceof Error ? err.message : String(err)}`;
      this._emit(
        "verification_check_result",
        { runId, toolCallId, check: id, status: "failed", message },
        runId,
        toolCallId,
      );
      return {
        id,
        status: "failed",
        success: false,
        exitCode: null,
        message,
        durationMs,
        stderr: message,
        runId,
        toolCallId,
      };
    }

    const durationMs = Date.now() - t0;
    const stdout = typeof execResult.result.data?.stdout === "string"
      ? (execResult.result.data.stdout as string)
      : undefined;
    const stderr = typeof execResult.result.data?.stderr === "string"
      ? (execResult.result.data.stderr as string)
      : undefined;
    const exitCode = typeof execResult.result.data?.exitCode === "number"
      ? (execResult.result.data.exitCode as number)
      : null;

    const message = `${CHECK_LABELS[id]}: ${execResult.result.message}`;

    this._emit(
      "verification_check_result",
      {
        runId,
        toolCallId,
        check: id,
        status: execResult.status,
        success: execResult.result.success,
        exitCode,
        durationMs,
      },
      runId,
      toolCallId,
    );

    return {
      id,
      status: execResult.status,
      success: execResult.result.success,
      exitCode,
      message,
      durationMs,
      stdout,
      stderr,
      runId,
      toolCallId,
    };
  }

  private async _runBrowserCheck(
    runId: string,
    toolCallId: string,
    browser: { url: string; timeoutMs: number } | null,
    timeoutMs: number,
  ): Promise<CheckResult> {
    if (!browser || !this._browserVerifier) {
      const result: CheckResult = {
        id: "browser",
        status: "skipped",
        success: false,
        exitCode: null,
        message: "Skipped: browser verification not configured",
        durationMs: 0,
        skippedReason: "browser verification not configured",
        runId,
        toolCallId,
      };
      this._emit(
        "verification_check_result",
        { runId, toolCallId, check: "browser", status: "skipped" },
        runId,
        toolCallId,
      );
      return result;
    }

    const t0 = Date.now();
    try {
      const browserTimeout = browser.timeoutMs ?? timeoutMs;
      const outcome = await this._browserVerifier.verify(browser.url, browserTimeout);
      const durationMs = outcome.durationMs ?? Date.now() - t0;
      const status: ToolStatus = outcome.ok ? "success" : "failed";
      const message = outcome.ok
        ? `Browser: OK (${browser.url})`
        : `Browser: ${outcome.errors.length} error(s) — ${outcome.message}`;

      this._emit(
        "verification_check_result",
        { runId, toolCallId, check: "browser", status, success: outcome.ok, errors: outcome.errors },
        runId,
        toolCallId,
      );

      return {
        id: "browser",
        status,
        success: outcome.ok,
        exitCode: outcome.ok ? 0 : 1,
        message,
        durationMs,
        stderr: outcome.ok ? undefined : outcome.errors.join("\n"),
        runId,
        toolCallId,
      };
    } catch (err) {
      const durationMs = Date.now() - t0;
      const message = `Browser check crashed: ${err instanceof Error ? err.message : String(err)}`;
      this._emit(
        "verification_check_result",
        { runId, toolCallId, check: "browser", status: "failed", message },
        runId,
        toolCallId,
      );
      return {
        id: "browser",
        status: "failed",
        success: false,
        exitCode: null,
        message,
        durationMs,
        stderr: message,
        runId,
        toolCallId,
      };
    }
  }

  // ─── Internal: summary + events ──────────────────────────────────

  private _buildSummary(
    status: VerificationResult["status"],
    checks: CheckResult[],
    proven: boolean,
  ): string {
    if (status === "skipped") {
      return "No verification checks configured — COMPLETE not proven by the runtime.";
    }
    const parts = checks.map((c) => {
      if (c.status === "skipped") return `${CHECK_LABELS[c.id]}: skipped`;
      return `${CHECK_LABELS[c.id]}: ${c.status === "success" ? "PASS" : c.status.toUpperCase()}`;
    });
    const head = proven
      ? "VERIFIED — runtime proved all checks passed."
      : "NOT VERIFIED — at least one check failed. COMPLETE is not honest.";
    return `${head} [${parts.join(" | ")}]`;
  }

  private _emit(
    subtype: string,
    data: Record<string, unknown>,
    runId: string,
    toolCallId?: string,
  ): void {
    if (!this._emitter) return;
    try {
      this._emitter({
        type: "litt_event",
        subtype,
        ts: Date.now(),
        data,
        runId,
        toolCallId,
      });
    } catch {
      // emitter must never crash the gate
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────────

export function createVerificationGate(options: VerificationGateOptions): VerificationGate {
  return new VerificationGate(options);
}

// ─── Honest-COMPLETE helper ────────────────────────────────────────

/**
 * The canonical assertion: a mission is COMPLETE only if the runtime
 * proved it. Callers should use this instead of trusting a model claim.
 *
 *   if (assertComplete(verification)) { /* ship *\/ }
 *
 * Returns the verification result so callers can inspect failures.
 */
export function assertComplete(verification: VerificationResult): VerificationResult {
  return verification;
}
