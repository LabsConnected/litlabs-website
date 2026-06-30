import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/jarvis/context
 * Returns real-time site context for smarter Jarvis responses.
 * Includes user counts, recent activity, agent statuses, etc.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ context: getStaticContext() });
  }

  const [userCount, recentNotifications, agentLogs] = await Promise.all([
    admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .then((r) => r.count || 0),
    admin
      .from("notifications")
      .select("type, title, created_at")
      .order("created_at", { ascending: false })
      .limit(5)
      .then((r) => r.data || []),
    admin
      .from("agent_logs")
      .select("agent_id, message, created_at")
      .order("created_at", { ascending: false })
      .limit(5)
      .then((r) => r.data || []),
  ]);

  return NextResponse.json({
    context: {
      platform: "LiTTree Lab Studios",
      url: "https://litlabs.net",
      totalUsers: userCount,
      recentEvents: recentNotifications.map((n: Record<string, unknown>) => ({
        type: n.type,
        title: n.title,
        when: n.created_at,
      })),
      recentAgentActivity: agentLogs.map((l: Record<string, unknown>) => ({
        agent: l.agent_id,
        action: l.message,
        when: l.created_at,
      })),
      capabilities: [
        "Multi-agent AI orchestration",
        "Voice commands (wake word: Hey JARVIS)",
        "Discord notifications",
        "Web Push notifications",
        "Email alerts via Resend",
        "Codebase scanning",
        "Smart home control (Home Assistant)",
        "Alexa integration (Voice Monkey)",
        "Image generation",
        "Code generation",
      ],
      currentTime: new Date().toISOString(),
    },
  });
}

function getStaticContext() {
  return {
    platform: "LiTTree Lab Studios",
    url: "https://litlabs.net",
    totalUsers: 0,
    recentEvents: [],
    recentAgentActivity: [],
    capabilities: [
      "Multi-agent AI orchestration",
      "Voice commands",
      "Discord notifications",
      "Web Push notifications",
      "Email alerts",
    ],
    currentTime: new Date().toISOString(),
  };
}
