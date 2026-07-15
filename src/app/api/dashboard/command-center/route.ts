import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

export const dynamic = "force-dynamic";

async function getDbUserId(clerkId: string | null) {
  if (!clerkId) return null;
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  if (error || !data) return null;
  return data.id as string;
}

async function handler() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = await getDbUserId(clerkId);
  if (!userId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Run independent queries in parallel.
  const [
    profileRes,
    walletRes,
    agentsRes,
    runningTasksRes,
    completedTodayRes,
    completedWeekRes,
    failedTasksRes,
    deploymentsRes,
    recentMediaRes,
    recentConversationsRes,
    recentPostsRes,
  ] = await Promise.all([
    supabaseAdmin.from("users").select("id, name, username, avatar_url, created_at").eq("id", userId).single(),
    supabaseAdmin.from("wallets").select("balance, last_claim_date").eq("user_id", userId).single(),
    supabaseAdmin
      .from("user_agents")
      .select("installed_at, agents(id, slug, display_name, role, description)")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("installed_at", { ascending: false }),
    supabaseAdmin
      .from("active_tasks")
      .select("id, status, task_type, input, error, created_at, completed_at, agents(id, slug, display_name)")
      .eq("user_id", userId)
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("active_tasks")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("completed_at", dayAgo),
    supabaseAdmin
      .from("active_tasks")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .eq("status", "completed")
      .gte("completed_at", weekAgo),
    supabaseAdmin
      .from("active_tasks")
      .select("id, status, task_type, input, error, created_at, completed_at, agents(id, slug, display_name)")
      .eq("user_id", userId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("deployments")
      .select("id, status, environment, branch, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("user_media")
      .select("id, type, url, caption, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(6),
    supabaseAdmin
      .from("conversations")
      .select("id, agent_id, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("posts")
      .select("id, content, created_at, likes_count, comments_count")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const installedAgents = (agentsRes.data ?? []).map((ua: Record<string, unknown>) => ({
    id: (ua.agents as { id?: string } | null)?.id ?? "",
    slug: (ua.agents as { slug?: string } | null)?.slug ?? "",
    name: (ua.agents as { display_name?: string } | null)?.display_name ?? "Agent",
    role: (ua.agents as { role?: string } | null)?.role ?? "",
    description: (ua.agents as { description?: string } | null)?.description ?? "",
    installedAt: ua.installed_at as string,
  }));

  const runningTasks = (runningTasksRes.data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    type: t.task_type as string | null,
    input: (t.input as string | null) ?? "",
    status: t.status as string,
    error: (t.error as string | null) ?? null,
    createdAt: t.created_at as string,
    completedAt: (t.completed_at as string | null) ?? null,
    agent: {
      id: (t.agents as { id?: string } | null)?.id ?? "",
      slug: (t.agents as { slug?: string } | null)?.slug ?? "",
      name: (t.agents as { display_name?: string } | null)?.display_name ?? "Agent",
    },
  }));

  const failedTasks = (failedTasksRes.data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    type: t.task_type as string | null,
    input: (t.input as string | null) ?? "",
    status: t.status as string,
    error: (t.error as string | null) ?? null,
    createdAt: t.created_at as string,
    agent: {
      id: (t.agents as { id?: string } | null)?.id ?? "",
      slug: (t.agents as { slug?: string } | null)?.slug ?? "",
      name: (t.agents as { display_name?: string } | null)?.display_name ?? "Agent",
    },
  }));

  const deployments = (deploymentsRes.data ?? []).map((d: Record<string, unknown>) => ({
    id: d.id as string,
    status: d.status as string,
    environment: d.environment as string,
    branch: d.branch as string,
    createdAt: d.created_at as string,
    updatedAt: d.updated_at as string,
  }));

  const media = (recentMediaRes.data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    type: m.type as string,
    url: m.url as string,
    caption: (m.caption as string | null) ?? "",
    createdAt: m.created_at as string,
  }));

  const conversations = (recentConversationsRes.data ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    agentId: c.agent_id as string,
    title: (c.title as string | null) ?? "Untitled session",
    updatedAt: c.updated_at as string,
    createdAt: c.created_at as string,
  }));

  const posts = (recentPostsRes.data ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    content: p.content as string,
    createdAt: p.created_at as string,
    likes: p.likes_count as number,
    comments: p.comments_count as number,
  }));

  // Attention items: real issues + onboarding gaps.
  const attention: Array<{ id: string; type: string; message: string; action?: string; href?: string }> = [];

  if (installedAgents.length === 0) {
    attention.push({
      id: "no-agents",
      type: "setup",
      message: "You haven’t installed any agents yet.",
      action: "Install agents",
      href: "/agents",
    });
  }

  failedTasks.slice(0, 3).forEach((t) => {
    attention.push({
      id: `failed-task-${t.id}`,
      type: "error",
      message: `${t.agent.name} failed: ${t.error || t.input || "task error"}`,
      action: "Review",
      href: "/studio?tool=agents",
    });
  });

  deployments
    .filter((d) => d.status === "failed")
    .slice(0, 3)
    .forEach((d) => {
      attention.push({
        id: `deployment-${d.id}`,
        type: "error",
        message: `Deployment to ${d.environment} failed on ${d.branch || "unknown branch"}`,
        action: "View",
        href: "/deployments",
      });
    });

  runningTasks
    .filter((t) => !t.completedAt)
    .slice(0, 3)
    .forEach((t) => {
      attention.push({
        id: `running-task-${t.id}`,
        type: "info",
        message: `${t.agent.name} is ${t.type ? t.type + " " : ""}working…`,
        action: "Open Studio",
        href: "/studio?tool=agents",
      });
    });

  if (media.length === 0 && installedAgents.length > 0) {
    attention.push({
      id: "no-media",
      type: "tip",
      message: "Generate your first image or video in the Studio.",
      action: "Create",
      href: "/studio?tool=image",
    });
  }

  if (posts.length === 0 && installedAgents.length > 0) {
    attention.push({
      id: "no-posts",
      type: "tip",
      message: "Share what your agents built on the social feed.",
      action: "New post",
      href: "/social",
    });
  }

  const stats = {
    activeProjects: 0, // No projects table in canonical schema yet.
    installedAgents: installedAgents.length,
    runningTasks: runningTasks.length,
    tasksCompletedToday: completedTodayRes.count ?? 0,
    tasksCompletedWeek: completedWeekRes.count ?? 0,
    failedTasks: failedTasks.length,
    credits: walletRes.data?.balance ?? 0,
    deployments: deployments.length,
    successfulDeployments: deployments.filter((d) => d.status === "live").length,
    failedDeployments: deployments.filter((d) => d.status === "failed").length,
    generatedAssets: media.length,
    posts: posts.length,
    storageUsedMB: 0, // No storage tracking table yet.
  };

  return NextResponse.json({
    user: {
      id: profileRes.data?.id ?? userId,
      name: (profileRes.data?.name as string | null) ?? "Creator",
      username: (profileRes.data?.username as string | null) ?? null,
      avatarUrl: (profileRes.data?.avatar_url as string | null) ?? null,
      createdAt: (profileRes.data?.created_at as string | null) ?? now,
    },
    stats,
    agents: installedAgents,
    tasks: runningTasks,
    continueWorking: {
      conversations,
      media,
      posts,
    },
    deployments,
    attention,
  });
}

export const GET = withRateLimit(handler, 120, 60);
