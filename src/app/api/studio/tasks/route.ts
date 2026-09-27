import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createStudioTask, listStudioTasks } from "@/lib/studio/task-service";
import { TASK_TYPES, type StudioTaskType } from "@/lib/studio/task-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const all = await listStudioTasks(userId, projectId, url.searchParams.get("includeClosed") === "true");
  return NextResponse.json({
    tasks: all.filter((task) => !task.archivedAt),
    closedTasks: all.filter((task) => Boolean(task.archivedAt)),
  });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.projectId !== "string" || !body.projectId.trim()) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  const taskType = typeof body.taskType === "string" && TASK_TYPES.includes(body.taskType as StudioTaskType)
    ? body.taskType as StudioTaskType
    : "general";
  const task = await createStudioTask(userId, {
    projectId: body.projectId.trim(),
    title: typeof body.title === "string" ? body.title : undefined,
    taskType,
    conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
  });
  if (!task) return NextResponse.json({ error: "Project, conversation, or task association is not available" }, { status: 403 });
  return NextResponse.json({ task }, { status: 201 });
}
