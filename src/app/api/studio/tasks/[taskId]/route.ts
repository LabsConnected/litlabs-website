import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getStudioTask, updateStudioTask } from "@/lib/studio/task-service";
import { TASK_STATUSES, type StudioTaskStatus } from "@/lib/studio/task-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ taskId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { taskId } = await params;
  const task = await getStudioTask(userId, taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { taskId } = await params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const requestedStatus = typeof body.status === "string" ? body.status as StudioTaskStatus : undefined;
  // Client task switching may close/reopen a tab, but cannot manufacture a
  // completed/failed/verification state. Runtime code owns those transitions.
  if (requestedStatus && !["ready", "closed"].includes(requestedStatus)) {
    return NextResponse.json({ error: "Task status is runtime-owned" }, { status: 400 });
  }
  if (requestedStatus && !TASK_STATUSES.includes(requestedStatus)) {
    return NextResponse.json({ error: "Invalid task status" }, { status: 400 });
  }

  const task = await updateStudioTask(userId, taskId, {
    title: typeof body.title === "string" ? body.title : undefined,
    status: requestedStatus,
    lastOpenedSurface: typeof body.lastOpenedSurface === "string" ? body.lastOpenedSurface : undefined,
    lastOpenedAt: new Date().toISOString(),
    close: requestedStatus === "closed",
    reopen: body.reopen === true,
  });
  if (!task) return NextResponse.json({ error: "Task not found or association is invalid" }, { status: 404 });
  return NextResponse.json({ task });
}
