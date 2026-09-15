/**
 * ExecutionWatchdog — the sole authoritative timeout for agent runs.
 *
 * When an agent run exceeds LITT_MAX_RUN_MS (default 10 min), the watchdog
 * cancels ALL underlying execution — not just UI state:
 *
 *   1. cancelSession() — kills the spawned process tree (ShellExecutor)
 *   2. cancelRemoteModel() — aborts in-flight RemoteModelProvider streams
 *   3. resetUi() — clears isProcessing, holoState, tool progress, mission
 *   4. recordFailure() — writes a WATCHDOG activity so the operator sees
 *      why the run was terminated
 *
 * Architecture: there is exactly ONE watchdog. The previous design had
 * two independent same-duration timers (cockpit-store + controller) racing
 * each other — the store timer could set isProcessing=false before the
 * controller timer fired, causing the controller's useEffect cleanup to
 * clear the controller timer BEFORE session.cancel() ran. That left
 * spawned processes and model streams running with a "recovered" UI.
 *
 * This class is a plain TypeScript object — no React — so the regression
 * test can exercise the REAL production logic without simulating it.
 */

/** Callbacks the watchdog invokes when it fires. */
export interface ExecutionWatchdogCallbacks {
  /** Kill the spawned process tree. Must never throw. */
  cancelSession: () => void | Promise<void>;
  /** Abort in-flight remote model stream. Must never throw. */
  cancelRemoteModel: () => void;
  /** Reset UI state: isProcessing, holoState, tool progress, mission. */
  resetUi: () => void;
  /** Record a WATCHDOG failure activity so the operator sees the reason. */
  recordFailure: (text: string) => void;
}

/** Default maximum run duration (10 minutes). */
export const DEFAULT_MAX_RUN_MS = 600_000;

/**
 * Resolve the configured max run duration from LITT_MAX_RUN_MS.
 * Invalid, missing, or non-positive values fall back to the default.
 */
export function resolveMaxRunMs(envValue?: string): number {
  const raw = envValue ?? process.env.LITT_MAX_RUN_MS ?? "";
  const parsed = parseInt(raw, 10);
  return parsed > 0 ? parsed : DEFAULT_MAX_RUN_MS;
}

/** The failure message recorded when the watchdog fires. */
export const WATCHDOG_FAILURE_MESSAGE =
  "Watchdog: run timed out — all underlying execution was cancelled " +
  "(processes killed, model stream aborted) after exceeding the maximum " +
  "run duration.";

/**
 * The sole authoritative execution watchdog.
 *
 * Lifecycle:
 *   start() — arms the timer (called when isProcessing becomes true)
 *   stop()  — disarms the timer (called when isProcessing becomes false
 *             or on unmount/cleanup)
 *
 * The timer fires at most once per start() call. If it fires, it calls
 * all four callbacks in order and sets hasFired=true. A subsequent
 * start() resets hasFired.
 */
export class ExecutionWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private _hasFired = false;
  private readonly maxMs: number;
  private readonly callbacks: ExecutionWatchdogCallbacks;

  constructor(callbacks: ExecutionWatchdogCallbacks, maxMs?: number) {
    this.callbacks = callbacks;
    this.maxMs = maxMs ?? resolveMaxRunMs();
  }

  /** Arm the timer. Disarms any existing timer first. Resets hasFired. */
  start(): void {
    this.stop();
    this._hasFired = false;
    this.timer = setTimeout(() => this.fire(), this.maxMs);
  }

  /** Disarm the timer. Safe to call when not armed. Does not reset hasFired. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** True when the timer is currently armed. */
  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** True when the watchdog has fired since the last start(). */
  get hasFired(): boolean {
    return this._hasFired;
  }

  /** The configured max duration in ms. */
  get configuredMaxMs(): number {
    return this.maxMs;
  }

  /**
   * Fire the watchdog — calls all callbacks in order.
   * Each callback is wrapped in try/catch so a throw in one
   * cannot prevent the others from running.
   */
  private fire(): void {
    this.timer = null;
    if (this._hasFired) return; // idempotent — no duplicate firing
    this._hasFired = true;

    // 1. Kill spawned process tree
    try {
      const result = this.callbacks.cancelSession();
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {});
      }
    } catch { /* must never propagate */ }

    // 2. Abort in-flight remote model stream
    try { this.callbacks.cancelRemoteModel(); } catch { /* must never propagate */ }

    // 3. Reset UI state
    try { this.callbacks.resetUi(); } catch { /* must never propagate */ }

    // 4. Record WATCHDOG failure
    try { this.callbacks.recordFailure(WATCHDOG_FAILURE_MESSAGE); } catch { /* must never propagate */ }
  }
}
