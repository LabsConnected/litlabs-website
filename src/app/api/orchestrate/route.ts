// API Route: Start and manage background agent conversations
import { NextRequest, NextResponse } from "next/server";
import { orchestrator, CONVERSATION_TOPERS } from "@/lib/agents";
import { withRateLimit } from "@/lib/rate-limiter";

// Store active background conversations
const activeBackgroundConversations: Map<string, NodeJS.Timeout> = new Map();

async function handler(req: NextRequest) {
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const {
        action,
        agent1,
        agent2,
        topic,
        conversationId,
        interval = 5000,
      } = body;

      // Start background conversation
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

        // Create conversation
        const conversation = await orchestrator.startBackgroundConversation(
          agent1,
          agent2,
          selectedTopic,
        );

        // Set up interval for continuous conversation
        const intervalId = setInterval(async () => {
          const lastMsg =
            conversation.messages[conversation.messages.length - 1];
          if (lastMsg && conversation.messages.length < 20) {
            // Limit to 20 messages
            await orchestrator.continueConversation(conversation.id);
          } else {
            // End conversation if too long
            conversation.status = "completed";
            clearInterval(intervalId);
            activeBackgroundConversations.delete(conversation.id);
          }
        }, interval);

        activeBackgroundConversations.set(conversation.id, intervalId);

        return NextResponse.json({
          success: true,
          conversation: {
            id: conversation.id,
            participants: conversation.participants,
            topic: conversation.topic,
            status: conversation.status,
            startedAt: conversation.startedAt,
            messageCount: conversation.messages.length,
          },
          message: `Started background conversation between ${agent1} and ${agent2} on topic: ${selectedTopic}`,
        });
      }

      // Stop background conversation
      if (action === "stop" && conversationId) {
        const intervalId = activeBackgroundConversations.get(conversationId);
        if (intervalId) {
          clearInterval(intervalId);
          activeBackgroundConversations.delete(conversationId);

          const conversation = orchestrator.getConversation(conversationId);
          if (conversation) {
            conversation.status = "paused";
          }

          return NextResponse.json({
            success: true,
            message: `Stopped conversation ${conversationId}`,
          });
        }

        return NextResponse.json(
          { error: "Conversation not found or already stopped" },
          { status: 404 },
        );
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
        { error: "Invalid action. Use: start, stop, status" },
        { status: 400 },
      );
    } catch {
      // Error in orchestration:
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
      totalRunning: activeBackgroundConversations.size,
    });
  }

  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}

export const POST = withRateLimit(handler, 30, 60);
export const GET = withRateLimit(handler, 50, 60);
