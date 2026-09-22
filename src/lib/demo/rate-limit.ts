import "server-only";

import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/**
 * Demo-lane rate limiting + message-ceiling counters.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are configured (same
 * as src/lib/rate-limit.ts), otherwise falls back to an in-memory sliding
 * window so the demo lane still enforces limits in environments without Redis
 * (and deterministically in tests).
 *
 * Keys are namespaced under `demo:` so anonymous traffic never collides with
 * authenticated tiers.
 */

export interface DemoLimitCheck {
  success: boolean;
  remaining: number;
  resetMs: number;
}

interface WindowHit {
  timestamps: number[];
}

/* ------------------------------------------------------------------ */
/* In-memory backend                                                   */
/* ------------------------------------------------------------------ */

class MemoryDemoStore {
  private windows = new Map<string, WindowHit>();
  private counters = new Map<string, { value: number; expiresAt: number }>();

  /** Sliding-window check. */
  checkWindow(key: string, limit: number, windowMs: number): DemoLimitCheck {
    const now = Date.now();
    let hit = this.windows.get(key);
    if (!hit) {
      hit = { timestamps: [] };
      this.windows.set(key, hit);
    }
    hit.timestamps = hit.timestamps.filter((t) => now - t < windowMs);
    if (hit.timestamps.length >= limit) {
      const oldest = hit.timestamps[0] ?? now;
      return { success: false, remaining: 0, resetMs: oldest + windowMs - now };
    }
    hit.timestamps.push(now);
    return {
      success: true,
      remaining: limit - hit.timestamps.length,
      resetMs: windowMs,
    };
  }

  getCount(key: string): number {
    const entry = this.counters.get(key);
    if (!entry) return 0;
    if (Date.now() > entry.expiresAt) {
      this.counters.delete(key);
      return 0;
    }
    return entry.value;
  }

  incrCount(key: string, ttlMs: number): number {
    const now = Date.now();
    const entry = this.counters.get(key);
    if (!entry || now > entry.expiresAt) {
      this.counters.set(key, { value: 1, expiresAt: now + ttlMs });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }

  reset(): void {
    this.windows.clear();
    this.counters.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Upstash backend                                                     */
/* ------------------------------------------------------------------ */

let _redis: Redis | null = null;
let _upstashLimiters: {
  session: Ratelimit;
  ip: Ratelimit;
} | null = null;

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || "",
      token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
    });
  }
  return _redis;
}

function getUpstashLimiters(sessionPerMinute: number, ipPerMinute: number): {
  session: Ratelimit;
  ip: Ratelimit;
} {
  // Rebuild when configured limits change (env is read once per boot in prod).
  if (!_upstashLimiters) {
    const redis = getRedis();
    _upstashLimiters = {
      session: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(sessionPerMinute, "1 m"),
        prefix: "demo:rl:session",
      }),
      ip: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(ipPerMinute, "1 m"),
        prefix: "demo:rl:ip",
      }),
    };
  }
  return _upstashLimiters;
}

const _memory = new MemoryDemoStore();

/** Test hook — clears all in-memory demo counters/windows. */
export function resetDemoStore(): void {
  _memory.reset();
}

function memoryOrUpstash(): boolean {
  // Prefer Redis in real deployments; memory is the documented fallback.
  return !upstashConfigured();
}

/**
 * Sliding-window burst check. `kind` selects the limiter; `key` is the
 * session id or client IP. Returns success=false when the window is exhausted.
 */
export async function checkDemoBurst(
  kind: "session" | "ip",
  key: string,
  opts: { sessionPerMinute: number; ipPerMinute: number },
): Promise<DemoLimitCheck> {
  const limitPerMinute = kind === "session" ? opts.sessionPerMinute : opts.ipPerMinute;
  if (memoryOrUpstash()) {
    return _memory.checkWindow(`burst:${kind}:${key}`, limitPerMinute, 60_000);
  }
  try {
    const limiters = getUpstashLimiters(opts.sessionPerMinute, opts.ipPerMinute);
    const res = await limiters[kind].limit(key);
    return {
      success: res.success,
      remaining: res.remaining,
      resetMs: Math.max(0, res.reset - Date.now()),
    };
  } catch {
    // Redis failure must not take the demo lane down — fail open to the
    // memory limiter for this request so abuse protection stays on.
    return _memory.checkWindow(`burst:${kind}:${key}`, limitPerMinute, 60_000);
  }
}

/**
 * Anonymous message counter for the per-session ceiling. Stored with a TTL so
 * a session regains its demo budget only after the session itself expires.
 */
export async function getDemoMessageCount(sessionId: string): Promise<number> {
  const key = `demo:msgs:${sessionId}`;
  if (memoryOrUpstash()) return _memory.getCount(key);
  try {
    const raw = await getRedis().get<number>(key);
    return typeof raw === "number" ? raw : 0;
  } catch {
    return _memory.getCount(key);
  }
}

export async function incrementDemoMessageCount(
  sessionId: string,
  ttlSeconds: number,
): Promise<number> {
  const key = `demo:msgs:${sessionId}`;
  if (memoryOrUpstash()) return _memory.incrCount(key, ttlSeconds * 1000);
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    // Set TTL only on first increment so the window doesn't slide forever.
    if (count === 1) await redis.expire(key, ttlSeconds);
    return count;
  } catch {
    return _memory.incrCount(key, ttlSeconds * 1000);
  }
}
