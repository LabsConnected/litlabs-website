// src/lib/rate-limiter.ts
// Serverless-compatible rate limiter using Supabase
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { newRequestId } from "@/lib/api-route-helpers";
import { httpRequestTotal, httpRequestDurationSeconds } from "@/lib/metrics";

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

const MAX_TRACKED_KEYS = 10000;
const inMemoryTimestamps = new Map<string, number[]>();

/**
 * In-process sliding-window fallback used when Supabase is unreachable.
 * This prevents an outage from leaving routes completely unprotected.
 * Timestamps are scoped to the current serverless process; the window
 * resets on redeploy/cold start, but it still bounds abuse inside a
 * single warm instance.
 */
function inProcessRateLimit(key: string, limit: number, window: number): RateLimitResult {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - window;
  const timestamps = inMemoryTimestamps.get(key) ?? [];
  const active = timestamps.filter((ts) => ts > windowStart);

  if (active.length >= limit) {
    const oldest = active[0] ?? now;
    inMemoryTimestamps.set(key, active);
    return { success: false, remaining: 0, resetTime: Math.max(1, oldest + window - now) };
  }

  active.push(now);
  inMemoryTimestamps.set(key, active);

  if (inMemoryTimestamps.size > MAX_TRACKED_KEYS) {
    const first = inMemoryTimestamps.keys().next().value;
    if (first) inMemoryTimestamps.delete(first);
  }

  const oldest = active[0] ?? now;
  const resetTime = Math.max(1, window - (now - oldest));
  const remaining = Math.max(0, limit - active.length);
  return { success: true, remaining, resetTime };
}

/**
 * Resolve the verified session user, if any. Client-supplied identity
 * headers (x-clerk-user-id, x-user-id) are never trusted: nothing in our
 * stack sets them, so honoring them lets a caller mint an unlimited
 * number of fresh rate-limit buckets. auth() is safe to call in any
 * route handler and returns nulls for unauthenticated requests.
 */
async function resolveVerifiedUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId;
  } catch {
    return null;
  }
}

/**
 * Client IP for the fallback bucket. X-Forwarded-For is append-only: the
 * LAST entry is the address of the peer that connected to our edge, which
 * a client cannot inject. The FIRST entry is client-controlled and must
 * not be used for a security decision. When no proxy is present (local
 * dev, direct connections) there is no XFF and we fall back to
 * x-real-ip, then a shared "unknown" bucket.
 */
function resolveClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const last = forwarded.split(",").map((part) => part.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;

/**
 * Route pattern for the bucket key: the request pathname with dynamic
 * segments (UUIDs, numeric ids) normalized to ":id", so
 * /api/studio/conversations/<uuid>/action-run is ONE bucket per user —
 * not one bucket per conversation, and never a bucket shared with
 * unrelated routes.
 */
function resolveRoutePattern(request: NextRequest): string {
  let pathname = "/";
  try {
    pathname = request.nextUrl?.pathname || new URL(request.url).pathname;
  } catch {
    pathname = "/";
  }
  const pattern = pathname
    .split("/")
    .map((segment) =>
      UUID_SEGMENT.test(segment) || NUMERIC_SEGMENT.test(segment) ? ":id" : segment,
    )
    .join("/");
  return pattern || "/";
}

/**
 * Rate limit a request using a Supabase-backed counter.
 *
 * Uses the verified authenticated user ID when available, falling
 * back to the edge-derived client IP for unauthenticated requests.
 *
 * The bucket is scoped per route pattern (see resolveRoutePattern):
 * each route's declared limit is that route's own budget. Before this
 * scoping, every rate-limited route incremented ONE shared per-user
 * counter, so chatty pollers on one route could 429 unrelated routes.
 *
 * Falls back to an in-process sliding window if Supabase is unreachable
 * or the table is missing, so a rate-limit outage no longer means
 * unlimited requests.
 */
export async function rateLimit(
  request: NextRequest,
  limit: number = 100,
  window: number = 60,
): Promise<RateLimitResult> {
  // Build the rate-limit key — prefer verified user ID, fall back to IP;
  // either way the bucket is scoped to this route's pattern.
  const userId = await resolveVerifiedUserId();
  const routePattern = resolveRoutePattern(request);
  const key = userId
    ? `rl_user_${userId}:${routePattern}`
    : `rl_${resolveClientIp(request)}:${routePattern}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - window;

  const admin = getSupabaseAdmin();
  if (!admin) {
    // No Supabase admin — use in-process fallback
    return inProcessRateLimit(key, limit, window);
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
    // Supabase error (table missing, connection timeout, etc.) — use fallback
    return inProcessRateLimit(key, limit, window);
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
    } catch {
      // Top-level safety net: never let an unhandled exception bubble up,
      // which would cause Vercel to render an HTML 500 page instead of JSON.
      // Error details are intentionally not logged here; the client receives
      // a generic JSON 500 with a request ID for correlation.
      const requestId = newRequestId();
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
