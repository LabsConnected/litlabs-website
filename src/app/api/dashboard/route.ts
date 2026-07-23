import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch integration accounts
    const { data: accounts } = await supabaseAdmin
      .from("integration_accounts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    // Fetch integration projects
    const { data: projects } = await supabaseAdmin
      .from("integration_projects")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    // Fetch recent events (last 50)
    const { data: events } = await supabaseAdmin
      .from("integration_events")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    // Fetch unread event count
    const { count: unreadCount } = await supabaseAdmin
      .from("integration_events")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);

    // Fetch deployments for all projects
    const projectIds = (projects || []).map((p) => p.id);
    let deployments: Array<Record<string, unknown>> = [];
    if (projectIds.length > 0) {
      const { data: depData } = await supabaseAdmin
        .from("project_deployments")
        .select("*")
        .in("integration_project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(20);
      deployments = depData || [];
    }

    // Fetch GitHub installations (legacy table)
    const { data: installations } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, user_id, created_at")
      .eq("user_id", userId);

    // Also fetch legacy projects for backward compat
    const { data: legacyProjects } = await supabaseAdmin
      .from("projects")
      .select("id, name, status, owner, repository, working_branch, connection_status, repository_full_name, repository_html_url, repository_private, selected_branch, connected_at, last_synced_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    return NextResponse.json({
      accounts: accounts || [],
      projects: projects || [],
      legacyProjects: legacyProjects || [],
      events: events || [],
      unreadCount: unreadCount || 0,
      deployments,
      installations: installations || [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load dashboard data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
