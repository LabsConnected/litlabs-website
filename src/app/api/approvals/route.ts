import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listPendingApprovals } from "@/lib/missions/mission-repository";

/**
 * GET /api/approvals?projectId=xxx
 * List pending approvals for a project.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "Missing projectId" }, { status: 400 });

  const approvals = await listPendingApprovals(projectId, userId);
  return NextResponse.json({ approvals });
}
