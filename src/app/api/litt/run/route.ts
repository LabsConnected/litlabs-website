/**
 * POST /api/litt/run — canonical LiTT run endpoint.
 *
 * Implements the smallest canonical vertical slice:
 * 1. Authenticate the user
 * 2. Validate the request
 * 3. Resolve or create the canonical conversation
 * 4. Persist exactly one user message
 * 5. Create exactly one linked user Canvas transcript block
 * 6. Call routeKernel()
 * 7. Persist the LiTTControlDecision
 * 8. Create the assistant streaming message
 * 9. Create the linked assistant Canvas block
 * 10. Stream assistant deltas (via SSE events endpoint)
 * 11. Update the same message and Canvas block
 * 12. Finalize both exactly once
 * 13. Mark the run completed or failed
 *
 * This route returns immediately after steps 1-8 with the runId and
 * eventsUrl. The client connects to GET /api/litt/runs/[runId]/events
 * for streaming. The actual LLM streaming happens in a background
 * async function that continues after the response is sent.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { routeKernel, composeSystemPrompt } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";
import { streamText } from "@/lib/llm";
import {
  CreateRunRequestSchema,
  type CreateRunResponse,
  type KernelDecisionSummary,
} from "@/lib/litt/run-contract";
import {
  createRun,
  updateRunStatus,
  linkUserMessage,
  linkAssistantMessage,
  createMessage,
  updateMessage,
  appendEvent,
  persistKernelDecision,
  getOrCreateConversation,
} from "@/lib/litt/run-repository";
import {
  createTranscriptBlock,
  updateTranscriptBlock,
  getOrCreateCanvas,
} from "@/lib/litt/canvas-blocks";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Auth helper ─────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  // In demo mode (no Clerk keys), use a stable demo user id
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return "demo-user-00000000-0000-0000-0000-000000000000";
  }

  const sb = getSupabaseAdmin();
  if (!sb) return null;

  const { data: user } = await sb
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  return (user?.id as string) ?? null;
}

// ─── POST handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Authenticate
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateRunRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { message, conversationId, projectId, missionId, canvasId, inputMode } =
    parsed.data;

  try {
    // 3. Resolve or create conversation
    const convId = await getOrCreateConversation(
      userId,
      conversationId,
      "litt",
      "LiTT Conversation",
    );

    // 4. Create the run
    const { runId, createdAt } = await createRun({
      conversationId: convId,
      userId,
      projectId: projectId ?? null,
      missionId: missionId ?? null,
      canvasId: canvasId ?? null,
    });

    // Emit run.created event
    await appendEvent(runId, "run.created", {
      type: "run.created",
      runId,
      conversationId: convId,
      sequence: 0, // will be assigned by appendEvent
      timestamp: createdAt,
    });

    // 5. Persist exactly one user message
    const userMessage = await createMessage({
      conversationId: convId,
      runId,
      role: "user",
      content: message,
      status: "complete",
      inputMode,
    });
    await linkUserMessage(runId, userMessage.id);

    // Emit message.user.created event
    await appendEvent(runId, "message.user.created", {
      type: "message.user.created",
      runId,
      message: userMessage,
      sequence: 0,
      timestamp: now(),
    });

    // 6. Create linked user Canvas transcript block
    const canvasIdResolved = canvasId ?? await getOrCreateCanvas(
      userId,
      convId,
      projectId ?? null,
    );

    const userBlock = await createTranscriptBlock({
      canvasId: canvasIdResolved,
      userId,
      messageId: userMessage.id,
      speaker: "user",
      content: message,
      status: "complete",
    });

    // Link the Canvas block to the user message
    await updateMessage(userMessage.id, { canvasBlockId: userBlock.id });

    // Emit canvas.block.created event
    await appendEvent(runId, "canvas.block.created", {
      type: "canvas.block.created",
      runId,
      block: {
        id: userBlock.id,
        canvasId: userBlock.canvasId,
        messageId: userBlock.messageId,
        speaker: "user",
        content: userBlock.content,
        status: "complete",
        position: userBlock.position,
        createdAt: userBlock.createdAt,
        updatedAt: userBlock.updatedAt,
      },
      sequence: 0,
      timestamp: userBlock.createdAt,
    });

    // 7. Call routeKernel()
    const capabilities: CapabilityRecord[] = []; // Phase 2: no tool execution
    const kernelResult = routeKernel({
      message,
      userId,
      conversationId: convId,
      projectId: projectId ?? null,
      missionId: missionId ?? null,
      canvasId: canvasIdResolved,
      capabilities,
    });

    const decision = kernelResult.decision;

    // Build safe summary for UI display (no hidden chain-of-thought)
    const summary: KernelDecisionSummary = {
      mode: decision.routing.mode,
      requiresProject: decision.routing.requiresProject,
      capabilityIds: decision.execution.capabilityIds,
      skillIds: decision.execution.skillIds,
      modelProfileId: decision.execution.modelProfileId,
      risk: decision.governance.risk,
      approvalRequired: decision.governance.approvalRequired,
      assumptions: [],
      unknowns: [],
    };

    // 8. Persist the LiTTControlDecision
    await persistKernelDecision(
      runId,
      userId,
      decision as unknown as Record<string, unknown>,
      summary,
    );

    // Emit kernel.decision.created event
    await appendEvent(runId, "kernel.decision.created", {
      type: "kernel.decision.created",
      runId,
      decision: summary,
      sequence: 0,
      timestamp: now(),
    });

    // 9. Create the assistant streaming message
    const assistantMessage = await createMessage({
      conversationId: convId,
      runId,
      role: "assistant",
      content: "",
      status: "streaming",
      inputMode: "text",
    });
    await linkAssistantMessage(runId, assistantMessage.id);

    // Emit message.assistant.started event
    await appendEvent(runId, "message.assistant.started", {
      type: "message.assistant.started",
      runId,
      message: assistantMessage,
      sequence: 0,
      timestamp: now(),
    });

    // 10. Create linked assistant Canvas block
    const assistantBlock = await createTranscriptBlock({
      canvasId: canvasIdResolved,
      userId,
      messageId: assistantMessage.id,
      speaker: "litt",
      content: "",
      status: "streaming",
    });

    // Link the Canvas block to the assistant message
    await updateMessage(assistantMessage.id, { canvasBlockId: assistantBlock.id });

    // Update run status to streaming
    await updateRunStatus(runId, "streaming");

    // 11. Start streaming in the background (continues after response)
    streamAssistantResponse(
      runId,
      assistantMessage.id,
      assistantBlock.id,
      canvasIdResolved,
      convId,
      kernelResult.ok ? composeSystemPrompt(kernelResult.decision, capabilities) : "",
      message,
    ).catch(async (err) => {
      // If streaming fails, mark the run as failed
      const errorInfo = {
        code: "STREAMING_FAILED",
        message: err instanceof Error ? err.message : "Unknown streaming error",
        retryable: true,
      };
      await updateRunStatus(runId, "failed", errorInfo);
      await updateMessage(assistantMessage.id, {
        status: "failed",
        error: errorInfo,
      });
      await appendEvent(runId, "run.failed", {
        type: "run.failed",
        runId,
        error: errorInfo,
        sequence: 0,
        timestamp: now(),
      });
    });

    // Return immediately with runId and eventsUrl
    const response: CreateRunResponse = {
      runId,
      conversationId: convId,
      userMessage,
      kernelDecision: summary as unknown as Record<string, unknown>,
      eventsUrl: `/api/litt/runs/${runId}/events`,
    };

    return NextResponse.json(response, { status: 202 });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create run", details: errorMessage },
      { status: 500 },
    );
  }
}

// ─── Background streaming ─────────────────────────────────────────

async function streamAssistantResponse(
  runId: string,
  assistantMessageId: string,
  assistantBlockId: string,
  canvasId: string,
  _conversationId: string,
  systemPrompt: string,
  userMessage: string,
): Promise<void> {
  let fullContent = "";

  try {
    await streamText(
      userMessage,
      async (delta: string) => {
        fullContent += delta;

        // Update the assistant message content
        await updateMessage(assistantMessageId, { content: fullContent });

        // Update the Canvas block content
        await updateTranscriptBlock(assistantBlockId, canvasId, {
          content: fullContent,
          status: "streaming",
        });

        // Emit message.assistant.delta event
        await appendEvent(runId, "message.assistant.delta", {
          type: "message.assistant.delta",
          runId,
          messageId: assistantMessageId,
          delta,
          sequence: 0,
          timestamp: now(),
        });

        // Emit canvas.block.updated event
        await appendEvent(runId, "canvas.block.updated", {
          type: "canvas.block.updated",
          runId,
          blockId: assistantBlockId,
          content: fullContent,
          sequence: 0,
          timestamp: now(),
        });
      },
      { task: "chat" },
      systemPrompt || undefined,
    );

    // 12. Finalize the assistant message
    const completedAt = now();
    await updateMessage(assistantMessageId, {
      status: "complete",
      completedAt,
    });

    // Finalize the Canvas block
    await updateTranscriptBlock(assistantBlockId, canvasId, {
      status: "complete",
    });

    // Emit message.assistant.completed event
    await appendEvent(runId, "message.assistant.completed", {
      type: "message.assistant.completed",
      runId,
      message: {
        id: assistantMessageId,
        conversationId: _conversationId,
        runId,
        role: "assistant",
        content: fullContent,
        status: "complete",
        inputMode: "text",
        completedAt,
        createdAt: completedAt,
        updatedAt: completedAt,
      },
      sequence: 0,
      timestamp: completedAt,
    });

    // 13. Mark the run completed
    await updateRunStatus(runId, "completed");
    await appendEvent(runId, "run.completed", {
      type: "run.completed",
      runId,
      sequence: 0,
      timestamp: now(),
    });
  } catch (err) {
    // Mark the message as failed but preserve content received so far
    const errorInfo = {
      code: "PROVIDER_FAILED",
      message: err instanceof Error ? err.message : "Provider error",
      retryable: true,
    };

    await updateMessage(assistantMessageId, {
      status: "failed",
      error: errorInfo,
    });
    await updateTranscriptBlock(assistantBlockId, canvasId, {
      status: "failed",
    });
    await updateRunStatus(runId, "failed", errorInfo);

    await appendEvent(runId, "run.failed", {
      type: "run.failed",
      runId,
      error: errorInfo,
      sequence: 0,
      timestamp: now(),
    });

    throw err; // re-throw for the outer catch
  }
}

function now(): string {
  return new Date().toISOString();
}
