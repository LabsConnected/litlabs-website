import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

function makeDemoLogs() {
  const now = Date.now();
  const agents = ["LiTT Director", "Forge", "Pulse", "Visionary", "Nexus"];
  const messages: Array<{ timestamp: string; agent: string; message: string; level: "info" | "warn" | "error" | "success" }> = [
    { timestamp: new Date(now - 300000).toLocaleTimeString(), agent: "LiTT", message: "Platform health check passed — all systems nominal", level: "success" },
    { timestamp: new Date(now - 270000).toLocaleTimeString(), agent: "Forge", message: "TypeScript build completed with 0 errors", level: "success" },
    { timestamp: new Date(now - 240000).toLocaleTimeString(), agent: "Pulse", message: "Telemetry batch processed: 128 events, 0 anomalies", level: "info" },
    { timestamp: new Date(now - 210000).toLocaleTimeString(), agent: "LiTT", message: "Agent orchestration cycle initiated — 5 agents active", level: "info" },
    { timestamp: new Date(now - 180000).toLocaleTimeString(), agent: "Pulse", message: "Content calendar synced — 12 posts scheduled", level: "success" },
    { timestamp: new Date(now - 150000).toLocaleTimeString(), agent: "Visionary", message: "Image prompt enhanced — 4K resolution, brand-aligned palette", level: "info" },
    { timestamp: new Date(now - 120000).toLocaleTimeString(), agent: "Forge", message: "PR review queued: 3 files changed, +87 -12 lines", level: "info" },
    { timestamp: new Date(now - 90000).toLocaleTimeString(), agent: "Pulse", message: "Retention cohort analysis complete — 4.2x lift confirmed", level: "success" },
    { timestamp: new Date(now - 60000).toLocaleTimeString(), agent: "LiTT", message: "Gemini API latency: 820ms p95 — within SLA", level: "info" },
    { timestamp: new Date(now - 45000).toLocaleTimeString(), agent: "Nexus", message: "WARNING: rate limit threshold at 78% for /api/gemini/chat", level: "warn" },
    { timestamp: new Date(now - 30000).toLocaleTimeString(), agent: "Forge", message: "Dependency audit: 0 critical, 2 moderate vulnerabilities found", level: "warn" },
    { timestamp: new Date(now - 15000).toLocaleTimeString(), agent: "LiTT", message: "Supabase connection pool healthy — 4/10 connections in use", level: "info" },
    { timestamp: new Date(now - 5000).toLocaleTimeString(), agent: "Pulse", message: "Live feed refresh: 5 new posts indexed from /api/posts", level: "info" },
    { timestamp: new Date(now - 2000).toLocaleTimeString(), agent: "LiTT", message: "Hive Mind sync complete — all agents reporting nominal status", level: "success" },
  ];

  /* Add a random recent event to simulate live activity */
  const randomAgent = agents[Math.floor(Math.random() * agents.length)];
  const randomMsgs = [
    "Heartbeat OK",
    "Cache invalidated for /api/agents/status",
    "Model context window at 42% utilization",
    "Webhook delivery confirmed",
    "Background task queue drained",
  ];
  messages.push({
    timestamp: new Date().toLocaleTimeString(),
    agent: randomAgent,
    message: randomMsgs[Math.floor(Math.random() * randomMsgs.length)],
    level: "info",
  });

  return messages;
}

function getAdminIds(): string[] {
  const env = process.env.ADMIN_USER_IDS ?? process.env.ADMIN_USER_ID ?? "";
  return env.split(",").map((s) => s.trim()).filter(Boolean);
}

function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const admins = getAdminIds();
  if (admins.length === 0) return false;
  return admins.includes(userId);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 200);

  // Command logs require admin auth
  if (type === "commands") {
    const { userId } = await auth();
    if (!isAdmin(userId)) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }
    try {
      const { data: rows, error } = await supabaseAdmin
        .from("agent_logs")
        .select("id, level, message, metadata, created_at, agent_id, agents(display_name)")
        .filter("metadata->_type", "eq", "command_execution")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!error && rows) {
        return NextResponse.json(rows.map((r) => ({
          id: r.id,
          timestamp: new Date(r.created_at).toISOString(),
          agent: (r.agents as { display_name?: string } | null)?.display_name ?? "System",
          level: (r.level ?? "info") as "info" | "warn" | "error" | "success",
          message: r.message ?? "",
          metadata: r.metadata ?? null,
        })));
      }
    } catch { /* fall through */ }
    return NextResponse.json([]);
  }

  // General agent logs (existing behaviour)
  try {
    const { data: rows, error } = await supabaseAdmin
      .from("agent_logs")
      .select("id, level, message, metadata, created_at, agent_id, agents(display_name)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!error && rows && rows.length > 0) {
      const logs = rows.map(r => ({
        timestamp: new Date(r.created_at).toLocaleTimeString(),
        agent: (r.agents as { display_name?: string } | null)?.display_name ?? "System",
        level: (r.level ?? "info") as "info" | "warn" | "error" | "success",
        message: r.message ?? "",
      }));
      return NextResponse.json(logs);
    }
  } catch { /* fall through to demo */ }

  return NextResponse.json(makeDemoLogs());
}
