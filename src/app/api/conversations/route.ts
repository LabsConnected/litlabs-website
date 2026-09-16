// API Route: Conversations
import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

async function getUserId(req: NextRequest) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) return null;
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return user?.id ?? null;
}

// GET: List user's conversations
async function getHandler(req: NextRequest) {
  try {
    const dbUserId = await getUserId(req);
    if (!dbUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get("agentId");

    let query = supabaseAdmin
      .from("conversations")
      .select("*")
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

    // conversations.agent_id is a plain TEXT slug — not an FK — so the
    // PostgREST `agent:agent_id(*)` embed can never resolve and turned this
    // endpoint into a permanent 500. Look up display names in one batch
    // instead so consumers still get `agent.display_name` when it exists.
    const agentIds = [
      ...new Set(
        (conversations ?? [])
          .map((c) => c.agent_id)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    let agentNames = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: agents } = await supabaseAdmin
        .from("agents")
        .select("id, display_name")
        .in("id", agentIds);
      agentNames = new Map(
        (agents ?? []).map((a) => [a.id, a.display_name] as const),
      );
    }
    const enriched = (conversations ?? []).map((c) => ({
      ...c,
      agent: agentNames.has(c.agent_id)
        ? { display_name: agentNames.get(c.agent_id) }
        : null,
    }));

    return NextResponse.json({
      conversations: enriched,
      total: enriched.length,
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
    const dbUserId = await getUserId(req);
    if (!dbUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to create conversation" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      conversation: { ...conversation, agent: agent ?? null },
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
