// src/lib/rate-limiter.ts
import { NextRequest, NextResponse } from "next/server";

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

const store: RateLimitStore = {};

// Auto-cleanup expired entries every 60 seconds to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const key in store) {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  }
}, 60000);

export function rateLimit(
  request: NextRequest,
  limit: number = 100,
  window: number = 60 // seconds
): { success: boolean; remaining: number; resetTime: number } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
             request.headers.get("x-real-ip") || 
             "unknown";
  const key = `${ip}`;
  const now = Date.now();

  if (!store[key] || store[key].resetTime < now) {
    store[key] = { count: 0, resetTime: now + window * 1000 };
  }

  store[key].count++;

  const remaining = Math.max(0, limit - store[key].count);
  const resetTime = Math.ceil((store[key].resetTime - now) / 1000);

  return {
    success: store[key].count <= limit,
    remaining,
    resetTime,
  };
}

export function withRateLimit(
  handler: (req: NextRequest) => Promise<NextResponse | Response>,
  limit: number = 100,
  window: number = 60
) {
  return async (request: NextRequest) => {
    const { success, remaining, resetTime } = rateLimit(request, limit, window);

    if (!success) {
      return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: {
          "Retry-After": String(resetTime),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(0),
          "X-RateLimit-Reset": String(resetTime),
        },
      });
    }

    const response = await handler(request);
    response.headers.set("X-RateLimit-Limit", String(limit));
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    response.headers.set("X-RateLimit-Reset", String(resetTime));

    return response;
  };
}
