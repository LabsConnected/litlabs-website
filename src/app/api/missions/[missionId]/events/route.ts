import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMission } from "@/lib/missions/mission-repository";
import { listSteps, listValidationResults } from "@/lib/missions/mission-repository";
import { listPendingApprovals } from "@/lib/missions/mission-repository";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/missions/[missionId]/events
 * Get the current state of a mission: runs, steps, approvals, validation results.
 * This is a polling endpoint (SSE could be added later).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { missionId } = await params;
  const mission = await getMission(missionId, userId);
  if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });

  // Get the latest run
  const { data: runs } = await supabaseAdmin
    .from("mission_runs")
    .select("*")
    .eq("mission_id", missionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const latestRun = runs?.[0];
  if (!latestRun) {
    return NextResponse.json({ mission, run: null, steps: [], approvals: [], validationResults: [] });
  }

  const [steps, approvals, validationResults] = await Promise.all([
    listSteps(latestRun.id),
    listPendingApprovals(mission.projectId, userId),
    listValidationResults(latestRun.id),
  ]);

  return NextResponse.json({
    mission,
    run: latestRun,
    steps,
    approvals: approvals.filter((a) => a.runId === latestRun.id),
    validationResults,
  });
}
