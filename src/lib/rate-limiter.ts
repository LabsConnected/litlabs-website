// Rate limiter — uses Supabase as backend store (serverless-safe).
// Falls back to per-request pass-through when Supabase is unavailable (dev).
import { NextRequest, NextResponse } from "next/server";

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function rateLimit(
  request: NextRequest,
  limit: number = 100,
  window: number = 60,
): Promise<RateLimitResult> {
  try {
    const { getAdminSupabase, isAdminSupabaseConfigured } = await import(
      "./supabase-admin"
    );

    if (!isAdminSupabaseConfigured()) {
      return { success: true, remaining: limit, resetTime: 0 };
    }

    const sb = getAdminSupabase();
    const ip = getClientIp(request);
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - window;

    // Clean old entries for this IP
    await sb
      .from("rate_limits")
      .delete()
      .eq("ip", ip)
      .lt("created_at", new Date(windowStart * 1000).toISOString());

    // Count requests in current window
    const { count } = await sb
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", new Date(windowStart * 1000).toISOString());

    const currentCount = count ?? 0;

    if (currentCount >= limit) {
      const oldest = await sb
        .from("rate_limits")
        .select("created_at")
        .eq("ip", ip)
        .order("created_at", { ascending: true })
        .limit(1)
        .single();

      const oldestTime = oldest.data?.created_at
        ? new Date(oldest.data.created_at).getTime() / 1000
        : now;
      const resetTime = Math.max(0, window - (now - oldestTime));

      return {
        success: false,
        remaining: 0,
        resetTime: Math.ceil(resetTime),
      };
    }

    // Record this request
    await sb.from("rate_limits").insert({
      ip,
      created_at: new Date().toISOString(),
    });

    return {
      success: true,
      remaining: limit - currentCount - 1,
      resetTime: window,
    };
  } catch {
    // Rate limiter unavailable — allow request through
    return { success: true, remaining: limit, resetTime: 0 };
  }
}

export function withRateLimit(
  handler: (
    req: NextRequest,
    ctx?: unknown,
  ) => Promise<NextResponse | Response>,
  limit: number = 100,
  window: number = 60,
) {
  return async (request: NextRequest, context?: unknown) => {
    const result = await rateLimit(request, limit, window);

    if (!result.success) {
      return new NextResponse(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429,
        headers: {
          "Retry-After": String(result.resetTime),
          "X-RateLimit-Limit": String(limit),
          "X-RateLimit-Remaining": String(0),
          "X-RateLimit-Reset": String(result.resetTime),
        },
      });
    }

    const response = await handler(request, context);
    try {
      response.headers.set("X-RateLimit-Limit", String(limit));
      response.headers.set("X-RateLimit-Remaining", String(result.remaining));
      response.headers.set("X-RateLimit-Reset", String(result.resetTime));
    } catch {
      /* immutable headers on plain Response — ignore */
    }
    return response;
  };
}
