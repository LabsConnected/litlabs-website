import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json({
      projects: [], tasks: [], agents: [], deployments: [], media: [],
      connected: false, partial: true, failedSources: ["database"],
    });
  }

  const sb = getAdminSupabase();
  const failedSources: string[] = [];
  const { data: dbUser } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .maybeSingle();

  const dbUserId = dbUser?.id as string | undefined;
  const settled = await Promise.allSettled([
    sb.from("projects").select("id, owner, repository, status, updated_at, working_branch").eq("user_id", userId).order("updated_at", { ascending: false }).limit(8),
    dbUserId
      ? sb.from("active_tasks").select("id, status, input, error, result, created_at, completed_at, agent:agent_id(display_name, slug, role)").eq("user_id", dbUserId).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
    dbUserId
      ? sb.from("user_agents").select("id, is_active, installed_at, agent:agent_id(id, display_name, slug, role)").eq("user_id", dbUserId).eq("is_active", true).limit(12)
      : Promise.resolve({ data: [], error: null }),
    sb.from("deployments").select("id, branch, environment, status, deploy_url, created_at, updated_at").contains("metadata", { user_id: userId }).order("created_at", { ascending: false }).limit(10),
    dbUserId
      ? sb.from("user_media").select("id, type, caption, created_at").eq("user_id", dbUserId).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const names = ["projects", "tasks", "agents", "deployments", "media"];
  const values = settled.map((result, index) => {
    if (result.status === "rejected" || result.value.error) {
      failedSources.push(names[index]);
      return [];
    }
    return result.value.data ?? [];
  });

  return NextResponse.json(
    {
      projects: values[0], tasks: values[1], agents: values[2],
      deployments: values[3], media: values[4], connected: true,
      partial: failedSources.length > 0, failedSources,
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
