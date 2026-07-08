// API Route: Conversations
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";
import { getDbUserId } from "@/lib/api/auth";
import { unauthorized } from "@/lib/api/response";

// GET: List user's conversations
async function getHandler(req: NextRequest) {
  try {
    const dbUserId = await getDbUserId();
    if (!dbUserId) {
      return unauthorized();
    }

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId");

    let query = supabaseAdmin
      .from("conversations")
      .select(
        `
        *,
        agent:agent_id (*)
      `,
      )
      .eq("user_id", dbUserId)
      .order("updated_at", { ascending: false });

    if (agentId) {
      query = query.eq("agent_id", agentId);
    }

    const { data: conversations, error } = await query;

    if (error) {
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
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

// POST: Create new conversation
async function postHandler(req: NextRequest) {
  try {
    const dbUserId = await getDbUserId();
    if (!dbUserId) {
      return unauthorized();
    }

    const body = await req.json();
    const { agentId, title } = body;

    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    // Verify user owns this agent
    await supabaseAdmin
      .from("user_agents")
      .select("id")
      .eq("user_id", dbUserId)
      .eq("agent_id", agentId)
      .single();

    // Get agent info for title
    const { data: agent } = await supabaseAdmin
      .from("agents")
      .select("display_name")
      .eq("id", agentId)
      .single();

    const conversationTitle = title || `Chat with ${agent?.display_name || "Agent"}`;

    const { data: conversation, error } = await supabaseAdmin
      .from("conversations")
      .insert({
        user_id: dbUserId,
        agent_id: agentId,
        title: conversationTitle,
      })
      .select("*, agent:agent_id (*)")
      .single();

    if (error) {
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
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  }
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 30, 60);
