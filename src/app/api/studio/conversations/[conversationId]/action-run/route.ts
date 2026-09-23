import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getConversation } from "@/lib/studio/conversation-service";
import {
  getActionRun,
  listActionRuns,
  listActionEvents,
  isTerminalActionRunStatus,
  type ActionRun,
} from "@/lib/action-runtime";
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
 * Selection: an explicit ?runId is honored only when the run belongs to
 * this conversation (a client can pin a run, never project someone
 * else's); otherwise the newest non-terminal run wins, falling back to
 * the newest terminal run so finished tasks still render their truth.
 *
 * Returns { projection: null } when there is nothing truthful to show —
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

  let run: ActionRun | null = null;
  const explicitRunId = new URL(req.url).searchParams.get("runId");
  if (explicitRunId) {
    const explicit = await getActionRun(explicitRunId, userId);
    run = explicit && explicit.conversationId === convId ? explicit : null;
  } else {
    const runs = await listActionRuns(userId, { conversationId: convId, limit: 50 });
    run = runs.find((candidate) => !isTerminalActionRunStatus(candidate.status)) ?? runs[0] ?? null;
  }

  if (!run) {
    return NextResponse.json({ projection: null });
  }

  const [events, pausedRuns] = await Promise.all([
    listActionEvents(run.id, userId, { limit: 500 }),
    listPausedRunsForActionRun(run.id, userId),
  ]);

  return NextResponse.json({
    projection: buildActionRunProjection({ run, events, pausedRuns }),
  });
}

export const GET = withRateLimit(getHandler, 60, 60);
