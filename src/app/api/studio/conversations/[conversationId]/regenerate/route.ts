import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { generateText, type ModelCategory, type LLMProvider } from "@/lib/llm";
import {
  getConversation,
  getMessage,
  listMessages,
  insertMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import { resolveAgent } from "@/lib/studio/agent-registry";
import { buildStudioContext, buildProjectContextBlock } from "@/lib/studio/project-resolver";
import { recallMemories, formatMemoryContext } from "@/lib/studio/memory-service";
import { studioLog } from "@/lib/studio/logger";
import type { AgentSlug } from "@/lib/studio/types";
import { translateCapabilities, type RawCapabilities } from "@/lib/capabilities/translate";
import { routeKernel, composeSystemPrompt, adaptLegacyCapability } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

const HISTORY_LIMIT = 12;

/**
 * POST /api/studio/conversations/[conversationId]/regenerate
 *
 * Regenerates an assistant response. Does NOT duplicate the user message.
 * Stores the new assistant message with regenerationOfMessageId linking.
 */
async function postHandler(req: NextRequest, routeCtx?: RouteParams) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const assistantMessageId = body.assistantMessageId;
  if (typeof assistantMessageId !== "string" || !assistantMessageId.trim()) {
    return NextResponse.json({ error: "assistantMessageId is required" }, { status: 400 });
  }

  // 1. Load conversation (ownership-scoped)
  const { conversationId: convId } = await (routeCtx?.params ?? Promise.resolve({ conversationId: "" }));
  const conversation = await getConversation(convId, userId);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 2. Load the original assistant message
  const originalAssistant = await getMessage(assistantMessageId, userId);
  if (!originalAssistant) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }
  if (originalAssistant.conversationId !== conversation.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (originalAssistant.role !== "assistant") {
    return NextResponse.json({ error: "Can only regenerate assistant messages" }, { status: 400 });
  }

  // 3. Find the parent user message
  const parentId = originalAssistant.parentMessageId;
  if (!parentId) {
    return NextResponse.json({ error: "Cannot regenerate: no parent user message" }, { status: 400 });
  }

  const parentMessage = await getMessage(parentId, userId);
  if (!parentMessage || parentMessage.role !== "user") {
    return NextResponse.json({ error: "Parent user message not found" }, { status: 404 });
  }

  // 4. Resolve agent
  const agentSlug: AgentSlug = originalAssistant.agentSlug ?? conversation.activeAgentSlug;
  const agent = resolveAgent(agentSlug);
  if (!agent) {
    return NextResponse.json({ error: "Unsupported agent" }, { status: 400 });
  }

  // 5. Resolve project server-side
  const ctx = await buildStudioContext(userId, conversation.id, conversation.projectId, agentSlug);
  if (!ctx) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 6. Load prior messages ending with the parent user message
  // Do NOT include the original assistant message or any messages after it
  const allMessages = await listMessages(conversation.id, userId);
  const parentIndex = allMessages.findIndex((m) => m.id === parentId);
  if (parentIndex === -1) {
    return NextResponse.json({ error: "Parent message not in conversation" }, { status: 404 });
  }

  const history = allMessages
    .slice(0, parentIndex) // messages before the parent user message
    .filter((m) => m.status === "completed" && (m.role === "user" || m.role === "assistant"))
    .slice(-HISTORY_LIMIT)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // 7. Recall project-scoped memories
  const memories = await recallMemories(parentMessage.content, userId, conversation.projectId, {
    agentSlug,
    limit: 5,
  });
  const memoryContext = formatMemoryContext(memories);

  // 8. Build system prompt
  const kernelCapabilities: CapabilityRecord[] = [];
  if (ctx.capabilities.repositoryConnected) {
    kernelCapabilities.push(adaptLegacyCapability({ id: "github", status: "ready", name: "Repository" }));
  }

  const kernelResult = routeKernel({
    message: parentMessage.content,
    userId,
    conversationId: conversation.id,
    projectId: conversation.projectId,
    missionId: null,
    canvasId: null,
    capabilities: kernelCapabilities,
  });

  const kernelSystemPrompt = composeSystemPrompt(kernelResult.decision, kernelCapabilities);
  const projectBlock = buildProjectContextBlock(ctx);

  const rawCaps: RawCapabilities = {
    repository: ctx.capabilities.repositoryConnected ? "connected" : "none",
    repositoryIndexed: ctx.capabilities.repositoryConnected,
    terminalExecution: ctx.capabilities.terminalConnected ? "available" : "unavailable",
    connectedProviders: ctx.capabilities.availableTools,
    availableTools: ctx.capabilities.availableTools,
    connectionSummary: ctx.capabilities.connectionSummary,
  };
  const translated = translateCapabilities(rawCaps);

  const systemPrompt = [
    kernelSystemPrompt,
    projectBlock,
    translated.contextBlock,
    memoryContext,
  ].filter(Boolean).join("\n");

  // 9. Build prompt — parent user message appears exactly once at the end
  const transcript = history
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agent.displayName}: ${entry.content}`,
    )
    .join("\n");

  const prompt = [
    systemPrompt,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${parentMessage.content}`,
    "",
    `${agent.displayName}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  // 10. Insert new assistant message with regeneration link
  const { message: newAssistant } = await insertMessage({
    conversationId: conversation.id,
    ownerId: userId,
    projectId: conversation.projectId,
    role: "assistant",
    agentSlug,
    content: "",
    status: "streaming",
    parentMessageId: parentId,
    regenerationOfMessageId: originalAssistant.id,
  });

  if (!newAssistant) {
    return NextResponse.json({ error: "Failed to create regeneration message" }, { status: 500 });
  }

  // 11. Call LLM
  try {
    const category = (body.category as ModelCategory | undefined) ?? "auto";
    const provider = typeof body.provider === "string" ? (body.provider as LLMProvider) : undefined;
    const modelOverride = typeof body.model === "string" && provider
      ? { [provider]: body.model } as Record<string, string>
      : undefined;

    const r = await generateText(
      prompt,
      {
        task: "chat",
        provider: category ? undefined : provider,
        category,
        maxTokens: 2048,
        modelOverride,
      },
      undefined,
    );

    // 12. Persist the new assistant response
    await updateMessageStatus(newAssistant.id, userId, "completed", r.text);

    // 13. Increment conversation revision
    const { getSupabaseAdmin } = await import("@/lib/supabase");
    const admin = getSupabaseAdmin();
    if (admin) {
      await admin
        .from("studio_conversations")
        .update({
          revision: conversation.revision + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("owner_id", userId);
    }

    studioLog("message:regenerated", {
      conversationId: conversation.id,
      userId,
      agentSlug,
      provider: r.provider,
      latencyMs: r.latencyMs,
      revisionBefore: conversation.revision,
      revisionAfter: conversation.revision + 1,
    });

    return NextResponse.json({
      assistantMessage: {
        ...newAssistant,
        content: r.text,
        status: "completed" as const,
      },
      originalAssistantMessageId: originalAssistant.id,
      revision: conversation.revision + 1,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latencyMs,
    });
  } catch (err) {
    await updateMessageStatus(newAssistant.id, userId, "failed");
    const errorMsg = err instanceof Error ? err.message : "LLM provider unavailable";
    studioLog("regenerate:failed", {
      conversationId: conversation.id,
      userId,
      errorClass: errorMsg,
    });
    return NextResponse.json(
      { error: "Provider unavailable", detail: errorMsg, assistantMessage: { ...newAssistant, status: "failed" as const } },
      { status: 502 },
    );
  }
}

export const POST = withRateLimit(postHandler, 20, 60);
