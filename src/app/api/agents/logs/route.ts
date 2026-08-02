import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

function makeDemoLogs(): never[] {
  // No real logs in Supabase means no logs — do NOT invent demo activity.
  // Returning an empty array makes it explicit that the dashboard has no
  // recent real activity to show, rather than fabricating fake "all systems
  // nominal" success lines. (Removed 2026-07-26 per truthful-status P0.)
  return [];
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
