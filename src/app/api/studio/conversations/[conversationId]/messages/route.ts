import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";
import { streamText, type ModelCategory, type LLMProvider } from "@/lib/llm";
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
import { reserveCredits, settleRun, estimateCredits } from "@/lib/agent-billing";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

const HISTORY_LIMIT = 12;

const TERMINAL_EXECUTION_STATES = ["available", "unavailable", "connecting", "degraded", "error"] as const;
const TERMINAL_STATES = ["disconnected", "connecting", "connected", "error"] as const;
const VOICE_INPUT_STATES = ["idle", "requesting_permission", "connecting", "listening", "error"] as const;
const VOICE_STATES = ["idle", "requesting_permission", "connecting", "listening", "user_speaking", "processing", "assistant_speaking", "muted", "error"] as const;
const VOICE_OUTPUT_STATES = ["idle", "connecting", "speaking", "error"] as const;

type RuntimeContext = {
  terminalExecution?: (typeof TERMINAL_EXECUTION_STATES)[number];
  terminalStatus?: (typeof TERMINAL_STATES)[number];
  terminalSessionId?: string | null;
  voiceTransportConnected?: boolean;
  voiceInputState?: (typeof VOICE_INPUT_STATES)[number];
  voiceMicrophoneOn?: boolean;
  voiceState?: (typeof VOICE_STATES)[number];
  voiceOutputState?: (typeof VOICE_OUTPUT_STATES)[number];
  voiceHealth?: {
    configured: boolean;
    tokenService: "healthy" | "error" | "unknown";
    available: boolean;
  };
  writeAccess?: boolean;
  activeBranch?: string;
  repositoryName?: string;
  workspaceStatus?: string;
  selectedModelLabel?: string;
  selectedModelId?: string;
};

function parseVoiceHealth(value: unknown): RuntimeContext["voiceHealth"] {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const tokenService = input.tokenService === "healthy" || input.tokenService === "error" || input.tokenService === "unknown"
    ? input.tokenService
    : "unknown";
  return {
    configured: input.configured === true,
    tokenService,
    available: input.available === true,
  };
}

