// Resolve an approval gate for a revenue agent run.
//
// POST /api/marketplace/agents/[id]/runs/[runId]/approvals
//
// Request body:
//   {
//     approvalId: string,
//     decision: "approved" | "rejected",
//     rejectionReason?: string
//   }
//
// Only the run owner can resolve approvals. The agent cannot
// approve its own actions — this is a human-in-the-loop gate.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveApproval, transitionRun } from "@/lib/revenue/agent-runs";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; runId: string }> },
) {
  const { clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // runId is in the path for routing but not needed — approvalId identifies the approval
  await ctx.params;

  let body: { approvalId?: string; decision?: string; rejectionReason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { approvalId, decision, rejectionReason } = body;

  if (!approvalId || typeof approvalId !== "string") {
    return NextResponse.json({ error: "Missing approvalId" }, { status: 400 });
  }
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  // Resolve internal user
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 401 });
  }

  const result = await resolveApproval(approvalId, user.id, decision, rejectionReason);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: 400 },
    );
  }

  // If approved, transition the run to the next state
  if (decision === "approved" && result.runId && result.type) {
    if (result.type === "plan") {
      await transitionRun(result.runId, user.id, "executing");
    } else if (result.type === "deploy") {
      await transitionRun(result.runId, user.id, "deploying");
    }
  } else if (decision === "rejected" && result.runId) {
    await transitionRun(result.runId, user.id, "failed", {
      error_code: "approval_rejected",
      error_message: rejectionReason ?? "User rejected approval",
    });
  }

  return NextResponse.json({ ok: true });
}
