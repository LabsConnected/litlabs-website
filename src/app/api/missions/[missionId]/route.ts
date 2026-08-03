import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMission, updateMissionGraph } from "@/lib/missions/mission-repository";

/**
 * GET /api/missions/[missionId]
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { missionId } = await params;
  const mission = await getMission(missionId, userId);
  if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });

  return NextResponse.json({ mission });
}

/**
 * PATCH /api/missions/[missionId]
 * Update mission graph.
 * Body: { graph?: object, name?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { missionId } = await params;
  let body: { graph?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.graph) {
    const mission = await updateMissionGraph(missionId, userId, body.graph);
    if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });
    return NextResponse.json({ mission });
  }

  return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
}
