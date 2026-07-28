/**
 * POST /api/litt/runs/[runId]/cancel — cancel an active run.
 *
 * Marks the run as cancelled. The streaming background function
 * checks the run status and stops streaming. The assistant message
 * is marked as cancelled with whatever content was received so far.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getRun, updateRunStatus, appendEvent, updateMessage } from "@/lib/litt/run-repository";
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

  const { runId } = await params;

  const run = await getRun(runId);
  if (!run || run.user_id !== userId) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Can only cancel active runs
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return NextResponse.json(
      { error: "Run already in terminal state", status: run.status },
      { status: 409 },
    );
  }

  // Mark the run as cancelled
  await updateRunStatus(runId, "cancelled");

  // Mark the assistant message as cancelled
  if (run.assistant_message_id) {
    await updateMessage(run.assistant_message_id, {
      status: "cancelled",
      completedAt: new Date().toISOString(),
    });
  }

  // Emit run.cancelled event
  await appendEvent(runId, "run.cancelled", {
    type: "run.cancelled",
    runId,
    sequence: 0,
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ runId, status: "cancelled" });
}
