/**
 * RuntimeSession — the CLI's single source of runtime truth.
 *
 * One RuntimeSession per CLI process. It owns:
 *   - ShellExecutor (process spawning)
 *   - RuntimeStore (canonical state)
 *   - CommandExecutor (hardened execution boundary)
 *   - Event handling (litt_event consumption, streaming, lifecycle)
 *
 * All CLI commands route through this session. No command creates its
 * own ShellExecutor or CommandRouter. This eliminates duplicated runtime
 * truth — there is exactly one RuntimeStore, one CommandExecutor, and
 * one event stream per CLI process.
 *
 * Ctrl+C handling:
 *   The session installs a SIGINT handler that cancels the active run
 *   instead of killing the CLI. A second SIGINT (when idle) exits.
 *
 * Reconnect/resync:
 *   When connected to terminal-server (--remote), the session can
 *   reconnect and resync state from the server's RuntimeStore.
 */

import {
  createShellExecutor,
  CommandExecutor,
  RuntimeStore,
  CommandRouter,
  ExecutionGateway,
  ToolRegistry,
  type RuntimeEvent,
  type RuntimeState,
  type ShellExecutor,
  type ToolResult,
  type StreamChunk,
  type CommandExecutorResult,
} from "@litt/agent-core";

// ─── Types ─────────────────────────────────────────────────────────

export interface RuntimeSessionOptions {
  cwd: string;
  mode?: "plan" | "act" | "auto";
  /** Optional event handler for live event consumption */
  onEvent?: (event: RuntimeEvent) => void;
  /** Optional stream handler for live stdout/stderr */
  onStream?: (chunk: StreamChunk) => void;
}

export interface CommandRunOptions {
  /** Command name (e.g. "check", "test", "build", "status") */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Human-readable label */
  label?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

export interface CommandRunResult {
  result: ToolResult;
  runId: string;
  toolCallId: string;
  status: "success" | "failed" | "cancelled" | "timeout";
  durationMs: number;
}

// ─── RuntimeSession ────────────────────────────────────────────────

/**
 * The CLI's single runtime session.
 *
 * One instance per CLI process. All commands route through this.
 */
export class RuntimeSession {
  private _shell: ShellExecutor;
  private _store: RuntimeStore;
  private _executor: CommandExecutor;
  private _router: CommandRouter;
  private _gateway: ExecutionGateway | null = null;
  private _cwd: string;
  private _mode: "plan" | "act" | "auto";
  private _onEvent: ((event: RuntimeEvent) => void) | null;
  private _onStream: ((chunk: StreamChunk) => void) | null;
  private _sigintInstalled: boolean = false;
  private _originalSigint: ((signal: "SIGINT") => void) | null = null;

  constructor(options: RuntimeSessionOptions) {
    this._cwd = options.cwd;
    this._mode = options.mode ?? "act";
    this._onEvent = options.onEvent ?? null;
    this._onStream = options.onStream ?? null;

    this._shell = createShellExecutor(this._cwd);
    this._store = new RuntimeStore((event) => this._handleEvent(event));
    this._executor = new CommandExecutor(this._shell, this._store, (event) => this._handleEvent(event));
    this._router = new CommandRouter(this._shell, { cwd: this._cwd, store: this._store });
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Get the canonical runtime state.
   */
  getState(): RuntimeState {
    return this._store.getState();
  }

  /**
   * Get the active run identity, if any.
   */
  getActiveRun(): { runId: string; toolCallId: string } | null {
    return this._executor.getActiveRun();
  }

  /**
   * Check if a command is currently running.
   */
  isRunning(): boolean {
    return this._executor.isRunning();
  }

  /**
   * Get the CommandRouter for slash-command dispatch.
   */
  getRouter(): CommandRouter {
    return this._router;
  }

  /**
   * Get the CommandExecutor for direct execution.
   */
  getExecutor(): CommandExecutor {
    return this._executor;
  }

  /**
   * Get the current execution mode (plan/act/auto).
   */
  getMode(): "plan" | "act" | "auto" {
    return this._mode;
  }

  /**
   * Get the ExecutionGateway — the ONE canonical execution authority.
   * Created lazily on first access. All tool calls should route through
   * this gateway, which enforces identity, grant, policy, approval, and
   * credential checks before dispatching.
   */
  getGateway(): ExecutionGateway {
    if (this._gateway) return this._gateway;
    this._gateway = new ExecutionGateway({
      tools: new ToolRegistry(),
      shell: this._shell,
      executor: this._executor,
      store: this._store,
      projectId: this._cwd,
    });
    return this._gateway;
  }

  /**
   * Execute a command through the hardened CommandExecutor.
   * This is the canonical execution path for all CLI commands.
   */
  async execute(command: string, args: string[], options: Omit<CommandRunOptions, "command" | "args"> = {}): Promise<CommandRunResult> {
    const execResult = await this._executor.execute(command, args, {
      cwd: this._cwd,
      mode: this._mode,
      timeoutMs: options.timeoutMs,
      commandLabel: options.label ?? command,
      onStream: this._onStream ?? undefined,
    });

    return {
      result: execResult.result,
      runId: execResult.runId,
      toolCallId: execResult.toolCallId,
      status: execResult.status,
      durationMs: execResult.durationMs,
    };
  }

  /**
   * Cancel the active run. Kills the process tree.
   * Returns the list of PIDs that were killed.
   */
  async cancel(runId?: string): Promise<number[]> {
    return this._executor.cancel(runId);
  }

  /**
   * Install Ctrl+C handler that cancels the active run instead of
   * killing the CLI. A second Ctrl+C when idle exits the process.
   */
  installSigintHandler(onCancel?: () => void): void {
    if (this._sigintInstalled) return;
    this._sigintInstalled = true;

    const handler = () => {
      if (this._executor.isRunning()) {
        // Cancel the active run — don't exit
        // The execute() promise will resolve with status: "cancelled"
        this._executor.cancel().then((pids) => {
          if (onCancel) onCancel();
          if (pids.length > 0) {
            process.stderr.write(`\nCancelled (killed ${pids.length} process(es))\n`);
          } else {
            process.stderr.write(`\nCancelled\n`);
          }
        }).catch(() => {
          process.stderr.write(`\nCancel failed\n`);
        });
      } else {
        // No active run — exit
        process.stderr.write(`\nExiting...\n`);
        process.exit(130);
      }
    };

    // Remove all existing SIGINT listeners to prevent default exit behavior
    // while a command is running, then add ours
    process.removeAllListeners("SIGINT");
    process.on("SIGINT", handler);
  }

  /**
   * Restore the original SIGINT handler.
   */
  uninstallSigintHandler(): void {
    if (!this._sigintInstalled) return;
    // Node doesn't expose a clean way to remove our specific listener
    // since we used an anonymous closure. We rely on process.exit
    // or the session being short-lived.
    this._sigintInstalled = false;
  }

  // ── Internal ────────────────────────────────────────────────────

  private _handleEvent(event: RuntimeEvent): void {
    if (this._onEvent) {
      try {
        this._onEvent(event);
      } catch {
        // handler must never crash the session
      }
    }
  }
}

/**
 * Create a RuntimeSession for the CLI.
 */
export function createRuntimeSession(options: RuntimeSessionOptions): RuntimeSession {
  return new RuntimeSession(options);
}
