import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runLiTT } from "@/lib/litt-runtime";
import { getOrCreateGlobalLittConversation } from "@/lib/litt/global-conversation";
import {
  getMessage,
  insertMessage,
  listMessages,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import type { ConversationMessage } from "@/lib/studio/types";
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

function assistantLockId(clientRequestId: string): string {
  return `global-assistant:${clientRequestId}`;
}

function findTurn(
  messages: ConversationMessage[],
  clientRequestId: string,
): { user: ConversationMessage | null; assistant: ConversationMessage | null } {
  const user = messages.find(
    (item) => item.role === "user" && item.clientRequestId === clientRequestId,
  ) ?? null;
  const assistant = user
    ? messages.find(
      (item) => item.role === "assistant" && item.parentMessageId === user.id,
    ) ?? null
    : null;
  return { user, assistant };
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
  if (!clientRequestId || clientRequestId.length > 200) {
    return NextResponse.json({ error: "clientRequestId is required and must be <= 200 characters" }, { status: 400 });
  }
  if (typeof expectedRevision !== "number" || expectedRevision < 1) {
    return NextResponse.json({ error: "expectedRevision is required" }, { status: 400 });
  }

  const { systemProject, conversation } = await getOrCreateGlobalLittConversation(userId);
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Idempotency preflight happens before revision reservation or provider work.
  // If the user turn already exists, reuse it. If an assistant row exists too,
  // its unique lock proves another request already owns/owned provider execution.
  let canonicalMessages = await listMessages(conversation.id, userId);
  let { user: userMessage, assistant: assistantMessage } = findTurn(
    canonicalMessages,
    clientRequestId,
  );

  if (userMessage && assistantMessage) {
    return NextResponse.json({
      projectId: systemProject.id,
      conversationId: conversation.id,
      userMessage,
      assistantMessage,
      duplicate: true,
      revision: conversation.revision,
    });
  }

  let turnRevision = conversation.revision;
  let reservedRevision: number | null = null;

  // A brand-new user turn owns exactly one revision reservation. Persist the
  // user idempotency key BEFORE any provider call so retries can never launch
  // a second provider action merely because the first HTTP response was lost.
  if (!userMessage) {
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

    reservedRevision = Number(newRevision);
    turnRevision = reservedRevision;

    const userInsert = await insertMessage({
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

    userMessage = userInsert.message;

    if (!userMessage) {
      // A concurrent same-id request may have won the unique index after our
      // insertMessage precheck. Re-read before treating this as a real failure.
      canonicalMessages = await listMessages(conversation.id, userId);
      const raced = findTurn(canonicalMessages, clientRequestId);
      userMessage = raced.user;
      assistantMessage = raced.assistant;
    }

    if (!userMessage) {
      await admin
        .from("studio_conversations")
        .update({ revision: expectedRevision })
        .eq("id", conversation.id)
        .eq("owner_id", userId)
        .eq("revision", reservedRevision);

      return NextResponse.json(
        { error: "Failed to persist Global LiTT message", detail: userInsert.error },
        { status: 500 },
      );
    }

    if (userInsert.duplicate || assistantMessage) {
      // This request reserved an extra revision but another same-id request
      // already owns the turn. Roll back only if nobody advanced past us.
      await admin
        .from("studio_conversations")
        .update({ revision: expectedRevision })
        .eq("id", conversation.id)
        .eq("owner_id", userId)
        .eq("revision", reservedRevision);
      turnRevision = expectedRevision;

      if (assistantMessage) {
        return NextResponse.json({
          projectId: systemProject.id,
          conversationId: conversation.id,
          userMessage,
          assistantMessage,
          duplicate: true,
          revision: turnRevision,
        });
      }
    }
  }

  // The assistant placeholder is the durable provider-execution lease. Its
  // clientRequestId has a deterministic suffix covered by the existing unique
  // message index. Only the request that CREATES this row may call runLiTT.
  const lockRequestId = assistantLockId(clientRequestId);
  const assistantInsert = await insertMessage({
    conversationId: conversation.id,
    ownerId: userId,
    projectId: systemProject.id,
    role: "assistant",
    agentSlug: "litt",
    agentMode: "standard",
    content: "",
    status: "streaming",
    parentMessageId: userMessage.id,
    clientRequestId: lockRequestId,
  });

  assistantMessage = assistantInsert.message;

  if (!assistantMessage) {
    canonicalMessages = await listMessages(conversation.id, userId);
    assistantMessage = canonicalMessages.find(
      (item) =>
        item.role === "assistant" &&
        (item.parentMessageId === userMessage!.id || item.clientRequestId === lockRequestId),
    ) ?? null;
  }

  if (!assistantMessage) {
    return NextResponse.json(
      {
        error: "Failed to reserve Global LiTT execution",
        detail: assistantInsert.error,
        userMessage,
        revision: turnRevision,
      },
      { status: 500 },
    );
  }

  if (assistantInsert.duplicate) {
    return NextResponse.json({
      projectId: systemProject.id,
      conversationId: conversation.id,
      userMessage,
      assistantMessage,
      duplicate: true,
      revision: turnRevision,
    });
  }

  // If the insert itself lost a unique-index race, insertMessage reports an
  // error rather than duplicate=true. The re-read above finds the winning row;
  // only execute when THIS request's insert actually created the lease.
  if (assistantInsert.message === null) {
    return NextResponse.json({
      projectId: systemProject.id,
      conversationId: conversation.id,
      userMessage,
      assistantMessage,
      duplicate: true,
      revision: turnRevision,
    });
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

  const assistantText = runtimeText || (
    typeof runtimeBody.detail === "string"
      ? runtimeBody.detail
      : "LiTT could not complete that turn."
  );
  const assistantStatus = runtimeStatus === 200 ? "completed" : "failed";
  const updated = await updateMessageStatus(
    assistantMessage.id,
    userId,
    assistantStatus,
    assistantText,
  );
  const persistedAssistant = updated
    ? await getMessage(assistantMessage.id, userId)
    : null;

  if (!persistedAssistant) {
    return NextResponse.json(
      {
        error: "LiTT replied but the response could not be persisted",
        userMessage,
        assistantMessage,
        revision: turnRevision,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    projectId: systemProject.id,
    conversationId: conversation.id,
    userMessage,
    assistantMessage: persistedAssistant,
    duplicate: false,
    revision: turnRevision,
    actions: Array.isArray(runtimeBody.actions) ? runtimeBody.actions : undefined,
  }, { status: runtimeStatus === 200 ? 200 : 502 });
}

export const GET = withRateLimit(getHandler, 200, 60);
export const POST = withRateLimit(postHandler, 60, 60);
