import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { listPendingApprovals, resolveApproval, type MissionResult } from "@/lib/missions";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/missions/approvals
 * List all pending approvals for the authenticated user.
 */
async function getHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  return toResponse(await listPendingApprovals(userId));
}

/**
 * POST /api/missions/approvals
 * Resolve an approval (approve or deny).
 * Body: { approvalId: string, decision: "approved" | "denied" }
 */
async function postHandler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) return typedError(401, "Unauthorized");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return typedError(400, "Invalid JSON body"); }
  const approvalId = body.approvalId as string | undefined;
  const decision = body.decision as "approved" | "denied" | undefined;
  if (!approvalId) return typedError(400, "approvalId is required");
  if (decision !== "approved" && decision !== "denied") return typedError(400, "decision must be 'approved' or 'denied'");
  return toResponse(await resolveApproval(userId, approvalId, decision));
}

export const GET = withRateLimit(getHandler, 60, 60);
export const POST = withRateLimit(postHandler, 20, 60);

function typedError(status: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}
function toResponse<T>(result: MissionResult<T>): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true, data: result.data });
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
