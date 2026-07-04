// API Route: Start and manage background agent conversations
// NOTE: Serverless-incompatible patterns (setInterval, in-memory state) removed.
// For production, use a queue system (e.g. Supabase Edge Functions + pg_cron).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { orchestrator, CONVERSATION_TOPERS } from "@/lib/agents";
import { withRateLimit } from "@/lib/rate-limiter";
import { supabaseAdmin } from "@/lib/supabase";

async function ensureDbUser(clerkId: string): Promise<string | null> {
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .single();
  return user?.id ?? null;
}

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUserId = await ensureDbUser(userId);
  if (!dbUserId) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { action, agent1, agent2, topic, conversationId } = body;

      if (action === "start") {
        if (!agent1 || !agent2) {
          return NextResponse.json(
            { error: "Missing required fields: agent1, agent2" },
            { status: 400 },
          );
        }

        const selectedTopic =
          topic ||
          CONVERSATION_TOPERS[
            Math.floor(Math.random() * CONVERSATION_TOPERS.length)
          ];

        const conversation = await orchestrator.startBackgroundConversation(
          agent1,
          agent2,
          selectedTopic,
        );

        await supabaseAdmin.from("orchestration_jobs").insert({
          conversation_id: conversation.id,
          user_id: dbUserId,
          agent1_id: agent1,
          agent2_id: agent2,
          topic: selectedTopic,
          status: "running",
          message_count: conversation.messages.length,
          max_messages: 20,
          created_at: new Date().toISOString(),
        });

        return NextResponse.json({
          success: true,
          conversation: {
            id: conversation.id,
            participants: conversation.participants,
            topic: conversation.topic,
            status: conversation.status,
            startedAt: conversation.startedAt,
            messageCount: conversation.messages.length,
            messages: conversation.messages,
          },
          message: `Started conversation between ${agent1} and ${agent2} on topic: ${selectedTopic}`,
        });
      }

      if (action === "stop" && conversationId) {
        const { error } = await supabaseAdmin
          .from("orchestration_jobs")
          .update({ status: "paused" })
          .eq("conversation_id", conversationId);

        const conversation = orchestrator.getConversation(conversationId);
        if (conversation) {
          conversation.status = "paused";
        }

        return NextResponse.json({ success: true, message: `Stopped conversation ${conversationId}` });
      }

      if (action === "status" && conversationId) {
        const conversation = orchestrator.getConversation(conversationId);
        if (!conversation) {
          const { data } = await supabaseAdmin
            .from("orchestration_jobs")
            .select("*")
            .eq("conversation_id", conversationId)
            .single();
          if (!data) {
            return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
          }
          return NextResponse.json({ conversation: data });
        }

        return NextResponse.json({
          conversation: {
            id: conversation.id,
            participants: conversation.participants,
            topic: conversation.topic,
            status: conversation.status,
            startedAt: conversation.startedAt,
            lastMessageAt: conversation.lastMessageAt,
            messages: conversation.messages.map((m) => ({
              id: m.id,
              from: m.from,
              to: m.to,
              content: m.content,
              timestamp: m.timestamp,
              type: m.type,
            })),
          },
        });
      }

      return NextResponse.json({ error: "Invalid action. Use: start, stop, status" }, { status: 400 });
    } catch {
      return NextResponse.json({ error: "Failed to orchestrate agents" }, { status: 500 });
    }
  }

  if (req.method === "GET") {
    const conversations = orchestrator.getActiveConversations().map((c) => ({
      id: c.id,
      participants: c.participants,
      topic: c.topic,
      status: c.status,
      messageCount: c.messages.length,
      startedAt: c.startedAt,
      lastMessageAt: c.lastMessageAt,
    }));

    return NextResponse.json({ activeConversations: conversations, totalActive: conversations.length });
  }

  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export const POST = withRateLimit(handler, 30, 60);
export const GET = withRateLimit(handler, 50, 60);
