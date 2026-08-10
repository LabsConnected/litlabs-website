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
import { buildStudioContext } from "@/lib/studio/project-resolver";
import { recallMemories, persistMemory, formatMemoryContext } from "@/lib/studio/memory-service";
import { studioLog } from "@/lib/studio/logger";
import type { AgentSlug } from "@/lib/studio/types";
import { parseAgentSelection } from "@/lib/agent-selection";
import { resolveRuntimeAgent, type RuntimeAgent } from "@/lib/agent-runtime";
import { reserveCredits, settleRun, estimateCredits } from "@/lib/agent-billing";
import {
  buildPrompt,
  buildRunContextFromStudio,
  parseRuntimeContextHint,
  HISTORY_LIMIT,
} from "@/lib/litt-runtime";
import { runAgentLoop } from "@/lib/litt-intelligence/agent-loop";
import { runAgentLoopV2, type AgentLoopConfig } from "@/lib/litt-intelligence/agent-loop-v2";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { createPausedRun } from "@/lib/litt-intelligence/paused-run-store";
import { resolveTurn } from "@/lib/litt-intelligence/turn-resolver";
import {
  buildCanonicalRuntimeContext,
  buildRuntimeContextBlock,
  type ClientRuntimeHint,
} from "@/lib/litt-intelligence/canonical-runtime-context";
import { detectAndExecuteTool } from "@/lib/litt-intelligence/tool-executor";
import type { ConversationTurn } from "@/lib/litt-intelligence/turn-resolver";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteParams {
  params: Promise<{ conversationId: string }>;
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

  const runtimeContext = parseRuntimeContextHint(body.runtimeContext);
  const message = body.message;
  const clientRequestId = body.clientRequestId;
  const expectedRevision = body.expectedRevision;
  const requestedAgentSlug = body.requestedAgentSlug;
  const agentInstanceId = body.agentInstanceId;
  const executionMode = typeof body.executionMode === "string" && ["plan", "act", "auto"].includes(body.executionMode)
    ? (body.executionMode as "plan" | "act" | "auto")
    : undefined;

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

  // 5.5. Build canonical runtime context — the ONE authoritative source
  // of runtime state for LiTT. Merges server-side workspace verification
  // with client-side terminal PTY status. The LLM must never guess.
  const clientHint: ClientRuntimeHint = {
    terminalStatus: runtimeContext.terminalStatus,
    terminalSessionId: runtimeContext.terminalSessionId,
    terminalCwd: runtimeContext.terminalCwd,
    workspaceStatus: runtimeContext.workspaceStatus,
    voiceTransportConnected: runtimeContext.voiceTransportConnected,
    cameraActive: runtimeContext.cameraActive,
  };
  const canonicalCtx = await buildCanonicalRuntimeContext(
    userId,
    conversation.projectId,
    clientHint,
    { executionMode },
  );
  const runtimeContextBlock = buildRuntimeContextBlock(canonicalCtx);

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

  // 7.5. Resolve ambiguous references in the user message using conversation history.
  // Expands "it", "that", "same thing", "why", etc. into self-contained messages.
  const turnResolution = resolveTurn(message, history);
  const resolvedMessage = turnResolution.resolved;

  // 7.6. Real-time tool execution (weather, web search, etc.)
  // Runs BEFORE the agent loop. If a tool fires, the live result is returned
  // directly and the LLM is never called — LiTT must never guess real-time data.
  const toolResult = await detectAndExecuteTool(userId, resolvedMessage, {
    headers: req.headers,
    history,
  });

  if (toolResult.executed) {
    // Insert assistant message with the tool result
    const { message: toolAssistantMessage } = await insertMessage({
      conversationId: conversation.id,
      ownerId: userId,
      projectId: conversation.projectId,
      role: "assistant",
      agentSlug,
      agentInstanceId: runtimeAgent?.agentInstanceId || null,
      content: toolResult.text,
      status: "completed",
      parentMessageId: userMessage.id,
    });

    if (!toolAssistantMessage) {
      return NextResponse.json({ error: "Failed to create assistant message" }, { status: 500 });
    }

    // Persist memory for tool results too
    void persistMemory(
      `User: ${message}\nLiTT: ${toolResult.text}`,
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
      provider: toolResult.metadata.provider,
      latencyMs: 0,
      revisionBefore: conversation.revision,
      revisionAfter: newRevision,
      tool: toolResult.toolId,
    });

    // Stream the tool result through the same SSE protocol the frontend consumes
    const toolEncoder = new TextEncoder();
    const toolEvent = (payload: Record<string, unknown>) =>
      toolEncoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
    const toolStream = new ReadableStream({
      start(controller) {
        controller.enqueue(toolEvent({ type: "text", text: toolResult.text }));
        controller.enqueue(toolEvent({
          type: "tool_execution",
          toolId: toolResult.toolId,
          success: true,
          metadata: toolResult.metadata,
        }));
        controller.enqueue(toolEvent({
          type: "done",
          userMessage,
          assistantMessage: {
            ...toolAssistantMessage,
            content: toolResult.text,
            status: "completed",
          },
          revision: newRevision,
          toolMetadata: toolResult.metadata,
        }));
        controller.enqueue(toolEncoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(toolStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // 8. Recall project-scoped memories
  const memories = await recallMemories(message, userId, conversation.projectId, {
    agentSlug,
    agentInstanceId: runtimeAgent?.agentInstanceId || undefined,
    memoryNamespace: runtimeAgent?.memoryNamespace,
    limit: 5,
  });
  const memoryContext = formatMemoryContext(memories);

  // 9. Build the prompt via the shared LiTT runtime prompt-builder.
  // The runtime owns Kernel routing, capability translation, project
  // context, memory context, and transcript assembly — the route only
  // owns the revision RPC and message persistence.
  const runCtx = buildRunContextFromStudio({
    userId,
    clerkId,
    studioCtx: ctx,
    history,
    memoryContext,
    runtimeContextHint: runtimeContext,
    agentInstanceId: runtimeAgent?.agentInstanceId ?? undefined,
    workspaceExecutionAvailable: canonicalCtx.workspaceExecutionAvailable,
  });

  const built = buildPrompt(runCtx, {
    message: resolvedMessage,
    agentSlug,
    agentInstanceId: runtimeAgent?.agentInstanceId ?? undefined,
  }, runtimeAgent);

  const prompt = built.fullPrompt + "\n\n" + runtimeContextBlock;
  const agentDisplayName = built.agentDisplayName;

  // 10.5. Agent Loop — V2 when workspace execution is available, V1 fallback otherwise.
  //
  // V2 is the full multi-step tool-calling loop with native structured tool calls,
  // loop detection, checkpoints, and build-fix. It produces the final assistant
  // response directly — no second LLM call is needed.
  //
  // V1 is the pre-LLM auto-inspection phase. It only enriches the prompt with
  // read-only tool results, then a normal LLM completion runs. This is the
  // fallback when no executable workspace is available.
  //
  // TEMPORARY FALLBACK: V1 is used when workspaceExecutionAvailable is false.
  // This fallback is marked for eventual removal once all chat paths require
  // a verified workspace.

  const useV2 = canonicalCtx.workspaceExecutionAvailable && !!conversation.projectId;

  let v2Result: Awaited<ReturnType<typeof runAgentLoopV2>> | null = null;
  let v1Result: Awaited<ReturnType<typeof runAgentLoop>> | null = null;
  let finalPrompt = prompt;

  if (useV2) {
    // Create workspace transport for V2 tool execution
    let transport;
    try {
      transport = await createWorkspaceTransport(conversation.projectId!, userId);
    } catch (_err) {
      // Transport creation failed (workspace not provisioned, DB error, etc.)
      // Fall back to V1
      v1Result = await runAgentLoop(resolvedMessage, conversation.projectId ?? "", prompt);
      finalPrompt = v1Result.enrichedPrompt;
    }

    if (transport) {
      const v2Config: Partial<AgentLoopConfig> = {
        systemPrompt: prompt,
        executionMode: canonicalCtx.executionMode,
        enableBuildFix: true,
        model: typeof body.model === "string" ? body.model : undefined,
      };

      v2Result = await runAgentLoopV2(resolvedMessage, transport, v2Config);
    }
  } else {
    // V1 fallback — no executable workspace, read-only inspection only
    v1Result = await runAgentLoop(resolvedMessage, conversation.projectId ?? "", prompt);
    finalPrompt = v1Result.enrichedPrompt;
  }

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
    const estimatedTokens = Math.ceil(finalPrompt.length / 4) + 2048; // prompt + max output
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
        if (v2Result) {
          // ── V2 path: stream progress events, then emit finalText ──
          // V2 already did all LLM calls with tool calling. Its finalText
          // IS the assistant response. No second LLM call.

          // Stream sanitized progress events (never chain-of-thought)
          for (const evt of v2Result.events) {
            if (evt.type === "tool_start") {
              controller.enqueue(event({ type: "tool_execution", toolId: evt.toolId, summary: evt.summary }));
            } else if (evt.type === "tool_result") {
              controller.enqueue(event({
                type: "tool_execution",
                toolId: evt.toolId,
                success: evt.success,
                summary: evt.summary,
              }));
            } else if (evt.type === "approval_required") {
              controller.enqueue(event({
                type: "approval_required",
                toolId: evt.toolId,
                reason: evt.reason,
              }));
            } else if (evt.type === "checkpoint") {
              controller.enqueue(event({ type: "checkpoint", label: evt.label, gitSha: evt.gitSha }));
            } else if (evt.type === "build_start") {
              controller.enqueue(event({ type: "build_start", check: evt.check }));
            } else if (evt.type === "build_result") {
              controller.enqueue(event({ type: "build_result", check: evt.check, passed: evt.passed }));
            } else if (evt.type === "phase") {
              controller.enqueue(event({ type: "phase", phase: evt.phase, step: evt.step }));
            }
          }

          // Stream the final text as a single chunk
          assistantText = v2Result.finalText;
          controller.enqueue(event({ type: "text", text: assistantText }));

          // If V2 paused for approval, persist the paused state and flag it
          let pausedRunId: string | undefined;
          if (v2Result.pendingApproval) {
            try {
              const pausedRun = await createPausedRun({
                userId,
                conversationId: conversation.id,
                projectId: conversation.projectId ?? "",
                workspaceId: canonicalCtx.workspaceId ?? "",
                toolId: v2Result.pendingApproval.toolId,
                toolCallId: v2Result.pendingApproval.toolCallId,
                inputs: v2Result.pendingApproval.inputs,
                reason: v2Result.pendingApproval.reason,
                pausedMessages: v2Result.pendingApproval.pausedMessages,
                executionMode: canonicalCtx.executionMode,
                systemPrompt: prompt,
                checkpointId: v2Result.checkpoint?.checkpointId ?? null,
              });
              pausedRunId = pausedRun.id;
            } catch {
              // If persistence fails, still send the approval event without a resume ID
            }

            controller.enqueue(event({
              type: "pending_approval",
              toolId: v2Result.pendingApproval.toolId,
              reason: v2Result.pendingApproval.reason,
              inputs: v2Result.pendingApproval.inputs,
              pausedRunId,
            }));
          }

          await updateMessageStatus(assistantMessage.id, userId, "completed", assistantText);
          if (agentRunId) {
            const actualCredits = runtimeAgent
              ? estimateCredits(Math.ceil(finalPrompt.length / 4), Math.ceil(assistantText.length / 4), 1, 1)
              : 0;
            void settleRun(agentRunId, {
              inputTokens: Math.ceil(finalPrompt.length / 4),
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
            provider: "openrouter-v2",
            latencyMs: v2Result.totalDurationMs,
            revisionBefore: conversation.revision,
            revisionAfter: newRevision,
            v2: true,
            stepsUsed: v2Result.stepsUsed,
            toolCalls: v2Result.toolCalls.length,
          });

          controller.enqueue(event({
            type: "done",
            userMessage,
            assistantMessage: {
              ...assistantMessage,
              content: assistantText,
              status: "completed",
            },
            revision: newRevision,
            provider: "openrouter-v2",
            latencyMs: v2Result.totalDurationMs,
            v2: true,
            pendingApproval: v2Result.pendingApproval ?? undefined,
          }));
        } else {
          // ── V1 fallback path: stream tool results, then run LLM ──
          if (v1Result?.ranTools) {
            for (const exec of v1Result.toolExecutions) {
              controller.enqueue(event({
                type: "tool_execution",
                toolId: exec.toolId,
                success: exec.success,
                summary: exec.summary,
              }));
            }
          }

          const r = await streamText(
            finalPrompt,
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
              ? estimateCredits(Math.ceil(finalPrompt.length / 4), Math.ceil(assistantText.length / 4), 1, 1)
              : 0;
            void settleRun(agentRunId, {
              inputTokens: Math.ceil(finalPrompt.length / 4),
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
            v2: false,
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
        }
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
          message: errorMsg,
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
