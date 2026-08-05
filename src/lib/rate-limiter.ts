// src/lib/rate-limiter.ts
// Serverless-compatible rate limiter using Supabase
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { newRequestId } from "@/lib/api-route-helpers";
import { httpRequestTotal, httpRequestDurationSeconds } from "@/lib/metrics";

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

/**
 * Rate limit a request using a Supabase-backed counter.
 *
 * Uses the authenticated user ID when available (from Clerk), falling
 * back to IP address for unauthenticated requests. This prevents a
 * single local-dev IP from exhausting the limit for all users.
 *
 * Always fails OPEN — if Supabase is unreachable or the table is
 * missing, the request is allowed through. Rate limiting is a
 * protection layer, not a hard gate.
 */
export async function rateLimit(
  request: NextRequest,
  limit: number = 100,
  window: number = 60,
): Promise<RateLimitResult> {
  // Build the rate-limit key — prefer user ID, fall back to IP
  const userId = request.headers.get("x-clerk-user-id")
    || request.headers.get("x-user-id");
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const key = userId ? `rl_user_${userId}` : `rl_${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - window;

  const admin = getSupabaseAdmin();
  if (!admin) {
    // No Supabase admin — fail open
    return { success: true, remaining: limit, resetTime: window };
  }

  try {
    const { data: existing } = await admin
      .from("rate_limit_store")
      .select("count, window_start")
      .eq("key", key)
      .single();

    let count = 0;
    let resetTime = window;

    if (existing && existing.window_start > windowStart) {
      count = existing.count + 1;
      // Window still active — preserve the original window_start
      await admin.from("rate_limit_store").upsert({
        key,
        count,
        window_start: existing.window_start,
        updated_at: new Date().toISOString(),
      });
    } else {
      // Window expired (or first request) — start a new window
      count = 1;
      await admin.from("rate_limit_store").upsert({
        key,
        count,
        window_start: now,
        updated_at: new Date().toISOString(),
      });
    }

    const actualWindowStart = existing && existing.window_start > windowStart ? existing.window_start : now;
    resetTime = Math.max(1, window - (now - actualWindowStart));

    const remaining = Math.max(0, limit - count);
    return {
      success: count <= limit,
      remaining,
      resetTime,
    };
  } catch {
    // Supabase error (table missing, connection timeout, etc.) — fail open
    return { success: true, remaining: limit, resetTime: window };
  }
}

export function withRateLimit(
  handler: (req: NextRequest) => Promise<NextResponse | Response>,
  limit?: number,
  window?: number,
): (request: NextRequest) => Promise<NextResponse | Response>;
export function withRateLimit<T>(
  handler: (req: NextRequest, ctx: T) => Promise<NextResponse | Response>,
  limit?: number,
  window?: number,
): (request: NextRequest, context: T) => Promise<NextResponse | Response>;
export function withRateLimit<T>(
  handler: ((req: NextRequest, ctx: T) => Promise<NextResponse | Response>) | ((req: NextRequest) => Promise<NextResponse | Response>),
  limit: number = 100,
  window: number = 60,
) {
  return async (request: NextRequest, context?: T) => {
    const _httpStart = Date.now();
    const _method = request.method;
    const _route = request.nextUrl?.pathname || new URL(request.url).pathname;

    const { success, remaining, resetTime } = await rateLimit(
      request,
      limit,
      window,
    );

    if (!success) {
      httpRequestTotal.labels({ method: _method, route: _route, status: "429" }).inc();
      httpRequestDurationSeconds.labels({ method: _method, route: _route, status: "429" }).observe((Date.now() - _httpStart) / 1000);
      return new NextResponse(
        JSON.stringify({ error: "Rate limit exceeded", retryAfter: resetTime }),
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

    let response: NextResponse | Response;
    try {
      response = await (handler as (req: NextRequest, ctx?: T) => Promise<NextResponse | Response>)(request, context);
    } catch (err) {
      // Top-level safety net: never let an unhandled exception bubble up,
      // which would cause Vercel to render an HTML 500 page instead of JSON.
      const requestId = newRequestId();
      const message = err instanceof Error ? err.message : "Internal server error";
      console.error(`[api] ${requestId} 500 (unhandled): ${message}\n${err instanceof Error ? err.stack ?? "" : ""}`);
      httpRequestTotal.labels({ method: _method, route: _route, status: "500" }).inc();
      httpRequestDurationSeconds.labels({ method: _method, route: _route, status: "500" }).observe((Date.now() - _httpStart) / 1000);
      return new NextResponse(
        JSON.stringify({ success: false, requestId, error: "Internal server error", code: "INTERNAL_ERROR" }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Request-Id": requestId,
          },
        },
      );
    }
    try {
      response.headers.set("X-RateLimit-Limit", String(limit));
      response.headers.set("X-RateLimit-Remaining", String(remaining));
      response.headers.set("X-RateLimit-Reset", String(resetTime));
    } catch {
      /* immutable headers on plain Response — ignore */
    }
    const _status = String(response.status);
    httpRequestTotal.labels({ method: _method, route: _route, status: _status }).inc();
    httpRequestDurationSeconds.labels({ method: _method, route: _route, status: _status }).observe((Date.now() - _httpStart) / 1000);
    return response;
  };
}
