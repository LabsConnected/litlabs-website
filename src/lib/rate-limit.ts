import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// Lazy-construct the Redis client and rate limiters only when first
// used. Constructing at module load with empty env vars produces
// "[Upstash Redis] The 'url' property is missing..." warnings during
// `next build` SSG and every cold start in environments without Redis.
// withRateLimit() already guards on env vars before calling checkLimit,
// so the client is only ever constructed when Redis is actually configured.

export type RateLimiterTier = 'auth' | 'ai' | 'payments' | 'uploads' | 'general';

interface LimiterMap {
  auth: Ratelimit;
  ai: Ratelimit;
  payments: Ratelimit;
  uploads: Ratelimit;
  general: Ratelimit;
}

let _redis: Redis | null = null;
let _limiters: LimiterMap | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || '',
      token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    });
  }
  return _redis;
}

function getLimiters(): LimiterMap {
  if (!_limiters) {
    const redis = getRedis();
    _limiters = {
      auth: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '15 m'), prefix: 'rl:auth' }),
      ai: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '1 m'), prefix: 'rl:ai' }),
      payments: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 h'), prefix: 'rl:pay' }),
      uploads: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, '1 h'), prefix: 'rl:up' }),
      general: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1 m'), prefix: 'rl:gen' }),
    };
  }
  return _limiters;
}

export const RateLimiters: Record<RateLimiterTier, Ratelimit> = {
  get auth() { return getLimiters().auth; },
  get ai() { return getLimiters().ai; },
  get payments() { return getLimiters().payments; },
  get uploads() { return getLimiters().uploads; },
  get general() { return getLimiters().general; },
};

export async function checkLimit(key: string, tier: RateLimiterTier) {
  return await getLimiters()[tier].limit(key);
}
