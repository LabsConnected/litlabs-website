// API Route: Conversations
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

// GET: List user's conversations
async function getHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId");

    let query = supabase
      .from("conversations")
      .select(
        `
        *,
        agent:agent_id (*)
      `,
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (agentId) {
      query = query.eq("agent_id", agentId);
    }

    const { data: conversations, error } = await query;

    if (error) {
      // Supabase error:
      return NextResponse.json(
        { error: "Failed to fetch conversations" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      conversations: conversations || [],
      total: conversations?.length || 0,
    });
  } catch {
    // Error fetching conversations:
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

// POST: Create new conversation
async function postHandler(req: NextRequest) {
  try {
    const { userId: clerkId } = await auth();

    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("clerk_id", clerkId)
      .single();
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const { agentId, title } = body;

    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    // Verify user owns this agent
    await supabase
      .from("user_agents")
      .select("id")
      .eq("user_id", user.id)
      .eq("agent_id", agentId)
      .single();

    // Get agent info for title
    const { data: agent } = await supabase
      .from("agents")
      .select("name")
      .eq("id", agentId)
      .single();

    const conversationTitle = title || `Chat with ${agent?.name || "Agent"}`;

    const { data: conversation, error } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        agent_id: agentId,
        title: conversationTitle,
      })
      .select("*, agent:agent_id (*)")
      .single();

    if (error) {
      // Supabase error:
      return NextResponse.json(
        { error: "Failed to create conversation" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      conversation,
      message: "Conversation created",
    });
  } catch {
    // Error creating conversation:
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
