import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPausedRun, reRequestExpiredRun } from "@/lib/litt-intelligence/paused-run-store";
import { studioLog } from "@/lib/studio/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/studio/conversations/[conversationId]/approvals/re-request
 *
 * Re-issue an EXPIRED approval gate as a fresh pending run.
 *
 * Body: { pausedRunId: string } — the expired run to re-request.
 *
 * An expired approval used to dead-end the run: the transcript said "send
 * the request again", which re-ran the whole agent loop from scratch and
 * lost the frozen tool call the user was asked to approve. Re-requesting
 * creates a new pending run carrying the identical frozen inputs/reason,
 * so the user decides on the same gate with a fresh TTL — no new agent
 * loop, and no duplicate side effects (nothing executes until approved).
 *
 * Only `expired` runs can be re-requested:
 *   - 404: no such run (or not yours)
 *   - 409: the run is not expired (pending/approved/rejected)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  let body: { pausedRunId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pausedRunId = typeof body.pausedRunId === "string" ? body.pausedRunId : "";
  if (!pausedRunId) {
    return NextResponse.json({ error: "pausedRunId is required" }, { status: 400 });
  }

  let fresh: Awaited<ReturnType<typeof reRequestExpiredRun>>;
  try {
    // Verify conversation ownership before creating anything — the new
    // run inherits the expired run's conversation.
    const existing = await getPausedRun(pausedRunId, userId);
    if (!existing) {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }
    if (existing.conversationId !== conversationId) {
      studioLog("approval:re_request_conversation_mismatch", {
        conversationId,
        userId,
        pausedRunId,
      });
      return NextResponse.json({ error: "Conversation mismatch" }, { status: 403 });
    }
    fresh = await reRequestExpiredRun(pausedRunId, userId);
  } catch (err) {
    studioLog("approval:re_request_failed", {
      conversationId,
      userId,
      pausedRunId,
      errorClass: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not re-request the approval" },
      { status: 500 },
    );
  }

  if (!fresh) {
    // The run exists and is yours (checked above) but is not `expired`
    // (pending, approved, or rejected) — it cannot be re-requested.
    return NextResponse.json(
      { error: "Only expired approvals can be re-requested" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    pausedRunId: fresh.id,
    toolId: fresh.toolId,
    reason: fresh.reason,
    inputs: fresh.inputs,
    expiresAt: fresh.expiresAt,
  });
}
