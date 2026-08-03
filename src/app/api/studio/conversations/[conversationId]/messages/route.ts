import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateText, type ModelCategory, type LLMProvider } from "@/lib/llm";
import {
  getConversation,
  listMessages,
  insertMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import { resolveAgent, isValidAgentSlug } from "@/lib/studio/agent-registry";
import { buildStudioContext, buildProjectContextBlock } from "@/lib/studio/project-resolver";
import { recallMemories, persistMemory, formatMemoryContext } from "@/lib/studio/memory-service";
import { studioLog } from "@/lib/studio/logger";
import type { AgentSlug } from "@/lib/studio/types";
import { translateCapabilities, type RawCapabilities } from "@/lib/capabilities/translate";
import { routeKernel, composeSystemPrompt, adaptLegacyCapability } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";
import { parseAgentSelection } from "@/lib/agent-selection";
import { resolveRuntimeAgent, type RuntimeAgent } from "@/lib/agent-runtime";
import { startAgentRun, completeAgentRun, estimateCredits } from "@/lib/agent-billing";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

const HISTORY_LIMIT = 12;

/**
 * POST /api/studio/conversations/[conversationId]/messages
 *
 * Idempotent message send. The server:
 * 1. Authenticates the user
 * 2. Loads the conversation (ownership-scoped)
 * 3. Validates expected revision
 * 4. Resolves project server-side
 * 5. Inserts the user message once (idempotent via clientRequestId)
 * 6. Loads prior completed messages from DB
 * 7. Builds model history in chronological order
 * 8. Calls the LLM provider
 * 9. Persists the assistant message
 * 10. Increments conversation revision
 * 11. Returns canonical IDs and revision
 */
async function postHandler(req: NextRequest, routeCtx: RouteParams) {
  const { userId, clerkId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = body.message;
  const clientRequestId = body.clientRequestId;
  const expectedRevision = body.expectedRevision;
  const requestedAgentSlug = body.requestedAgentSlug;
  const agentInstanceId = body.agentInstanceId;

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  if (typeof clientRequestId !== "string" || !clientRequestId.trim()) {
    return NextResponse.json({ error: "clientRequestId is required" }, { status: 400 });
  }
  if (typeof expectedRevision !== "number" || expectedRevision < 1) {
    return NextResponse.json({ error: "expectedRevision is required" }, { status: 400 });
  }

  // 1. Load conversation (ownership-scoped)
  const { conversationId: convId } = await (routeCtx?.params ?? Promise.resolve({ conversationId: "" }));
  const conversation = await getConversation(convId, userId);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 2. Atomic revision check-and-increment via RPC (prevents concurrent writes)
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  const { data: newRevision, error: rpcError } = await admin
    .rpc("try_increment_conversation_revision", {
      p_conversation_id: conversation.id,
      p_owner_id: userId,
      p_expected_revision: expectedRevision,
    });

  if (rpcError || newRevision === null) {
    return NextResponse.json(
      { error: "Stale revision", detail: `Expected revision ${expectedRevision}, got ${conversation.revision}` },
      { status: 409 },
    );
  }

  // 3. Resolve agent — either builtin slug or marketplace instance
  let agentSlug: AgentSlug = conversation.activeAgentSlug;
  let runtimeAgent: RuntimeAgent | null = null;

  if (agentInstanceId && clerkId) {
    // Marketplace agent instance — resolve via the runtime resolver
    const selection = parseAgentSelection(agentInstanceId);
    if (selection) {
      const result = await resolveRuntimeAgent({ clerkId, selection });
      if (!result.ok || !result.agent) {
        return NextResponse.json(
          { error: result.error || "Agent access denied" },
          { status: result.status || 403 },
        );
      }
      runtimeAgent = result.agent;
      // Use the agent template slug for memory/capability routing
      agentSlug = (result.agent.agentId ? "litt" : "litt") as AgentSlug; // fallback for type compat
    }
  } else {
    // Builtin agent
    if (requestedAgentSlug && isValidAgentSlug(String(requestedAgentSlug))) {
      agentSlug = requestedAgentSlug as AgentSlug;
    }
    const agent = resolveAgent(agentSlug);
    if (!agent) {
      return NextResponse.json({ error: "Unsupported agent" }, { status: 400 });
    }
  }

  // 4. Insert user message (idempotent)
  const { message: userMessage, duplicate } = await insertMessage({
    conversationId: conversation.id,
    ownerId: userId,
    projectId: conversation.projectId,
    role: "user",
    content: message,
    status: "completed",
    clientRequestId,
  });

  if (!userMessage) {
    return NextResponse.json({ error: "Failed to insert message" }, { status: 500 });
  }

  // If duplicate request, return the existing message + any assistant response
  if (duplicate) {
    studioLog("message:duplicate", {
      conversationId: conversation.id,
      userId,
      clientRequestId,
    });

    // Look up the assistant message that was generated for this user message
    const allMsgs = await listMessages(conversation.id, userId);
    const assistantMsg = allMsgs.find(
      (m) => m.parentMessageId === userMessage.id && m.role === "assistant",
    );

    return NextResponse.json({
      userMessage,
      assistantMessage: assistantMsg ?? undefined,
      duplicate: true,
      revision: conversation.revision,
    });
  }

  // 5. Resolve project server-side
  const ctx = await buildStudioContext(userId, conversation.id, conversation.projectId, agentSlug);
  if (!ctx) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // 6. Load prior completed messages from DB (excluding the just-inserted user message)
  const allMessages = await listMessages(conversation.id, userId);
  const priorMessages = allMessages.filter((m) => m.id !== userMessage.id);

  // 7. Build model history in chronological order
  const history = priorMessages
    .filter((m) => m.status === "completed" && (m.role === "user" || m.role === "assistant"))
    .slice(-HISTORY_LIMIT)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // 8. Recall project-scoped memories
  const memories = await recallMemories(message, userId, conversation.projectId, {
    agentSlug,
    agentInstanceId: runtimeAgent?.agentInstanceId || undefined,
    memoryNamespace: runtimeAgent?.memoryNamespace,
    limit: 5,
  });
  const memoryContext = formatMemoryContext(memories);

  // 9. Build system prompt
  const kernelCapabilities: CapabilityRecord[] = [];
  if (ctx.capabilities.repositoryConnected) {
    kernelCapabilities.push(adaptLegacyCapability({ id: "github", status: "ready", name: "Repository" }));
  }

  const kernelResult = routeKernel({
    message,
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
    // Use the runtime agent's version prompt for marketplace agents, or the
    // kernel system prompt for builtin agents.
    runtimeAgent?.systemPrompt || kernelSystemPrompt,
    projectBlock,
    translated.contextBlock,
    memoryContext,
  ].filter(Boolean).join("\n");

  // 10. Build the full prompt — current user message appears exactly once
  const agentDisplayName = runtimeAgent?.displayName || resolveAgent(agentSlug)?.displayName || "Agent";
  const transcript = history
    .map((entry) =>
      entry.role === "user"
        ? `User: ${entry.content}`
        : `${agentDisplayName}: ${entry.content}`,
    )
    .join("\n");

  const prompt = [
    systemPrompt,
    "",
    transcript ? `--- Conversation so far ---\n${transcript}\n--- End of history ---\n` : "",
    `User: ${message}`,
    "",
    `${agentDisplayName}:`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  // 11. Insert pending assistant message
  const { message: assistantMessage } = await insertMessage({
    conversationId: conversation.id,
    ownerId: userId,
    projectId: conversation.projectId,
    role: "assistant",
    agentSlug,
    agentInstanceId: runtimeAgent?.agentInstanceId || null,
    content: "",
    status: "streaming",
    parentMessageId: userMessage.id,
  });

  if (!assistantMessage) {
    return NextResponse.json({ error: "Failed to create assistant message" }, { status: 500 });
  }

  // 11.5. Start an agent_run record for marketplace agents (for billing audit)
  let agentRunId: string | null = null;
  if (runtimeAgent?.agentInstanceId && clerkId) {
    const runResult = await startAgentRun({
      clerkId,
      agentInstanceId: runtimeAgent.agentInstanceId,
      agentId: runtimeAgent.agentId,
      agentVersionId: runtimeAgent.agentVersionId,
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      idempotencyKey: clientRequestId,
      model: runtimeAgent.model,
    });
    agentRunId = runResult.runId;
  }

  // 12. Call the LLM provider
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

    // 13. Persist the assistant response
    await updateMessageStatus(assistantMessage.id, userId, "completed", r.text);

    // 13.5. Complete the agent_run and charge credits (marketplace agents only)
    if (agentRunId) {
      const credits = runtimeAgent
        ? estimateCredits(
            Math.ceil(prompt.length / 4), // rough token estimate
            Math.ceil(r.text.length / 4),
            1, // per 1k tokens
            1, // per run
          )
        : 0;
      void completeAgentRun(agentRunId, {
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(r.text.length / 4),
        creditsCharged: credits,
        status: "completed",
      });
    }

    // 14. Revision was already incremented atomically by the RPC at step 2

    // 15. Persist memory (project-scoped, non-blocking)
    void persistMemory(
      `User: ${message}\n${agentDisplayName}: ${r.text}`,
      userId,
      conversation.projectId,
      {
        agentSlug,
        agentInstanceId: runtimeAgent?.agentInstanceId || undefined,
        memoryNamespace: runtimeAgent?.memoryNamespace,
        conversationId: conversation.id,
        memoryType: "conversation_summary",
      },
    );

    studioLog("message:sent", {
      conversationId: conversation.id,
      projectId: conversation.projectId,
      userId,
      agentSlug,
      agentInstanceId: runtimeAgent?.agentInstanceId || null,
      provider: r.provider,
      latencyMs: r.latencyMs,
      revisionBefore: conversation.revision,
      revisionAfter: newRevision,
      memoryProvider: process.env.SUPERMEMORY_API_KEY ? "supermemory+supabase" : "supabase",
    });

    return NextResponse.json({
      userMessage,
      assistantMessage: {
        ...assistantMessage,
        content: r.text,
        status: "completed" as const,
      },
      revision: newRevision,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latencyMs,
    });
  } catch (err) {
    // Mark assistant message as failed
    await updateMessageStatus(assistantMessage.id, userId, "failed");

    // Mark the agent_run as failed
    if (agentRunId) {
      void completeAgentRun(agentRunId, {
        inputTokens: 0,
        outputTokens: 0,
        creditsCharged: 0,
        status: "failed",
        error: err instanceof Error ? err.message : "LLM provider unavailable",
      });
    }

    const errorMsg = err instanceof Error ? err.message : "LLM provider unavailable";
    studioLog("message:failed", {
      conversationId: conversation.id,
      userId,
      agentSlug,
      errorClass: errorMsg,
    });

    return NextResponse.json(
      {
        error: "Provider unavailable",
        detail: errorMsg,
        userMessage,
        assistantMessage: { ...assistantMessage, status: "failed" as const },
        revision: conversation.revision,
      },
      { status: 502 },
    );
  }
}

/**
 * GET /api/studio/conversations/[conversationId]/messages
 * Returns all messages for a conversation, scoped by owner.
 */
async function getHandler(req: NextRequest, routeCtx: RouteParams) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId: convId } = await (routeCtx?.params ?? Promise.resolve({ conversationId: "" }));
  const conversation = await getConversation(convId, userId);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await listMessages(conversation.id, userId);
  return NextResponse.json({ messages, revision: conversation.revision });
}

export const POST = withRateLimit(postHandler, 30, 60);
export const GET = withRateLimit(getHandler, 100, 60);
