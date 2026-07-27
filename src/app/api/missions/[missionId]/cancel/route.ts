import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getMission, updateMissionStatus } from "@/lib/missions/mission-repository";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/missions/[missionId]/cancel
 * Cancel a running mission.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ missionId: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { missionId } = await params;
  const mission = await getMission(missionId, userId);
  if (!mission) return NextResponse.json({ error: "Mission not found" }, { status: 404 });

  // Cancel the latest running/paused run
  const { data: runs } = await supabaseAdmin
    .from("mission_runs")
    .select("*")
    .eq("mission_id", missionId)
    .eq("user_id", userId)
    .in("status", ["running", "paused", "pending"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (runs && runs[0]) {
    await supabaseAdmin
      .from("mission_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", runs[0].id);
  }

  await updateMissionStatus(missionId, userId, "cancelled");
  return NextResponse.json({ success: true });
}
