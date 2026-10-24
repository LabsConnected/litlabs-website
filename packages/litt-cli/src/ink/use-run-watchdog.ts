/**
 * useRunWatchdog — arms the ExecutionWatchdog for the duration of a run.
 *
 * The effect depends ONLY on `runActive`. Callers rebuild `store` and
 * `controller` objects on every render, so callback identities cannot be
 * effect dependencies: listing them would stop+restart the timer on
 * every streamed update, and a run that keeps producing output could
 * exceed LITT_MAX_RUN_MS forever. Instead the latest callbacks are read
 * through a ref, so the armed timer never re-arms but always calls the
 * current closures.
 */

import { useEffect, useRef } from "react";
import { ExecutionWatchdog, type ExecutionWatchdogCallbacks } from "../lib/execution-watchdog.js";

export function useRunWatchdog(
  runActive: boolean,
  callbacks: ExecutionWatchdogCallbacks,
  maxMs?: number,
): void {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  useEffect(() => {
    if (!runActive) return;
    const cbs = latest;
    const watchdog = new ExecutionWatchdog({
      cancelSession: () => cbs.current.cancelSession(),
      cancelRemoteModel: () => cbs.current.cancelRemoteModel(),
      resetUi: () => cbs.current.resetUi(),
      recordFailure: (text) => cbs.current.recordFailure(text),
    }, maxMs);
    watchdog.start();
    return () => watchdog.stop();
  }, [runActive]); // eslint-disable-line react-hooks/exhaustive-deps -- callbacks intentionally via ref
}
