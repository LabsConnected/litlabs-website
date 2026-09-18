import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getSupabaseAdmin } from "@/lib/supabase";
import { streamText, isEmptyProviderResponse, type ModelCategory, type LLMProvider } from "@/lib/llm";
import {
  getConversation,
  listMessages,
  insertMessage,
  updateMessageStatus,
} from "@/lib/studio/conversation-service";
import { resolveAgent, isValidAgentSlug } from "@/lib/studio/agent-registry";
import { buildStudioContext } from "@/lib/studio/project-resolver";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { recallMemories, persistMemory, formatMemoryContext, harvestUserPreferences } from "@/lib/studio/memory-service";
import { studioLog } from "@/lib/studio/logger";
import type { AgentSlug, MessageStatus } from "@/lib/studio/types";
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
import { findToolCallMarkup, stripToolCallMarkupText } from "@/lib/litt-intelligence/tool-call-markup";
import { withV1NoToolsDirective } from "@/lib/litt-intelligence/text-lane-guard";
import { sanitizeTextLaneHistory } from "@/lib/litt-intelligence/toolless-lane-guard";
import { runLaunchFlow, type LaunchFlowResult } from "@/lib/litt-intelligence/launch-flow";
import { shouldEnableQualityLoop } from "@/lib/litt-intelligence/quality-loop-flow";
import { ProgressEmitter, type ProgressEvent } from "@/lib/litt-intelligence/progress-events";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { createPausedRun, getLatestPausedRunForConversation, getPendingPausedRunForConversation, pausedRunBelongsToMessage } from "@/lib/litt-intelligence/paused-run-store";
import { getActiveExecution, registerExecution, unregisterExecution } from "@/lib/studio/execution-registry";
import { resolveTurn } from "@/lib/litt-intelligence/turn-resolver";
import {
  buildCanonicalRuntimeContext,
  buildRuntimeContextBlock,
  type ClientRuntimeHint,
} from "@/lib/litt-intelligence/canonical-runtime-context";
import { detectAndExecuteTool } from "@/lib/litt-intelligence/tool-executor";
import { deploymentEvidenceFrom } from "@/lib/studio/completion-evidence";
import type { ConversationTurn } from "@/lib/litt-intelligence/turn-resolver";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

// A streamed assistant message is only live while the canonical execution
// registry or the persisted approval record says so. If a process dies after
// inserting the message, leaving it as "streaming" would render a permanent
// "LiTT is thinking" bubble on the next load.
const STALE_STREAMING_MESSAGE_MS = 2 * 60 * 1000;

