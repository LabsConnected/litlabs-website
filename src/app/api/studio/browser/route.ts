import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listActionRuns } from "@/lib/action-runtime";
import { listStudioTasks } from "@/lib/studio/task-service";
import { canonicalBrowserJobsForScope } from "@/lib/studio/canonical-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId")?.trim();
  const conversationId = url.searchParams.get("conversationId")?.trim() || undefined;
  const runId = url.searchParams.get("runId")?.trim() || undefined;
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const tasks = await listStudioTasks(userId, projectId, true);
  const scopedTasks = tasks.filter((task) => !conversationId || task.conversationId === conversationId);
  const runs = await listActionRuns(userId, {
    projectId,
    conversationId,
    limit: 100,
  });
  const jobs = canonicalBrowserJobsForScope(runs, scopedTasks, runId);

  return NextResponse.json({ jobs });
}
