// API Route: User's installed agents (Dock)
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

// GET: List user's installed agents
async function getHandler() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: userAgents, error } = await supabase
      .from("user_agents")
      .select(
        `
        *,
        agent:agent_id (*)
      `,
      )
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      // Supabase error:
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
    // Error fetching user agents:
    return NextResponse.json(
      { error: "Failed to fetch user agents" },
      { status: 500 },
    );
  }
}

// POST: Install an agent (add to dock)
async function postHandler(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { agentId } = body;

    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    // Check if agent exists and is public
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .eq("is_public", true)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { error: "Agent not found or not available" },
        { status: 404 },
      );
    }

    // Check if already installed
    const { data: existing } = await supabase
      .from("user_agents")
      .select("*")
      .eq("user_id", userId)
      .eq("agent_id", agentId)
      .single();

    if (existing) {
      return NextResponse.json(
        { message: "Agent already in your dock", userAgent: existing },
        { status: 200 },
      );
    }

    // Install agent
    const { data: userAgent, error } = await supabase
      .from("user_agents")
      .insert({
        user_id: userId,
        agent_id: agentId,
        is_active: true,
      })
      .select("*, agent:agent_id (*)")
      .single();

    if (error) {
      // Supabase error:
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
    // Error installing agent:
    return NextResponse.json(
      { error: "Failed to install agent" },
      { status: 500 },
    );
  }
}

// DELETE: Remove agent from dock
async function deleteHandler(req: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId");

    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    const { error } = await supabase
      .from("user_agents")
      .delete()
      .eq("user_id", userId)
      .eq("agent_id", agentId);

    if (error) {
      // Supabase error:
      return NextResponse.json(
        { error: "Failed to remove agent" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      message: "Agent removed from dock",
    });
  } catch {
    // Error removing agent:
    return NextResponse.json(
      { error: "Failed to remove agent" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 50, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
