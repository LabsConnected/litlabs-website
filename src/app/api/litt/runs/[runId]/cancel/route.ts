import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/litt/runs/[runId]/cancel
 *
 * Cancels a running agent run. The run is marked as 'cancelled' and
 * any reserved credits are refunded. Long-running jobs continue
 * outside the browser request but check the run status periodically.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  if (!runId) {
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }

  // Resolve internal user ID
  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Verify ownership and check if the run is still active
  const { data: run, error: fetchError } = await supabaseAdmin
    .from("agent_runs")
    .select("id, status, user_id, credits_charged")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
    return NextResponse.json({
      error: `Run is already ${run.status}`,
      runId,
      status: run.status,
    }, { status: 409 });
  }

  // Mark the run as cancelled
  const { error: updateError } = await supabaseAdmin
    .from("agent_runs")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
  }

  // Refund reserved credits via the credit ledger
  if (run.credits_charged > 0) {
    await supabaseAdmin.rpc("refund_credits", {
      p_user_id: user.id,
      p_credits: run.credits_charged,
      p_reason: "Run cancelled by user",
    });
  }

  // Cancel any pending steps
  await supabaseAdmin
    .from("agent_steps")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("run_id", runId)
    .in("status", ["pending", "running"]);

  // Audit event
  await supabaseAdmin.from("audit_events").insert({
    user_id: user.id,
    event_type: "error",
    event_category: "info",
    description: `Run ${runId} cancelled by user`,
    metadata: { runId, refundedCredits: run.credits_charged },
    related_id: runId,
    related_type: "agent_run",
  });

  return NextResponse.json({
    runId,
    status: "cancelled",
    refundedCredits: run.credits_charged,
  });
}
