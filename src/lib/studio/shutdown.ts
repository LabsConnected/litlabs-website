import "server-only";

import {
  snapshotActiveExecutions,
  unregisterExecution,
} from "./execution-registry";
import { updateMessageStatus } from "./conversation-service";

/**
 * Studio graceful-shutdown routine.
 *
 * When the web process receives SIGTERM/SIGINT (e.g. a Railway deployment
 * cutover), in-flight Studio agent runs would otherwise die silently: the
 * message row freezes as `streaming` and the transcript only gets a
 * generic watchdog note minutes later. This routine aborts every active
 * execution's AbortController (agent loops already unwind on abort) and
 * writes back a truthful `cancelled` status per run, so the user sees
 * exactly what happened and can resend to retry.
 *
 * Persistence is injected so tests can observe writeback without a
 * database. In production the default `updateMessageStatus` is used.
 */

export const SHUTDOWN_NOTE =
  "The server restarted (deployment) while this run was in flight. Workspace changes made before the restart are intact — send the request again to retry.";

/**
 * Upper bound for the writeback pass. Railway's grace period is short;
 * the process must still exit promptly, so a hung persistence call can
 * never block shutdown beyond this.
 */
export const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface ShutdownPersistFn {
  (
    assistantMessageId: string,
    userId: string,
    status: "cancelled",
    content: string,
  ): Promise<boolean>;
}

export interface ShutdownResult {
  /** Number of active executions found and aborted. */
  shutdown: number;
  /** Number of executions whose status writeback succeeded. */
  persisted: number;
}

export async function shutdownActiveExecutions(
  reason: string,
  opts?: { persist?: ShutdownPersistFn; timeoutMs?: number },
): Promise<ShutdownResult> {
  const active = snapshotActiveExecutions();
  if (active.length === 0) {
    return { shutdown: 0, persisted: 0 };
  }

  const persist: ShutdownPersistFn = opts?.persist ?? updateMessageStatus;
  const timeoutMs = opts?.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;

  // Signal every run to stop first; the agent loops unwind on abort.
  for (const entry of active) {
    try {
      if (!entry.controller.signal.aborted) {
        entry.controller.abort(new Error(reason));
      }
    } catch {
      // Best effort — a broken controller must not block the writeback.
    }
  }

  const work = (async (): Promise<ShutdownResult> => {
    let persisted = 0;
    for (const entry of active) {
      try {
        const ok = await persist(
          entry.assistantMessageId,
          entry.userId,
          "cancelled",
          SHUTDOWN_NOTE,
        );
        if (ok) persisted += 1;
      } catch {
        // Best effort — keep going for the remaining executions.
      }
      unregisterExecution(entry.conversationId, entry.key);
    }
    return { shutdown: active.length, persisted };
  })();

  const timeout = new Promise<ShutdownResult>((resolve) => {
    const timer = setTimeout(
      () => resolve({ shutdown: active.length, persisted: 0 }),
      timeoutMs,
    );
    // Never hold the event loop open on this timer alone.
    timer.unref?.();
  });

  return Promise.race([work, timeout]);
}
