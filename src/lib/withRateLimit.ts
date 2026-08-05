import { checkLimit } from './rate-limit';

type RateLimitTier = keyof typeof import('./rate-limit').RateLimiters;

export async function withRateLimit({ key, tier }: { key: string; tier: RateLimitTier }) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null; // disabled when Redis is not configured
  }
  const res = await checkLimit(key, tier);
  if (!res.success) {
    return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: res.reset }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
