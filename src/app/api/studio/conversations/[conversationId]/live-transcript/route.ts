import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  getConversation,
  insertMessage,
  updateConversation,
} from "@/lib/studio/conversation-service";
import type { LiveTurnPair } from "@/lib/litt/live/types";

export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * POST /api/studio/conversations/[conversationId]/live-transcript
 *
 * Persists a finalized Live turn pair (user speech + assistant response)
 * directly to the conversation WITHOUT invoking another LLM call.
 *
 * This is the P0.4 fix: Live transcripts were previously fed back through
 * conversation.send(), which triggered a second LLM response. Now we persist
 * both messages server-side using the conversation service.
 *
 * Body: LiveTurnPair
 * Returns: { userMessage, assistantMessage, revision }
 */
async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const session = await auth(req);
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { conversationId } = await params;
    if (!conversationId) {
      return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
    }

    const body = (await req.json()) as LiveTurnPair;
    if (!body.userText?.trim() && !body.assistantText?.trim()) {
      return NextResponse.json({ error: "Empty transcript" }, { status: 400 });
    }

    // Verify the conversation exists and belongs to the user
    const conversation = await getConversation(conversationId, session.userId);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const liveTurnId = body.liveTurnId || `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const clientRequestId = `live_${liveTurnId}`;

    // Insert user message
    const userResult = await insertMessage({
      conversationId,
      ownerId: session.userId,
      projectId: conversation.projectId,
      role: "user",
      content: body.userText.trim(),
      status: "completed",
      clientRequestId: `${clientRequestId}_user`,
    });

    if (userResult.error || !userResult.message) {
      return NextResponse.json(
        { error: userResult.error || "Failed to insert user message" },
        { status: 500 },
      );
    }

    // Insert assistant message
    const assistantResult = await insertMessage({
      conversationId,
      ownerId: session.userId,
      projectId: conversation.projectId,
      role: "assistant",
      agentSlug: "litt",
      agentMode: "standard",
      content: body.assistantText.trim() || "(no response)",
      status: "completed",
      parentMessageId: userResult.message.id,
      clientRequestId: `${clientRequestId}_assistant`,
    });

    if (assistantResult.error || !assistantResult.message) {
      return NextResponse.json(
        { error: assistantResult.error || "Failed to insert assistant message" },
        { status: 500 },
      );
    }

    // Bump revision
    const { conversation: updated, conflict } = await updateConversation(
      conversationId,
      session.userId,
      conversation.revision,
      {},
    );

    return NextResponse.json({
      userMessage: {
        id: userResult.message.id,
        role: userResult.message.role,
        content: userResult.message.content,
        agentSlug: userResult.message.agentSlug,
        agentMode: userResult.message.agentMode,
        status: userResult.message.status,
        createdAt: userResult.message.createdAt,
        parentMessageId: userResult.message.parentMessageId,
        regenerationOfMessageId: userResult.message.regenerationOfMessageId,
      },
      assistantMessage: {
        id: assistantResult.message.id,
        role: assistantResult.message.role,
        content: assistantResult.message.content,
        agentSlug: assistantResult.message.agentSlug,
        agentMode: assistantResult.message.agentMode,
        status: assistantResult.message.status,
        createdAt: assistantResult.message.createdAt,
        parentMessageId: assistantResult.message.parentMessageId,
        regenerationOfMessageId: assistantResult.message.regenerationOfMessageId,
      },
      revision: updated?.revision ?? conversation.revision + 1,
      conflict,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withRateLimit(postHandler, 20, 60);
