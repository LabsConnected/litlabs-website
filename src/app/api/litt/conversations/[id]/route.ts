/**
 * GET /api/litt/conversations/[id] — retrieve conversation state for refresh recovery.
 *
 * Returns all canonical messages and their linked Canvas blocks.
 * Used by the CoderWorkspace to restore conversation state after refresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getMessages } from "@/lib/litt/run-repository";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return "demo-user-00000000-0000-0000-0000-000000000000";
  }
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data: user } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();
  return (user?.id as string) ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId } = await params;

  // Verify conversation belongs to user
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }

  const { data: conversation } = await sb
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Get all canonical messages
  const messages = await getMessages(conversationId);

  // Get linked Canvas blocks
  const messageIds = messages.map((m) => m.id);
  let blocks: Array<Record<string, unknown>> = [];
  if (messageIds.length > 0) {
    const { data: blockRows } = await sb
      .from("canvas_blocks")
      .select("*")
      .in("message_id", messageIds)
      .order("position", { ascending: true });
    blocks = (blockRows as Array<Record<string, unknown>>) ?? [];
  }

  // Get runs for this conversation
  const { data: runs } = await sb
    .from("litt_runs")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    conversation,
    messages,
    blocks,
    runs: runs ?? [],
  });
}
