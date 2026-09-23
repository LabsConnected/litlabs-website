import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import {
  ActionRuntimeError,
  getActionRun,
  requestActionRunCancellation,
} from "@/lib/action-runtime";
import { requestExecutionCancellation } from "@/lib/studio/execution-registry";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ runId: string }> };

async function handler(req: NextRequest, context: RouteContext) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { runId } = await context.params;
  if (!runId) return NextResponse.json({ error: "Missing run ID" }, { status: 400 });

  const run = await getActionRun(runId, userId);
  if (!run) return NextResponse.json({ error: "Action run not found" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { clientRequestId?: unknown };
  const clientRequestId = typeof body.clientRequestId === "string" && body.clientRequestId.trim()
    ? body.clientRequestId
    : null;

  try {
    const updated = await requestActionRunCancellation(runId, userId);
    let executionStatus: string | null = null;
    if (run.conversationId && clientRequestId) {
      const result = requestExecutionCancellation(run.conversationId, userId, clientRequestId);
      if (result.status === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      executionStatus = result.status;
    }
    return NextResponse.json({ run: updated, cancellationRequested: true, executionStatus });
  } catch (error) {
    if (error instanceof ActionRuntimeError && error.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Action run not found" }, { status: 404 });
    }
    return NextResponse.json(
      { code: "ACTION_RUNTIME_CANCEL_FAILED", message: "LiTT couldn't stop this task." },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 30, 60);
