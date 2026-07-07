// Admin Live Data SSE Endpoint
// Streams real-time stats and events to admin dashboard

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import type { TelemetryData } from "@/components/TelemetryPanel";
import type { AdminEvent } from "@/components/EventStream";

const ADMIN_IDS = (process.env.ADMIN_CLERK_IDS || process.env.ADMIN_CLERK_ID || process.env.ADMIN_USER_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function fallbackStats(): TelemetryData {
  return {
    onlineUsers: 0,
    totalUsers: 0,
    todaySignups: 0,
    todaySales: 0,
    todayRevenueLBC: 0,
    activeAgents: 0,
    totalConversations: 0,
    systemHealth: "healthy",
    requestRate: 0,
    responseTime: 0,
    errorRate: 0,
  };
}

async function fetchRealStats(): Promise<TelemetryData> {
  const sb = getAdminSupabase();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [usersRes, todayUsersRes, agentsRes, activeTasksRes, walletRes, conversationsRes, logsRes, errorLogsRes, recentLogsRes] = await Promise.all([
    sb.from("users").select("id", { count: "exact", head: true }),
    sb.from("users").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
    sb.from("agents").select("id", { count: "exact", head: true }),
    sb.from("active_tasks").select("id", { count: "exact", head: true }).eq("status", "running"),
    sb.from("wallets").select("balance"),
    sb.from("conversations").select("id", { count: "exact", head: true }),
    sb.from("agent_logs").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
    sb.from("agent_logs").select("id", { count: "exact", head: true }).eq("level", "error").gte("created_at", todayIso),
    sb.from("agent_logs").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 60_000).toISOString()),
  ]);

  const totalCoins = walletRes.data?.reduce((sum, row) => sum + (row.balance || 0), 0) ?? 0;
  const todayLogs = logsRes.count ?? 0;
  const todayErrors = errorLogsRes.count ?? 0;

  return {
    onlineUsers: 0,
    totalUsers: usersRes.count || 0,
    todaySignups: todayUsersRes.count || 0,
    todaySales: 0,
    todayRevenueLBC: totalCoins,
    activeAgents: activeTasksRes.count ?? agentsRes.count ?? 0,
    totalConversations: conversationsRes.count || 0,
    systemHealth: todayErrors > 0 ? "degraded" : "healthy",
    requestRate: recentLogsRes.count || 0,
    responseTime: 0,
    errorRate: todayLogs > 0 ? todayErrors / todayLogs : 0,
  };
}

async function fetchRealEvents(): Promise<AdminEvent[]> {
  const sb = getAdminSupabase();
  const [logsRes, usersRes] = await Promise.all([
    sb
      .from("agent_logs")
      .select("id, level, message, created_at, metadata, agents(display_name)")
      .order("created_at", { ascending: false })
      .limit(12),
    sb.from("users").select("id, display_name, created_at").order("created_at", { ascending: false }).limit(5),
  ]);

  const logEvents =
    logsRes.data?.map((row) => ({
      id: String(row.id),
      type: (row.level === "error" ? "alert" : row.level === "warn" ? "system" : "agent") as AdminEvent["type"],
      message: String(row.message),
      timestamp: row.created_at,
      data: row.metadata as Record<string, unknown> | undefined,
    })) ?? [];

  const userEvents =
    usersRes.data?.map((row) => ({
      id: `user-${row.id}`,
      type: "signup" as const,
      message: `${row.display_name || "User"} joined the platform`,
      timestamp: row.created_at,
    })) ?? [];

  return [...userEvents, ...logEvents].slice(0, 24) as AdminEvent[];
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();

  if (!userId || !ADMIN_IDS.includes(userId)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const push = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      const initialStats = isAdminSupabaseConfigured()
        ? await fetchRealStats().catch(() => fallbackStats())
        : fallbackStats();
      const initialEvents = isAdminSupabaseConfigured()
        ? await fetchRealEvents().catch(() => [])
        : [];

      push({ type: "stats", payload: initialStats });
      initialEvents.forEach((event) => push({ type: "event", payload: event }));

      const statsInterval = setInterval(async () => {
        if (closed) return clearInterval(statsInterval);
        const payload = isAdminSupabaseConfigured()
          ? await fetchRealStats().catch(() => fallbackStats())
          : fallbackStats();
        push({ type: "stats", payload });
      }, 4000);

      const eventsInterval = setInterval(async () => {
        if (closed) return clearInterval(eventsInterval);
        if (!isAdminSupabaseConfigured()) return;
        const fresh = await fetchRealEvents().catch(() => []);
        if (fresh.length > 0) push({ type: "event", payload: fresh[0] });
      }, 7000);

      const pingInterval = setInterval(() => {
        if (closed) return clearInterval(pingInterval);
        push({ type: "ping" });
      }, 15000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(statsInterval);
        clearInterval(eventsInterval);
        clearInterval(pingInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
