import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/litt/runs/[runId]
 *
 * Returns the status of an agent run, including its steps.
 * Used by the Studio to show run progress and survive page refresh.
 */
export async function GET(
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

  // Fetch the run, ensuring ownership
  const { data: run, error } = await supabaseAdmin
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to fetch run" }, { status: 500 });
  }

  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  // Fetch steps for this run
  const { data: steps } = await supabaseAdmin
    .from("agent_steps")
    .select("*")
    .eq("run_id", runId)
    .order("step_index", { ascending: true });

  return NextResponse.json({
    run: {
      id: run.id,
      status: run.status,
      model: run.model,
      provider: run.provider,
      creditsCharged: run.credits_charged,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      errorMessage: run.error_message,
      conversationId: run.conversation_id,
    },
    steps: (steps ?? []).map((s) => ({
      id: s.id,
      stepIndex: s.step_index,
      stepType: s.step_type,
      title: s.title,
      status: s.status,
      model: s.model,
      provider: s.provider,
      toolId: s.tool_id,
      creditsConsumed: s.credits_consumed,
      startedAt: s.started_at,
      completedAt: s.completed_at,
      errorMessage: s.error_message,
    })),
  });
}
