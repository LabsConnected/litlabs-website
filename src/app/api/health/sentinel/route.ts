import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { readHeartbeat } from "@/lib/sentinel/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/sentinel — public Sentinel liveness signal.
 *
 * Sentinel watches the platform; this endpoint lets an EXTERNAL monitor
 * (GitHub Actions cron, uptime service) detect Sentinel itself dying.
 * Returns only heartbeat age — no service details, no incident data.
 *
 * Status semantics:
 *   - "ok"       heartbeat fresh (leader pass within threshold)
 *   - "stale"    heartbeat older than threshold → Sentinel may be dead
 *   - "unknown"  no heartbeat recorded yet (migration pending or
 *                Sentinel never ran) — reported, not paged
 *
 * Always HTTP 200: a stale Sentinel must not trigger Railway restarts
 * of the web service — it degrades monitoring, not the product.
 */
const STALE_AFTER_MS = 10 * 60_000;

export async function GET() {
  try {
    const heartbeat = await readHeartbeat(getSupabaseAdmin());
    if (!heartbeat?.lastPassAt) {
      return NextResponse.json({
        service: "sentinel",
        status: "unknown",
        detail: "no heartbeat recorded",
        timestamp: new Date().toISOString(),
      });
    }
    const ageMs = Date.now() - Date.parse(heartbeat.lastPassAt);
    const status = ageMs > STALE_AFTER_MS ? "stale" : "ok";
    return NextResponse.json({
      service: "sentinel",
      status,
      lastPassAt: heartbeat.lastPassAt,
      ageSeconds: Math.max(0, Math.floor(ageMs / 1000)),
      staleAfterSeconds: Math.floor(STALE_AFTER_MS / 1000),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      service: "sentinel",
      status: "unknown",
      detail: "heartbeat check failed",
      timestamp: new Date().toISOString(),
    });
  }
}
