import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

const MAX_HISTORY = 50;

/**
 * GET /api/jarvis/history?agent=director&limit=20
 * Returns conversation history for the current user + agent pair.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ messages: [] });
  }

  const { searchParams } = new URL(req.url);
  const agent = searchParams.get("agent") || "director";
  const limit = Math.min(
    parseInt(searchParams.get("limit") || "20", 10),
    MAX_HISTORY,
  );

  const { data, error } = await admin
    .from("jarvis_messages")
    .select("id, role, content, agent_slug, created_at")
    .eq("user_id", userId)
    .eq("agent_slug", agent)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ messages: [] });
  }

  return NextResponse.json({ messages: (data || []).reverse() });
}

/**
 * POST /api/jarvis/history
 * Saves a message to conversation history.
 * Body: { agent: string, role: "user"|"assistant", content: string }
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ success: false });
  }

  const body = await req.json();
  const { agent, role, content } = body;

  if (!agent || !role || !content) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    );
  }

  const { error } = await admin.from("jarvis_messages").insert({
    user_id: userId,
    agent_slug: agent,
    role,
    content,
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message });
  }

  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/jarvis/history?agent=director
 * Clears conversation history for the agent.
 */
export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ success: false });
  }

  const { searchParams } = new URL(req.url);
  const agent = searchParams.get("agent") || "director";

  await admin
    .from("jarvis_messages")
    .delete()
    .eq("user_id", userId)
    .eq("agent_slug", agent);

  return NextResponse.json({ success: true });
}
