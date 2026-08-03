import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getApproval } from "@/lib/missions/mission-repository";
import { resolveMissionApproval } from "@/lib/missions/mission-executor";

/**
 * GET /api/approvals/[approvalId]
 * Get an approval with its diff and details.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { approvalId } = await params;
  const approval = await getApproval(approvalId, userId);
  if (!approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });

  return NextResponse.json({ approval });
}

/**
 * POST /api/approvals/[approvalId]
 * Resolve an approval. Server-enforced — the actual file write only
 * happens if the approval is approved server-side.
 *
 * Body: { decision: "approved" | "denied" }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { approvalId } = await params;
  let body: { decision?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.decision !== "approved" && body.decision !== "denied") {
    return NextResponse.json({ error: "decision must be 'approved' or 'denied'" }, { status: 400 });
  }

  // Verify ownership before resolving
  const approval = await getApproval(approvalId, userId);
  if (!approval) return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  if (approval.status !== "pending") {
    return NextResponse.json({ error: `Approval already ${approval.status}` }, { status: 409 });
  }

  try {
    const result = await resolveMissionApproval(approvalId, userId, body.decision);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve approval";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