function parseRuntimeContext(value: unknown): RuntimeContext {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const isValue = <T extends readonly string[]>(values: T, candidate: unknown): candidate is T[number] =>
    typeof candidate === "string" && values.includes(candidate);
  return {
    terminalExecution: isValue(TERMINAL_EXECUTION_STATES, input.terminalExecution) ? input.terminalExecution : undefined,
    terminalStatus: isValue(TERMINAL_STATES, input.terminalStatus) ? input.terminalStatus : undefined,
    terminalSessionId: typeof input.terminalSessionId === "string" && input.terminalSessionId.length <= 200
      ? input.terminalSessionId
      : null,
    voiceTransportConnected: input.voiceTransportConnected === true,
    voiceInputState: isValue(VOICE_INPUT_STATES, input.voiceInputState) ? input.voiceInputState : undefined,
    voiceMicrophoneOn: input.voiceMicrophoneOn === true,
    voiceState: isValue(VOICE_STATES, input.voiceState) ? input.voiceState : undefined,
    voiceOutputState: isValue(VOICE_OUTPUT_STATES, input.voiceOutputState) ? input.voiceOutputState : undefined,
    voiceHealth: parseVoiceHealth(input.voiceHealth),
    writeAccess: input.writeAccess === true,
    activeBranch: typeof input.activeBranch === "string" && input.activeBranch.length <= 200 ? input.activeBranch : undefined,
    repositoryName: typeof input.repositoryName === "string" && input.repositoryName.length <= 200 ? input.repositoryName : undefined,
    workspaceStatus: typeof input.workspaceStatus === "string" && input.workspaceStatus.length <= 100 ? input.workspaceStatus : undefined,
    selectedModelLabel: typeof input.selectedModelLabel === "string" && input.selectedModelLabel.length <= 100 ? input.selectedModelLabel : undefined,
    selectedModelId: typeof input.selectedModelId === "string" && input.selectedModelId.length <= 100 ? input.selectedModelId : undefined,
  };
}

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

  const runtimeContext = parseRuntimeContext(body.runtimeContext);
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
  const { message: userMessage, duplicate, error: insertError } = await insertMessage({
    conversationId: conversation.id,
    ownerId: userId,
    projectId: conversation.projectId,
    role: "user",
    content: message,
    status: "completed",
    clientRequestId,
  });

  if (!userMessage) {
    // Rollback the revision increment so the conversation isn't bricked
    // (every retry would otherwise get a 409 "Stale revision").
    await admin
      .from("studio_conversations")
      .update({ revision: expectedRevision })
      .eq("id", conversation.id)
      .eq("owner_id", userId)
      .eq("revision", newRevision);
    return NextResponse.json(
      { error: "Failed to insert message", detail: insertError || undefined },
      { status: 500 },
    );
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
    repositoryName: runtimeContext.repositoryName ?? ctx.repositoryName ?? undefined,
    activeBranch: runtimeContext.activeBranch ?? ctx.activeBranch ?? undefined,
    writeAccess: runtimeContext.writeAccess,
    workspaceStatus: runtimeContext.workspaceStatus,
    selectedModelLabel: runtimeContext.selectedModelLabel,
    terminalExecution: runtimeContext.terminalExecution ?? (ctx.capabilities.terminalConnected ? "available" : "unavailable"),
    terminalStatus: runtimeContext.terminalStatus,
    terminalSessionId: runtimeContext.terminalSessionId,
    connectedProviders: ctx.capabilities.availableTools,
    availableTools: ctx.capabilities.availableTools,
    connectionSummary: ctx.capabilities.connectionSummary,
    voiceTransportConnected: runtimeContext.voiceTransportConnected,
    voiceMicrophoneOn: runtimeContext.voiceMicrophoneOn,
    voiceInputState: runtimeContext.voiceInputState,
    voiceState: runtimeContext.voiceState,
    voiceOutputState: runtimeContext.voiceOutputState,
    voiceHealth: runtimeContext.voiceHealth,
  };
  const translated = translateCapabilities(rawCaps);

  const conversationContext = conversation.title
    ? `CURRENT CONVERSATION: "${conversation.title}"`
    : "CURRENT CONVERSATION: (untitled)";

  const systemPrompt = [
    // Use the runtime agent's version prompt for marketplace agents, or the
    // kernel system prompt for builtin agents.
    runtimeAgent?.systemPrompt || kernelSystemPrompt,
    projectBlock,
    conversationContext,
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

  // 11.5. Reserve credits BEFORE the model call (marketplace agents only)
  let agentRunId: string | null = null;
  let reservedCredits = 0;
  if (runtimeAgent?.agentInstanceId && clerkId) {
    // Estimate the maximum cost: per-run fee + estimated tokens
    const estimatedTokens = Math.ceil(prompt.length / 4) + 2048; // prompt + max output
    const estimatedCost = estimateCredits(estimatedTokens, 0, 1, 1);
    const reserveResult = await reserveCredits(
      {
        clerkId,
        agentInstanceId: runtimeAgent.agentInstanceId,
        agentId: runtimeAgent.agentId,
        agentVersionId: runtimeAgent.agentVersionId,
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        idempotencyKey: clientRequestId,
        model: runtimeAgent.model,
      },
      estimatedCost,
    );

    if (!reserveResult.ok) {
      // Insufficient balance — abort BEFORE the model call
      await updateMessageStatus(assistantMessage.id, userId, "failed");
      return NextResponse.json(
        {
          error: reserveResult.error || "Insufficient LiTTBits balance",
          detail: "This agent requires LiTTBits to run. Purchase credits in your wallet.",
          userMessage,
          assistantMessage: { ...assistantMessage, status: "failed" as const },
          revision: conversation.revision,
        },
        { status: reserveResult.status || 402 },
      );
    }

    agentRunId = reserveResult.runId;
    reservedCredits = reserveResult.reservedCredits;
  }

  const category = (body.category as ModelCategory | undefined) ?? "auto";
  const provider = typeof body.provider === "string" ? (body.provider as LLMProvider) : undefined;
  const modelOverride = typeof body.model === "string" && provider
    ? { [provider]: body.model } as Record<string, string>
    : undefined;
  const encoder = new TextEncoder();
  const event = (payload: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  const stream = new ReadableStream({
    async start(controller) {
      let assistantText = "";
      let reasoningText = "";
      try {
        const r = await streamText(
          prompt,
          (chunk) => {
            assistantText += chunk;
            controller.enqueue(event({ type: "text", text: chunk }));
          },
          {
            task: "chat",
            provider: category === "auto" ? undefined : provider,
            category,
            maxTokens: 2048,
            modelOverride,
          },
          undefined,
          (reasoning) => {
            reasoningText += reasoning;
            controller.enqueue(event({ type: "reasoning", text: reasoning }));
          },
        );

        await updateMessageStatus(assistantMessage.id, userId, "completed", assistantText);
        if (agentRunId) {
          const actualCredits = runtimeAgent
            ? estimateCredits(Math.ceil(prompt.length / 4), Math.ceil(assistantText.length / 4), 1, 1)
            : 0;
          void settleRun(agentRunId, {
            inputTokens: Math.ceil(prompt.length / 4),
            outputTokens: Math.ceil(assistantText.length / 4),
            actualCredits,
            status: "completed",
          }, reservedCredits);
        }

        void persistMemory(
          `User: ${message}\n${agentDisplayName}: ${assistantText}`,
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

        controller.enqueue(event({
          type: "done",
          userMessage,
          assistantMessage: {
            ...assistantMessage,
            content: assistantText,
            reasoning: reasoningText || undefined,
            status: "completed",
          },
          revision: newRevision,
          provider: r.provider,
          model: r.model,
          latencyMs: r.latencyMs,
        }));
      } catch (err) {
        await updateMessageStatus(assistantMessage.id, userId, "failed");
        if (agentRunId) {
          void settleRun(agentRunId, {
            inputTokens: 0,
            outputTokens: 0,
            actualCredits: 0,
            status: "failed",
            error: err instanceof Error ? err.message : "LLM provider unavailable",
          }, reservedCredits);
        }
        const errorMsg = err instanceof Error ? err.message : "LLM provider unavailable";
        studioLog("message:failed", {
          conversationId: conversation.id,
          userId,
          agentSlug,
          errorClass: errorMsg,
        });
        controller.enqueue(event({
          type: "error",
          message: "Provider unavailable",
          partialText: assistantText || undefined,
        }));
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/**
 * GET /api/studio/conversations/[conversationId]/messages
 * Returns all messages for a conversation, scoped by owner.
 */
async function getHandler(req: NextRequest, routeCtx: RouteParams) {
  const { userId } = await auth(req);
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

export const POST = withRateLimit(postHandler, 60, 60);
export const GET = withRateLimit(getHandler, 200, 60);
