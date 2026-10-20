/**
 * Cancellation attribution — the single place that decides whether a
 * stopped run was stopped BY THE USER (Repair R4, Diagnosis E3-S1/S6).
 *
 * The defect this replaces: settle sites keyed "cancelled" purely on a
 * boolean (loop `cancelled`, or `signal.aborted`) and wrote "Task
 * cancelled by user" for every stop — but most loop stops are NOT user
 * stops (max steps, max output, repeated-call detection, the zero-call
 * stall, max runtime), and a signal abort can come from the graceful
 * shutdown routine (server restart) rather than from Stop. The truth
 * is carried in two places, and both are read here:
 *
 *  - the loop's `cancelReason` — the user-stop reason is exactly
 *    USER_CANCEL_REASON; every other reason names its real cause;
 *  - the abort signal's `reason` — the execution registry aborts ONLY
 *    for an explicit, authenticated user cancellation and stamps the
 *    controller with an Error carrying USER_CANCEL_REASON; the
 *    shutdown routine aborts with its own reason string. A bare
 *    `abort()` (no explicit reason) has no non-user origin in this
 *    system, so it keeps the historical user attribution.
 */

/** The exact cancelReason the agent loop records for a user stop. */
export const USER_CANCEL_REASON = "Cancelled by user";

/** True when a loop cancelReason records a user-initiated stop. */
export function isUserCancelReason(reason?: string | null): boolean {
  return reason === USER_CANCEL_REASON;
}

/**
 * The cancelReason for a signal abort, read from the abort's origin:
 * an explicit Error reason (registry user cancel, shutdown) is the
 * truth; anything else falls back to the historical user attribution.
 * A bare `abort()` carries the runtime's DEFAULT reason — a
 * DOMException named "AbortError" — which is "no explicit reason",
 * not an origin: no production aborter passes a raw DOMException.
 */
export function cancelReasonFromAbortSignal(signal?: AbortSignal | null): string {
  const reason = (signal as { reason?: unknown } | null | undefined)?.reason;
  if (reason instanceof DOMException && reason.name === "AbortError") {
    return USER_CANCEL_REASON;
  }
  if (reason instanceof Error && reason.message) return reason.message;
  return USER_CANCEL_REASON;
}

/** True when the signal was aborted AND the abort was a user stop. */
export function isUserCancelAbort(signal?: AbortSignal | null): boolean {
  if (!signal?.aborted) return false;
  return cancelReasonFromAbortSignal(signal) === USER_CANCEL_REASON;
}
