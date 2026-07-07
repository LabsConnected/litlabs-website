// Admin snapshot endpoint — returns recent users, agents, and media for the dashboard
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

const ADMIN_IDS = (process.env.ADMIN_CLERK_IDS || process.env.ADMIN_CLERK_ID || process.env.ADMIN_USER_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type SnapshotUser = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  plan?: string | null;
  signup_source?: string | null;
  signup_referrer?: string | null;
  signup_landing_path?: string | null;
  signup_utm?: Record<string, string> | null;
};

type Snapshot = {
  recentUsers: SnapshotUser[];
  signupSources: Array<{ name: string; count: number; color: string }>;
  topReferrers: Array<{ name: string; count: number }>;
  topLandingPaths: Array<{ name: string; count: number }>;
  topUtmCampaigns: Array<{ name: string; count: number }>;
  agents: Array<{
    id: string;
    slug: string;
    name: string;
    display_name: string | null;
    category: string | null;
    status: string | null;
    created_at: string;
  }>;
  recentImages: Array<{
    id: string;
    prompt: string | null;
    image_url: string | null;
    public_url?: string | null;
    created_at: string;
  }>;
  recentConversations: Array<{
    id: string;
    message: string | null;
    level: string | null;
    created_at: string;
    agent_name: string | null;
  }>;
};

export async function GET() {
  const { userId } = await auth();
  if (!userId || !ADMIN_IDS.includes(userId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({
      recentUsers: [],
      signupSources: [],
      topReferrers: [],
      topLandingPaths: [],
      topUtmCampaigns: [],
      agents: [],
      recentImages: [],
      recentConversations: [],
    } satisfies Snapshot);
  }

  const sb = getAdminSupabase();
  const [usersRes, agentsRes, imagesRes, logsRes] = await Promise.all([
    sb
      .from("users")
      .select("id, display_name, username, avatar_url, created_at, plan, signup_source, signup_referrer, signup_landing_path, signup_utm")
      .order("created_at", { ascending: false })
      .limit(8),
    sb
      .from("agents")
      .select("id, slug, display_name, role, is_core, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    sb
      .from("generated_images")
      .select("id, prompt, public_url, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    sb
      .from("agent_logs")
      .select("id, message, level, created_at, agents(display_name)")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const users = (usersRes.data ?? []) as SnapshotUser[];

  // Aggregate signup sources
  const sourceCounts = new Map<string, number>();
  const referrerCounts = new Map<string, number>();
  const landingCounts = new Map<string, number>();
  const utmCampaignCounts = new Map<string, number>();

  const colors = ["#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#22d3ee", "#f87171", "#94a3b8"];

  for (const u of users) {
    const source = u.signup_source || "direct";
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

    if (u.signup_referrer) {
      referrerCounts.set(u.signup_referrer, (referrerCounts.get(u.signup_referrer) || 0) + 1);
    }
    if (u.signup_landing_path) {
      landingCounts.set(u.signup_landing_path, (landingCounts.get(u.signup_landing_path) || 0) + 1);
    }
    const utm = u.signup_utm;
    if (utm && typeof utm === "object" && !Array.isArray(utm)) {
      const campaign = utm.campaign || utm.utm_campaign;
      if (campaign) {
        utmCampaignCounts.set(String(campaign), (utmCampaignCounts.get(String(campaign)) || 0) + 1);
      }
    }
  }

  const sortedEntries = (map: Map<string, number>) =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

  const signupSources = sortedEntries(sourceCounts).map((entry, i) => ({
    ...entry,
    color: colors[i % colors.length],
  }));

  const snapshot: Snapshot = {
    recentUsers: users,
    signupSources,
    topReferrers: sortedEntries(referrerCounts),
    topLandingPaths: sortedEntries(landingCounts),
    topUtmCampaigns: sortedEntries(utmCampaignCounts),
    agents:
      agentsRes.data?.map((agent: { id: string; slug: string; display_name: string | null; role: string | null; is_core?: boolean | null; created_at: string }) => ({
        id: agent.id,
        slug: agent.slug,
        name: agent.display_name || agent.slug,
        display_name: agent.display_name,
        category: agent.role,
        status: agent.is_core ? "active" : "available",
        created_at: agent.created_at,
      })) ?? [],
    recentImages:
      imagesRes.data?.map((image: { id: string; prompt: string | null; public_url: string | null; created_at: string }) => ({
        id: image.id,
        prompt: image.prompt,
        image_url: image.public_url,
        public_url: image.public_url,
        created_at: image.created_at,
      })) ?? [],
    recentConversations:
      logsRes.data?.map((row: { id: string | number; message: string | null; level: string | null; created_at: string; agents?: { display_name: string | null }[] | null }) => {
        const agent = row.agents?.[0];
        return {
          id: String(row.id),
          message: String(row.message ?? "").slice(0, 80),
          level: row.level,
          created_at: row.created_at,
          agent_name: agent?.display_name ?? null,
        };
      }) ?? [],
  };

  return NextResponse.json(snapshot);
}
