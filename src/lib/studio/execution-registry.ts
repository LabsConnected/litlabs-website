import "server-only";

/**
 * Studio Execution Registry — in-process tracking of active LiTT runs.
 *
 * TRANSPORT LIFETIME != EXECUTION LIFETIME.
 *
 * A browser/SSE disconnect must never cancel a server-side run, so the
 * run's AbortController is held here — reachable only through an explicit,
 * authenticated, user-scoped cancellation request (the conversation cancel
 * endpoint) or an intentional internal deadline/shutdown. Request-signal
 * aborts and downstream stream cancellations never touch this registry.
 *
 * The registry is scoped by conversationId: the messages route serializes
 * sends per conversation via the revision check-and-increment RPC, so at
 * most one execution per conversation is expected at a time.
 */

export interface ActiveExecution {
  /** Internal unique key for this registration (assistant message id). */
  key: string;
  controller: AbortController;
  userId: string;
  conversationId: string;
  /** Exact request identity — always present (the messages route requires it). */
  clientRequestId: string;
  assistantMessageId: string;
  startedAt: number;
}

interface PendingCancel {
  userId: string;
  clientRequestId: string;
  requestedAt: number;
}

export type CancelOutcome = "aborted" | "recorded" | "not_found" | "forbidden";

/**
 * A pending cancellation stamp only aborts a run that registers within
 * this window. That covers the race where Stop arrives between the POST
 * being dispatched and the stream's start() registering the execution.
 */
const PENDING_CANCEL_TTL_MS = 30_000;

/**
 * Executions are bounded internally by the agent-loop runtime budget
 * (~10 min). Anything registered longer than this is stale bookkeeping
 * from a killed process and is no longer treated as active.
 */
const STALE_EXECUTION_MS = 15 * 60 * 1000;

const globalRegistry = globalThis as unknown as {
  __littStudioExecutions?: Map<string, ActiveExecution>;
  __littStudioPendingCancels?: Map<string, PendingCancel[]>;
};

const executions = (globalRegistry.__littStudioExecutions ??= new Map<string, ActiveExecution>());
const pendingCancels = (globalRegistry.__littStudioPendingCancels ??= new Map<string, PendingCancel[]>());

function prunePendingCancels(conversationId: string): PendingCancel[] {
  const now = Date.now();
  const fresh = (pendingCancels.get(conversationId) ?? []).filter(
    (p) => now - p.requestedAt <= PENDING_CANCEL_TTL_MS,
  );
  if (fresh.length > 0) {
    pendingCancels.set(conversationId, fresh);
  } else {
    pendingCancels.delete(conversationId);
  }
  return fresh;
}

/**
 * Register an execution so an explicit cancellation request can reach it.
 * Returns the registration key for later unregistration. If a matching
 * pending cancellation was recorded just before registration, the
 * controller is aborted immediately so the run starts cancelled.
 */
export function registerExecution(input: {
  conversationId: string;
  userId: string;
  clientRequestId: string;
  assistantMessageId: string;
  controller: AbortController;
}): { key: string } {
  const entry: ActiveExecution = {
    key: input.assistantMessageId,
    controller: input.controller,
    userId: input.userId,
    conversationId: input.conversationId,
    clientRequestId: input.clientRequestId,
    assistantMessageId: input.assistantMessageId,
    startedAt: Date.now(),
  };
  executions.set(input.conversationId, entry);

  // Consume a pending cancel stamp that was recorded for this run just
  // before it registered. Matching is exact — userId AND clientRequestId —
  // so a stale Stop for a finished run can never pre-abort the next run
  // in the same conversation.
  const stamps = prunePendingCancels(input.conversationId);
  const match = stamps.find(
    (p) =>
      p.userId === input.userId &&
      p.clientRequestId === entry.clientRequestId,
  );
  if (match) {
    pendingCancels.set(
      input.conversationId,
      stamps.filter((p) => p !== match),
    );
    if (!input.controller.signal.aborted) {
      input.controller.abort(new Error("Cancelled by user"));
    }
  }

  return { key: entry.key };
}

/**
 * Remove a registration when the execution finishes. Only removes the
 * exact registration (matched by key) so a newer run for the same
 * conversation is never unregistered by an older run's cleanup.
 */
export function unregisterExecution(conversationId: string, key: string): void {
  const entry = executions.get(conversationId);
  if (entry && entry.key === key) {
    executions.delete(conversationId);
  }
}

/**
 * Look up the active execution for a conversation (stale entries are
 * treated as absent and dropped).
 */
export function getActiveExecution(conversationId: string): ActiveExecution | null {
  const entry = executions.get(conversationId);
  if (!entry) return null;
  if (Date.now() - entry.startedAt > STALE_EXECUTION_MS) {
    executions.delete(conversationId);
    return null;
  }
  return entry;
}

/**
 * Test-only helper — clears all registrations and pending cancel stamps.
 * Not used by production code.
 */
export function resetExecutionRegistryForTests(): void {
  executions.clear();
  pendingCancels.clear();
}

/**
 * Request cancellation of the active execution for a conversation.
 *
 * Cancellation is ALWAYS keyed to the exact clientRequestId — there is no
 * wildcard. A missing/mismatched request id can never abort a run and can
 * never record a pending stamp that would kill the user's NEXT run in the
 * same conversation.
 *
 * - "aborted":   an active run owned by this user with this exact request
 *                id was signalled.
 * - "recorded":  no active run right now — a pending stamp was recorded so
 *                the run with this exact request id starts cancelled if it
 *                registers within the TTL (covers Stop arriving while the
 *                POST is still in flight). Never matches a different
 *                clientRequestId.
 * - "not_found": nothing to cancel (the run already finished, or the
 *                request id doesn't match the active run). Idempotent.
 * - "forbidden": an active run exists but belongs to a different user.
 */
export function requestExecutionCancellation(
  conversationId: string,
  userId: string,
  clientRequestId: string,
): { status: CancelOutcome } {
  const entry = getActiveExecution(conversationId);
  if (entry) {
    if (entry.userId !== userId) {
      return { status: "forbidden" };
    }
    // A request-scoped cancel must not kill a different run for the same
    // conversation (e.g. a stale Stop racing a newer send).
    if (entry.clientRequestId !== clientRequestId) {
      return { status: "not_found" };
    }
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(new Error("Cancelled by user"));
    }
    return { status: "aborted" };
  }

  const stamps = prunePendingCancels(conversationId);
  stamps.push({
    userId,
    clientRequestId,
    requestedAt: Date.now(),
  });
  pendingCancels.set(conversationId, stamps);
  return { status: "recorded" };
}
