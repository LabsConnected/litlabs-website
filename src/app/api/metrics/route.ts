/**
 * Prometheus metrics endpoint.
 *
 * Scraped by Grafana Alloy at http://localhost:3000/metrics
 * and forwarded to Grafana Cloud alongside Windows host metrics.
 *
 * Returns Prometheus text format with content-type header.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMetrics } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
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
