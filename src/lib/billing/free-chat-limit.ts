/**
 * Shared free-chat allowance for plain Studio chat.
 *
 * The shared store is public.rate_limit_store, consumed by the
 * consume_free_chat_limit RPC (atomic via pg_advisory_xact_lock).
 * Upstash is not the store: it is optional in this repo and the demo
 * limiter fails open to process memory. This limiter fails closed.
 *
 * The RPC migration is written and not applied. Until it exists, the
 * production call fails and free chat is denied (fail safe).
 */

export const FREE_CHAT_PER_MINUTE = 20;
export const FREE_CHAT_PER_DAY = 500;
export const FREE_CHAT_DENY_RETRY_SECONDS = 60;

export interface FreeChatDecision {
  ok: boolean;
  retryAfterSeconds: number;
}

export interface FreeChatLimitStore {
  /**
   * Atomically consume one free-chat hit for both the minute and day
   * windows, or consume neither.
   */
  consume(userKey: string, nowMs: number): Promise<FreeChatDecision>;
}

interface WindowRow {
  count: number;
  windowStartSec: number;
}

/**
 * In-memory stand-in for consume_free_chat_limit. A per-key queue is the
 * advisory lock: overlapping calls for one user cannot both pass the check.
 */
export function createMemoryFreeChatStore(): FreeChatLimitStore & { reset(): void } {
  const rows = new Map<string, WindowRow>();
  const tails = new Map<string, Promise<void>>();

  function locked<T>(userKey: string, fn: () => T): Promise<T> {
    const prev = tails.get(userKey) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = prev.then(() => fn());
    tails.set(userKey, gate);
    return run.finally(() => release());
  }

  function take(key: string, limit: number, windowSec: number, nowSec: number, commit: boolean): { ok: boolean; retry: number } {
    const row = rows.get(key);
    if (!row || nowSec - row.windowStartSec >= windowSec) {
      if (commit) rows.set(key, { count: 1, windowStartSec: nowSec });
      return { ok: true, retry: windowSec };
    }
    if (row.count >= limit) {
      return { ok: false, retry: Math.max(1, row.windowStartSec + windowSec - nowSec) };
    }
    if (commit) row.count += 1;
    return { ok: true, retry: Math.max(1, row.windowStartSec + windowSec - nowSec) };
  }

  return {
    reset() {
      rows.clear();
    },
    consume(userKey: string, nowMs: number) {
      return locked(userKey, () => {
        const nowSec = Math.floor(nowMs / 1000);
        const minute = take(`freechat:${userKey}:m`, FREE_CHAT_PER_MINUTE, 60, nowSec, false);
        const day = take(`freechat:${userKey}:d`, FREE_CHAT_PER_DAY, 86_400, nowSec, false);
        if (!minute.ok || !day.ok) {
          return { ok: false, retryAfterSeconds: !minute.ok ? minute.retry : day.retry };
        }
        take(`freechat:${userKey}:m`, FREE_CHAT_PER_MINUTE, 60, nowSec, true);
        take(`freechat:${userKey}:d`, FREE_CHAT_PER_DAY, 86_400, nowSec, true);
        return { ok: true, retryAfterSeconds: 0 };
      });
    },
  };
}

/** Fail closed. A missing RPC, a down database, or a thrown store denies the hit. */
export async function consumeFreeChat(
  store: FreeChatLimitStore | null | undefined,
  userKey: string,
  nowMs: number = Date.now(),
): Promise<FreeChatDecision> {
  if (!store || !userKey) {
    return { ok: false, retryAfterSeconds: FREE_CHAT_DENY_RETRY_SECONDS };
  }
  try {
    const decision = await store.consume(userKey, nowMs);
    if (!decision || typeof decision.ok !== "boolean") {
      return { ok: false, retryAfterSeconds: FREE_CHAT_DENY_RETRY_SECONDS };
    }
    return decision;
  } catch {
    return { ok: false, retryAfterSeconds: FREE_CHAT_DENY_RETRY_SECONDS };
  }
}
