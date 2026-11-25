import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isOwnerClerkId } from "@/lib/owner-identity";
import { getSentinelSnapshot } from "@/lib/sentinel";
import { loadRepairCandidates } from "@/lib/sentinel/repairs";
import { readHeartbeat } from "@/lib/sentinel/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/owner/sentinel
 *
 * Owner-only Sentinel snapshot: per-service health levels, open and
 * recent incidents, last probe pass time. Returns 403 for non-owners.
 * Never exposes secrets — probe details are sanitized upstream.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwnerClerkId(userId)) {
    return NextResponse.json(
      { error: "Forbidden — owner access required" },
      { status: 403 },
    );
  }

  try {
    const db = getSupabaseAdmin();
    const [snapshot, repairCandidates, heartbeat] = await Promise.all([
      getSentinelSnapshot(db),
      loadRepairCandidates(db, 20),
      readHeartbeat(db),
    ]);
    return NextResponse.json({ ...snapshot, repairCandidates, heartbeat });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sentinel snapshot failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
