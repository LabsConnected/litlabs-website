import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isOwnerClerkId } from "@/lib/owner-identity";
import {
  loadRepairCandidates,
  transitionRepairCandidate,
  type RepairCandidateState,
} from "@/lib/sentinel/repairs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/owner/sentinel/repairs/[id]
 * Body: { action: "approve" | "reject" | "cancel" | "running" | "pr_open" | "resolved" | "failed", note? }
 *
 * Owner-gated transitions for Sentinel repair candidates. This endpoint
 * ONLY moves the candidate state machine — it never executes repairs,
 * never calls `litt repair`, and never touches production. An approved
 * candidate is picked up by an external agent/operator workflow.
 */
const ACTION_TO_STATE: Record<string, RepairCandidateState> = {
  approve: "approved",
  reject: "rejected",
  cancel: "cancelled",
  running: "running",
  pr_open: "pr_open",
  resolved: "resolved",
  failed: "failed",
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isOwnerClerkId(userId)) {
    return NextResponse.json({ error: "Forbidden — owner access required" }, { status: 403 });
  }

  const { id } = await params;
  let body: { action?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = body.action ? ACTION_TO_STATE[body.action] : undefined;
  if (!to) {
    return NextResponse.json(
      { error: `Unknown action. Expected one of: ${Object.keys(ACTION_TO_STATE).join(", ")}` },
      { status: 400 },
    );
  }

  const db = getSupabaseAdmin();
  const next = await transitionRepairCandidate(db, id, to, `owner:${userId}`, body.note);
  if (!next) {
    return NextResponse.json(
      { error: "Transition rejected — illegal state change, budget/attempt cap, or candidate not found" },
      { status: 409 },
    );
  }

  const candidates = await loadRepairCandidates(db, 20);
  return NextResponse.json({ ok: true, id, state: next, repairCandidates: candidates });
}
