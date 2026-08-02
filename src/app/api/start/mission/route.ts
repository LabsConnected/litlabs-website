import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { trackFunnelEvent } from "@/lib/analytics/funnel";

/**
 * POST /api/start/mission
 *
 * Creates a mission and (optionally) a project based on the onboarding
 * flow answers. Returns the run ID or project ID so the client can
 * redirect to the appropriate workspace.
 *
 * This is the bridge between the /start onboarding flow and the
 * canonical agent-run service. For the Launch Agent, it creates a
 * revenue_agent_run directly. For other agents, it creates a mission
 * and redirects to the studio.
 */

export const runtime = "nodejs";

interface StartMissionBody {
  goal?: string;
  source?: string;
  brief?: string;
  agentSlug?: string;
}

export async function POST(req: NextRequest) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: StartMissionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { goal, source, brief, agentSlug } = body;

  if (!brief || typeof brief !== "string" || brief.trim().length < 10) {
    return NextResponse.json({ error: "Please provide a more detailed brief" }, { status: 400 });
  }

  // Get user
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  await trackFunnelEvent({
    event: "onboarding_goal_selected",
    userId: user.id,
    properties: { goal, source, agentSlug },
  });

  // Get agent
  const { data: agent } = await supabaseAdmin
    .from("agents")
    .select("id, slug, name")
    .eq("slug", agentSlug ?? "litt-launch-agent")
    .eq("is_public", true)
    .maybeSingle();

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Create or find a project
  let projectId: string;

  if (source === "existing") {
    // Find the user's most recent project
    const { data: existingProject } = await supabaseAdmin
      .from("studio_projects")
      .select("id, name")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingProject) {
      projectId = existingProject.id;
    } else {
      // No existing project — create a new one
      const { data: newProject, error: projectError } = await supabaseAdmin
        .from("studio_projects")
        .insert({
          user_id: user.id,
          name: brief.slice(0, 60),
          source_type: "blank",
          template_id: "nextjs-starter",
        })
        .select("id")
        .single();

      if (projectError || !newProject) {
        return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
      }
      projectId = newProject.id;
    }
  } else {
    // Create a new project
    const { data: newProject, error: projectError } = await supabaseAdmin
      .from("studio_projects")
      .insert({
        user_id: user.id,
        name: brief.slice(0, 60),
        source_type: "blank",
        template_id: "nextjs-starter",
      })
      .select("id")
      .single();

    if (projectError || !newProject) {
      return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
    }
    projectId = newProject.id;
  }

  // For the Launch Agent, create a revenue agent run
  if (agent.slug === "litt-launch-agent") {
    // Check entitlement
    const { data: entitlement } = await supabaseAdmin
      .from("agent_entitlements")
      .select("id, is_active, is_refunded")
      .eq("user_id", user.id)
      .eq("agent_id", agent.id)
      .eq("is_active", true)
      .eq("is_refunded", false)
      .maybeSingle();

    // Check if agent is free
    const { data: version } = await supabaseAdmin
      .from("agent_versions")
      .select("id, price_cents")
      .eq("agent_id", agent.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const isFree = version?.price_cents === 0;
    const hasEntitlement = !!entitlement;

    if (!isFree && !hasEntitlement) {
      // Redirect to the agent detail page for purchase
      return NextResponse.json({
        redirect: `/agents/${agent.slug}`,
        error: "You need to purchase this agent first",
      }, { status: 402 });
    }

    // Create the run
    const clientRequestId = `start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: run, error: runError } = await supabaseAdmin
      .from("revenue_agent_runs")
      .insert({
        user_id: user.id,
        agent_id: agent.id,
        agent_version_id: version?.id ?? null,
        project_id: projectId,
        prompt: brief.trim(),
        status: "queued",
        allowed_tools: [
          "project.context.read",
          "project.files.list",
          "project.files.read",
          "project.files.write",
          "project.checkpoint.create",
          "project.build.run",
          "project.test.run",
          "project.preview.start",
          "project.preview.read",
          "deployment.prepare",
          "deployment.trigger",
          "deployment.status.read",
        ],
        client_request_id: clientRequestId,
        queued_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runError || !run) {
      return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
    }

    await trackFunnelEvent({
      event: "run_created",
      userId: user.id,
      properties: { agentSlug: agent.slug, projectId, runId: run.id },
    });

    return NextResponse.json({
      runId: run.id,
      projectId,
      agentSlug: agent.slug,
    });
  }

  // For other agents, create a mission
  const { data: mission, error: missionError } = await supabaseAdmin
    .from("missions")
    .insert({
      user_id: user.id,
      agent_id: agent.id,
      project_id: projectId,
      title: brief.slice(0, 100),
      description: brief.trim(),
      status: "active",
      goal: goal ?? "build",
    })
    .select("id")
    .single();

  if (missionError || !mission) {
    return NextResponse.json({ error: "Failed to create mission" }, { status: 500 });
  }

  return NextResponse.json({
    missionId: mission.id,
    projectId,
    agentSlug: agent.slug,
  });
}
