// src/lib/rate-limiter.ts
// Serverless-compatible rate limiter using Supabase
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

export async function rateLimit(
  request: NextRequest,
  limit: number = 100,
  window: number = 60,
): Promise<RateLimitResult> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const key = `rl_${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - window;

  const admin = getSupabaseAdmin();
  if (!admin) {
    return { success: true, remaining: limit, resetTime: window };
  }

  const { data: existing } = await admin
    .from("rate_limit_store")
    .select("count, window_start")
    .eq("key", key)
    .single();

  let count = 0;
  let resetTime = window;

  if (existing && existing.window_start > windowStart) {
    count = existing.count + 1;
  } else {
    count = 1;
  }

  resetTime = Math.max(1, window - (now - windowStart));

  await admin.from("rate_limit_store").upsert({
    key,
    count,
    window_start: now,
    updated_at: new Date().toISOString(),
  });

  const remaining = Math.max(0, limit - count);
  return {
    success: count <= limit,
    remaining,
    resetTime,
  };
}

export function withRateLimit<T = unknown>(
  handler: (req: NextRequest, ctx?: T) => Promise<NextResponse | Response>,
  limit: number = 100,
  window: number = 60,
) {
  return async (request: NextRequest, context?: T) => {
    const { success, remaining, resetTime } = await rateLimit(
      request,
      limit,
      window,
    );

    if (!success) {
      return new NextResponse(
        JSON.stringify({ error: "Rate limit exceeded" }),
        {
          status: 429,
          headers: {
            "Retry-After": String(resetTime),
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": String(0),
            "X-RateLimit-Reset": String(resetTime),
          },
        },
      );
    }

    const response = await handler(request, context);
    try {
      response.headers.set("X-RateLimit-Limit", String(limit));
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      response.headers.set("X-RateLimit-Reset", String(resetTime));
    } catch {
      /* immutable headers on plain Response — ignore */
    }
    return response;
  };
}
