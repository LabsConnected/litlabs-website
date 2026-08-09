import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPausedRun, resolvePausedRun } from "@/lib/litt-intelligence/paused-run-store";
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
 *   - Execute the EXACT previously requested tool (frozen inputs)
 *   - Resume the V2 agent loop
 *   - Return the resumed result
 *
 * On REJECT:
 *   - Inject rejection as tool result
 *   - Resume V2 so LiTT can choose a safer alternative
 *
 * Security:
 *   - Never accepts replacement tool arguments
 *   - Never trusts client-supplied paused state
 *   - Approvals are single-use and expiring (5 min TTL)
 *   - Re-verifies workspace ownership on resume
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

  // 4. Re-validate workspace ownership and readiness
  let transport;
  try {
    transport = await createWorkspaceTransport(resolved.projectId, userId);
  } catch {
    return NextResponse.json(
      {
        error:
          "Workspace is no longer available or you no longer have access. The approval has been recorded but the operation cannot proceed.",
        resolved: true,
      },
      { status: 409 },
    );
  }

  // 5. Verify workspace hasn't changed in a way that invalidates the approval
  try {
    const verified = await verifyProjectWorkspace(resolved.projectId, userId);
    if (verified.workspaceId !== resolved.workspaceId) {
      return NextResponse.json(
        {
          error:
            "Workspace has changed since the approval was requested. Please retry the operation.",
          resolved: true,
        },
        { status: 409 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Workspace verification failed on resume" },
      { status: 500 },
    );
  }

  // 6. Resume the V2 agent loop with frozen inputs
  const resumeConfig: Partial<AgentLoopConfig> = {
    systemPrompt: resolved.systemPrompt,
    executionMode: resolved.executionMode,
    enableBuildFix: true,
  };

  try {
    const result = await resumeAgentLoopV2(
      {
        pausedMessages: resolved.pausedMessages,
        toolId: resolved.toolId,
        toolCallId: resolved.toolCallId,
        inputs: resolved.inputs, // Frozen from pause time — never from client
        decision: body.decision as "approved" | "rejected",
        rejectionReason: body.reason,
        config: resumeConfig,
        stepsUsedBeforePause: 0, // Will be adjusted by resume function
        hadInterveningMutation: false,
        existingCheckpoint: resolved.checkpointId
          ? { checkpointId: resolved.checkpointId, label: "pre-approval", gitSha: "" }
          : undefined,
      },
      transport,
    );

    return NextResponse.json({
      resolved: true,
      decision: body.decision,
      result: {
        finalText: result.finalText,
        stepsUsed: result.stepsUsed,
        toolCalls: result.toolCalls,
        cancelled: result.cancelled,
        cancelReason: result.cancelReason,
        pendingApproval: result.pendingApproval ?? undefined,
        buildFixResult: result.buildFixResult,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Resume failed";
    return NextResponse.json({ error: message, resolved: true }, { status: 500 });
  }
}

/**
 * GET /api/studio/conversations/[conversationId]/approvals/[pausedRunId]
 * Get the status of a paused run.
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
  });
}
