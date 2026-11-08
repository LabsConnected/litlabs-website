/**
 * useRunWatchdog — arms the ExecutionWatchdog for the duration of a run.
 *
 * The watchdog effect depends ONLY on `runActive`. Callers rebuild
 * `store`/`controller` objects on every render, so callback identities
 * cannot be effect dependencies: listing them would stop+restart the
 * timer on every streamed update, and a run that keeps producing output
 * could exceed LITT_MAX_RUN_MS forever. Instead the latest callbacks are
 * kept in a ref synced by a separate always-run effect — writing the ref
 * during render itself is not allowed.
 */

import { useEffect, useRef } from "react";
import { ExecutionWatchdog, type ExecutionWatchdogCallbacks } from "../lib/execution-watchdog.js";

export function useRunWatchdog(
  runActive: boolean,
  callbacks: ExecutionWatchdogCallbacks,
  maxMs?: number,
): void {
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });
  useEffect(() => {
    if (!runActive) return;
    const watchdog = new ExecutionWatchdog({
      cancelSession: () => latest.current.cancelSession(),
      cancelRemoteModel: () => latest.current.cancelRemoteModel(),
      resetUi: () => latest.current.resetUi(),
      recordFailure: (text) => latest.current.recordFailure(text),
    }, maxMs);
    watchdog.start();
    return () => watchdog.stop();
  }, [runActive, maxMs]);
}
