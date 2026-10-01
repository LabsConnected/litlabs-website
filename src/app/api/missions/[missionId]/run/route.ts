import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMission } from "@/lib/missions/mission-repository";
import { startMissionRun } from "@/lib/missions/mission-executor";

/**
 * POST /api/missions/[missionId]/run
 * Start a mission run. This is the ONE endpoint MissionForge calls.
 * The server coordinates LLM, file operations, approvals, validation,
 * and checkpoints — the browser does not coordinate these directly.
 *
 * Body: { prompt: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { missionId } = await params;

  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.prompt || body.prompt.trim().length < 3) {
    return NextResponse.json({ error: "Prompt must be at least 3 characters" }, { status: 400 });
  }

  // Verify mission ownership
  const mission = await getMission(missionId, userId);
  if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });

  try {
    const result = await startMissionRun(missionId, mission.projectId, userId, body.prompt);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mission run failed";
    const status = message.includes("not found") ? 404
      : message.includes("not provisioned") || message.includes("not ready") ? 409
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
