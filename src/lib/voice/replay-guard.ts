export type ReplayCheckResult =
  | { ok: true }
  | { ok: false; reason: "stale_timestamp" | "future_timestamp" | "replayed_request_id" };

export interface ReplayGuard {
  check(requestId: string, timestampMs: number): ReplayCheckResult;
}

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

/**
 * In-memory replay/idempotency guard. A requestId can only be accepted once
 * within windowMs of its claimed timestamp; a repeat is rejected rather than
 * reprocessed, so duplicate delivery of the same signed request can never
 * cause duplicate effects (two authorize attempts, two recorded attempts,
 * two dials). State is process-local — acceptable for a single-instance
 * deployment, same caveat class as voice-server/server.mjs's in-memory
 * session tracking. A multi-instance deployment would need a shared store.
 */
export function createReplayGuard(opts?: { now?: () => number; windowMs?: number }): ReplayGuard {
  const now = opts?.now ?? Date.now;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const seen = new Map<string, number>(); // requestId -> expiry timestamp

  function prune(current: number): void {
    for (const [id, expiry] of seen) {
      if (expiry <= current) seen.delete(id);
    }
  }

  return {
    check(requestId: string, timestampMs: number): ReplayCheckResult {
      const current = now();
      prune(current);

      if (!Number.isFinite(timestampMs)) return { ok: false, reason: "stale_timestamp" };

      const age = current - timestampMs;
      if (age > windowMs) return { ok: false, reason: "stale_timestamp" };
      if (age < -windowMs) return { ok: false, reason: "future_timestamp" };

      if (seen.has(requestId)) return { ok: false, reason: "replayed_request_id" };

      // Expire relative to whichever is later — current time or the claimed
      // timestamp — so a request near the edge of the window can't be
      // pruned out of the dedupe set before its own freshness window would
      // have elapsed.
      seen.set(requestId, Math.max(current, timestampMs) + windowMs);
      return { ok: true };
    },
  };
}
