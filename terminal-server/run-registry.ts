/**
 * RunRegistry — tracks active command executions by runId so they can be
 * cancelled individually.
 *
 * When a command starts, a Cancellable (typically a ShellExecutor) is
 * registered with its runId. When the client disconnects or sends
 * /api/cancel, the registry calls cancel() on the registered Cancellable,
 * which kills the actual child process tree.
 *
 * After a command completes (success or failure), the entry is
 * unregistered to prevent the map from growing without bound.
 */

export interface Cancellable {
  /** Kill the running process tree. Returns the PIDs that were killed. */
  cancel(): Promise<number[]>;
}

export class RunRegistry {
  private readonly runs = new Map<string, Cancellable>();

  /** Register a cancellable for a runId. Overwrites any prior entry. */
  register(runId: string, cancellable: Cancellable): void {
    this.runs.set(runId, cancellable);
  }

  /**
   * Cancel the run identified by runId. Returns true if a running process
   * was found and cancelled, false if no run was registered (already
   * finished or never started).
   */
  async cancel(runId: string): Promise<boolean> {
    const cancellable = this.runs.get(runId);
    if (!cancellable) return false;
    this.runs.delete(runId);
    try {
      await cancellable.cancel();
      return true;
    } catch {
      return false;
    }
  }

  /** Remove a run entry after it completes (cleanup). */
  unregister(runId: string): void {
    this.runs.delete(runId);
  }

  /** Check if a runId is currently active. */
  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  /** Number of active runs. */
  get size(): number {
    return this.runs.size;
  }

  /** Clear all entries (for testing). */
  clear(): void {
    this.runs.clear();
  }
}

// ─── Singleton ────────────────────────────────────────────────────

const runRegistry = new RunRegistry();

/** Get the shared RunRegistry instance (process-wide singleton). */
export function getRunRegistry(): RunRegistry {
  return runRegistry;
}
