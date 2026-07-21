import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type HealthStatus = "online" | "degraded" | "offline";
type MemoryStatus = HealthStatus | "unconfigured";

interface AutonomicHealth {
  status: HealthStatus;
  api: HealthStatus;
  database: HealthStatus;
  queue: HealthStatus;
  worker: HealthStatus;
  memory: MemoryStatus;
  queuedTasks: number;
  runningTasks: number;
  failedTasks: number;
  lastWorkerHeartbeat: string | null;
  lastSuccessfulTask: string | null;
  version: string;
}

const WORKER_STALE_THRESHOLD_MS = 60_000; // 60s
const WORKER_DEGRADED_THRESHOLD_MS = 120_000; // 120s

export async function GET() {
  const started = Date.now();

  // Always report api as online if we reached this handler
  const api: HealthStatus = "online";

  let database: HealthStatus = "offline";
  let queue: HealthStatus = "offline";
  let worker: HealthStatus = "offline";
  let memory: MemoryStatus = "unconfigured";

  let queuedTasks = 0;
  let runningTasks = 0;
  let failedTasks = 0;

  let lastWorkerHeartbeat: string | null = null;
  let lastSuccessfulTask: string | null = null;

  try {
    // Probe DB connectivity with a lightweight query
    const { data: dbPing, error: dbErr } = await supabaseAdmin
      .from("agent_tasks")
      .select("id", { head: true, count: "exact" })
      .limit(1);

    if (!dbErr) {
      database = "online";
    } else {
      console.warn("[autonomic-health] DB probe failed:", dbErr.message);
      database = "degraded";
    }

    // Task counts (best effort)
    const { data: counts, error: countsErr } = await supabaseAdmin
      .from("agent_tasks")
      .select("status", { count: "exact", head: false });

    if (!countsErr && counts) {
      queue = "online";
      for (const row of counts as Array<{ status: string }>) {
        const s = row.status;
        if (s === "queued" || s === "claimed" || s === "retry_scheduled") queuedTasks++;
        if (s === "running") runningTasks++;
        if (s === "failed") failedTasks++;
      }
    } else if (countsErr) {
      console.warn("[autonomic-health] counts query failed:", countsErr.message);
      queue = database === "online" ? "degraded" : "offline";
    }

    // Last successful task timestamp
    const { data: lastOk } = await supabaseAdmin
      .from("agent_tasks")
      .select("completed_at")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOk?.completed_at) {
      lastSuccessfulTask = lastOk.completed_at as string;
    }

    // Worker heartbeat from worker_instances (if table exists)
    const { data: workers, error: wErr } = await supabaseAdmin
      .from("worker_instances")
      .select("last_heartbeat_at,status")
      .order("last_heartbeat_at", { ascending: false })
      .limit(1);

    if (!wErr && workers && workers.length > 0) {
      const wh = workers[0] as { last_heartbeat_at: string | null; status?: string | null };
      lastWorkerHeartbeat = wh.last_heartbeat_at || null;

      if (lastWorkerHeartbeat) {
        const hb = new Date(lastWorkerHeartbeat).getTime();
        const age = Date.now() - hb;
        if (age <= WORKER_STALE_THRESHOLD_MS) {
          worker = "online";
        } else if (age <= WORKER_DEGRADED_THRESHOLD_MS) {
          worker = "degraded";
        } else {
          worker = "offline";
        }
      } else {
        worker = "offline";
      }
    } else if (wErr) {
      // Table may not exist yet — treat as unconfigured for worker
      worker = "offline";
      console.warn("[autonomic-health] worker_instances probe failed:", wErr.message);
    }

    // Memory (Supermemory) is optional
    if (process.env.SUPERMEMORY_API_KEY?.trim()) {
      memory = "online";
    } else {
      memory = "unconfigured";
    }

    // Overall status
    const critical = [api, database, queue, worker];
    const hasOffline = critical.includes("offline");
    const hasDegraded = critical.includes("degraded") || memory === "unconfigured";

    let status: HealthStatus = "online";
    if (hasOffline) status = "offline";
    else if (hasDegraded || memory === "unconfigured") status = "degraded";

    const payload: AutonomicHealth = {
      status,
      api,
      database,
      queue,
      worker,
      memory,
      queuedTasks,
      runningTasks,
      failedTasks,
      lastWorkerHeartbeat,
      lastSuccessfulTask,
      version: process.env.npm_package_version || "0.0.0",
    };

    // Light timing note in logs only
    const ms = Date.now() - started;
    console.log(`[autonomic-health] responded in ${ms}ms`);

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[autonomic-health] fatal:", e);
    const payload: AutonomicHealth = {
      status: "offline",
      api,
      database: "offline",
      queue: "offline",
      worker: "offline",
      memory: "unconfigured" as MemoryStatus,
      queuedTasks: 0,
      runningTasks: 0,
      failedTasks: 0,
      lastWorkerHeartbeat: null,
      lastSuccessfulTask: null,
      version: process.env.npm_package_version || "0.0.0",
    };
    return NextResponse.json(payload, { status: 200 }); // still 200 so UI can render state
  }
}
