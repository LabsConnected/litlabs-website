import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getConversation } from "@/lib/studio/conversation-service";
import { requestExecutionCancellation } from "@/lib/studio/execution-registry";
import { studioLog } from "@/lib/studio/logger";

interface RouteParams {
  params: Promise<{ conversationId: string }>;
}

/**
 * POST /api/studio/conversations/[conversationId]/cancel
 *
 * Explicit, authenticated, user-scoped cancellation of the active LiTT
 * execution for this conversation.
 *
 * Browser/SSE disconnects do NOT cancel execution — this endpoint is the
 * only supported "Stop" path. It aborts the run's dedicated execution
 * AbortController registered by the messages route; the run then settles
 * through the normal launch-flow cancellation path and persists a
 * "cancelled" assistant message.
 *
 * Body (required): { clientRequestId: string }
 *   Cancellation is keyed to the exact client request — a stale Stop can
 *   never kill a newer run for the same conversation, and no wildcard
 *   pending cancellation is ever recorded.
 *
 * Idempotent: safe to call when no run is active (returns
 * status "recorded"/"not_found" rather than an error), safe to call
 * repeatedly.
 *
 * Security: requires auth; conversation ownership is verified before any
 * cancellation is attempted, and the registry re-checks that the active
 * execution belongs to the requesting user.
 */
async function postHandler(req: NextRequest, routeCtx: RouteParams) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId: convId } = await (routeCtx?.params ?? Promise.resolve({ conversationId: "" }));
  const conversation = await getConversation(convId, userId);
  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null) as { clientRequestId?: unknown } | null;
  const clientRequestId = typeof body?.clientRequestId === "string" && body.clientRequestId.trim()
    ? body.clientRequestId
    : undefined;

  // Exact request identity is mandatory — without it there is no safe way
  // to scope a cancellation, and recording a wildcard pending stamp could
  // kill the user's NEXT run in this conversation.
  if (!clientRequestId) {
    return NextResponse.json({ error: "clientRequestId is required" }, { status: 400 });
  }

  const result = requestExecutionCancellation(conversation.id, userId, clientRequestId);

  if (result.status === "forbidden") {
    // Active execution exists but is owned by a different user. This should
    // be unreachable once conversation ownership is verified — it is a
    // hard stop, not a silent no-op.
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  studioLog("message:execution_cancel_requested", {
    conversationId: conversation.id,
    projectId: conversation.projectId,
    userId,
    clientRequestId,
    status: result.status,
  });

  return NextResponse.json({
    cancelled: result.status === "aborted" || result.status === "recorded",
    status: result.status,
  });
}

export const POST = withRateLimit(postHandler, 60, 60);
