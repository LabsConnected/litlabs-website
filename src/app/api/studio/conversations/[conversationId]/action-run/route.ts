import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getConversation } from "@/lib/studio/conversation-service";
import { listActionRuns, listActionEvents } from "@/lib/action-runtime";
import { buildActionRunProjection } from "@/lib/action-runtime/projection";
import { listPausedRunsForActionRun } from "@/lib/litt-intelligence/paused-run-store";

interface RouteParams {
  params?: Promise<{ conversationId: string }>;
}

export const runtime = "nodejs";

/**
 * GET /api/studio/conversations/[conversationId]/action-run
 *
 * Read-only projection of the durable parent ActionRun for the Studio
 * chat shell: run state, ordered event timeline, capability chips
 * (files/terminal/browser/preview/deploy/verify/approval), pending
 * approval gates, and deployment evidence — everything the
 * ActionRunStatusPanel needs to render truthful runtime state.
 *
 * Returns { projection: null } when the conversation has no ActionRun —
 * a conversation without durable execution is a normal state, not an error.
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

  // Latest run for this conversation — the projection renders terminal
  // truth too, so take the newest regardless of status.
  const runs = await listActionRuns(userId, { conversationId: convId, limit: 1 });
  const run = runs[0];
  if (!run) {
    return NextResponse.json({ projection: null });
  }

  const [events, pausedRuns] = await Promise.all([
    listActionEvents(run.id, userId, { limit: 200 }),
    listPausedRunsForActionRun(run.id, userId),
  ]);

  return NextResponse.json({
    projection: buildActionRunProjection({ run, events, pausedRuns }),
  });
}

export const GET = withRateLimit(getHandler, 60, 60);
