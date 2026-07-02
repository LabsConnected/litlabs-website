// API Route: Start and manage background agent conversations
// NOTE: Serverless-incompatible patterns (setInterval, in-memory state) removed.
// For production, use a queue system (e.g. Supabase Edge Functions + pg_cron).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { orchestrator, CONVERSATION_TOPERS } from "@/lib/agents";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { action, agent1, agent2, topic, conversationId } = body;

      // Start a conversation (single turn — client polls for updates)
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

        await orchestrator.continueConversation(conversation.id);

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

      // Continue a conversation (client-driven, one more turn)
      if (action === "continue" && conversationId) {
        await orchestrator.continueConversation(conversationId);
        const conversation = orchestrator.getConversation(conversationId);
        if (!conversation) {
          return NextResponse.json(
            { error: "Conversation not found" },
            { status: 404 },
          );
        }
        return NextResponse.json({
          success: true,
          conversation: {
            id: conversation.id,
            status: conversation.status,
            messageCount: conversation.messages.length,
            messages: conversation.messages,
          },
        });
      }

      // Get conversation status
      if (action === "status" && conversationId) {
        const conversation = orchestrator.getConversation(conversationId);
        if (!conversation) {
          return NextResponse.json(
            { error: "Conversation not found" },
            { status: 404 },
          );
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

      return NextResponse.json(
        { error: "Invalid action. Use: start, continue, status" },
        { status: 400 },
      );
    } catch {
      return NextResponse.json(
        { error: "Failed to orchestrate agents" },
        { status: 500 },
      );
    }
  }

  // GET all active conversations
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

    return NextResponse.json({
      activeConversations: conversations,
      totalActive: conversations.length,
    });
  }

  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export const POST = withRateLimit(handler, 30, 60);
export const GET = withRateLimit(handler, 50, 60);
