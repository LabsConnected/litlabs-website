import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAdminSupabase, isAdminSupabaseConfigured } from "@/lib/supabase-admin";
import { withRateLimit } from "@/lib/rate-limiter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function handler() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdminSupabaseConfigured()) {
    return NextResponse.json(
      {
        projects: [],
        tasks: [],
        agents: [],
        deployments: [],
        media: [],
        connected: false,
        partial: true,
        failedSources: ["database"],
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }

  const sb = getAdminSupabase();
  const failedSources: string[] = [];

  const { data: dbUser, error: userError } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (userError || !dbUser) {
    return NextResponse.json(
      {
        projects: [],
        tasks: [],
        agents: [],
        deployments: [],
        media: [],
        connected: false,
        partial: true,
        failedSources: ["users"],
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }

  const dbUserId = dbUser.id as string;

  const settled = await Promise.allSettled([
    sb
      .from("projects")
      .select("id, owner, repository, status, updated_at, working_branch")
      .eq("user_id", clerkId)
      .order("updated_at", { ascending: false })
      .limit(8),
    sb
      .from("active_tasks")
      .select(
        "id, status, task_type, input, error, result, created_at, completed_at, agent:agent_id(display_name, slug, role)",
      )
      .eq("user_id", dbUserId)
      .order("created_at", { ascending: false })
      .limit(20),
    sb
      .from("user_agents")
      .select("id, is_active, installed_at, agent:agent_id(id, display_name, slug, role)")
      .eq("user_id", dbUserId)
      .eq("is_active", true)
      .limit(12),
    sb
      .from("deployments")
      .select("id, branch, environment, status, deploy_url, created_at, updated_at")
      .contains("metadata", { user_id: clerkId })
      .order("created_at", { ascending: false })
      .limit(10),
    sb
      .from("user_media")
      .select("id, type, caption, created_at")
      .eq("user_id", dbUserId)
      .order("created_at", { ascending: false })
      .limit(20),
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
      projects: values[0],
      tasks: values[1],
      agents: values[2],
      deployments: values[3],
      media: values[4],
      connected: true,
      partial: failedSources.length > 0,
      failedSources,
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export const GET = withRateLimit(handler, 120, 60);
