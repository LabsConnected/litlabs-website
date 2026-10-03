import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runLiTT } from "@/lib/litt-runtime";
import { getOrCreateGlobalLittConversation } from "@/lib/litt/global-conversation";
import {
  insertMessage,
  listMessages,
} from "@/lib/studio/conversation-service";
import type { PageContextHint } from "@/lib/litt-runtime/types";

export const runtime = "nodejs";

function sanitizePageContext(value: unknown): PageContextHint {
  const input = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const active = input.activeEntity && typeof input.activeEntity === "object"
    ? input.activeEntity as Record<string, unknown>
    : null;

  return {
    surface: "global_companion",
    route: typeof input.route === "string" ? input.route.slice(0, 500) : undefined,
    pageTitle: typeof input.pageTitle === "string" ? input.pageTitle.slice(0, 160) : undefined,
    activeEntity: active && typeof active.type === "string" && typeof active.name === "string"
      ? { type: active.type.slice(0, 80), name: active.name.slice(0, 160) }
      : undefined,
    authenticated: true,
  };
}

async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { systemProject, conversation } = await getOrCreateGlobalLittConversation(userId);
    const messages = await listMessages(conversation.id, userId);
    return NextResponse.json({
      projectId: systemProject.id,
      conversation,
      messages,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Global LiTT unavailable",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}

async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const clientRequestId = typeof body.clientRequestId === "string" ? body.clientRequestId.trim() : "";
  const expectedRevision = body.expectedRevision;

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (!clientRequestId) {
    return NextResponse.json({ error: "clientRequestId is required" }, { status: 400 });
  }
  if (typeof expectedRevision !== "number" || expectedRevision < 1) {
    return NextResponse.json({ error: "expectedRevision is required" }, { status: 400 });
  }

  const { systemProject, conversation } = await getOrCreateGlobalLittConversation(userId);

  // Idempotency preflight happens before revision reservation or model work.
  // A transport retry with the same clientRequestId must never trigger a
  // second provider attempt/user action.
  const existingMessages = await listMessages(conversation.id, userId);
  const existingUser = existingMessages.find(
    (item) => item.role === "user" && item.clientRequestId === clientRequestId,
  );
  if (existingUser) {
    const existingAssistant = existingMessages.find(
      (item) => item.role === "assistant" && item.parentMessageId === existingUser.id,
    );
    return NextResponse.json({
      projectId: systemProject.id,
      conversationId: conversation.id,
      userMessage: existingUser,
      assistantMessage: existingAssistant ?? undefined,
      duplicate: true,
      revision: conversation.revision,
    });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Reserve exactly one canonical conversation revision for this user turn.
  const { data: newRevision, error: rpcError } = await admin.rpc(
    "try_increment_conversation_revision",
    {
      p_conversation_id: conversation.id,
      p_owner_id: userId,
      p_expected_revision: expectedRevision,
    },
  );

  if (rpcError || newRevision === null) {
    return NextResponse.json(
      {
        error: "Stale revision",
        detail: `Expected revision ${expectedRevision}, got ${conversation.revision}`,
      },
      { status: 409 },
    );
  }

  let runtimeText = "";
  let runtimeStatus = 500;
  let runtimeBody: Record<string, unknown> = {};

  try {
    const result = await runLiTT({
      httpRequest: req,
      req: {
        message,
        conversationId: conversation.id,
        projectId: systemProject.id,
        agentMode: "companion",
        agentSlug: "litt",
        stream: false,
        clientRequestId,
        pageContext: sanitizePageContext(body.pageContext),
      },
    });
    runtimeStatus = result.status;
    runtimeBody = result.body as unknown as Record<string, unknown>;
    runtimeText = typeof result.body.text === "string" ? result.body.text : "";
  } catch (error) {
    runtimeBody = {
      error: "LiTT runtime failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const { message: userMessage, duplicate, error: userInsertError } = await insertMessage({
    conversationId: conversation.id,
    ownerId: userId,
    projectId: systemProject.id,
    role: "user",
    agentSlug: "litt",
    agentMode: "standard",
    content: message,
    status: "completed",
    clientRequestId,
  });

  if (!userMessage) {
    // Release the reserved revision when persistence fails so the conversation
    // cannot get stuck permanently ahead of the client.
    await admin
      .from("studio_conversations")
      .update({ revision: expectedRevision })
      .eq("id", conversation.id)
      .eq("owner_id", userId)
      .eq("revision", newRevision);

    return NextResponse.json(
      { error: "Failed to persist Global LiTT message", detail: userInsertError },
      { status: 500 },
    );
  }

  // A duplicate here is only possible in an unusual race after the preflight;
  // reuse the canonical persisted response instead of writing another turn.
  if (duplicate) {
    const canonicalMessages = await listMessages(conversation.id, userId);
    const assistant = canonicalMessages.find(
      (item) => item.role === "assistant" && item.parentMessageId === userMessage.id,
    );
    return NextResponse.json({
      projectId: systemProject.id,
      conversationId: conversation.id,
      userMessage,
      assistantMessage: assistant ?? undefined,
      duplicate: true,
      revision: newRevision,
    });
  }

  const assistantText = runtimeText || (
    typeof runtimeBody.detail === "string"
      ? runtimeBody.detail
      : "LiTT could not complete that turn."
  );
  const assistantStatus = runtimeStatus === 200 ? "completed" : "failed";
  const { message: assistantMessage, error: assistantInsertError } = await insertMessage({
    conversationId: conversation.id,
    ownerId: userId,
    projectId: systemProject.id,
    role: "assistant",
    agentSlug: "litt",
    agentMode: "standard",
    content: assistantText,
    status: assistantStatus,
    parentMessageId: userMessage.id,
  });

  if (!assistantMessage) {
    return NextResponse.json(
      {
        error: "LiTT replied but the response could not be persisted",
        detail: assistantInsertError,
        userMessage,
        revision: newRevision,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    projectId: systemProject.id,
    conversationId: conversation.id,
    userMessage,
    assistantMessage,
    duplicate: false,
    revision: newRevision,
    actions: Array.isArray(runtimeBody.actions) ? runtimeBody.actions : undefined,
  }, { status: runtimeStatus === 200 ? 200 : 502 });
}

export const GET = withRateLimit(getHandler, 200, 60);
export const POST = withRateLimit(postHandler, 60, 60);
