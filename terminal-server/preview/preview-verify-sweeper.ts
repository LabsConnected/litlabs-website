/**
 * Preview verify sweeper — the terminal-side driver for the live
 * preview verify (round 16 follow-up to C2).
 *
 * Why this exists: until now the ONLY driver of
 * `verifyPreviewHealth` was the Studio panel polling the preview
 * status endpoint (~every 30 s, and only while the panel sat in its
 * local "ready" state with the tab visible). The 2026-11-18 live
 * proof of PR #1040 (C2) failed on exactly that: the external-failure
 * counter reached 3 of the 4 rounds the recreation gate requires,
 * the panel flipped to its error state and stopped polling, and the
 * counter froze mid-count — no further round ever ran, so the
 * recreation never fired and the dead preview sat unwatched.
 *
 * This sweeper gives the verify its own driver on the terminal: an
 * interval that runs one verify round for every live preview session
 * on a fixed cadence, whether or not any client is polling. It adds
 * no verdict logic of its own — every round is the existing
 * `verifyPreviewHealth` path (the same call the status route makes),
 * so C2's accounting, gates, caps, and cooldown apply unchanged.
 *
 * Tracking model: the sweeper holds NO per-session state between
 * ticks beyond the in-flight set. Each tick re-derives its work set
 * from the live session list, so a session that ends (preview
 * stopped, runtime replaced, sandbox recreated under a new id) simply
 * stops appearing and is never verified or logged again; in-flight
 * entries are removed when their round settles, so nothing leaks.
 */

/** One live preview session, as the sweeper needs to see it. */
export interface PreviewVerifySweepSession {
  workspaceId: string;
  /** Provider sandbox id, or null for host runtimes. */
  sandboxId: string | null;
  /** C2 accounting: consecutive external-probe failures so far. */
  externalFailureCount: number;
}

export interface PreviewVerifySweeperDeps {
  /** Snapshot of the sessions currently live (status "ready"). */
  listSessions: () => PreviewVerifySweepSession[];
  /** Current view of one session, or undefined when it has ended. */
  getSession: (workspaceId: string) => PreviewVerifySweepSession | undefined;
  /** The existing verify path — one round for one workspace. */
  verify: (workspaceId: string) => Promise<unknown>;
  /** Emit one sweeper log line for a completed round. */
  log: (workspaceId: string, line: string) => void;
  /** Tick cadence; defaults to PREVIEW_VERIFY_SWEEP_INTERVAL_MS. */
  intervalMs?: number;
}

export interface PreviewVerifySweeper {
  /** Run one sweep tick now (rounds launch detached per session). */
  tick: () => void;
  /** Start the interval (idempotent). */
  start: () => void;
  /** Stop the interval (idempotent). */
  stop: () => void;
  /** Sessions with a verify round currently in flight. */
  inFlightCount: () => number;
}

/**
 * Sweep cadence. 30 s matches the panel's own poll interval, so the
 * verify now advances at the rate C2's accounting was calibrated
 * against — it just no longer depends on the panel to do it. Inside
 * the approved 30–45 s band.
 */
export const PREVIEW_VERIFY_SWEEP_INTERVAL_MS = 30_000;

export function createPreviewVerifySweeper(
  deps: PreviewVerifySweeperDeps,
): PreviewVerifySweeper {
  const intervalMs = deps.intervalMs ?? PREVIEW_VERIFY_SWEEP_INTERVAL_MS;
  const inFlight = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  function tick(): void {
    // Prune guard entries whose session ended mid-round bookkeeping
    // (their finally below also removes them; this keeps the set
    // honest even if a round's promise never settles).
    for (const workspaceId of [...inFlight]) {
      if (!deps.getSession(workspaceId)) inFlight.delete(workspaceId);
    }
    for (const session of deps.listSessions()) {
      const { workspaceId } = session;
      // Re-entrancy guard: a round for this session is already in
      // flight — skip this tick for it. One round, one increment of
      // the C2 counter; overlapping rounds would bank parallel
      // counts for what is really one sustained failure window.
      if (inFlight.has(workspaceId)) continue;
      inFlight.add(workspaceId);
      void (async () => {
        try {
          await deps.verify(workspaceId);
          // Log AFTER the round so the line carries the counter the
          // round produced — a stall (count frozen below the gate)
          // is visible in the service logs instead of silent. If the
          // session ended during the round there is nothing live to
          // report against, so the round goes unlogged by design.
          const after = deps.getSession(workspaceId);
          if (after) {
            deps.log(
              workspaceId,
              `[preview] Verify sweep round: workspace=${after.workspaceId} ` +
                `sandbox=${after.sandboxId ?? "none"} ` +
                `externalFailures=${after.externalFailureCount}`,
            );
          }
        } catch {
          // verifyPreviewHealth is designed not to throw; if a round
          // ever does, the sweeper must survive it — the next tick
          // retries, and the guard entry is released below either way.
        } finally {
          inFlight.delete(workspaceId);
        }
      })();
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
    // Never keep the process alive just for the sweeper (mirrors the
    // PTY session manager's sweeper).
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { tick, start, stop, inFlightCount: () => inFlight.size };
}
