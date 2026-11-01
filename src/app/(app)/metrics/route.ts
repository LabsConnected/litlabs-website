/**
 * Prometheus metrics endpoint.
 *
 * Scraped by Grafana Alloy with Authorization: Bearer <METRICS_BEARER_TOKEN>
 * and forwarded to Grafana Cloud alongside Windows host metrics.
 *
 * SECURITY: This endpoint requires a valid bearer token. Requests without
 * a valid token receive 401. The token is compared with timingSafeEqual
 * to prevent timing attacks.
 *
 * FAIL-CLOSED: if METRICS_BEARER_TOKEN is not configured, ALL requests
 * are denied. An unconfigured metrics endpoint must never expose
 * operational intelligence (provider mix, traffic, token burn, latency).
 *
 * Returns Prometheus text format with content-type header.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Timing-safe string comparison. Returns false if lengths differ.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Verify the request presents a valid bearer token.
 *
 * FAIL-CLOSED: if METRICS_BEARER_TOKEN is not configured, deny everything.
 */
function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.METRICS_BEARER_TOKEN;

  // Fail closed: no token configured → deny everything.
  if (!expectedToken) return false;

  const authHeader = req.headers.get("authorization") || "";
  let presented = "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    presented = authHeader.slice(7).trim();
  }

  if (!presented) return false;
  return safeEqual(presented, expectedToken);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const metrics = await getMetrics();
    return new NextResponse(metrics, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to collect metrics" },
      { status: 500 },
    );
  }
}
