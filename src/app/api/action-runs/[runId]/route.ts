import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { ActionRuntimeError, getActionRun, listActionEvents } from "@/lib/action-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ runId: string }> };

async function handler(req: NextRequest, context: RouteContext) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { runId } = await context.params;
  if (!runId) return NextResponse.json({ error: "Missing run ID" }, { status: 400 });

  try {
    const run = await getActionRun(runId, userId);
    if (!run) return NextResponse.json({ error: "Action run not found" }, { status: 404 });
    const rawCursor = new URL(req.url).searchParams.get("afterSequence");
    // The sequence is a BIGINT identity transported as text — pass it
    // through untouched so cursors stay exact past 2^53.
    const afterSequence = rawCursor && /^\d+$/.test(rawCursor) ? rawCursor : undefined;
    const events = await listActionEvents(runId, userId, { afterSequence });
    return NextResponse.json({ run, events });
  } catch (error) {
    return runtimeErrorResponse(error);
  }
}

function runtimeErrorResponse(error: unknown): NextResponse {
  if (error instanceof ActionRuntimeError && error.code === "PERSISTENCE_UNAVAILABLE") {
    return NextResponse.json(
      { code: "ACTION_RUNTIME_UNAVAILABLE", message: "LiTT's activity service is temporarily unavailable." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { code: "ACTION_RUNTIME_READ_FAILED", message: "LiTT couldn't load this task." },
    { status: 500 },
  );
}

export const GET = withRateLimit(handler, 60, 60);
