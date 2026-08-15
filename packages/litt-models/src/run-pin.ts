/**
 * Run-pinning — once a run begins, the model is pinned for that operation
 * (spec section 16). Switching mid-run is forbidden; the next run picks up
 * the new selection. This keeps logs and debugging reproducible.
 *
 * The registry/router only SELECT a model. Run state (the pin) is owned by
 * the runtime. This module provides the type + a tiny in-memory store for
 * surfaces that don't have a durable run record (e.g. CLI). The web runtime
 * should persist the pin alongside the run row in its own store.
 */

import type { RunModelPin } from "./types";

/**
 * In-memory run pin store. Not durable — surfaces with persistence should
 * roll their own and just use the RunModelPin type.
 */
export class RunPinStore {
  private pins = new Map<string, RunModelPin>();

  /** Pin a model to a run. Overwrites any existing pin for the run. */
  pin(runId: string, modelId: string): RunModelPin {
    const pin: RunModelPin = { runId, modelId, pinnedAt: new Date().toISOString() };
    this.pins.set(runId, pin);
    return pin;
  }

  /** Get the pin for a run, or null if unpinned. */
  get(runId: string): RunModelPin | null {
    return this.pins.get(runId) ?? null;
  }

  /** True if the run has a pinned model. */
  has(runId: string): boolean {
    return this.pins.has(runId);
  }

  /** Clear the pin for a run (called when the run completes). */
  release(runId: string): void {
    this.pins.delete(runId);
  }

  /** All active pins (for debugging / cockpit display). */
  active(): RunModelPin[] {
    return [...this.pins.values()];
  }
}