// Anaphoric follow-ups ("build it", "do that again but lime") name no target.
// With a project in context, steer the model to ask a short, targeted
// clarification about what to do on the project instead of a generic chat reply.
const ANAPHORIC_CLARIFICATION_NUDGE =
  "The user's latest message is an anaphoric follow-up — it references prior " +
  "context (words like 'it', 'that', or 'again') and names no explicit target. " +
  "Do not give a generic chat reply. Ask one short, targeted clarification " +
  "question about what specifically they want built or changed on their project.";

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
  const rawPreviewSelection = body.previewSelection;
  const previewSelection = rawPreviewSelection && typeof rawPreviewSelection === "object"
    ? rawPreviewSelection as { label?: unknown; selector?: unknown; tagName?: unknown }
    : null;
  const selectedPreviewLabel = typeof previewSelection?.label === "string" ? previewSelection.label.slice(0, 80) : null;
  const selectedPreviewSelector = typeof previewSelection?.selector === "string" ? previewSelection.selector.slice(0, 240) : null;
  const selectedPreviewTag = typeof previewSelection?.tagName === "string" ? previewSelection.tagName.slice(0, 32) : null;

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

  // 5. Resolve project server-side.
  // Try the conversation's projectId first. If it's stale (project deleted,
  // user switched projects, or the conversation references a different user's
  // project), fall back to the canonical active project via
  // resolveCurrentProject. This prevents the "LiTT can't find the project"
  // divergence where the Studio UI shows a connected project but the agent
  // chat returns 404 because conversation.projectId no longer resolves.
  let ctx = await buildStudioContext(userId, conversation.id, conversation.projectId, agentSlug);
  let effectiveProjectId = conversation.projectId;

  if (!ctx) {
    // Stale conversation.projectId — try the active project
    const activeProject = await resolveCurrentProject({ userId });
    if (activeProject && activeProject.projectId !== conversation.projectId) {
      ctx = await buildStudioContext(userId, conversation.id, activeProject.projectId, agentSlug);
      if (ctx) {
        effectiveProjectId = activeProject.projectId;
        // Update the conversation's projectId so future messages use the
        // corrected project. This is a one-time fix — subsequent messages
        // will resolve directly.
        await admin
          .from("studio_conversations")
          .update({ project_id: activeProject.projectId })
          .eq("id", conversation.id)
          .eq("owner_id", userId);
      }
    }
  }

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
    effectiveProjectId,
    clientHint,
    { executionMode },
  );
  const runtimeContextBlock = buildRuntimeContextBlock(canonicalCtx);

  // 6. Load prior completed messages from DB (excluding the just-inserted user message)
  const allMessages = await listMessages(conversation.id, userId);
  const priorMessages = allMessages.filter((m) => m.id !== userMessage.id);

  // 7. Build model history in chronological order.
  // V1 text-lane hygiene: this lane calls the model with NO tools
  // attached, so a pseudo tool call persisted by an earlier turn would
  // re-prime the model to emit envelope markup again mid-conversation.
  // Strip envelope markup from assistant turns before history reaches the
  // prompt (user turns and backtick-quoted examples are preserved). The
  // V2 native lane performs its own strip in buildAssistantToolCallMessage.
  const history = sanitizeTextLaneHistory(
    priorMessages
      .filter((m) => m.status === "completed" && (m.role === "user" || m.role === "assistant"))
      .slice(-HISTORY_LIMIT)
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
  );

  // 7.5. Resolve ambiguous references in the user message using conversation history.
  // Expands "it", "that", "same thing", "why", etc. into self-contained messages.
  const turnResolution = resolveTurn(message, history);
  const resolvedMessage = selectedPreviewLabel
    ? `${turnResolution.resolved}\n\n[Preview selection context]\nThe user selected the ${selectedPreviewLabel} element in the live preview${selectedPreviewTag ? ` (<${selectedPreviewTag}>)` : ""}. Use this element as the subject of the requested change. Preview selector: ${selectedPreviewSelector ?? "not available"}.`
    : turnResolution.resolved;

  // 7.5.5. Harvest user preferences (non-blocking, best-effort).
  // Extracts name, city, timezone from natural conversation. Dedupe is handled
  // by persistMemory's dedupe_key — no duplicate writes for the same info.
  // Wrapped in try/catch to prevent unhandled rejections from leaking.
  if (conversation.projectId) {
    harvestUserPreferences(resolvedMessage, userId, conversation.projectId, {
      agentSlug,
      conversationId: conversation.id,
    }).catch(() => {
      // Best-effort — preference harvesting failure must not break the chat
    });
  }

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

    // Persist memory for tool results too (best-effort, no unhandled rejection)
    persistMemory(
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
    ).catch(() => {
      // Best-effort — memory persistence failure must not break the chat
    });

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
    conversationId: conversation.id,
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

  const useV2 = canonicalCtx.workspaceExecutionAvailable
    && !!conversation.projectId
    && !!built.kernelResult.decision.routing.requiresExecution;

  let v2Result: Awaited<ReturnType<typeof runAgentLoopV2>> | null = null;
  let launchFlowResult: LaunchFlowResult | null = null;
  let v1Result: Awaited<ReturnType<typeof runAgentLoop>> | null = null;
  let finalPrompt = prompt;

  // Prepare the workspace transport BEFORE the stream starts, for both
  // the V2 loop and the V1 pre-LLM auto-inspection. Workspace-scoped tools
  // require this transport — without it they fail closed rather than
  // touching the web service's own filesystem.
  // The actual V2 loop runs INSIDE the stream so events stream in real-time.
  let v2Transport: Awaited<ReturnType<typeof createWorkspaceTransport>> | null = null;
  let v2Config: Partial<AgentLoopConfig> | null = null;

  if (conversation.projectId && canonicalCtx.workspaceExecutionAvailable) {
    try {
      v2Transport = await createWorkspaceTransport(conversation.projectId, userId);
    } catch (transportErr) {
      // Transport creation failed — fall back to V1 with visible logging
      // so operators can detect workspace issues (not silently swallowed).
      studioLog("message:v2_transport_failed", {
        conversationId: conversation.id,
        projectId: conversation.projectId,
        userId,
        errorClass: transportErr instanceof Error ? transportErr.message : "unknown",
      });
    }
  }

  // Execution-required turns must never fall through to the read-only V1
  // inspection + text-only stream. That path cannot execute mutations and
  // would expose model pseudo-tool markup as if it were an answer.
  if (built.kernelResult.decision.routing.requiresExecution && !(useV2 && v2Transport)) {
    studioLog("message:tool_execution_unavailable", {
      conversationId: conversation.id,
      projectId: conversation.projectId,
    });
    return NextResponse.json(
      {
        error: "Tool execution unavailable for this task",
        code: "TOOL_EXECUTION_UNAVAILABLE",
        detail: "No verified workspace execution path is available. The request was not sent to a text-only model.",
        projectId: conversation.projectId ?? null,
        workspaceId: canonicalCtx.workspaceId ?? null,
      },
      { status: 409 },
    );
  }

  if (useV2 && v2Transport) {
    v2Config = {
      systemPrompt: built.systemPrompt + "\n\n" + runtimeContextBlock,
      executionMode: canonicalCtx.executionMode,
      enableBuildFix: true,
      model: typeof body.model === "string" ? body.model : undefined,
      // Quality loop: gate serious ACT/AUTO-mode builds through the
      // UNDERSTAND→VERIFY evidence stages + visual-quality judge.
      qualityLoop: shouldEnableQualityLoop(canonicalCtx.executionMode, conversation.projectId)
        ? {
            enabled: true,
            runId: randomUUID(),
            projectId: conversation.projectId,
            userId,
            userRequest: resolvedMessage.slice(0, 2000),
          }
        : undefined,
      evalMetadata: {
        agentSlug,
        agentMode: "v2-execution",
        conversationId: conversation.id,
        userId,
        projectId: conversation.projectId ?? undefined,
      },
    };
  } else {
    // V1 fallback — read-only inspection only. Pass the transport (when a
    // workspace exists) so auto-inspection reads the user's real workspace.
    v1Result = await runAgentLoop(
      resolvedMessage,
      conversation.projectId ?? "",
      prompt,
      v2Transport ?? undefined,
    );
    finalPrompt = v1Result.enrichedPrompt;
    // Anaphoric follow-up with a project in context: don't let this fall
    // through to a generic chat reply — nudge toward a targeted clarification.
    if (conversation.projectId && built.kernelResult.decision.routing.anaphoricFollowUp) {
      finalPrompt = `${ANAPHORIC_CLARIFICATION_NUDGE}\n\n${finalPrompt}`;
    }
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
  let reservationId: string | null = null;
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
    reservationId = reserveResult.reservationId;
  }

  const category = (body.category as ModelCategory | undefined) ?? "auto";
  const provider = typeof body.provider === "string" ? (body.provider as LLMProvider) : undefined;
  const modelOverride = typeof body.model === "string" && provider
    ? { [provider]: body.model } as Record<string, string>
    : undefined;

  const encoder = new TextEncoder();
  const event = (payload: Record<string, unknown>) =>
    encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  // Correlation ID for structured diagnostics — shared across start/cancel
  const rid = `${conversation.id.slice(0, 8)}-${Date.now().toString(36)}`;

  // ── Transport lifetime ≠ execution lifetime ──
  //
  // TRANSPORT state covers the browser request (req.signal) and the SSE
  // ReadableStream consumer. Losing it only means nobody is reading events
  // anymore — it must NEVER abort the LiTT run. Mobile browsers routinely
  // suspend connections mid-build; a dropped socket must not kill the
  // server-side execution, its tool calls, or its persistence.
  //
  // EXECUTION state is governed by a dedicated AbortController registered
  // in the execution registry. Only explicit, authenticated cancellation
  // (POST .../cancel), an intentional execution deadline, or controlled
  // server shutdown may abort it.
  const executionAbort = new AbortController();
  let transportOpen = true;
  const markTransportDetached = (via: string) => {
    if (!transportOpen) return;
    transportOpen = false;
    console.error(`[messages-route:${rid}] transport detached via ${via}; execution continues server-side`);
    studioLog("message:transport_detached", {
      requestId: rid,
      conversationId: conversation.id,
      projectId: conversation.projectId,
      userId,
      clientRequestId,
    });
  };
  const onReqAbort = () => markTransportDetached("req_signal");
  if (req.signal) {
    if (req.signal.aborted) {
      markTransportDetached("req_signal");
    } else {
      req.signal.addEventListener("abort", onReqAbort, { once: true });
    }
  }
  const stream = new ReadableStream({
    async start(controller) {
      console.error(`[messages-route:${rid}] stream opened`);

      // Register the execution so an explicit, authenticated Stop can reach
      // it via the cancel endpoint. Transport loss alone never touches this.
      const { key: executionKey } = registerExecution({
        conversationId: conversation.id,
        userId,
        clientRequestId,
        assistantMessageId: assistantMessage.id,
        controller: executionAbort,
      });

      // Safe enqueue — no-ops once the transport is detached so a dead
      // connection doesn't spam enqueue exceptions or abort execution.
      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (!transportOpen) return false;
        try {
          controller.enqueue(chunk);
          return true;
        } catch {
          markTransportDetached("enqueue_failed");
          return false;
        }
      };
      const safeEvent = (payload: Record<string, unknown>): boolean =>
        safeEnqueue(event(payload));

      // Heartbeat — emits SSE comments every 15s to prevent proxy idle timeouts
      // (Cloudflare/Railway close connections after ~100s of inactivity)
      const heartbeatTimer = setInterval(() => {
        if (!transportOpen) {
          clearInterval(heartbeatTimer);
          return;
        }
        safeEnqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);

      let assistantText = "";
      let reasoningText = "";
      // Actual provider that produced the last model response — surfaced
      // through model_routing events from the provider-neutral router.
      let routedProvider = "auto";
      let routedModel: string | undefined;
      try {
        if (v2Transport && v2Config) {
          // ── V2 path: run agent loop INSIDE the stream with real-time events ──
          // The ProgressEmitter streams events to the SSE controller as they
          // happen, so the user can watch LiTT work in real-time.

          const streamProgress = new ProgressEmitter((evt: ProgressEvent) => {
            // Stream each event to the client immediately
            if (evt.type === "tool_start") {
              safeEvent({ type: "tool_execution", toolId: evt.toolId, summary: evt.summary });
            } else if (evt.type === "tool_result") {
              safeEvent({
                type: "tool_execution",
                toolId: evt.toolId,
                success: evt.success,
                summary: evt.summary,
                durationMs: evt.durationMs,
              });
            } else if (evt.type === "approval_required") {
              safeEvent({
                type: "approval_required",
                toolId: evt.toolId,
                reason: evt.reason,
              });
            } else if (evt.type === "checkpoint") {
              safeEvent({ type: "checkpoint", label: evt.label, gitSha: evt.gitSha });
            } else if (evt.type === "build_start") {
              safeEvent({ type: "build_start", check: evt.check });
            } else if (evt.type === "build_result") {
              safeEvent({ type: "build_result", check: evt.check, passed: evt.passed, errorCount: evt.errorCount });
            } else if (evt.type === "phase") {
              safeEvent({ type: "phase", phase: evt.phase, step: evt.step });
            } else if (evt.type === "finished") {
              safeEvent({ type: "finished", totalSteps: evt.totalSteps, totalDurationMs: evt.totalDurationMs });
            } else if (evt.type === "cancelled") {
              safeEvent({ type: "cancelled", reason: evt.reason });
            } else if (evt.type === "model_routing") {
              routedProvider = evt.provider;
              routedModel = evt.model;
              safeEvent({
                type: "model_routing",
                model: evt.model,
                provider: evt.provider,
                fallbackFrom: evt.fallbackFrom,
                category: evt.category,
                latencyMs: evt.latencyMs,
              });
            } else if (evt.type === "model_response") {
              safeEvent({
                type: "model_response",
                provider: evt.provider,
                model: evt.model,
                finishReason: evt.finishReason,
                contentType: evt.contentType,
                contentLength: evt.contentLength,
                messageKeys: evt.messageKeys,
                toolCalls: evt.toolCalls,
              });
            } else if (evt.type === "model_failed") {
              safeEvent({
                type: "model_failed",
                model: evt.model,
                category: evt.category,
                message: evt.message,
              });
            } else if (evt.type === "reasoning") {
              safeEvent({ type: "reasoning", summary: evt.summary });
            } else if (evt.type === "status") {
              safeEvent({ type: "status", summary: evt.summary });
            } else if (evt.type === "repair_attempt") {
              safeEvent({ type: "repair_attempt", attempt: evt.attempt, maxAttempts: evt.maxAttempts });
            } else if (evt.type === "preview_start") {
              safeEvent({ type: "preview_start" });
            } else if (evt.type === "preview_status") {
              safeEvent({ type: "preview_status", status: evt.status, healthy: evt.healthy });
            } else if (evt.type === "preview_result") {
              safeEvent({ type: "preview_result", success: evt.success, previewUrl: evt.previewUrl, error: evt.error });
            } else if (evt.type === "deploy_start") {
              safeEvent({ type: "deploy_start", environment: evt.environment, provider: evt.provider });
            } else if (evt.type === "deploy_status") {
              safeEvent({ type: "deploy_status", status: evt.status, deploymentId: evt.deploymentId });
            } else if (evt.type === "deploy_result") {
              safeEvent({ type: "deploy_result", success: evt.success, productionUrl: evt.productionUrl, error: evt.error });
            } else if (evt.type === "deploy_verify") {
              safeEvent({ type: "deploy_verify", url: evt.url, success: evt.success, detail: evt.detail });
            }
          });

          // Run the full launch flow: plan → build → preview → deploy.
          // This keeps V2 execution bounded, truthful, and auto-repairing.
          launchFlowResult = await runLaunchFlow({
            userMessage: resolvedMessage,
            projectId: conversation.projectId ?? "",
            userId,
            transport: v2Transport,
            systemPrompt: v2Config.systemPrompt,
            model: v2Config.model,
            executionMode: v2Config.executionMode,
            enableBuildFix: true,
            // Quality loop: the launch flow passes this to the main agent-loop
            // phase (it was silently dropped before AUTO-mode support).
            qualityLoop: v2Config.qualityLoop,
            enableDeploy: built.kernelResult.decision.routing.mode === "ship",
            requiresExecution: built.kernelResult.decision.routing.requiresExecution,
            // A production execution request is not complete until the
            // agent-created website entry file is physically present in the
            // verified workspace. This is enforced again after approval
            // resume by the approvals route.
            requireProjectArtifacts: built.kernelResult.decision.routing.requiresExecution,
            evalMetadata: v2Config.evalMetadata,
            progress: streamProgress,
            signal: executionAbort.signal,
          });

          v2Result = launchFlowResult.agentLoopResult ?? null;

          // Stream the final text
          assistantText = launchFlowResult.finalText;
          safeEvent({ type: "text", text: assistantText });

          // If V2 paused for approval, persist the paused state and flag it
          let pausedRunId: string | undefined;
          let pausedRunPersistFailed = false;
          if (v2Result?.pendingApproval) {
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
                systemPrompt: built.systemPrompt + "\n\n" + runtimeContextBlock,
                checkpointId: v2Result.checkpoint?.checkpointId ?? null,
                qualityLoopState: v2Result.qualityLoopState,
                deferredToolCalls: v2Result.pendingApproval.deferredToolCalls,
                stepsUsed: v2Result.pendingApproval.stepsUsedAtPause,
                hadInterveningMutation: v2Result.pendingApproval.hadInterveningMutationAtPause,
              });
              pausedRunId = pausedRun.id;
            } catch (pausedErr) {
              // If persistence fails, the gate cannot be resumed — there is
              // no pausedRunId for the Approve button to act on. Emitting
              // pending_approval anyway would mount a dead card that can
              // never resolve (2026-09-18 defect: the transcript reconciler
              // then attributed a stale expired run to this message and
              // told the user the approval "expired before a decision was
              // made" within seconds). Fail the turn honestly instead.
              pausedRunPersistFailed = true;
              studioLog("message:paused_run_persist_failed", {
                conversationId: conversation.id,
                projectId: conversation.projectId,
                userId,
                tool: v2Result.pendingApproval.toolId,
                errorClass: pausedErr instanceof Error ? pausedErr.message : "unknown",
              });
            }

            if (!pausedRunPersistFailed) {
              safeEvent({
                type: "pending_approval",
                toolId: v2Result.pendingApproval.toolId,
                reason: v2Result.pendingApproval.reason,
                inputs: v2Result.pendingApproval.inputs,
                pausedRunId,
              });
            }
          }

          // An approval gate that could not be persisted is not actionable —
          // surface it as a failed turn, never as a phantom approval card.
          const actionableApproval = v2Result?.pendingApproval && !pausedRunPersistFailed
            ? v2Result.pendingApproval
            : undefined;
          if (pausedRunPersistFailed) {
            assistantText = "I needed your approval to continue, but the approval request couldn't be saved. Please send your request again and I'll ask for approval once more.";
          }

          // A run that produced no response text cannot be reported as
          // completed — empty provider output is a failure, not success.
          // (A persist-failed approval is not "empty": it failed honestly.)
          const v2Empty = !launchFlowResult?.cancelled
            && !actionableApproval
            && !assistantText.trim();

          const finalMessageStatus: MessageStatus = launchFlowResult?.cancelled
            ? "cancelled"
            : actionableApproval
              ? "awaiting_approval"
              : launchFlowResult?.success && !v2Empty && !pausedRunPersistFailed
                ? "completed"
                : "failed";

          await updateMessageStatus(assistantMessage.id, userId, finalMessageStatus, assistantText);
          if (agentRunId) {
            const actualCredits = runtimeAgent
              ? estimateCredits(Math.ceil(finalPrompt.length / 4), Math.ceil(assistantText.length / 4), 1, 1)
              : 0;
            settleRun(agentRunId, {
              inputTokens: Math.ceil(finalPrompt.length / 4),
              outputTokens: Math.ceil(assistantText.length / 4),
              actualCredits,
              status: finalMessageStatus === "completed"
                ? "completed"
                : finalMessageStatus === "cancelled"
                  ? "cancelled"
                  : "failed",
            }, reservedCredits, reservationId).catch(() => {
              // Best-effort settlement — must not leak unhandled rejection
            });
          }

          // A cancelled run's partial output must not be persisted as a
          // normal conversation_summary — it would pollute long-term
          // memory with truncated work. Persist memory only for runs that
          // reached a non-cancelled terminal state.
          if (finalMessageStatus !== "cancelled") {
            persistMemory(
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
            ).catch(() => {
              // Best-effort memory persistence — must not leak unhandled rejection
            });
          }

          const launchLatencyMs = launchFlowResult?.totalDurationMs ?? v2Result?.totalDurationMs ?? 0;
          const launchSteps = v2Result?.stepsUsed ?? 0;
          const launchToolCalls = v2Result?.toolCalls.length ?? 0;

          studioLog("message:sent", {
            conversationId: conversation.id,
            projectId: conversation.projectId,
            userId,
            agentSlug,
            agentInstanceId: runtimeAgent?.agentInstanceId || null,
            provider: routedProvider,
            model: routedModel,
            latencyMs: launchLatencyMs,
            revisionBefore: conversation.revision,
            revisionAfter: newRevision,
            v2: true,
            stepsUsed: launchSteps,
            toolCalls: launchToolCalls,
          });

          safeEvent({
            type: "done",
            userMessage,
            assistantMessage: {
              ...assistantMessage,
              content: assistantText,
              status: finalMessageStatus,
              // `status` describes the MESSAGE STREAM only (completed/failed/cancelled/awaiting_approval).
              // Whether the WORK completed is judged from `execution` below.
              ...(v2Result ? {
                execution: {
                  mode: built.kernelResult.decision.routing.mode,
                  toolCalls: v2Result.toolCalls.map((c) => ({
                    toolId: c.toolId,
                    success: c.success,
                    mutating: c.mutating,
                  })),
                  deployment: deploymentEvidenceFrom(v2Result.toolCalls),
                },
              } : {}),
            },
            revision: newRevision,
            provider: routedProvider,
            model: routedModel,
            latencyMs: launchLatencyMs,
            v2: true,
            pendingApproval: actionableApproval ?? undefined,
            launchStatus: launchFlowResult?.status ?? undefined,
            previewUrl: launchFlowResult?.previewUrl ?? undefined,
            productionUrl: launchFlowResult?.productionUrl ?? undefined,
          });
        } else {
          // ── V1 fallback path: stream tool results, then run LLM ──
          if (v1Result?.ranTools) {
            for (const exec of v1Result.toolExecutions) {
              safeEvent({
                type: "tool_execution",
                toolId: exec.toolId,
                success: exec.success,
                summary: exec.summary,
              });
            }
          }

          // streamText receives the execution AbortSignal and propagates
          // it into every provider adapter (fetch signal, SDK request
          // options, stream readers) — an explicit Stop cancels the real
          // underlying HTTP request, not just the local wait. Transport
          // loss never touches this signal.
          let cancelledV1 = executionAbort.signal.aborted;
          let r: Awaited<ReturnType<typeof streamText>> | null = null;
          // The V1 text-only lane attaches NO tools to the model call, but
          // the shared runtime-context block teaches tool-invocation tokens
          // (files.write, path="index.html", …) that the model may echo as
          // text — markup that can never execute here. State the constraint
          // explicitly so the model answers in plain words instead.
          const v1TextPrompt = withV1NoToolsDirective(finalPrompt);
          if (!cancelledV1) {
            try {
              r = await streamText(
                v1TextPrompt,
                (chunk) => {
                  // Suppress late provider callbacks after an abort — a
                  // cancelled run must not keep mutating the response or
                  // writing to the (possibly dead) transport.
                  if (executionAbort.signal.aborted) return;
                  assistantText += chunk;
                  safeEvent({ type: "text", text: chunk });
                },
                {
                  task: "chat",
                  provider: category === "auto" ? undefined : provider,
                  category,
                  maxTokens: 2048,
                  modelOverride,
                  signal: executionAbort.signal,
                  evalMetadata: {
                    agentSlug,
                    agentMode: "v1-conversation",
                    conversationId: conversation.id,
                    userId,
                    projectId: conversation.projectId ?? undefined,
                  },
                },
                undefined,
                (reasoning) => {
                  if (executionAbort.signal.aborted) return;
                  reasoningText += reasoning;
                  safeEvent({ type: "reasoning", text: reasoning });
                },
              );
            } catch (streamErr) {
              // A provider abort surfaces here as an AbortError — treat it
              // as the cancellation it is. Any other failure is a real
              // provider error handled by the outer catch.
              if (executionAbort.signal.aborted) {
                cancelledV1 = true;
              } else {
                throw streamErr;
              }
            }
          }

          // Tool-protocol boundary for the text-only path: markup carrying
          // invocation intent (a recognized tool id or call-arg structure)
          // means the model tried to invoke a tool that can never execute
          // on this path. Persisting it as a completed answer was the
          // production defect — fail the run truthfully instead. Markup
          // without intent (quoted examples, orphan tags) is stripped so
          // it never reaches the transcript verbatim.
          const v1ToolIds = new Set(
            (await import("@/lib/litt-intelligence/tool-registry")).toolRegistry.list().map((t) => t.id),
          );
          const v1MarkupHit = !cancelledV1 && assistantText
            ? findToolCallMarkup(assistantText, v1ToolIds)
            : null;
          if (!cancelledV1 && !v1MarkupHit) {
            assistantText = stripToolCallMarkupText(assistantText);
          }

          // Defense in depth: streamText now throws on empty provider
          // payloads, but if a run still resolves with no usable text the
          // outcome is failed — never a completed empty response.
          const v1Empty = !cancelledV1 && !assistantText.trim();
          const v1Failed = !cancelledV1 && (v1Empty || v1MarkupHit !== null);
          const v1MessageStatus: MessageStatus = cancelledV1 ? "cancelled" : v1Failed ? "failed" : "completed";
          await updateMessageStatus(
            assistantMessage.id,
            userId,
            v1MessageStatus,
            v1MarkupHit
              ? "The model produced a tool call in a format this run cannot execute, so nothing was executed."
              : assistantText || undefined,
          );
          if (agentRunId) {
            const actualCredits = runtimeAgent
              ? estimateCredits(Math.ceil(finalPrompt.length / 4), Math.ceil(assistantText.length / 4), 1, 1)
              : 0;
            settleRun(agentRunId, {
              inputTokens: Math.ceil(finalPrompt.length / 4),
              outputTokens: Math.ceil(assistantText.length / 4),
              actualCredits,
              status: cancelledV1 ? "cancelled" : v1Failed ? "failed" : "completed",
            }, reservedCredits, reservationId).catch(() => {
              // Best-effort settlement — must not leak unhandled rejection
            });
          }

          // Skip memory persistence for cancelled, empty, and markup-failed
          // runs — partial or protocol-broken output must not become a
          // normal conversation_summary in long-term memory.
          if (!cancelledV1 && !v1Failed) {
            persistMemory(
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
            ).catch(() => {
              // Best-effort memory persistence — must not leak unhandled rejection
            });
          }

          studioLog("message:sent", {
            conversationId: conversation.id,
            projectId: conversation.projectId,
            userId,
            agentSlug,
            agentInstanceId: runtimeAgent?.agentInstanceId || null,
            provider: r?.provider,
            latencyMs: r?.latencyMs ?? 0,
            revisionBefore: conversation.revision,
            revisionAfter: newRevision,
            v2: false,
          });

          if (cancelledV1) {
            safeEvent({ type: "cancelled", reason: "user_stop" });
          }
          if (v1MarkupHit) {
            // Same contract as V2's tool_call_parse_failed — the run could
            // not execute the model's intended call, so it is a classified
            // failure, not a done card.
            studioLog("message:tool_call_markup_in_text", {
              requestId: rid,
              conversationId: conversation.id,
              projectId: conversation.projectId,
              userId,
              provider: r?.provider,
              model: r?.model,
              errorClass: `tool_call_markup_${v1MarkupHit.kind}`,
              tool: v1MarkupHit.toolId,
            });
            safeEvent({
              type: "error",
              code: "TOOL_CALL_PARSE_FAILED",
              message: "The model produced a tool call in a format this run cannot execute. Nothing was executed.",
              revision: newRevision,
            });
          } else if (v1Empty) {
            // Truthful terminal state for an empty provider payload: an
            // explicit classified error (with the bumped revision so the
            // client's next send doesn't 409 on a stale expectedRevision).
            studioLog("message:empty_provider_response", {
              conversationId: conversation.id,
              projectId: conversation.projectId,
              userId,
              agentSlug,
              provider: r?.provider,
              model: r?.model,
              latencyMs: r?.latencyMs ?? 0,
              finishReason: r?.finishReason,
              failover: r?.failover,
            });
            safeEvent({
              type: "error",
              code: "EMPTY_PROVIDER_RESPONSE",
              message: "The AI provider returned an empty response.",
              revision: newRevision,
            });
          } else {
            safeEvent({
              type: "done",
              userMessage,
              assistantMessage: {
                ...assistantMessage,
                content: assistantText,
                reasoning: reasoningText || undefined,
                status: v1MessageStatus,
                // V1 is the read-only fallback: it can inspect but never
                // mutate. Report the evidence bar and the (read-only) calls so
                // a build request answered here shows as NOT started, never
                // as completed work.
                execution: {
                  mode: built.kernelResult.decision.routing.mode,
                  toolCalls: (v1Result?.toolExecutions ?? []).map((exec) => ({
                    toolId: exec.toolId,
                    success: exec.success,
                    mutating: false,
                  })),
                  deployment: null,
                },
              },
              revision: newRevision,
              provider: r?.provider,
              model: r?.model,
              latencyMs: r?.latencyMs ?? 0,
            });
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "LLM provider unavailable";
        // An explicit execution abort wins over a provider error — a
        // cancelled run is persisted/reported as "cancelled" and must NOT
        // also emit a generic "error" event for the same Stop.
        const cancelledBySignal = executionAbort.signal.aborted;
        if (!cancelledBySignal) {
          console.error(`[messages-route:${rid}] Stream failed:`, errorMsg, err instanceof Error ? err.stack : "");
        }
        await updateMessageStatus(
          assistantMessage.id,
          userId,
          cancelledBySignal ? "cancelled" : "failed",
          cancelledBySignal ? assistantText || undefined : undefined,
        );
        if (agentRunId) {
          settleRun(agentRunId, {
            inputTokens: 0,
            outputTokens: 0,
            actualCredits: 0,
            status: cancelledBySignal ? "cancelled" : "failed",
            ...(cancelledBySignal ? {} : { error: errorMsg }),
          }, reservedCredits, reservationId).catch(() => {
            // Best-effort settlement on failure — must not leak unhandled rejection
          });
        }
        studioLog(cancelledBySignal ? "message:cancelled" : "message:failed", {
          conversationId: conversation.id,
          userId,
          agentSlug,
          errorClass: cancelledBySignal ? undefined : errorMsg,
        });
        if (cancelledBySignal) {
          safeEvent({ type: "cancelled", reason: "user_stop" });
          safeEvent({
            type: "done",
            userMessage,
            assistantMessage: {
              ...assistantMessage,
              content: assistantText,
              status: "cancelled" as MessageStatus,
            },
            revision: newRevision,
          });
        } else {
          safeEvent({
            type: "error",
            message: errorMsg,
            partialText: assistantText || undefined,
            // The revision RPC already bumped the conversation — the client
            // MUST learn the new revision even on failure, or its next send
            // posts a stale expectedRevision and gets a 409.
            revision: newRevision,
            ...(isEmptyProviderResponse(err) ? { code: "EMPTY_PROVIDER_RESPONSE" } : {}),
          });
        }
      } finally {
        clearInterval(heartbeatTimer);
        unregisterExecution(conversation.id, executionKey);
        if (!transportOpen) {
          studioLog("message:execution_finished_after_disconnect", {
            requestId: rid,
            conversationId: conversation.id,
            projectId: conversation.projectId,
            userId,
            clientRequestId,
          });
        }
        console.error(`[messages-route:${rid}] finally: emitting [DONE]`);
        safeEnqueue(encoder.encode("data: [DONE]\n\n"));
        try {
          controller.close();
          console.error(`[messages-route:${rid}] controller.close() succeeded`);
        } catch (e) {
          console.error(`[messages-route:${rid}] controller.close() failed:`, e instanceof Error ? e.message : String(e));
        }
        if (req.signal) {
          req.signal.removeEventListener("abort", onReqAbort);
        }
      }
    },
    cancel(reason) {
      // Downstream stopped consuming — mark the transport detached so SSE
      // writes become no-ops. The execution itself keeps running: only the
      // explicit cancel endpoint may abort it.
      console.error(`[messages-route:${rid}] stream cancelled by downstream:`, reason);
      markTransportDetached("downstream_cancel");
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

  // Rehydration: a run paused for ACT-mode approval survives reload only in
  // agent_paused_runs — the message row has no pending_approval column, and
  // the messages.status CHECK constraint does not (yet) accept
  // 'awaiting_approval', so a paused message can persist as 'streaming'.
  // The paused run row is authoritative: attach it to the latest assistant
  // message whenever its status still reflects an open turn.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (
    lastAssistant?.status === "awaiting_approval" ||
    lastAssistant?.status === "streaming"
  ) {
    try {
      const pendingRun = await getPendingPausedRunForConversation(conversation.id, userId);
      if (pendingRun) {
        lastAssistant.pendingApproval = {
          toolId: pendingRun.toolId,
          reason: pendingRun.reason,
          pausedRunId: pendingRun.id,
          inputs: pendingRun.inputs,
        };
      } else if (
        lastAssistant.status === "awaiting_approval" &&
        !getActiveExecution(conversation.id)
      ) {
        // The open turn has no resumable gate — the pause died without a
        // writeback (TTL expiry, or a decision writeback that missed).
        // Reconcile the message to a truthful terminal state instead of
        // leaving "Waiting for your approval" mounted forever.
        //
        // Precision guard: the latest run is only this message's gate when
        // it was created after the message. Without this, a STALE run from
        // the conversation's history (e.g. an approval that expired
        // yesterday) is attributed to a fresh approval whenever the
        // pending lookup misses — row persist failure, replication lag —
        // and the user sees "expired before a decision was made" within
        // seconds of the request (2026-09-18 defect). An unrelated run
        // leaves the message alone instead of writing a bogus note.
        const latestRun = await getLatestPausedRunForConversation(conversation.id, userId);
        const gateRun =
          latestRun &&
          pausedRunBelongsToMessage(latestRun.createdAt, lastAssistant.createdAt)
            ? latestRun
            : null;
        if (gateRun?.status === "expired") {
          const note = `${lastAssistant.content || "Approval was required."}\n\nThis approval expired before a decision was made — send the request again to continue.`;
          const persisted = await updateMessageStatus(lastAssistant.id, userId, "cancelled", note);
          if (persisted !== false) {
            lastAssistant.status = "cancelled";
            lastAssistant.content = note;
          }
        } else if (gateRun?.status === "rejected") {
          const note = `${lastAssistant.content || "Approval was required."}\n\nDeclined — the gated action was not performed.`;
          const persisted = await updateMessageStatus(lastAssistant.id, userId, "completed", note);
          if (persisted !== false) {
            lastAssistant.status = "completed";
            lastAssistant.content = note;
          }
        } else if (gateRun?.status === "approved" && gateRun.runStatus === "failed") {
          // The resumed run died without a transcript writeback — the
          // process was killed mid-flight and the stale-run watchdog
          // marked it failed. Reconcile the dead approval card to a
          // truthful terminal state instead of leaving it mounted.
          const note = `${lastAssistant.content || "Approval was required."}\n\nThe approved run failed before it could finish${gateRun.runError ? ` — ${gateRun.runError}` : ""}. Send the request again to retry.`;
          const persisted = await updateMessageStatus(lastAssistant.id, userId, "failed", note);
          if (persisted !== false) {
            lastAssistant.status = "failed";
            lastAssistant.content = note;
          }
        } else if (gateRun?.status === "approved" && gateRun.runStatus === "completed") {
          // The resumed run finished but its transcript writeback missed.
          // Reconcile to the recorded outcome — a nested gate whose row
          // was never persisted is a dead card and must surface as failed.
          const result = gateRun.runResult;
          const note = result?.pendingApproval
            ? `${lastAssistant.content || "Approval was required."}\n\nThe run reached a follow-up approval that could not be persisted — send the request again to retry.`
            : result?.finalText?.trim() ||
              `${lastAssistant.content || "Approval was required."}\n\nThe run finished, but its final response was lost — check the workspace for changes.`;
          const status = result?.pendingApproval
            ? "failed"
            : result?.cancelled
              ? "cancelled"
              : "completed";
          const persisted = await updateMessageStatus(lastAssistant.id, userId, status, note);
          if (persisted !== false) {
            lastAssistant.status = status;
            lastAssistant.content = note;
          }
        }
        // approved/processing gates own their writeback — leave the
        // message alone while the resumed run is in flight.
      } else if (
        lastAssistant.status === "streaming" &&
        lastAssistant.updatedAt &&
        Number.isFinite(Date.parse(lastAssistant.updatedAt)) &&
        Date.now() - Date.parse(lastAssistant.updatedAt) > STALE_STREAMING_MESSAGE_MS &&
        !getActiveExecution(conversation.id)
      ) {
        // No active execution and no resumable approval means the stream is
        // stale. Persist a truthful terminal state so reload cannot resurrect
        // the message as an active thinking indicator.
        const fallbackContent = lastAssistant.content?.trim()
          ? lastAssistant.content
          : "The previous run ended before it produced a result.";
        const persisted = await updateMessageStatus(
          lastAssistant.id,
          userId,
          "failed",
          fallbackContent,
        );
        if (persisted !== false) {
          lastAssistant.status = "failed";
          lastAssistant.content = fallbackContent;
        }
      }
    } catch {
      // Non-fatal — transcript still loads; the approval card just won't remount.
    }
  }

  return NextResponse.json({ messages, revision: conversation.revision });
}

export const POST = withRateLimit(postHandler, 60, 60);
export const GET = withRateLimit(getHandler, 200, 60);
