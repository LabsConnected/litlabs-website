/**
 * POST /api/litt/runs/[runId]/retry — retry a failed or cancelled run.
 *
 * Creates a new run that is a retry of the original. The new run
 * reuses the same user message (no duplicate user content) and
 * creates a new assistant message + Canvas block.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { routeKernel, composeSystemPrompt } from "@/lib/litt-kernel";
import type { CapabilityRecord } from "@/lib/litt-kernel";
import { streamText } from "@/lib/llm";
import {
  getRun,
  createRun,
  updateRunStatus,
  linkUserMessage,
  linkAssistantMessage,
  createMessage,
  updateMessage,
  appendEvent,
  persistKernelDecision,
  setRetryOf,
} from "@/lib/litt/run-repository";
import {
  createTranscriptBlock,
  updateTranscriptBlock,
  getOrCreateCanvas,
} from "@/lib/litt/canvas-blocks";
import type { KernelDecisionSummary } from "@/lib/litt/run-contract";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserId(): Promise<string | null> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;
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

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const userId = await getUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId: originalRunId } = await params;

  // Get the original run
  const originalRun = await getRun(originalRunId);
  if (!originalRun || originalRun.user_id !== userId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Can only retry failed or cancelled runs
  if (!["failed", "cancelled"].includes(originalRun.status)) {
    return NextResponse.json(
      { error: "Can only retry failed or cancelled runs" },
      { status: 409 },
    );
  }

  // Get the original user message content
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 500 });
  }

  const { data: userMessageRow } = await sb
    .from("conversation_messages")
    .select("content, input_mode")
    .eq("id", originalRun.user_message_id)
    .maybeSingle();

  if (!userMessageRow) {
    return NextResponse.json({ error: "Original user message not found" }, { status: 404 });
  }

  const message = (userMessageRow as { content: string }).content;
  const inputMode = (userMessageRow as { input_mode: string }).input_mode as "text" | "voice" | "tool";

  try {
    // Create a new run (retry)
    const { runId: newRunId, createdAt } = await createRun({
      conversationId: originalRun.conversation_id,
      userId,
      projectId: originalRun.project_id,
      missionId: originalRun.mission_id,
      canvasId: originalRun.canvas_id,
    });

    // Set retry_of linkage
    await setRetryOf(newRunId, originalRunId);

    // Emit run.created event
    await appendEvent(newRunId, "run.created", {
      type: "run.created",
      runId: newRunId,
      conversationId: originalRun.conversation_id,
      sequence: 0,
      timestamp: createdAt,
    });

    // Reuse the original user message (no duplicate user content)
    // Link the original user message to the new run
    if (originalRun.user_message_id) {
      await linkUserMessage(newRunId, originalRun.user_message_id);
    }

    // Emit message.user.created event (referencing the existing message)
    await appendEvent(newRunId, "message.user.created", {
      type: "message.user.created",
      runId: newRunId,
      message: {
        id: originalRun.user_message_id,
        conversationId: originalRun.conversation_id,
        runId: newRunId,
        role: "user",
        content: message,
        status: "complete",
        inputMode,
        createdAt,
        updatedAt: createdAt,
      },
      sequence: 0,
      timestamp: createdAt,
    });

    // Get or create canvas
    const canvasId = originalRun.canvas_id ?? await getOrCreateCanvas(
      userId,
      originalRun.conversation_id,
      originalRun.project_id,
    );

    // Call routeKernel()
    const capabilities: CapabilityRecord[] = [];
    const kernelResult = routeKernel({
      message,
      userId,
      conversationId: originalRun.conversation_id,
      projectId: originalRun.project_id,
      missionId: originalRun.mission_id,
      canvasId,
      capabilities,
    });

    const decision = kernelResult.decision;
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

    await persistKernelDecision(
      newRunId,
      userId,
      decision as unknown as Record<string, unknown>,
      summary,
    );

    await appendEvent(newRunId, "kernel.decision.created", {
      type: "kernel.decision.created",
      runId: newRunId,
      decision: summary,
      sequence: 0,
      timestamp: new Date().toISOString(),
    });

    // Create new assistant message (new version, not duplicate user content)
    const assistantMessage = await createMessage({
      conversationId: originalRun.conversation_id,
      runId: newRunId,
      role: "assistant",
      content: "",
      status: "streaming",
      inputMode: "text",
    });
    await linkAssistantMessage(newRunId, assistantMessage.id);

    await appendEvent(newRunId, "message.assistant.started", {
      type: "message.assistant.started",
      runId: newRunId,
      message: assistantMessage,
      sequence: 0,
      timestamp: new Date().toISOString(),
    });

    // Create new assistant Canvas block
    const assistantBlock = await createTranscriptBlock({
      canvasId,
      userId,
      messageId: assistantMessage.id,
      speaker: "litt",
      content: "",
      status: "streaming",
    });

    await updateMessage(assistantMessage.id, { canvasBlockId: assistantBlock.id });
    await updateRunStatus(newRunId, "streaming");

    // Start streaming in background
    streamRetryResponse(
      newRunId,
      assistantMessage.id,
      assistantBlock.id,
      canvasId,
      originalRun.conversation_id,
      kernelResult.ok ? composeSystemPrompt(kernelResult.decision, capabilities) : "",
      message,
    ).catch(async (err) => {
      const errorInfo = {
        code: "STREAMING_FAILED",
        message: err instanceof Error ? err.message : "Unknown streaming error",
        retryable: true,
      };
      await updateRunStatus(newRunId, "failed", errorInfo);
      await updateMessage(assistantMessage.id, { status: "failed", error: errorInfo });
      await appendEvent(newRunId, "run.failed", {
        type: "run.failed",
        runId: newRunId,
        error: errorInfo,
        sequence: 0,
        timestamp: new Date().toISOString(),
      });
    });

    return NextResponse.json(
      {
        runId: newRunId,
        originalRunId,
        conversationId: originalRun.conversation_id,
        eventsUrl: `/api/litt/runs/${newRunId}/events`,
      },
      { status: 202 },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to create retry run", details: errorMessage },
      { status: 500 },
    );
  }
}

async function streamRetryResponse(
  runId: string,
  assistantMessageId: string,
  assistantBlockId: string,
  canvasId: string,
  conversationId: string,
  systemPrompt: string,
  userMessage: string,
): Promise<void> {
  let fullContent = "";

  try {
    await streamText(
      userMessage,
      async (delta: string) => {
        fullContent += delta;
        await updateMessage(assistantMessageId, { content: fullContent });
        await updateTranscriptBlock(assistantBlockId, canvasId, {
          content: fullContent,
          status: "streaming",
        });
        await appendEvent(runId, "message.assistant.delta", {
          type: "message.assistant.delta",
          runId,
          messageId: assistantMessageId,
          delta,
          sequence: 0,
          timestamp: new Date().toISOString(),
        });
        await appendEvent(runId, "canvas.block.updated", {
          type: "canvas.block.updated",
          runId,
          blockId: assistantBlockId,
          content: fullContent,
          sequence: 0,
          timestamp: new Date().toISOString(),
        });
      },
      { task: "chat" },
      systemPrompt || undefined,
    );

    const completedAt = new Date().toISOString();
    await updateMessage(assistantMessageId, { status: "complete", completedAt });
    await updateTranscriptBlock(assistantBlockId, canvasId, { status: "complete" });
    await appendEvent(runId, "message.assistant.completed", {
      type: "message.assistant.completed",
      runId,
      message: {
        id: assistantMessageId,
        conversationId,
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
    await updateRunStatus(runId, "completed");
    await appendEvent(runId, "run.completed", {
      type: "run.completed",
      runId,
      sequence: 0,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const errorInfo = {
      code: "PROVIDER_FAILED",
      message: err instanceof Error ? err.message : "Provider error",
      retryable: true,
    };
    await updateMessage(assistantMessageId, { status: "failed", error: errorInfo });
    await updateTranscriptBlock(assistantBlockId, canvasId, { status: "failed" });
    await updateRunStatus(runId, "failed", errorInfo);
    await appendEvent(runId, "run.failed", {
      type: "run.failed",
      runId,
      error: errorInfo,
      sequence: 0,
      timestamp: new Date().toISOString(),
    });
    throw err;
  }
}
