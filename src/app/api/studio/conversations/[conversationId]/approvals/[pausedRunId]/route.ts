import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  markRunCompleted,
  markRunFailed,
  type RunResult,
} from "@/lib/litt-intelligence/paused-run-store";
import { createWorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { resumeAgentLoopV2, type AgentLoopConfig } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";

/**
 * POST /api/studio/conversations/[conversationId]/approvals/[pausedRunId]
 *
 * Resolve a V2 agent loop paused approval. Server-authoritative.
 *
 * Body: { decision: "approved" | "rejected", reason?: string }
 *
 * On APPROVE:
 *   - Revalidate user ownership and workspace
 *   - Re-run permission validation
 *   - Persist the approval decision (single-use, atomic)
 *   - Start the resumed execution DETACHED from this HTTP request
 *   - Return 202 Accepted with { resolved: true, status: "processing" }
 *
 * The client polls GET /approvals/[pausedRunId] for run_status until
 * "completed" or "failed".
 *
 * Security:
 * - Never accepts replacement tool arguments
 * - Never trusts client-supplied paused state
 * - Approvals are single-use and expiring (5 min TTL)
 * - Re-verifies workspace ownership on resume
 * - Idempotent: repeated approval requests return 202 without
 *   launching duplicate executions
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string; pausedRunId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId, pausedRunId } = await params;

  let body: { decision?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.decision !== "approved" && body.decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 },
    );
  }

  // 1. Get the paused run — server-side state only
  const pausedRun = await getPausedRun(pausedRunId, userId);
  if (!pausedRun) {
    return NextResponse.json({ error: "Approval not found or expired" }, { status: 404 });
  }

  if (pausedRun.status !== "pending") {
    // Already resolved — check if the execution is still running
    // This is the idempotent path: a repeated approval request returns 202
    // with the current run status instead of launching a duplicate.
    if (pausedRun.status === "approved" || pausedRun.status === "rejected") {
      return NextResponse.json({
        resolved: true,
        decision: pausedRun.status,
        status: pausedRun.runStatus ?? "processing",
        pausedRunId,
        runStatus: pausedRun.runStatus,
        runError: pausedRun.runError,
      }, { status: 202 });
    }
    return NextResponse.json(
      { error: `Approval already ${pausedRun.status}` },
      { status: 409 },
    );
  }

  // 2. Verify conversation ownership
  if (pausedRun.conversationId !== conversationId) {
    return NextResponse.json({ error: "Conversation mismatch" }, { status: 403 });
  }

  // 3. Resolve the approval (single-use, atomic)
  const resolved = await resolvePausedRun(pausedRunId, userId, body.decision);
  if (!resolved) {
    return NextResponse.json(
      { error: "Approval could not be resolved (expired or already resolved)" },
      { status: 409 },
    );
  }

  // 4. For REJECTED: no resumed execution needed — return immediately
  if (body.decision === "rejected") {
    return NextResponse.json({
      resolved: true,
      decision: "rejected",
      status: "completed",
      pausedRunId,
    });
  }

  // 5. For APPROVED: validate workspace, then start detached execution
  let transport;
  try {
    transport = await createWorkspaceTransport(resolved.projectId, userId);
  } catch {
    await markRunFailed(pausedRunId, userId, "Workspace is no longer available");
    return NextResponse.json(
      {
        error:
          "Workspace is no longer available or you no longer have access. The approval has been recorded but the operation cannot proceed.",
        resolved: true,
        status: "failed",
        pausedRunId,
      },
      { status: 409 },
    );
  }

  // 6. Verify workspace hasn't changed in a way that invalidates the approval
  try {
    const verified = await verifyProjectWorkspace(resolved.projectId, userId);
    if (verified.workspaceId !== resolved.workspaceId) {
      await markRunFailed(pausedRunId, userId, "Workspace changed since approval");
      return NextResponse.json(
        {
          error:
            "Workspace has changed since the approval was requested. Please retry the operation.",
          resolved: true,
          status: "failed",
          pausedRunId,
        },
        { status: 409 },
      );
    }
  } catch {
    await markRunFailed(pausedRunId, userId, "Workspace verification failed on resume");
    return NextResponse.json(
      { error: "Workspace verification failed on resume", resolved: true, status: "failed" },
      { status: 500 },
    );
  }

  // 7. Mark the run as "processing" (atomic — prevents duplicate executions)
  const started = await markRunProcessing(pausedRunId, userId);
  if (!started) {
    // Another request already started the execution — return current status
    const current = await getPausedRun(pausedRunId, userId);
    return NextResponse.json({
      resolved: true,
      decision: "approved",
      status: current?.runStatus ?? "processing",
      pausedRunId,
      runStatus: current?.runStatus ?? "processing",
    }, { status: 202 });
  }

  // 8. Start the resumed execution DETACHED from this HTTP request.
  // Railway's long-running Node process keeps this promise alive after
  // the response is sent. The result is persisted to the DB so the client
  // can poll GET for completion.
  const resumeConfig: Partial<AgentLoopConfig> = {
    systemPrompt: resolved.systemPrompt,
    executionMode: resolved.executionMode,
    enableBuildFix: true,
  };

  // Fire-and-forget with proper error handling — NOT a floating promise.
  // The .then/.catch chain persists the result/error to the DB.
  void resumeAgentLoopV2(
    {
      pausedMessages: resolved.pausedMessages,
      toolId: resolved.toolId,
      toolCallId: resolved.toolCallId,
      inputs: resolved.inputs, // Frozen from pause time — never from client
      decision: body.decision as "approved" | "rejected",
      rejectionReason: body.reason,
      config: resumeConfig,
      stepsUsedBeforePause: 0,
      hadInterveningMutation: false,
      existingCheckpoint: resolved.checkpointId
        ? { checkpointId: resolved.checkpointId, label: "pre-approval", gitSha: "" }
        : undefined,
    },
    transport,
  )
    .then((result) => {
      const runResult: RunResult = {
        finalText: result.finalText,
        stepsUsed: result.stepsUsed,
        toolCalls: result.toolCalls,
        cancelled: result.cancelled,
        cancelReason: result.cancelReason,
        pendingApproval: result.pendingApproval
          ? {
              toolId: result.pendingApproval.toolId,
              pausedRunId: undefined, // Will be set by the next pause cycle
              reason: result.pendingApproval.reason,
            }
          : undefined,
      };
      return markRunCompleted(pausedRunId, userId, runResult);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : "Resume failed";
      return markRunFailed(pausedRunId, userId, message);
    });

  // 9. Return 202 Accepted immediately — the execution continues in the background
  return NextResponse.json({
    resolved: true,
    decision: "approved",
    status: "processing",
    pausedRunId,
    runStatus: "processing",
  }, { status: 202 });
}

/**
 * GET /api/studio/conversations/[conversationId]/approvals/[pausedRunId]
 * Get the status of a paused run, including async execution state.
 *
 * Returns:
 *   - status: "pending" | "approved" | "rejected" | "expired"
 *   - runStatus: null | "processing" | "completed" | "failed"
 *   - runResult: the resumed execution result (when completed)
 *   - runError: error message (when failed)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string; pausedRunId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { pausedRunId } = await params;
  const pausedRun = await getPausedRun(pausedRunId, userId);
  if (!pausedRun) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: pausedRun.id,
    toolId: pausedRun.toolId,
    inputs: pausedRun.inputs,
    reason: pausedRun.reason,
    status: pausedRun.status,
    expiresAt: pausedRun.expiresAt,
    createdAt: pausedRun.createdAt,
    runStatus: pausedRun.runStatus,
    runResult: pausedRun.runResult,
    runError: pausedRun.runError,
    runStartedAt: pausedRun.runStartedAt,
    runCompletedAt: pausedRun.runCompletedAt,
  });
}
