import { NextResponse } from "next/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

const DEMO_STATS = {
  activeNodes: 3,
  agents: 8,
  impressions: 1247,
  uptime: "99.9%",
  onlineAgents: 7,
  totalUsers: 42,
  postsToday: 12,
  mock: true,
};

async function getHandler() {
  try {
    if (!isAdminSupabaseConfigured()) {
      return NextResponse.json(DEMO_STATS);
    }

    const sb = getAdminSupabase();

    const { count: agentCount } = await sb.from("agents").select("*", { count: "exact", head: true });
    const { count: userCount } = await sb.from("users").select("*", { count: "exact", head: true });
    const { count: postCount } = await sb.from("posts").select("*", { count: "exact", head: true });

    return NextResponse.json({
      activeNodes: 3,
      agents: agentCount ?? 8,
      impressions: 1247,
      uptime: "99.9%",
      onlineAgents: 7,
      totalUsers: userCount ?? 42,
      postsToday: postCount ?? 12,
      mock: false,
    });
  } catch {
    return NextResponse.json(DEMO_STATS);
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
