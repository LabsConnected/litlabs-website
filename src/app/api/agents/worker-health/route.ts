import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { ServiceStatus, HealthCheck, StudioHealthResponse } from "@/lib/health/types";

export const runtime = "nodejs";

const OFFLINE_THRESHOLD_MS = 90_000;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    const health: StudioHealthResponse = {
      status: "misconfigured",
      ready: false,
      checks: [
        {
          name: "supabase",
          status: "misconfigured",
          message: "Supabase admin client not initialized",
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(health, { status: 503 });
  }

  const { data, error } = await admin
    .from("worker_heartbeats")
    .select("worker_id, status, current_task_id, last_seen_at, metadata");

  if (error) {
    const health: StudioHealthResponse = {
      status: "offline",
      ready: false,
      checks: [
        {
          name: "worker_heartbeats",
          status: "offline",
          message: error.message,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(health, { status: 503 });
  }

  const now = Date.now();
  const checks: HealthCheck[] = (data || []).map((row) => {
    const lastSeen = new Date(row.last_seen_at).getTime();
    const stale = now - lastSeen > OFFLINE_THRESHOLD_MS;
    const reported = row.status as ServiceStatus;

    if (stale) {
      return {
        name: `worker:${row.worker_id}`,
        status: "offline",
        message: `Last seen ${Math.round((now - lastSeen) / 1000)}s ago`,
      };
    }

    return {
      name: `worker:${row.worker_id}`,
      status: reported === "healthy" ? "healthy" : reported,
      message:
        reported === "healthy"
          ? `Online, current task ${row.current_task_id ?? "none"}`
          : `Worker reports ${reported}`,
    };
  });

  // If no workers have ever reported, the execution system is not available yet.
  if (checks.length === 0) {
    checks.push({
      name: "worker",
      status: "offline",
      message: "No worker heartbeats found — daemon is not reporting",
    });
  }

  const overall: ServiceStatus = checks.some((c) => c.status === "offline")
    ? "offline"
    : checks.some((c) => c.status === "misconfigured")
      ? "misconfigured"
      : checks.some((c) => c.status === "degraded")
        ? "degraded"
        : "healthy";

  const response: StudioHealthResponse = {
    status: overall,
    ready: overall === "healthy",
    checks,
    timestamp: new Date().toISOString(),
  };

  const statusCode = response.ready ? 200 : 503;
  return NextResponse.json(response, { status: statusCode });
}
