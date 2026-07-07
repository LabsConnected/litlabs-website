// API Route: User's installed agents (Dock)
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

async function getUserId() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return user?.id ?? null;
}

// GET: List user's installed agents
async function getHandler() {
  try {
    const dbUserId = await getUserId();
    if (!dbUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userAgents, error } = await supabaseAdmin
      .from("user_agents")
      .select(
        `
        *,
        agent:agent_id (*)
      `,
      )
      .eq("user_id", dbUserId)
      .eq("is_active", true);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch user agents" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      agents: userAgents || [],
      total: userAgents?.length || 0,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch user agents" },
      { status: 500 },
    );
  }
}

// POST: Install an agent (add to dock)
async function postHandler(req: NextRequest) {
  try {
    const dbUserId = await getUserId();
    if (!dbUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { agentId, slug } = body;

    if (!agentId && !slug) {
      return NextResponse.json({ error: "Missing agentId or slug" }, { status: 400 });
    }

    // Try lookup by ID first, then by slug
    let agent = null;
    if (agentId) {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("id", agentId)
        .eq("is_public", true)
        .single();
      if (!error && data) agent = data;
    }
    if (!agent && slug) {
      const { data, error } = await supabaseAdmin
        .from("agents")
        .select("*")
        .eq("slug", slug)
        .eq("is_public", true)
        .single();
      if (!error && data) agent = data;
    }

    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found or not available" },
        { status: 404 },
      );
    }

    // Check if already installed
    const { data: existing } = await supabaseAdmin
      .from("user_agents")
      .select("*")
      .eq("user_id", dbUserId)
      .eq("agent_id", agent.id)
      .single();

    if (existing) {
      return NextResponse.json(
        { message: "Agent already in your dock", userAgent: existing },
        { status: 200 },
      );
    }

    // Install agent
    const { data: userAgent, error } = await supabaseAdmin
      .from("user_agents")
      .insert({
        user_id: dbUserId,
        agent_id: agent.id,
        is_active: true,
      })
      .select("*, agent:agent_id (*)")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to install agent" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: `Installed ${agent.name} to your dock`,
      userAgent: userAgent,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to install agent" },
      { status: 500 },
    );
  }
}

// DELETE: Remove agent from dock
async function deleteHandler(req: NextRequest) {
  try {
    const dbUserId = await getUserId();
    if (!dbUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId");

    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("user_agents")
      .delete()
      .eq("user_id", dbUserId)
      .eq("agent_id", agentId);

    if (error) {
      return NextResponse.json(
        { error: "Failed to remove agent" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: "Agent removed from dock",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to remove agent" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 50, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
