import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { applyHttpWorkspaceAction, getWorkspace, type HttpWorkspaceAction } from "@/lib/studio/workspace-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  try {
    const record = await getWorkspace(userId, projectId);
    if (!record) return NextResponse.json({ error: "Project not found" }, { status: 403 });
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Workspace persistence is not configured" }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { projectId?: string; revision?: number; action?: HttpWorkspaceAction } | null;
  if (!body?.projectId || typeof body.revision !== "number" || !body.action?.type) {
    return NextResponse.json({ error: "projectId, revision, and action are required" }, { status: 400 });
  }
  try {
    const result = await applyHttpWorkspaceAction(userId, body.projectId, body.revision, body.action);
    if ("error" in result) {
      return NextResponse.json({ error: result.error, workspace: result.record ?? null }, { status: result.status });
    }
    return NextResponse.json({ ...result.record, result: result.result });
  } catch {
    return NextResponse.json({ error: "Workspace persistence is not configured" }, { status: 503 });
  }
}
